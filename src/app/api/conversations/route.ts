import { NextResponse } from "next/server";

// Force dynamic — never cache this route
export const dynamic = "force-dynamic";

/**
 * Fetch conversations directly via Supabase REST API.
 * The JS client has an intermittent bug returning empty arrays,
 * so we bypass it for the conversations table.
 */
async function fetchConversations(): Promise<any[]> {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/conversations?select=*`;
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
 * GET /api/conversations
 * Returns all conversations with aggregated trace stats.
 */
export async function GET() {
  try {
    const conversations = await fetchConversations();

    if (!conversations || conversations.length === 0) {
      return NextResponse.json({ conversations: [] });
    }

    // Sort by created_at in JS
    conversations.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    // Per-mode counters for labeling: Baseline 1, 2, 3 / ScaleDown 1, 2, 3
    let baselineCounter = 0;
    let scaledownCounter = 0;

    const result = await Promise.all(conversations.map(async (conv: any) => {
      const modeLabel = conv.mode === "scaledown" ? "ScaleDown" : "Baseline";
      const modeIndex = conv.mode === "scaledown" ? ++scaledownCounter : ++baselineCounter;

      const traceRes = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/trace_events?conversation_id=eq.${encodeURIComponent(conv.id)}&select=original_tokens,compressed_tokens,compression_ratio,latency_ms,groq_latency_ms,total_latency_ms,compression_success,baseline_mode,cost_total_usd,quality_score,groq_prompt_tokens`,
        {
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          },
          cache: "no-store",
        }
      );
      const traces = traceRes.ok ? await traceRes.json() : [];

      const n = traces?.length || 0;
      const totalSaved = (traces || []).reduce(
        (sum: number, t: any) => sum + Math.max(0, t.original_tokens - t.compressed_tokens), 0
      );
      const avgCompressionRatio = n > 0
        ? (traces || []).reduce((s: number, t: any) => s + t.compression_ratio, 0) / n
        : 0;
      const avgGroqLatencyMs = n > 0
        ? Math.round((traces || []).reduce((s: number, t: any) => s + (t.groq_latency_ms || 0), 0) / n)
        : 0;
      const avgScaledownLatencyMs = n > 0
        ? Math.round((traces || []).reduce((s: number, t: any) => s + (t.latency_ms || 0), 0) / n)
        : 0;
      const avgTotalLatencyMs = n > 0
        ? Math.round((traces || []).reduce((s: number, t: any) => s + (t.total_latency_ms || t.latency_ms || 0), 0) / n)
        : 0;
      const scaledownTurns = (traces || []).filter((t: any) => !t.baseline_mode);
      const successfulCompressionRate = scaledownTurns.length > 0
        ? scaledownTurns.filter((t: any) => t.compression_success).length / scaledownTurns.length
        : 1;

      // Cost aggregation
      const totalCostUsd = (traces || []).reduce(
        (sum: number, t: any) => sum + (Number(t.cost_total_usd) || 0), 0
      );

      // Quality score aggregation
      const scoredTraces = scaledownTurns.filter((t: any) => t.quality_score != null);
      const avgQualityScore = scoredTraces.length > 0
        ? scoredTraces.reduce((s: number, t: any) => s + Number(t.quality_score), 0) / scoredTraces.length
        : null;
      const qualityCoverage = scaledownTurns.length > 0
        ? scoredTraces.length / scaledownTurns.length
        : 0;

      return {
        id: conv.id,
        label: `${modeLabel} ${modeIndex}`,
        mode: conv.mode as "baseline" | "scaledown",
        createdAt: conv.created_at,
        turns: n,
        totalTokensSaved: totalSaved,
        avgCompressionRatio: Number(avgCompressionRatio.toFixed(3)),
        avgGroqLatencyMs,
        avgScaledownLatencyMs,
        avgTotalLatencyMs,
        successfulCompressionRate: Number(successfulCompressionRate.toFixed(3)),
        totalCostUsd: Number(totalCostUsd.toFixed(8)),
        avgQualityScore: avgQualityScore != null ? Number(avgQualityScore.toFixed(3)) : null,
        qualityCoverage: Number(qualityCoverage.toFixed(3)),
      };
    }));

    return NextResponse.json({ conversations: result });
  } catch (err) {
    console.error("[conversations] Unexpected error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
