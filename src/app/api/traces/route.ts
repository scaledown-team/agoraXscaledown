import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Fetch trace events via Supabase REST API (bypasses JS client intermittent bugs).
 */
async function fetchTraces(conversationId: string): Promise<any[]> {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/trace_events?conversation_id=eq.${encodeURIComponent(conversationId)}&select=*&order=turn.asc`;
  const res = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Supabase REST error: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * GET /api/traces?conversationId=xxx
 * Returns trace events for a specific conversation from Supabase.
 */
export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get("conversationId");

  if (!conversationId) {
    return NextResponse.json({ totalTurns: 0, traces: [], summary: {} });
  }

  let rows: any[];
  try {
    rows = await fetchTraces(conversationId);
  } catch (err) {
    console.error("[Supabase] Failed to fetch traces:", err);
    return NextResponse.json({ error: "Failed to fetch traces" }, { status: 500 });
  }

  const traces = (rows || []).map((r, index) => ({
    turn: index + 1,
    timestamp: new Date(r.created_at).getTime(),
    originalTokens: r.original_tokens,
    compressedTokens: r.compressed_tokens,
    compressionRatio: r.compression_ratio,
    scaledownLatencyMs: r.latency_ms,
    groqLatencyMs: r.groq_latency_ms ?? 0,
    totalLatencyMs: r.total_latency_ms ?? r.latency_ms,
    model: r.model,
    baselineMode: r.baseline_mode,
    compressionSuccess: r.compression_success ?? true,
    // Phase 1: real tokens + cost
    groqPromptTokens: r.groq_prompt_tokens ?? null,
    groqCompletionTokens: r.groq_completion_tokens ?? null,
    costTotalUsd: r.cost_total_usd != null ? Number(r.cost_total_usd) : null,
    tokenSource: r.token_source ?? "estimate",
    // Phase 2: quality
    qualityScore: r.quality_score != null ? Number(r.quality_score) : null,
    responseText: r.response_text ?? null,
    // Phase 3: baseline comparison
    baselineResponseText: r.baseline_response_text ?? null,
    baselineLatencyMs: r.baseline_latency_ms ?? null,
    baselineTokens: r.baseline_tokens ?? null,
  }));

  const n = traces.length;
  const scaledownTurns = traces.filter(t => !t.baselineMode);
  const ns = scaledownTurns.length;

  const summary = n === 0 ? {
    avgOriginalTokens: 0,
    avgCompressedTokens: 0,
    avgCompressionRatio: 0,
    avgScaledownLatencyMs: 0,
    avgGroqLatencyMs: 0,
    avgTotalLatencyMs: 0,
    successfulCompressionRate: 0,
    totalCostUsd: 0,
    avgQualityScore: null as number | null,
    qualityCoverage: 0,
    totalGroqPromptTokens: 0,
    totalGroqCompletionTokens: 0,
  } : {
    avgOriginalTokens: Math.round(traces.reduce((s, t) => s + t.originalTokens, 0) / n),
    avgCompressedTokens: Math.round(traces.reduce((s, t) => s + t.compressedTokens, 0) / n),
    avgCompressionRatio: Number((traces.reduce((s, t) => s + t.compressionRatio, 0) / n).toFixed(3)),
    avgScaledownLatencyMs: Math.round(traces.reduce((s, t) => s + t.scaledownLatencyMs, 0) / n),
    avgGroqLatencyMs: Math.round(traces.reduce((s, t) => s + t.groqLatencyMs, 0) / n),
    avgTotalLatencyMs: Math.round(traces.reduce((s, t) => s + t.totalLatencyMs, 0) / n),
    successfulCompressionRate: ns > 0
      ? Number((scaledownTurns.filter(t => t.compressionSuccess).length / ns).toFixed(3))
      : 1,
    // Cost: sum of all per-turn costs
    totalCostUsd: Number(traces.reduce((s, t) => s + (t.costTotalUsd ?? 0), 0).toFixed(8)),
    // Quality: average of scored turns (null if no scores)
    avgQualityScore: (() => {
      const scored = traces.filter(t => t.qualityScore != null && t.qualityScore >= 0);
      return scored.length > 0
        ? Number((scored.reduce((s, t) => s + t.qualityScore!, 0) / scored.length).toFixed(3))
        : null;
    })(),
    qualityCoverage: ns > 0
      ? Number((traces.filter(t => !t.baselineMode && t.qualityScore != null && t.qualityScore >= 0).length / ns).toFixed(3))
      : 0,
    // Real token totals from Groq
    totalGroqPromptTokens: traces.reduce((s, t) => s + (t.groqPromptTokens ?? 0), 0),
    totalGroqCompletionTokens: traces.reduce((s, t) => s + (t.groqCompletionTokens ?? 0), 0),
  };

  return NextResponse.json({ totalTurns: n, traces, summary });
}
