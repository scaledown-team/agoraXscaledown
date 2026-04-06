"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useConversation } from "@/hooks/useConversation";

interface TraceEvent {
  turn: number;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  latencyMs: number;
  baselineMode: boolean;
}

interface Summary {
  avgOriginalTokens: number;
  avgCompressedTokens: number;
  avgCompressionRatio: number;
  avgLatencyMs: number;
}

interface TraceData {
  totalTurns: number;
  mode: string;
  traces: TraceEvent[];
  summary: Summary;
}

interface SavedConversation {
  id: number;
  label: string;
  mode: "baseline" | "scaledown";
  time: string;
  traces: TraceEvent[];
  summary: Summary;
}

export default function Home() {
  const [preferredMode, setPreferredMode] = useState<"baseline" | "scaledown">("baseline");
  const [traceData, setTraceData] = useState<TraceData | null>(null);
  const [conversations, setConversations] = useState<SavedConversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<number | null>(null);
  const [isDark, setIsDark] = useState(true);

  const convCounterRef = useRef(0);
  const prevStatusRef = useRef<string>("idle");
  const hasSavedRef = useRef(false);

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

  // Save conversation when it ends (once, on transition away from active)
  useEffect(() => {
    const wasActive = prevStatusRef.current === "active";
    const isNoLongerActive = status !== "active";
    if (wasActive && isNoLongerActive && !hasSavedRef.current) {
      hasSavedRef.current = true;
      fetch("/api/traces").then(async (res) => {
        if (!res.ok) return;
        const final: TraceData = await res.json();
        if (final.traces.length === 0) return;
        convCounterRef.current += 1;
        const convMode = final.traces[0]?.baselineMode ? "baseline" : "scaledown";
        setConversations(prev => [...prev, {
          id: convCounterRef.current,
          label: `Conversation ${convCounterRef.current}`,
          mode: convMode,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          traces: final.traces,
          summary: final.summary,
        }]);
        setSelectedConvId(convCounterRef.current);
      });
    }
    prevStatusRef.current = status;
  }, [status]);

  // Clear traces and start a new conversation
  const handleStart = useCallback(async () => {
    await fetch("/api/traces", { method: "DELETE" });
    setTraceData(null);
    setSelectedConvId(null);
    hasSavedRef.current = false;
    startConversation();
  }, [startConversation]);

  // What to display: live data or a saved conversation
  const selectedConv = conversations.find(c => c.id === selectedConvId);
  const displayTraces = selectedConv ? selectedConv.traces : (traceData?.traces ?? []);
  const displaySummary = selectedConv ? selectedConv.summary : traceData?.summary;
  const isLive = selectedConvId === null && status === "active";
  const hasTraces = displayTraces.length > 0;

  const totalTokensSaved = displayTraces.reduce(
    (sum, t) => sum + Math.max(0, t.originalTokens - t.compressedTokens), 0
  );

  // Theme
  const bg = isDark ? "bg-gray-950" : "bg-slate-50";
  const sideBg = isDark ? "bg-gray-950" : "bg-white";
  const panelBg = isDark ? "bg-gray-900" : "bg-white";
  const border = isDark ? "border-gray-800" : "border-gray-200";
  const textPrimary = isDark ? "text-white" : "text-gray-900";
  const textSub = isDark ? "text-gray-400" : "text-gray-500";
  const textMuted = isDark ? "text-gray-600" : "text-gray-400";
  const tabInactive = isDark
    ? "bg-gray-800/60 text-gray-500 hover:text-gray-300"
    : "bg-gray-100 text-gray-400 hover:text-gray-700";

  return (
    <main className={`flex h-screen ${bg} ${textPrimary} overflow-hidden transition-colors duration-200`}>

      {/* ── LEFT: Controls ── */}
      <div className={`w-80 border-r ${border} ${sideBg} flex flex-col p-6 gap-5 shrink-0`}>

        {/* Branding + theme toggle */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              Agora <span className="text-blue-400">×</span> ScaleDown
            </h1>
            <p className={`${textMuted} text-xs mt-0.5`}>Real-time voice AI with context compression</p>
          </div>
          <button
            onClick={() => setIsDark(!isDark)}
            className={`p-2 rounded-lg text-base transition-colors ${
              isDark ? "bg-gray-800 text-gray-400 hover:text-white" : "bg-gray-100 text-gray-500 hover:text-gray-900"
            }`}
            title={isDark ? "Light mode" : "Dark mode"}
          >
            {isDark ? "☀" : "☾"}
          </button>
        </div>

        {/* Mode toggle */}
        <div>
          <p className={`${textMuted} text-xs mb-2 uppercase tracking-widest font-medium`}>Mode</p>
          <div className={`flex gap-1 p-1 rounded-xl ${isDark ? "bg-gray-900" : "bg-gray-100"}`}>
            <button
              onClick={() => setPreferredMode("baseline")}
              disabled={status !== "idle"}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                preferredMode === "baseline"
                  ? isDark ? "bg-gray-700 text-white shadow" : "bg-white text-gray-900 shadow"
                  : `${textMuted} hover:${textSub}`
              }`}
            >
              Baseline
            </button>
            <button
              onClick={() => setPreferredMode("scaledown")}
              disabled={status !== "idle"}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                preferredMode === "scaledown"
                  ? "bg-cyan-600 text-white shadow"
                  : `${textMuted} hover:${textSub}`
              }`}
            >
              ScaleDown
            </button>
          </div>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full shrink-0 ${
            status === "active" ? "bg-green-400 animate-pulse"
            : status === "connecting" || status === "ending" ? "bg-yellow-400 animate-pulse"
            : isDark ? "bg-gray-700" : "bg-gray-300"
          }`} />
          <span className={`text-sm ${textSub}`}>
            {status === "idle" && "Ready to start"}
            {status === "connecting" && "Connecting..."}
            {status === "active" && `Active · ${mode === "baseline" ? "Baseline" : "ScaleDown"}`}
            {status === "ending" && "Ending..."}
          </span>
        </div>

        {/* Action button */}
        {status === "idle" ? (
          <button
            onClick={handleStart}
            className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 rounded-xl font-semibold transition-colors"
          >
            Start Conversation
          </button>
        ) : status === "active" ? (
          <button
            onClick={endConversation}
            className="w-full py-3.5 bg-red-600 hover:bg-red-500 active:bg-red-700 rounded-xl font-semibold transition-colors"
          >
            End Conversation
          </button>
        ) : (
          <button disabled className={`w-full py-3.5 rounded-xl font-semibold opacity-40 cursor-not-allowed ${isDark ? "bg-gray-700" : "bg-gray-200 text-gray-500"}`}>
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
            Tap to Enable Audio
          </button>
        )}

        {status === "active" && (
          <p className={`text-xs ${textMuted}`}>
            Agent audio:{" "}
            <span className={agentAudioReceived ? "text-green-400" : "text-yellow-400"}>
              {agentAudioReceived ? "receiving" : "waiting..."}
            </span>
          </p>
        )}

        {/* Pipeline */}
        <div className={`mt-auto rounded-xl p-4 text-xs ${isDark ? "bg-gray-900" : "bg-gray-50 border " + border}`}>
          <p className={`font-semibold ${textMuted} mb-3 uppercase tracking-widest`}>Pipeline</p>
          <div className={`space-y-2 ${textMuted}`}>
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${isDark ? "bg-gray-600" : "bg-gray-300"}`} />
              <span>Voice · <span className={textSub}>Deepgram</span> (ASR)</span>
            </div>
            {preferredMode === "scaledown" && (
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-500" />
                <span>Transcript · <span className="text-cyan-400 font-semibold">ScaleDown</span> (compress)</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${isDark ? "bg-gray-600" : "bg-gray-300"}`} />
              <span>Context · <span className={textSub}>Groq llama-3.3</span> (LLM)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${isDark ? "bg-gray-600" : "bg-gray-300"}`} />
              <span>Response · <span className={textSub}>Cartesia</span> (TTS)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${isDark ? "bg-gray-600" : "bg-gray-300"}`} />
              <span>Audio via <span className={textSub}>Agora RTC</span></span>
            </div>
          </div>
        </div>
      </div>

      {/* ── RIGHT: Metrics ── */}
      <div className="flex-1 flex flex-col p-6 gap-4 min-w-0 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Compression Metrics</h2>
            <p className={`${textMuted} text-sm mt-0.5`}>
              {isLive
                ? `Live · ${traceData?.traces.length ?? 0} turn${traceData?.traces.length !== 1 ? "s" : ""}`
                : hasTraces
                ? `${displayTraces.length} turns recorded`
                : "Start a conversation to see live metrics"}
            </p>
          </div>
          {isLive && (
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-green-400 font-medium">Live</span>
            </div>
          )}
        </div>

        {/* Conversation tabs */}
        {conversations.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-0.5 shrink-0">
            {status === "active" && (
              <button
                onClick={() => setSelectedConvId(null)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  selectedConvId === null
                    ? "bg-green-900/40 text-green-400 border-green-800"
                    : `${tabInactive} border-transparent`
                }`}
              >
                ● Live
              </button>
            )}
            {conversations.map(conv => (
              <button
                key={conv.id}
                onClick={() => setSelectedConvId(conv.id)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  selectedConvId === conv.id
                    ? conv.mode === "scaledown"
                      ? "bg-cyan-900/40 text-cyan-400 border-cyan-800"
                      : isDark ? "bg-gray-700 text-white border-gray-600" : "bg-white text-gray-900 border-gray-300 shadow-sm"
                    : `${tabInactive} border-transparent`
                }`}
              >
                {conv.label}
                <span className={`ml-1.5 ${conv.mode === "scaledown" ? "text-cyan-600" : isDark ? "text-gray-600" : "text-gray-400"}`}>
                  {conv.mode === "scaledown" ? "ScaleDown" : "Baseline"}
                </span>
                <span className={`ml-1 ${textMuted}`}>{conv.time}</span>
              </button>
            ))}
          </div>
        )}

        {hasTraces ? (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-4 shrink-0">
              <div className={`${panelBg} rounded-xl p-4 border ${border}`}>
                <p className={`${textMuted} text-xs uppercase tracking-widest`}>Tokens saved</p>
                <p className="text-3xl font-bold text-cyan-400 mt-2">{totalTokensSaved.toLocaleString()}</p>
                <p className={`${textMuted} text-xs mt-1`}>cumulative</p>
              </div>
              <div className={`${panelBg} rounded-xl p-4 border ${border}`}>
                <p className={`${textMuted} text-xs uppercase tracking-widest`}>Avg compression</p>
                <p className="text-3xl font-bold text-green-400 mt-2">
                  {displaySummary && displaySummary.avgCompressionRatio > 0
                    ? `${(displaySummary.avgCompressionRatio * 100).toFixed(0)}%`
                    : "0%"}
                </p>
                <p className={`${textMuted} text-xs mt-1`}>context reduction</p>
              </div>
              <div className={`${panelBg} rounded-xl p-4 border ${border}`}>
                <p className={`${textMuted} text-xs uppercase tracking-widest`}>Avg latency</p>
                <p className="text-3xl font-bold text-yellow-400 mt-2">
                  {displaySummary && displaySummary.avgLatencyMs > 0
                    ? `${displaySummary.avgLatencyMs}ms`
                    : "0ms"}
                </p>
                <p className={`${textMuted} text-xs mt-1`}>ScaleDown overhead</p>
              </div>
            </div>

            {/* Per-turn table */}
            <div className={`${panelBg} rounded-xl border ${border} overflow-auto flex-1`}>
              <table className="w-full text-sm">
                <thead className={`sticky top-0 ${panelBg} border-b ${border}`}>
                  <tr>
                    <th className={`text-left px-5 py-3 ${textMuted} font-medium text-xs uppercase tracking-wide`}>Turn</th>
                    <th className={`text-right px-5 py-3 ${textMuted} font-medium text-xs uppercase tracking-wide`}>Original tokens</th>
                    <th className={`text-right px-5 py-3 ${textMuted} font-medium text-xs uppercase tracking-wide`}>Compressed</th>
                    <th className={`text-right px-5 py-3 ${textMuted} font-medium text-xs uppercase tracking-wide`}>Saved</th>
                    <th className={`text-right px-5 py-3 ${textMuted} font-medium text-xs uppercase tracking-wide`}>Latency</th>
                    <th className={`text-right px-5 py-3 ${textMuted} font-medium text-xs uppercase tracking-wide`}>Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {displayTraces.map((t) => {
                    const saved = Math.max(0, t.originalTokens - t.compressedTokens);
                    return (
                      <tr key={t.turn} className={`border-b ${border} last:border-0 ${isDark ? "hover:bg-gray-800/40" : "hover:bg-gray-50"} transition-colors`}>
                        <td className={`px-5 py-3.5 ${textMuted} font-mono text-xs`}>#{t.turn}</td>
                        <td className={`px-5 py-3.5 text-right ${textSub} font-mono`}>
                          {t.originalTokens.toLocaleString()}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono">
                          {t.baselineMode
                            ? <span className={textMuted}>—</span>
                            : <span className="text-cyan-400">{t.compressedTokens.toLocaleString()}</span>
                          }
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          {t.baselineMode ? (
                            <span className={`${textMuted} text-xs`}>no compression</span>
                          ) : (
                            <span className={`font-semibold text-sm ${
                              t.compressionRatio >= 0.3 ? "text-green-400"
                              : t.compressionRatio >= 0.1 ? "text-yellow-400"
                              : "text-gray-400"
                            }`}>
                              {saved.toLocaleString()} <span className="text-xs opacity-70">({(t.compressionRatio * 100).toFixed(0)}%)</span>
                            </span>
                          )}
                        </td>
                        <td className={`px-5 py-3.5 text-right ${textMuted} font-mono text-xs`}>
                          {t.latencyMs > 0 ? `${t.latencyMs}ms` : "—"}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                            t.baselineMode
                              ? isDark ? "bg-gray-800 text-gray-500" : "bg-gray-100 text-gray-400"
                              : "bg-cyan-950 text-cyan-400 border border-cyan-900"
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
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-5">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-2xl ${isDark ? "bg-gray-900" : "bg-gray-100"}`}>
              ◎
            </div>
            <div>
              <p className={`${textSub} font-semibold text-lg`}>No data yet</p>
              <p className={`${textMuted} text-sm mt-1.5 max-w-xs`}>
                {preferredMode === "scaledown"
                  ? "Start a conversation. Each turn shows original vs compressed tokens in real time."
                  : "Run Baseline to capture token growth, then ScaleDown to see the savings."}
              </p>
            </div>
            <div className={`${panelBg} rounded-xl p-5 text-left text-xs max-w-sm border ${border} space-y-2`}>
              <p className={`font-semibold ${textSub} mb-1`}>How it works</p>
              <p className={textMuted}>
                <span className={textSub}>Baseline</span> — Agora calls Groq directly. Token history grows linearly every turn.
              </p>
              <p className={textMuted}>
                <span className="text-cyan-400 font-medium">ScaleDown</span> — Conversation history is compressed before each Groq call. Same responses, fewer tokens burned.
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
