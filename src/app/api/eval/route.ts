import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * ROUGE-1 F1 score — unigram overlap between hypothesis and reference.
 * Measures lexical overlap: 1.0 = identical words, 0.0 = no overlap.
 * No external deps needed — pure string math.
 */
function rouge1F1(hypothesis: string, reference: string): number {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  const hyp = normalize(hypothesis);
  const ref = normalize(reference);
  if (hyp.length === 0 || ref.length === 0) return 0;
  // Count matches (clipped by reference frequency)
  const refCounts = new Map<string, number>();
  ref.forEach(w => refCounts.set(w, (refCounts.get(w) ?? 0) + 1));
  let matches = 0;
  hyp.forEach(w => {
    const c = refCounts.get(w) ?? 0;
    if (c > 0) { matches++; refCounts.set(w, c - 1); }
  });
  const precision = matches / hyp.length;
  const recall = matches / ref.length;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Fetch conversations directly via REST (JS client has intermittent issues).
 */
async function fetchConversations(): Promise<any[]> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/conversations?select=*&order=created_at.asc`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
      cache: "no-store",
    }
  );
  if (!res.ok) throw new Error(`Supabase REST error: ${res.status}`);
  return res.json();
}

/**
 * POST /api/eval
 * Aggregates real conversation data from Supabase.
 * Compares baseline vs ScaleDown across all recorded conversations.
 */
export async function POST() {
  try {
    const conversations = await fetchConversations();

    if (!conversations || conversations.length === 0) {
      return NextResponse.json({ error: "No conversations found. Run some baseline and ScaleDown conversations first." }, { status: 400 });
    }

    // Fetch all traces grouped by conversation
    const conversationResults = await Promise.all(
      conversations.map(async (conv: any) => {
        const traceRes = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/trace_events?conversation_id=eq.${encodeURIComponent(conv.id)}&select=*&order=turn.asc`,
          {
            headers: {
              apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
              Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
            },
            cache: "no-store",
          }
        );
        const rows = traceRes.ok ? await traceRes.json() : [];
        if (rows.length === 0) return null;

        const totalOriginalTokens = rows.reduce((s: number, t: any) => s + (t.original_tokens || 0), 0);
        const totalCompressedTokens = rows.reduce((s: number, t: any) => s + (t.compressed_tokens || 0), 0);
        const totalGroqPromptTokens = rows.reduce((s: number, t: any) => s + (t.groq_prompt_tokens || 0), 0);
        const totalGroqCompletionTokens = rows.reduce((s: number, t: any) => s + (t.groq_completion_tokens || 0), 0);
        const totalCost = rows.reduce((s: number, t: any) => s + (Number(t.cost_total_usd) || 0), 0);
        const avgCompressionRatio = rows.reduce((s: number, t: any) => s + (t.compression_ratio || 0), 0) / rows.length;
        const avgGroqLatency = rows.reduce((s: number, t: any) => s + (t.groq_latency_ms || 0), 0) / rows.length;
        const avgScaledownLatency = rows.reduce((s: number, t: any) => s + (t.latency_ms || 0), 0) / rows.length;
        const avgTotalLatency = rows.reduce((s: number, t: any) => s + (t.total_latency_ms || t.latency_ms || 0), 0) / rows.length;

        // LLM-judge quality scores
        const scored = rows.filter((t: any) => t.quality_score != null);
        const avgQuality = scored.length > 0
          ? scored.reduce((s: number, t: any) => s + Number(t.quality_score), 0) / scored.length
          : null;

        // ROUGE-1 F1 — computed from stored response pairs (no extra API calls)
        const rougeRows = rows.filter((t: any) => t.response_text && t.shadow_response_text);
        const avgRouge = rougeRows.length > 0
          ? rougeRows.reduce((s: number, t: any) =>
              s + rouge1F1(t.response_text, t.shadow_response_text), 0) / rougeRows.length
          : null;

        // Token source breakdown
        const realTokenTurns = rows.filter((t: any) => t.token_source === "groq").length;

        return {
          id: conv.id,
          mode: conv.mode,
          label: conv.label || conv.mode,
          createdAt: conv.created_at,
          turns: rows.length,
          totalOriginalTokens,
          totalCompressedTokens,
          tokensSaved: totalOriginalTokens - totalCompressedTokens,
          avgCompressionRatio: Number(avgCompressionRatio.toFixed(3)),
          totalGroqPromptTokens,
          totalGroqCompletionTokens,
          totalCost: Number(totalCost.toFixed(8)),
          avgGroqLatencyMs: Math.round(avgGroqLatency),
          avgScaledownLatencyMs: Math.round(avgScaledownLatency),
          avgTotalLatencyMs: Math.round(avgTotalLatency),
          avgQualityScore: avgQuality != null ? Number(avgQuality.toFixed(3)) : null,
          avgRougeScore: avgRouge != null ? Number(avgRouge.toFixed(3)) : null,
          rougeScoredTurns: rougeRows.length,
          scoredTurns: scored.length,
          realTokenTurns,
          hasRealTokens: realTokenTurns > 0,
        };
      })
    );

    const validResults = conversationResults.filter(Boolean) as any[];
    const baselineResults = validResults.filter((r: any) => r.mode === "baseline");
    const scaledownResults = validResults.filter((r: any) => r.mode === "scaledown");

    // Aggregate by mode
    const aggregate = (group: any[]) => {
      if (group.length === 0) return null;
      const totalTurns = group.reduce((s, r) => s + r.turns, 0);
      const totalOriginal = group.reduce((s, r) => s + r.totalOriginalTokens, 0);
      const totalCompressed = group.reduce((s, r) => s + r.totalCompressedTokens, 0);
      const totalGroqPrompt = group.reduce((s, r) => s + r.totalGroqPromptTokens, 0);
      const totalGroqCompletion = group.reduce((s, r) => s + r.totalGroqCompletionTokens, 0);
      const totalCost = group.reduce((s, r) => s + r.totalCost, 0);
      const avgGroqLatency = totalTurns > 0
        ? Math.round(group.reduce((s, r) => s + r.avgGroqLatencyMs * r.turns, 0) / totalTurns)
        : 0;
      const avgScaledownLatency = totalTurns > 0
        ? Math.round(group.reduce((s, r) => s + r.avgScaledownLatencyMs * r.turns, 0) / totalTurns)
        : 0;
      const avgTotalLatency = totalTurns > 0
        ? Math.round(group.reduce((s, r) => s + r.avgTotalLatencyMs * r.turns, 0) / totalTurns)
        : 0;
      const scored = group.filter(r => r.avgQualityScore != null);
      const avgQuality = scored.length > 0
        ? Number((scored.reduce((s, r) => s + r.avgQualityScore, 0) / scored.length).toFixed(3))
        : null;
      const rougeScored = group.filter(r => r.avgRougeScore != null);
      const avgRouge = rougeScored.length > 0
        ? Number((rougeScored.reduce((s, r) => s + r.avgRougeScore, 0) / rougeScored.length).toFixed(3))
        : null;
      const totalScoredTurns = group.reduce((s, r) => s + (r.scoredTurns || 0), 0);
      const totalRougeTurns = group.reduce((s, r) => s + (r.rougeScoredTurns || 0), 0);

      return {
        conversations: group.length,
        totalTurns,
        totalOriginalTokens: totalOriginal,
        totalCompressedTokens: totalCompressed,
        tokensSaved: totalOriginal - totalCompressed,
        compressionPct: totalOriginal > 0 ? Number(((1 - totalCompressed / totalOriginal) * 100).toFixed(1)) : 0,
        totalGroqPromptTokens: totalGroqPrompt,
        totalGroqCompletionTokens: totalGroqCompletion,
        totalCost: Number(totalCost.toFixed(8)),
        avgGroqLatencyMs: avgGroqLatency,
        avgScaledownLatencyMs: avgScaledownLatency,
        avgTotalLatencyMs: avgTotalLatency,
        avgQualityScore: avgQuality,
        avgRougeScore: avgRouge,
        qualityCoverage: totalTurns > 0 ? Number((totalScoredTurns / totalTurns).toFixed(3)) : 0,
        rougeCoverage: totalTurns > 0 ? Number((totalRougeTurns / totalTurns).toFixed(3)) : 0,
      };
    };

    const baselineAgg = aggregate(baselineResults);
    const scaledownAgg = aggregate(scaledownResults);

    // Comparison
    const comparison = (baselineAgg && scaledownAgg) ? {
      tokenSavingsPct: baselineAgg.totalOriginalTokens > 0
        ? Number(((1 - scaledownAgg.totalCompressedTokens / baselineAgg.totalOriginalTokens) * 100).toFixed(1))
        : scaledownAgg.compressionPct,
      costSavingsPct: baselineAgg.totalCost > 0
        ? Number(((1 - scaledownAgg.totalCost / baselineAgg.totalCost) * 100).toFixed(1))
        : 0,
      latencyDiffMs: scaledownAgg.avgTotalLatencyMs - baselineAgg.avgTotalLatencyMs,
      groqLatencyDiffMs: scaledownAgg.avgGroqLatencyMs - baselineAgg.avgGroqLatencyMs,
      scaledownOverheadMs: scaledownAgg.avgScaledownLatencyMs,
    } : null;

    return NextResponse.json({
      results: validResults,
      baseline: baselineAgg,
      scaledown: scaledownAgg,
      comparison,
      summary: {
        totalConversations: validResults.length,
        baselineCount: baselineResults.length,
        scaledownCount: scaledownResults.length,
        totalTurns: validResults.reduce((s, r) => s + r.turns, 0),
        totalTokensSaved: scaledownResults.reduce((s, r) => s + r.tokensSaved, 0),
        overallCompressionPct: scaledownAgg?.compressionPct ?? 0,
        overallCostSavings: comparison?.costSavingsPct ?? 0,
        avgQualityScore: scaledownAgg?.avgQualityScore ?? null,
        avgRougeScore: scaledownAgg?.avgRougeScore ?? null,
        qualityCoverage: scaledownAgg?.qualityCoverage ?? 0,
        rougeCoverage: scaledownAgg?.rougeCoverage ?? 0,
      },
    });
  } catch (err) {
    console.error("[eval] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
