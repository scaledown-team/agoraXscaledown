export interface TraceEvent {
  turn: number;
  timestamp: number;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  scaledownLatencyMs: number;  // time ScaleDown took to compress
  groqLatencyMs: number;       // time Groq took to respond
  totalLatencyMs: number;      // scaledown + groq combined
  model: string;
  baselineMode: boolean;
  compressionSuccess: boolean; // did ScaleDown successfully compress

  // Real token counts from Groq's response (Phase 1)
  groqPromptTokens?: number;
  groqCompletionTokens?: number;

  // Cost tracking (Phase 1)
  costInputUsd?: number;
  costOutputUsd?: number;
  costTotalUsd?: number;
  tokenSource: "groq" | "scaledown" | "estimate";

  // Quality measurement (Phase 2)
  responseText?: string;
  shadowResponseText?: string;
  qualityScore?: number;

  // Single-bot dual-path (Phase 3)
  baselineResponseText?: string;
  baselineLatencyMs?: number;
  baselineTokens?: number;
}

/**
 * Write a trace event to Supabase via direct REST API.
 * Bypasses the JS client which has intermittent insert issues.
 */
export async function logTrace(event: TraceEvent, conversationId: string): Promise<void> {
  const costStr = event.costTotalUsd != null
    ? ` | cost: $${event.costTotalUsd.toFixed(6)}`
    : "";
  const realTokenStr = event.groqPromptTokens != null
    ? ` | groq_tokens: ${event.groqPromptTokens}in/${event.groqCompletionTokens}out`
    : "";

  console.log(
    `[Turn ${event.turn}] ` +
    `tokens: ${event.originalTokens} -> ${event.compressedTokens} ` +
    `(${(event.compressionRatio * 100).toFixed(1)}% saved) | ` +
    `scaledown: ${event.scaledownLatencyMs}ms | groq: ${event.groqLatencyMs}ms | ` +
    `total: ${event.totalLatencyMs}ms | ` +
    `accuracy: ${event.compressionSuccess ? "✓" : "✗"} | ` +
    `mode: ${event.baselineMode ? "BASELINE" : "SCALEDOWN"} | ` +
    `source: ${event.tokenSource}${realTokenStr}${costStr}`
  );

  const row = {
    conversation_id: conversationId,
    turn: event.turn,
    original_tokens: event.originalTokens,
    compressed_tokens: event.compressedTokens,
    compression_ratio: event.compressionRatio,
    latency_ms: event.scaledownLatencyMs,
    groq_latency_ms: event.groqLatencyMs,
    total_latency_ms: event.totalLatencyMs,
    baseline_mode: event.baselineMode,
    model: event.model,
    compression_success: event.compressionSuccess,
    groq_prompt_tokens: event.groqPromptTokens ?? null,
    groq_completion_tokens: event.groqCompletionTokens ?? null,
    cost_input_usd: event.costInputUsd ?? null,
    cost_output_usd: event.costOutputUsd ?? null,
    cost_total_usd: event.costTotalUsd ?? null,
    token_source: event.tokenSource,
    response_text: event.responseText ?? null,
    shadow_response_text: event.shadowResponseText ?? null,
    quality_score: event.qualityScore ?? null,
    baseline_response_text: event.baselineResponseText ?? null,
    baseline_latency_ms: event.baselineLatencyMs ?? null,
    baseline_tokens: event.baselineTokens ?? null,
  };

  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/trace_events`,
      {
        method: "POST",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(row),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      console.error("[Supabase REST] Failed to write trace:", res.status, text);
    }
  } catch (err) {
    console.error("[Supabase REST] Network error writing trace:", err);
  }
}

/**
 * Rough token count estimate (1 token ≈ 4 chars for English).
 * Used as fallback when real token counts are unavailable.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
