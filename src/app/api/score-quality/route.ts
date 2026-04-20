import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { scoreQuality } from "@/lib/quality";

export const dynamic = "force-dynamic";

/**
 * POST /api/score-quality
 *
 * Runs LLM-as-judge quality scoring on a conversation's trace events.
 * Requires shadow baseline to have been enabled (SHADOW_BASELINE=true)
 * so both response_text and shadow_response_text are available.
 *
 * Body: { conversationId: string }
 * Returns: { scored: number, skipped: number, scores: { turn, score }[] }
 */
export async function POST(req: NextRequest) {
  try {
    const { conversationId } = await req.json();

    if (!conversationId) {
      return NextResponse.json({ error: "conversationId required" }, { status: 400 });
    }

    // Fetch traces that have both responses (shadow baseline was enabled)
    const { data: traces, error } = await getSupabase()
      .from("trace_events")
      .select("id, turn, response_text, shadow_response_text, quality_score")
      .eq("conversation_id", conversationId)
      .not("response_text", "is", null)
      .not("shadow_response_text", "is", null)
      .order("turn", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!traces || traces.length === 0) {
      return NextResponse.json({
        error: "No traces with shadow baseline found. Enable SHADOW_BASELINE=true and run a ScaleDown conversation first.",
        scored: 0,
        skipped: 0,
        scores: [],
      });
    }

    const scores: { turn: number; score: number; error?: string }[] = [];
    let scored = 0;
    let skipped = 0;

    for (const trace of traces) {
      // Skip if already scored
      if (trace.quality_score != null) {
        scores.push({ turn: trace.turn, score: Number(trace.quality_score) });
        skipped++;
        continue;
      }

      const result = await scoreQuality(
        trace.response_text,
        trace.shadow_response_text,
        "" // user message not stored separately, judge works without it
      );

      if (result.score >= 0) {
        // Update the score in Supabase
        await getSupabase()
          .from("trace_events")
          .update({ quality_score: result.score })
          .eq("id", trace.id);

        scores.push({ turn: trace.turn, score: result.score });
        scored++;
      } else {
        scores.push({ turn: trace.turn, score: -1, error: result.error });
        skipped++;
      }
    }

    const avgScore = scores.filter(s => s.score >= 0).length > 0
      ? scores.filter(s => s.score >= 0).reduce((sum, s) => sum + s.score, 0) / scores.filter(s => s.score >= 0).length
      : null;

    return NextResponse.json({
      scored,
      skipped,
      avgScore: avgScore != null ? Number(avgScore.toFixed(3)) : null,
      scores,
    });
  } catch (err) {
    console.error("[score-quality] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
