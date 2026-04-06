"use client";

import { useState, useCallback, useEffect } from "react";
import { useConversation } from "@/hooks/useConversation";

interface TraceEvent {
  turn: number;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  latencyMs: number;
  baselineMode: boolean;
}

interface TraceData {
  totalTurns: number;
  mode: string;
  traces: TraceEvent[];
  summary: {
    avgOriginalTokens: number;
    avgCompressedTokens: number;
    avgCompressionRatio: number;
    avgLatencyMs: number;
  };
}

export default function Home() {
  const [preferredMode, setPreferredMode] = useState<"baseline" | "scaledown">("baseline");
  const [traceData, setTraceData] = useState<TraceData | null>(null);

  const {
    status, mode, error,
    audioAutoplayFailed, agentAudioReceived,
    startConversation, endConversation, unlockAudio,
  } = useConversation(preferredMode);

  // Poll /api/traces every 2s while active
  useEffect(() => {
    if (status !== "active") return;
    const poll = async () => {
      const res = await fetch("/api/traces");
      if (res.ok) setTraceData(await res.json());
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [status]);

  // Clear traces then start conversation
  const handleStart = useCallback(async () => {
    await fetch("/api/traces", { method: "DELETE" });
    setTraceData(null);
    startConversation();
  }, [startConversation]);

  const totalTokensSaved = traceData?.traces.reduce(
    (sum, t) => sum + Math.max(0, t.originalTokens - t.compressedTokens), 0
  ) ?? 0;

  const hasTraces = (traceData?.traces.length ?? 0) > 0;

  return (
    <main className="flex h-screen bg-gray-950 text-white overflow-hidden">

      {/* LEFT: Voice interface */}
      <div className="w-80 border-r border-gray-800 flex flex-col p-6 gap-5 shrink-0">

        <div>
          <h1 className="text-xl font-bold tracking-tight">
            Agora <span className="text-blue-400">x</span> ScaleDown
          </h1>
          <p className="text-gray-500 text-xs mt-0.5">Real-time voice AI with context compression</p>
        </div>

        {/* Mode toggle */}
        <div>
          <p className="text-gray-500 text-xs mb-2 uppercase tracking-widest">Mode</p>
          <div className="flex gap-2">
            <button
              onClick={() => setPreferredMode("baseline")}
              disabled={status !== "idle"}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                preferredMode === "baseline"
                  ? "bg-gray-700 text-white"
                  : "bg-gray-900 text-gray-500 hover:text-gray-300"
              }`}
            >
              Baseline
            </button>
            <button
              onClick={() => setPreferredMode("scaledown")}
              disabled={status !== "idle"}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                preferredMode === "scaledown"
                  ? "bg-cyan-800 text-cyan-200"
                  : "bg-gray-900 text-gray-500 hover:text-gray-300"
              }`}
            >
              ScaleDown
            </button>
          </div>
          {preferredMode === "scaledown" && status === "idle" && (
            <p className="text-xs text-yellow-600 mt-2">
              Requires ngrok — update PROXY_BASE_URL in .env.local
            </p>
          )}
        </div>

        {/* Status */}
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
            status === "active" ? "bg-green-400 animate-pulse"
            : status === "connecting" || status === "ending" ? "bg-yellow-400 animate-pulse"
            : "bg-gray-600"
          }`} />
          <span className="text-sm text-gray-300">
            {status === "idle" && "Ready to start"}
            {status === "connecting" && "Connecting..."}
            {status === "active" && `Active - ${mode === "baseline" ? "Baseline" : "ScaleDown"} mode`}
            {status === "ending" && "Ending..."}
          </span>
        </div>

        {/* Action button */}
        {status === "idle" ? (
          <button
            onClick={handleStart}
            className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-medium transition-colors"
          >
            Start Conversation
          </button>
        ) : status === "active" ? (
          <button
            onClick={endConversation}
            className="w-full py-4 bg-red-600 hover:bg-red-500 rounded-xl font-medium transition-colors"
          >
            End Conversation
          </button>
        ) : (
          <button disabled className="w-full py-4 bg-gray-700 rounded-xl font-medium opacity-50 cursor-not-allowed">
            {status === "connecting" ? "Connecting..." : "Ending..."}
          </button>
        )}

        {error && (
          <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-xs">
            {error}
          </div>
        )}

        {audioAutoplayFailed && (
          <button
            onClick={unlockAudio}
            className="w-full py-3 bg-yellow-600 hover:bg-yellow-500 rounded-xl text-sm font-medium animate-pulse"
          >
            Click to Enable Audio
          </button>
        )}

        {status === "active" && (
          <div className="text-xs text-gray-500">
            Agent audio:{" "}
            <span className={agentAudioReceived ? "text-green-400" : "text-yellow-400"}>
              {agentAudioReceived ? "received" : "waiting..."}
            </span>
          </div>
        )}

        {/* Pipeline diagram */}
        <div className="mt-auto bg-gray-900 rounded-xl p-4 text-xs">
          <p className="font-semibold text-gray-400 mb-2 text-xs uppercase tracking-widest">Pipeline</p>
          <div className="text-gray-500 space-y-1 leading-relaxed">
            <p>Voice <span className="text-gray-300">Deepgram</span> (ASR)</p>
            {preferredMode === "scaledown" && (
              <p> Transcript  <span className="text-cyan-400 font-semibold">ScaleDown</span> (compress)</p>
            )}
            <p> Context  <span className="text-gray-300">Groq llama-3.3</span> (LLM)</p>
            <p> Response  <span className="text-gray-300">Cartesia</span> (TTS)</p>
            <p> Audio via <span className="text-gray-300">Agora RTC</span></p>
          </div>
        </div>
      </div>

      {/* RIGHT: Metrics dashboard */}
      <div className="flex-1 flex flex-col p-6 gap-5 min-w-0">

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Compression Metrics</h2>
            <p className="text-gray-500 text-sm mt-0.5">
              {hasTraces
                ? `${traceData!.traces.length} turn${traceData!.traces.length !== 1 ? "s" : ""} recorded - ${mode === "baseline" ? "baseline (no compression)" : "ScaleDown active"}`
                : "Start a conversation to see live per-turn data"}
            </p>
          </div>
          {hasTraces && (
            <button
              onClick={async () => { await fetch("/api/traces", { method: "DELETE" }); setTraceData(null); }}
              className="text-xs text-gray-500 hover:text-gray-300 border border-gray-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {hasTraces ? (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                <p className="text-gray-500 text-xs uppercase tracking-widest">Tokens saved</p>
                <p className="text-3xl font-bold text-cyan-400 mt-2">
                  {totalTokensSaved > 0 ? totalTokensSaved.toLocaleString() : "0"}
                </p>
                <p className="text-gray-600 text-xs mt-1">cumulative</p>
              </div>
              <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                <p className="text-gray-500 text-xs uppercase tracking-widest">Avg compression</p>
                <p className="text-3xl font-bold text-green-400 mt-2">
                  {traceData!.summary.avgCompressionRatio > 0
                    ? `${(traceData!.summary.avgCompressionRatio * 100).toFixed(0)}%`
                    : "0%"}
                </p>
                <p className="text-gray-600 text-xs mt-1">context reduction</p>
              </div>
              <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                <p className="text-gray-500 text-xs uppercase tracking-widest">Avg latency</p>
                <p className="text-3xl font-bold text-yellow-400 mt-2">
                  {traceData!.summary.avgLatencyMs > 0 ? `${traceData!.summary.avgLatencyMs}ms` : "0ms"}
                </p>
                <p className="text-gray-600 text-xs mt-1">ScaleDown overhead</p>
              </div>
            </div>

            {/* Per-turn table */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-auto flex-1">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                  <tr>
                    <th className="text-left px-5 py-3 text-gray-500 font-medium">Turn</th>
                    <th className="text-right px-5 py-3 text-gray-500 font-medium">Original tokens</th>
                    <th className="text-right px-5 py-3 text-gray-500 font-medium">Compressed</th>
                    <th className="text-right px-5 py-3 text-gray-500 font-medium">Saved</th>
                    <th className="text-right px-5 py-3 text-gray-500 font-medium">Latency</th>
                    <th className="text-right px-5 py-3 text-gray-500 font-medium">Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {traceData!.traces.map((t) => {
                    const saved = Math.max(0, t.originalTokens - t.compressedTokens);
                    return (
                      <tr key={t.turn} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                        <td className="px-5 py-3 text-gray-400 font-mono">#{t.turn}</td>
                        <td className="px-5 py-3 text-right text-gray-300 font-mono">
                          {t.originalTokens.toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-right font-mono">
                          {t.baselineMode
                            ? <span className="text-gray-600">-</span>
                            : <span className="text-cyan-400">{t.compressedTokens.toLocaleString()}</span>
                          }
                        </td>
                        <td className="px-5 py-3 text-right">
                          {t.baselineMode ? (
                            <span className="text-gray-600 text-xs">no compression</span>
                          ) : (
                            <span className={`font-semibold ${
                              t.compressionRatio >= 0.4 ? "text-green-400"
                              : t.compressionRatio >= 0.15 ? "text-yellow-400"
                              : "text-gray-400"
                            }`}>
                              {saved.toLocaleString()} ({(t.compressionRatio * 100).toFixed(0)}%)
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right text-gray-400 font-mono text-xs">
                          {t.latencyMs > 0 ? `${t.latencyMs}ms` : "-"}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            t.baselineMode
                              ? "bg-gray-800 text-gray-500"
                              : "bg-cyan-900/50 text-cyan-400"
                          }`}>
                            {t.baselineMode ? "baseline" : "scaledown"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
            <div className="text-6xl opacity-20">chart</div>
            <div>
              <p className="text-gray-400 font-medium text-lg">No data yet</p>
              <p className="text-gray-600 text-sm mt-2 max-w-sm">
                {preferredMode === "scaledown"
                  ? "Start a conversation in ScaleDown mode. Each LLM turn will show original vs compressed token counts live."
                  : "Switch to ScaleDown mode to see live compression metrics, or run Baseline first to compare."}
              </p>
            </div>
            <div className="mt-2 bg-gray-900 rounded-xl p-5 text-left text-xs text-gray-500 max-w-sm border border-gray-800">
              <p className="font-semibold text-gray-400 mb-2">How it works</p>
              <p><span className="text-gray-300">Baseline:</span> Agora calls Groq directly. Full token history every turn.</p>
              <p className="mt-1.5"><span className="text-cyan-400">ScaleDown:</span> The growing conversation history is compressed before reaching Groq each turn - reducing cost and latency as conversations get longer.</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
