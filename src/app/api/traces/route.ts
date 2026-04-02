import { NextResponse } from "next/server";
import { getTraceLog, clearTraceLog } from "@/lib/tracing";

/**
 * GET /api/traces
 *
 * Returns the in-memory trace log for the current session.
 * Use this to pull benchmark data after running a conversation.
 */
export async function GET() {
  const traces = getTraceLog();
  return NextResponse.json({
    totalTurns: traces.length,
    mode: traces[0]?.baselineMode ? "baseline" : "scaledown",
    traces,
    summary: {
      avgOriginalTokens: traces.length > 0
        ? Math.round(traces.reduce((sum, t) => sum + t.originalTokens, 0) / traces.length)
        : 0,
      avgCompressedTokens: traces.length > 0
        ? Math.round(traces.reduce((sum, t) => sum + t.compressedTokens, 0) / traces.length)
        : 0,
      avgCompressionRatio: traces.length > 0
        ? Number((traces.reduce((sum, t) => sum + t.compressionRatio, 0) / traces.length).toFixed(3))
        : 0,
      avgLatencyMs: traces.length > 0
        ? Math.round(traces.reduce((sum, t) => sum + t.latencyMs, 0) / traces.length)
        : 0,
    },
  });
}

/**
 * DELETE /api/traces — Clear trace log before a new benchmark run
 */
export async function DELETE() {
  clearTraceLog();
  return NextResponse.json({ success: true, message: "Trace log cleared" });
}
