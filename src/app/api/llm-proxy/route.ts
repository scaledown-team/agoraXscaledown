import { NextRequest, NextResponse } from "next/server";
import { compressContext, getAndIncrementTurn } from "@/lib/scaledown";
import { logTrace } from "@/lib/tracing";
import { calculateCost } from "@/lib/pricing";
import { scoreQuality } from "@/lib/quality";

/**
 * Shared Supabase PATCH helper for writing quality scores back to a trace row.
 */
async function patchTraceQuality(
  conversationId: string,
  turn: number,
  responseText: string,
  shadowResponseText: string,
  qualityScore: number | null
): Promise<void> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/trace_events?conversation_id=eq.${encodeURIComponent(conversationId)}&turn=eq.${turn}`,
    {
      method: "PATCH",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ response_text: responseText, shadow_response_text: shadowResponseText, quality_score: qualityScore }),
    }
  );
  if (!res.ok) console.warn("[patchTraceQuality] PATCH failed:", res.status, await res.text());
  else console.log(`[patchTraceQuality] Turn ${turn} patched — quality: ${qualityScore ?? "n/a"}`);
}

/**
 * For ScaleDown turns: shadow = uncompressed Groq call. Scores ScaleDown vs uncompressed.
 * Fire-and-forget.
 */
async function runShadowAndPatch(
  responseText: string,
  messages: any[],
  model: string,
  body: any,
  conversationId: string,
  turn: number,
  latestUserMessage: string
): Promise<void> {
  const llmUrl = `${process.env.LLM_BASE_URL}/chat/completions`;

  // 1. Call Groq non-streaming with original (uncompressed) messages
  const shadowRes = await fetch(llmUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: body.temperature,
      max_tokens: body.max_tokens,
      stream: false,
    }),
  });
  if (!shadowRes.ok) {
    console.warn("[runShadowAndPatch] Shadow Groq call failed:", shadowRes.status);
    return;
  }
  const shadowData = await shadowRes.json();
  const shadowResponseText = shadowData.choices?.[0]?.message?.content || "";

  // 2. Score + patch
  const qualityResult = await scoreQuality(responseText, shadowResponseText, latestUserMessage);
  await patchTraceQuality(conversationId, turn, responseText, shadowResponseText,
    qualityResult.score >= 0 ? qualityResult.score : null);
}

/**
 * For Baseline turns: shadow = ScaleDown-compressed Groq call. Scores baseline vs compressed.
 * Fire-and-forget.
 */
async function runBaselineShadowAndPatch(
  responseText: string,
  messages: any[],
  model: string,
  body: any,
  conversationId: string,
  turn: number,
  latestUserMessage: string
): Promise<void> {
  const llmUrl = `${process.env.LLM_BASE_URL}/chat/completions`;

  // 1. Compress the same messages with ScaleDown
  const { messages: compressedMessages, compressionSuccess } = await compressContext(messages, { targetModel: model });
  if (!compressionSuccess) {
    console.warn("[runBaselineShadowAndPatch] ScaleDown compression failed, skipping");
    return;
  }

  // 2. Call Groq with compressed messages (what ScaleDown would have sent)
  const shadowRes = await fetch(llmUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LLM_API_KEY}` },
    body: JSON.stringify({ model, messages: compressedMessages, temperature: body.temperature, max_tokens: body.max_tokens, stream: false }),
  });
  if (!shadowRes.ok) {
    console.warn("[runBaselineShadowAndPatch] Shadow Groq call failed:", shadowRes.status);
    return;
  }
  const shadowResponseText = (await shadowRes.json()).choices?.[0]?.message?.content || "";

  // 3. Score baseline response vs compressed response + patch
  const qualityResult = await scoreQuality(responseText, shadowResponseText, latestUserMessage);
  await patchTraceQuality(conversationId, turn, responseText, shadowResponseText,
    qualityResult.score >= 0 ? qualityResult.score : null);
}

