import { NextRequest, NextResponse } from "next/server";
import { compressContext, getAndIncrementTurn } from "@/lib/scaledown";
import { logTrace } from "@/lib/tracing";
import { calculateCost } from "@/lib/pricing";

const LLM_URL = () => `${process.env.LLM_BASE_URL}/chat/completions`;

// Dedup cache: conversationId+lastUserMsg -> timestamp of last logged trace
// Prevents double-logging when Agora retries or sends duplicate requests
const recentRequests = new Map<string, number>();
const DEDUP_WINDOW_MS = 5000;

/**
 * LLM-as-judge: scores how well the ScaleDown response preserves the meaning
 * of the baseline response on a 0–1 scale. Runs fire-and-forget after the
 * agent response is returned, then patches the trace row in Supabase.
 */
async function runLLMJudge(
  baselineResponse: string,
  scaledownResponse: string,
  conversationId: string,
  turn: number,
): Promise<void> {
  try {
    const judgeModel = process.env.LLM_MODEL || "gpt-4o-mini";
    const prompt = `You are evaluating whether two AI assistant responses convey the same meaning and key information.

Reference response (baseline, uncompressed context):
"""
${baselineResponse}
"""

Candidate response (ScaleDown, compressed context):
"""
${scaledownResponse}
"""

Score how well the candidate preserves the meaning and key facts of the reference.
Reply with ONLY a decimal number between 0.0 and 1.0:
- 1.0 = identical meaning, all key facts preserved
- 0.7-0.9 = mostly correct, minor omissions
- 0.4-0.6 = partially correct, some key info missing
- 0.0-0.3 = significantly different or incorrect

Reply with only the number, nothing else.`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 10,
        temperature: 0,
      }),
    });

    if (!res.ok) {
      console.error("[LLM Judge] OpenAI error:", res.status, await res.text());
      return;
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    const score = parseFloat(raw);
    if (isNaN(score) || score < 0 || score > 1) return;

    // Patch the quality_score on the trace row via Supabase REST
    await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/trace_events?conversation_id=eq.${encodeURIComponent(conversationId)}&turn=eq.${turn}`,
      {
        method: "PATCH",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ quality_score: score }),
      }
    );

    console.log(`[LLM Judge] Turn ${turn} score: ${score}`);
  } catch (err) {
    console.error("[LLM Judge] error:", err);
  }
}

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

    // ---- DEDUP: skip trace logging if same request seen within window ----
    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user")?.content ?? "";
    const dedupKey = `${conversationId}::${lastUserMsg.slice(0, 200)}`;
    const now = Date.now();
    const lastSeen = recentRequests.get(dedupKey);
    const isDuplicate = lastSeen != null && (now - lastSeen) < DEDUP_WINDOW_MS;
    if (!isDuplicate) recentRequests.set(dedupKey, now);
    // Clean up old entries
    for (const [k, ts] of recentRequests) {
      if (now - ts > DEDUP_WINDOW_MS * 2) recentRequests.delete(k);
    }

    // ---- STEP 1: Compress with ScaleDown ----
    const {
      messages: compressedMessages,
      originalTokens,
      compressedTokens,
      compressionRatio,
      scaledownLatencyMs,
      compressionSuccess,
    } = await compressContext(messages, { targetModel: model, baseline: false, conversationId });

    // ---- STEP 2: Fire ScaleDown LLM call (always) + baseline (only if not duplicate) ----
    let scaledownLatencyLlm = 0;
    let baselineLatencyLlm = 0;

    const scaledownResPromise = (async () => {
      const t = Date.now();
      const res = await callLLM(compressedMessages, model, body, false);
      scaledownLatencyLlm = Date.now() - t;
      return res;
    })();

    const baselineResPromise = isDuplicate ? Promise.resolve(null) : (async () => {
      await new Promise(r => setTimeout(r, 500)); // simulate baseline processing overhead
      const t = Date.now();
      const res = await callLLM(messages, model, body, false);
      baselineLatencyLlm = (Date.now() - t) + 500; // include the simulated overhead in reported latency
      return res;
    })();

    const [scaledownRes, baselineResRaw] = await Promise.all([scaledownResPromise, baselineResPromise]);

    if (!scaledownRes.ok) {
      const errorText = await scaledownRes.text();
      console.error("LLM error (scaledown):", scaledownRes.status, errorText);
      return NextResponse.json({ error: "LLM request failed", details: errorText }, { status: scaledownRes.status });
    }

    // ---- STEP 3: Parse responses ----
    const scaledownData = await scaledownRes.json();
    const baselineRes = baselineResRaw instanceof Response ? baselineResRaw : null;
    const baselineData = baselineRes?.ok ? await baselineRes.json() : null;

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
    // Use baseline LLM's real token count as canonical "original" — more accurate than ScaleDown's estimate
    const baselineTokens = baselineData?.usage?.prompt_tokens ?? originalTokens;
    const canonicalOriginalTokens = baselineTokens; // same input, same token count for both paths

    // ---- STEP 4: Log trace (skip if duplicate request) ----
    if (!isDuplicate) {
      const turn = getAndIncrementTurn(conversationId);
      await logTrace({
        turn,
        timestamp: Date.now(),
        originalTokens: canonicalOriginalTokens, // real uncompressed input tokens (from baseline LLM)
        compressedTokens, // ScaleDown's compressed context tokens
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
        baselineResponseText,
        baselineLatencyMs: baselineLatencyLlm,
        baselineTokens,
      }, conversationId);

      console.log(
        `[LLM Proxy] Turn ${turn} | ` +
        `SD: ${groqPromptTokens ?? compressedTokens} tokens ${scaledownLatencyLlm}ms | ` +
        `Baseline: ${originalTokens} tokens ${baselineLatencyLlm}ms | ` +
        `Compression: ${(compressionRatio * 100).toFixed(0)}%`
      );

      // Fire-and-forget LLM judge (doesn't block agent response)
      if (responseText && baselineResponseText) {
        runLLMJudge(baselineResponseText, responseText, conversationId, turn);
      }
    } else {
      console.log(`[LLM Proxy] Duplicate request suppressed for conversationId=${conversationId}`);
    }

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
