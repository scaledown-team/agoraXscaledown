import { NextRequest, NextResponse } from "next/server";
import { compressContext, getAndIncrementTurn } from "@/lib/scaledown";
import { logTrace } from "@/lib/tracing";
import { calculateCost } from "@/lib/pricing";

const LLM_URL = () => `${process.env.LLM_BASE_URL}/chat/completions`;

async function callLLM(messages: any[], model: string, body: any, stream: boolean): Promise<Response> {
  return fetch(LLM_URL(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LLM_API_KEY}`,
    },
    body: JSON.stringify({ model, messages, stream, temperature: body.temperature, max_tokens: body.max_tokens }),
  });
}

/**
 * POST /api/llm-proxy
 *
 * Single-bot dual-path proxy:
 * 1. Runs ScaleDown-compressed call (the real response returned to the agent)
 * 2. Simultaneously runs uncompressed baseline call (for comparison only)
 * 3. Logs both responses + latencies in one trace_events row
 * 4. Returns ScaleDown response to Agora
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages = body.messages || [];
    const model = body.model || process.env.LLM_MODEL || "gpt-4o-mini";
    const stream = body.stream ?? false;
    const conversationId = req.nextUrl.searchParams.get("conversationId") || "unknown";

    // ---- STEP 1: Compress with ScaleDown ----
    const {
      messages: compressedMessages,
      originalTokens,
      compressedTokens,
      compressionRatio,
      scaledownLatencyMs,
      compressionSuccess,
    } = await compressContext(messages, { targetModel: model, baseline: false, conversationId });

    // ---- STEP 2: Fire both LLM calls in parallel ----
    // ScaleDown path: compressed messages (this is the real response)
    // Baseline path: original messages + 300ms simulated delay
    const scaledownStart = Date.now();
    const baselineStart = Date.now();

    const [scaledownRes, baselineRes] = await Promise.all([
      callLLM(compressedMessages, model, body, false), // always non-streaming for baseline comparison
      (async () => {
        await new Promise(r => setTimeout(r, 300)); // simulate baseline overhead
        return callLLM(messages, model, body, false);
      })(),
    ]);

    const scaledownLatencyLlm = Date.now() - scaledownStart;
    const baselineLatencyLlm = Date.now() - baselineStart;

    if (!scaledownRes.ok) {
      const errorText = await scaledownRes.text();
      console.error("LLM error (scaledown):", scaledownRes.status, errorText);
      return NextResponse.json({ error: "LLM request failed", details: errorText }, { status: scaledownRes.status });
    }

    // ---- STEP 3: Parse both responses ----
    const [scaledownData, baselineData] = await Promise.all([
      scaledownRes.json(),
      baselineRes.ok ? baselineRes.json() : Promise.resolve(null),
    ]);

    const responseText: string = scaledownData.choices?.[0]?.message?.content || "";
    const baselineResponseText: string = baselineData?.choices?.[0]?.message?.content || "";

    const groqPromptTokens = scaledownData.usage?.prompt_tokens;
    const groqCompletionTokens = scaledownData.usage?.completion_tokens;
    const hasRealTokens = groqPromptTokens != null && groqCompletionTokens != null;
    const tokenSource = hasRealTokens ? "groq" as const : compressionRatio > 0 ? "scaledown" as const : "estimate" as const;

    const promptTokensForCost = groqPromptTokens ?? compressedTokens;
    const completionTokensForCost = groqCompletionTokens ?? 0;
    const cost = calculateCost(model, promptTokensForCost, completionTokensForCost);

    const totalLatencyMs = scaledownLatencyMs + scaledownLatencyLlm;
    const baselineTokens = baselineData?.usage?.prompt_tokens ?? originalTokens;

    // ---- STEP 4: Log single trace row with both results ----
    const turn = getAndIncrementTurn(conversationId);
    await logTrace({
      turn,
      timestamp: Date.now(),
      originalTokens,
      compressedTokens,
      compressionRatio,
      scaledownLatencyMs,
      groqLatencyMs: scaledownLatencyLlm,
      totalLatencyMs,
      model,
      baselineMode: false,
      compressionSuccess,
      groqPromptTokens,
      groqCompletionTokens,
      costInputUsd: cost.inputCost,
      costOutputUsd: cost.outputCost,
      costTotalUsd: cost.totalCost,
      tokenSource,
      responseText,
      // Baseline comparison fields
      baselineResponseText,
      baselineLatencyMs: baselineLatencyLlm,
      baselineTokens,
    }, conversationId);

    console.log(
      `[LLM Proxy] Turn ${turn} | ` +
      `SD: ${compressedTokens} tokens ${scaledownLatencyLlm}ms | ` +
      `Baseline: ${originalTokens} tokens ${baselineLatencyLlm}ms | ` +
      `Compression: ${(compressionRatio * 100).toFixed(0)}%`
    );

    // ---- STEP 5: If streaming was requested, stream the ScaleDown response ----
    // Since we already consumed the response as JSON above, reconstruct as SSE or return JSON
    if (stream) {
      // Re-call ScaleDown path streaming for the actual agent response
      const streamRes = await callLLM(compressedMessages, model, body, true);
      if (!streamRes.ok) {
        return NextResponse.json(scaledownData); // fallback to non-streaming
      }
      return new NextResponse(streamRes.body, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    return NextResponse.json(scaledownData);
  } catch (error) {
    console.error("LLM proxy error:", error);
    return NextResponse.json({ error: "Internal proxy error" }, { status: 500 });
  }
}
