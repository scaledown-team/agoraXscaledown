import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Force dynamic — never cache this route
export const dynamic = "force-dynamic";

/**
 * GET /api/conversations
 * Returns all conversations with aggregated trace stats.
 */
export async function GET() {
  try {
    const { data: conversations, error: convError } = await supabase
      .from("conversations")
      .select("*");

    if (convError) {
      console.error("[conversations] Supabase error:", convError.message);
      return NextResponse.json({ error: convError.message }, { status: 500 });
    }

    if (!conversations || conversations.length === 0) {
      return NextResponse.json({ conversations: [] });
    }

    // Sort by created_at in JS to avoid any Supabase ordering issues
    conversations.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    // Per-mode counters for labeling: Baseline 1, 2, 3 / ScaleDown 1, 2, 3
    let baselineCounter = 0;
    let scaledownCounter = 0;

    const result = await Promise.all(conversations.map(async (conv) => {
      const modeLabel = conv.mode === "scaledown" ? "ScaleDown" : "Baseline";
      const modeIndex = conv.mode === "scaledown" ? ++scaledownCounter : ++baselineCounter;

      const { data: traces } = await supabase
        .from("trace_events")
        .select("original_tokens, compressed_tokens, compression_ratio, latency_ms, groq_latency_ms, total_latency_ms, compression_success, baseline_mode")
        .eq("conversation_id", conv.id);

      const n = traces?.length || 0;
      const totalSaved = (traces || []).reduce(
        (sum, t) => sum + Math.max(0, t.original_tokens - t.compressed_tokens), 0
      );
      const avgCompressionRatio = n > 0
        ? (traces || []).reduce((s, t) => s + t.compression_ratio, 0) / n
        : 0;
      const avgGroqLatencyMs = n > 0
        ? Math.round((traces || []).reduce((s, t) => s + (t.groq_latency_ms || 0), 0) / n)
        : 0;
      const avgScaledownLatencyMs = n > 0
        ? Math.round((traces || []).reduce((s, t) => s + (t.latency_ms || 0), 0) / n)
        : 0;
      const scaledownTurns = (traces || []).filter(t => !t.baseline_mode);
      const accuracyRate = scaledownTurns.length > 0
        ? scaledownTurns.filter(t => t.compression_success).length / scaledownTurns.length
        : 1;

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
        accuracyRate: Number(accuracyRate.toFixed(3)),
      };
    }));

    return NextResponse.json({ conversations: result });
  } catch (err) {
    console.error("[conversations] Unexpected error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