/**
 * POST /api/llm-proxy
 *
 * ============================================================
 * THIS IS THE CORE SCALEDOWN INTEGRATION POINT
 * ============================================================
 *
 * This endpoint acts as an OpenAI-compatible proxy that:
 * 1. Receives conversation messages from Agora's AI agent
 * 2. Compresses the accumulated context with ScaleDown /compress
 * 3. Forwards the compressed context to Groq (measuring inference latency)
 * 4. Extracts REAL token counts from Groq's response for accurate metrics
 * 5. Logs full metrics: tokens, latency, cost, accuracy
 * 6. Optionally runs shadow baseline for quality comparison
 * 7. Returns Groq's response back to Agora
 *
 * Flow:
 *   Agora agent -> this proxy -> ScaleDown /compress -> Groq -> response -> Agora
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages = body.messages || [];
    const model = body.model || process.env.LLM_MODEL || "llama-3.3-70b-versatile";
    const stream = body.stream ?? false;

    const isBaseline = req.nextUrl.searchParams.get("baseline") === "true";
    const conversationId = req.nextUrl.searchParams.get("conversationId") || "unknown";

    // ---- STEP 1: Compress with ScaleDown (or pass-through in baseline) ----
    const {
      messages: compressedMessages,
      originalTokens,
      compressedTokens,
      compressionRatio,
      scaledownLatencyMs,
      compressionSuccess,
    } = await compressContext(messages, { targetModel: model, baseline: isBaseline, conversationId });

    // ---- STEP 2: Forward to Groq (measuring inference latency) ----
    const llmUrl = `${process.env.LLM_BASE_URL}/chat/completions`;
    const groqStart = Date.now();

    const llmResponse = await fetch(llmUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: compressedMessages,
        stream,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
      }),
    });

    const groqLatencyMs = Date.now() - groqStart;
    const totalLatencyMs = scaledownLatencyMs + groqLatencyMs;

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();
      console.error("Groq API error:", llmResponse.status, errorText);
      return NextResponse.json(
        { error: "LLM request failed", details: errorText },
        { status: llmResponse.status }
      );
    }

    // ---- STEP 3: Parse response and extract REAL token counts ----
    // Streaming: tap the SSE stream to collect responseText, then log after stream ends
    if (stream) {
      const turn = getAndIncrementTurn(conversationId);
      const decoder = new TextDecoder();
      let collectedText = "";

      const tapStream = new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(chunk);
          // Parse SSE chunks to extract response content
          const text = decoder.decode(chunk, { stream: true });
          for (const line of text.split("\n")) {
            if (line.startsWith("data: ") && !line.includes("[DONE]")) {
              try {
                const json = JSON.parse(line.slice(6));
                const delta = json.choices?.[0]?.delta?.content;
                if (delta) collectedText += delta;
              } catch { /* ignore malformed chunks */ }
            }
          }
        },
        flush() {
          // Stream finished — log trace with full response text (non-blocking)
          logTrace({
            turn, timestamp: Date.now(),
            originalTokens, compressedTokens, compressionRatio,
            scaledownLatencyMs, groqLatencyMs, totalLatencyMs,
            model, baselineMode: isBaseline, compressionSuccess,
            tokenSource: "estimate",
            responseText: collectedText,
          }, conversationId).catch(console.error);

          if (process.env.SHADOW_BASELINE === "true" && !isBaseline && compressionSuccess && collectedText) {
            const latestUserMessage = [...messages].reverse()
              .find((m: any) => m.role === "user")?.content || "";
            runShadowAndPatch(collectedText, messages, model, body, conversationId, turn, latestUserMessage).catch(console.error);
          }
        },
      });

      llmResponse.body!.pipeThrough(tapStream);
      return new NextResponse(tapStream.readable, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // Non-streaming: parse JSON to get real usage data
    const data = await llmResponse.json();

    // Extract real token counts from Groq's response
    const groqPromptTokens = data.usage?.prompt_tokens;
    const groqCompletionTokens = data.usage?.completion_tokens;
    const hasRealTokens = groqPromptTokens != null && groqCompletionTokens != null;

    // Determine token source: prefer Groq's real counts > ScaleDown's counts > estimate
    const tokenSource = hasRealTokens ? "groq" as const
      : compressionRatio > 0 ? "scaledown" as const
      : "estimate" as const;

    // Calculate cost using best available token counts
    const promptTokensForCost = groqPromptTokens ?? compressedTokens;
    const completionTokensForCost = groqCompletionTokens ?? 0;
    const cost = calculateCost(model, promptTokensForCost, completionTokensForCost);

    // Extract response text for quality comparison
    const responseText = data.choices?.[0]?.message?.content || "";

    // ---- STEP 4: Shadow baseline (optional) ----
    // If SHADOW_BASELINE=true and this is a ScaleDown turn, also call Groq
    // with the ORIGINAL uncompressed messages to get a baseline response for comparison
    let shadowResponseText: string | undefined;
    let qualityScore: number | undefined;
    if (process.env.SHADOW_BASELINE === "true" && !isBaseline && compressionSuccess) {
      try {
        const shadowResponse = await fetch(llmUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.LLM_API_KEY}`,
          },
          body: JSON.stringify({
            model,
            messages, // original uncompressed messages
            temperature: body.temperature,
            max_tokens: body.max_tokens,
          }),
        });
        if (shadowResponse.ok) {
          const shadowData = await shadowResponse.json();
          shadowResponseText = shadowData.choices?.[0]?.message?.content || "";

          const latestUserMessage = [...messages]
            .reverse()
            .find((message: { role?: string; content?: string }) => message.role === "user")
            ?.content || "";
          const qualityResult = await scoreQuality(
            responseText,
            shadowResponseText || "",
            latestUserMessage
          );
          if (qualityResult.score >= 0) {
            qualityScore = qualityResult.score;
          } else {
            console.warn("[Shadow baseline] Quality scoring failed:", qualityResult.error);
          }
        }
      } catch (e) {
        console.warn("[Shadow baseline] Failed:", e);
      }
    }

    // ---- STEP 5: Log full metrics ----
    const turn = getAndIncrementTurn(conversationId);
    await logTrace({
      turn,
      timestamp: Date.now(),
      originalTokens,
      compressedTokens,
      compressionRatio,
      scaledownLatencyMs,
      groqLatencyMs,
      totalLatencyMs,
      model,
      baselineMode: isBaseline,
      compressionSuccess,
      groqPromptTokens,
      groqCompletionTokens,
      costInputUsd: cost.inputCost,
      costOutputUsd: cost.outputCost,
      costTotalUsd: cost.totalCost,
      tokenSource,
      responseText,
      shadowResponseText,
      qualityScore,
    }, conversationId);

    console.log(
      `[LLM Proxy] Turn ${turn} | ` +
      `${originalTokens} → ${compressedTokens} tokens (est) | ` +
      `Groq real: ${groqPromptTokens ?? "?"}in/${groqCompletionTokens ?? "?"}out | ` +
      `Cost: $${cost.totalCost.toFixed(6)} | ` +
      `ScaleDown: ${scaledownLatencyMs}ms | Groq: ${groqLatencyMs}ms | Total: ${totalLatencyMs}ms`
    );

    // ---- STEP 6: Return response to Agora ----
    return NextResponse.json(data);
  } catch (error) {
    console.error("LLM proxy error:", error);
    return NextResponse.json(
      { error: "Internal proxy error" },
      { status: 500 }
    );
  }
}
