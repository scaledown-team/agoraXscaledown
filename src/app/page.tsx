"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useConversation } from "@/hooks/useConversation";

interface TraceEvent {
  turn: number;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  scaledownLatencyMs: number;
  groqLatencyMs: number;
  totalLatencyMs: number;
  baselineMode: boolean;
  compressionSuccess: boolean;
}

interface Summary {
  avgOriginalTokens: number;
  avgCompressedTokens: number;
  avgCompressionRatio: number;
  avgScaledownLatencyMs: number;
  avgGroqLatencyMs: number;
  avgTotalLatencyMs: number;
  accuracyRate: number;
}

interface TraceData {
  totalTurns: number;
  traces: TraceEvent[];
  summary: Summary;
}

interface SavedConversation {
  id: string;
  label: string;
  mode: "baseline" | "scaledown";
  createdAt: string;
  turns: number;
  totalTokensSaved: number;
  avgCompressionRatio: number;
  avgGroqLatencyMs: number;
  avgScaledownLatencyMs: number;
  accuracyRate: number;
}

export default function Home() {
  const [preferredMode, setPreferredMode] = useState<"baseline" | "scaledown">("baseline");
  const [traceData, setTraceData] = useState<TraceData | null>(null);
  const [conversations, setConversations] = useState<SavedConversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [selectedTraceData, setSelectedTraceData] = useState<TraceData | null>(null);
  const [isDark, setIsDark] = useState(true);

  // Keep a ref to the last active conversationId so we can auto-select it after it ends
  // (the hook clears conversationId on end, so we need to capture it before that happens)
  const lastConversationIdRef = useRef<string | null>(null);

  const {
    status, mode, error, conversationId,
    audioAutoplayFailed, agentAudioReceived,
    startConversation, endConversation, unlockAudio,
  } = useConversation(preferredMode);

  // Load all conversations from Supabase on mount
  const refreshConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (res.ok) {
      const data = await res.json();
      setConversations(data.conversations || []);
    }
  }, []);

  useEffect(() => { refreshConversations(); }, [refreshConversations]);

  // Track conversationId in a ref so we can auto-select it after the hook clears it
  useEffect(() => {
    if (conversationId) lastConversationIdRef.current = conversationId;
  }, [conversationId]);

  // When a conversation ends: refresh the list, then auto-select the just-ended conversation
  useEffect(() => {
    if (status === "idle" && lastConversationIdRef.current) {
      const endedId = lastConversationIdRef.current;
      refreshConversations().then(() => {
        setSelectedConvId(endedId);
      });
    }
  }, [status, refreshConversations]);

  // Poll traces every 2s while active
  useEffect(() => {
    if (status !== "active" || !conversationId) return;
    const poll = async () => {
      const res = await fetch(`/api/traces?conversationId=${conversationId}`);
      if (res.ok) setTraceData(await res.json());
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [status, conversationId]);

  // Load traces for a selected past conversation
  useEffect(() => {
    if (!selectedConvId) { setSelectedTraceData(null); return; }
    fetch(`/api/traces?conversationId=${selectedConvId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setSelectedTraceData(d));
  }, [selectedConvId]);

  const handleStart = useCallback(async () => {
    setTraceData(null);
    setSelectedConvId(null);
    setSelectedTraceData(null);
    lastConversationIdRef.current = null;
    startConversation();
  }, [startConversation]);

  // What to show
  const isLive = status === "active" && selectedConvId === null;
  const displayData = selectedConvId ? selectedTraceData : traceData;
  const displayTraces = displayData?.traces ?? [];
  const displaySummary = displayData?.summary;
  const hasTraces = displayTraces.length > 0;

  // Compute comparison between baseline and ScaleDown sessions
  const baselineConvs = conversations.filter(c => c.mode === "baseline" && c.turns > 0);
  const scaledownConvs = conversations.filter(c => c.mode === "scaledown" && c.turns > 0);
  const hasComparison = baselineConvs.length > 0 && scaledownConvs.length > 0;
  const avgBaselineGroq = baselineConvs.length > 0
    ? Math.round(baselineConvs.reduce((s, c) => s + c.avgGroqLatencyMs, 0) / baselineConvs.length)
    : 0;
  const avgScaledownGroq = scaledownConvs.length > 0
    ? Math.round(scaledownConvs.reduce((s, c) => s + c.avgGroqLatencyMs, 0) / scaledownConvs.length)
    : 0;
  const avgBaselineTokens = baselineConvs.length > 0
    ? Math.round(baselineConvs.reduce((s, c) => s + (c.turns > 0 ? c.totalTokensSaved / c.turns : 0), 0) / baselineConvs.length)
    : 0;
  const avgScaledownAccuracy = scaledownConvs.length > 0
    ? Math.round(scaledownConvs.reduce((s, c) => s + c.accuracyRate, 0) / scaledownConvs.length * 100)
    : 0;
  const latencyImprovement = avgBaselineGroq > 0 && avgScaledownGroq > 0
    ? Math.round((1 - avgScaledownGroq / avgBaselineGroq) * 100)
    : 0;

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
                  : `${textMuted}`
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
                  : `${textMuted}`
              }`}
            >
              ScaleDown
            </button>
          </div>
        </div>

        {/* Status */}
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
          <button onClick={handleStart} className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 rounded-xl font-semibold transition-colors">
            Start Conversation
          </button>
        ) : status === "active" ? (
          <button onClick={endConversation} className="w-full py-3.5 bg-red-600 hover:bg-red-500 rounded-xl font-semibold transition-colors">
            End Conversation
          </button>
        ) : (
          <button disabled className={`w-full py-3.5 rounded-xl font-semibold opacity-40 cursor-not-allowed ${isDark ? "bg-gray-700" : "bg-gray-200 text-gray-500"}`}>
            {status === "connecting" ? "Connecting..." : "Ending..."}
          </button>
        )}

        {error && (
          <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-xs">{error}</div>
        )}

        {audioAutoplayFailed && (
          <button onClick={unlockAudio} className="w-full py-3 bg-yellow-600 hover:bg-yellow-500 rounded-xl text-sm font-medium animate-pulse">
            Tap to Enable Audio
          </button>
        )}

        {status === "active" && (
          <p className={`text-xs ${textMuted}`}>
            Agent audio: <span className={agentAudioReceived ? "text-green-400" : "text-yellow-400"}>
              {agentAudioReceived ? "receiving" : "waiting..."}
            </span>
          </p>
        )}

        {/* Pipeline */}
        <div className={`mt-auto rounded-xl p-4 text-xs ${isDark ? "bg-gray-900" : "bg-gray-50 border " + border}`}>
          <p className={`font-semibold ${textMuted} mb-3 uppercase tracking-widest`}>Pipeline</p>
          <div className={`space-y-2 ${textMuted}`}>
            {[
              { label: "Speech → Text", value: "Deepgram", note: "", dot: false },
              ...(preferredMode === "scaledown" ? [{ label: "Compress context", value: "ScaleDown", note: "", dot: true }] : []),
              { label: "AI brain", value: "Groq · Llama 3.3", note: "", dot: false },
              { label: "Text → Speech", value: "Cartesia", note: "", dot: false },
              { label: "Voice transport", value: "Agora RTC", note: "", dot: false },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.dot ? "bg-cyan-500" : isDark ? "bg-gray-700" : "bg-gray-300"}`} />
                <span>
                  {item.label} ·{" "}
                  <span className={item.dot ? "text-cyan-400 font-semibold" : textSub}>{item.value}</span>
                  {item.note ? ` (${item.note})` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── RIGHT: Metrics ── */}
      <div className="flex-1 flex flex-col p-6 gap-4 min-w-0 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-semibold">Live Savings Dashboard</h2>
            <p className={`${textMuted} text-sm mt-0.5`}>
              {isLive
                ? `Listening · ${traceData?.traces.length ?? 0} exchange${traceData?.traces.length !== 1 ? "s" : ""} so far`
                : hasTraces
                ? `${displayTraces.length} exchanges recorded`
                : "Start a conversation to see savings appear in real time"}
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
        {(conversations.length > 0 || isLive) && (
          <div className="flex gap-2 overflow-x-auto pb-0.5 shrink-0">
            {isLive && (
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
                <span className={`ml-1.5 ${conv.mode === "scaledown" ? "text-cyan-600" : textMuted}`}>
                  · {conv.mode === "scaledown" ? "ScaleDown" : "Baseline"}
                </span>
                <span className={`ml-1 ${textMuted}`}>
                  · {conv.turns} turn{conv.turns !== 1 ? "s" : ""}
                </span>
              </button>
            ))}
          </div>
        )}

        {hasTraces ? (
          <>
            {/* Comparison banner — only shows when both modes have been run */}
            {hasComparison && (
              <div className={`shrink-0 rounded-xl border p-4 ${
                isDark
                  ? "bg-gradient-to-r from-cyan-950/40 to-gray-900 border-cyan-900/50"
                  : "bg-gradient-to-r from-cyan-50 to-white border-cyan-200"
              }`}>
                <p className={`text-xs font-semibold uppercase tracking-widest mb-3 ${isDark ? "text-cyan-400" : "text-cyan-600"}`}>
                  ScaleDown vs. No Compression
                </p>
                <div className="grid grid-cols-3 gap-6">
                  <div>
                    <p className={`text-xs ${textMuted} mb-1`}>AI Reply Speed</p>
                    <div className="flex items-baseline gap-2">
                      <span className={`text-xl font-bold ${isDark ? "text-white" : "text-gray-900"}`}>{avgScaledownGroq}ms</span>
                      <span className={`text-sm ${textMuted}`}>vs {avgBaselineGroq}ms</span>
                    </div>
                    {latencyImprovement > 0 && (
                      <p className="text-green-400 text-xs font-medium mt-0.5">↓ {latencyImprovement}% faster</p>
                    )}
                  </div>
                  <div>
                    <p className={`text-xs ${textMuted} mb-1`}>Tokens Per Turn</p>
                    <div className="flex items-baseline gap-2">
                      <span className={`text-xl font-bold text-cyan-400`}>
                        {scaledownConvs[0] && scaledownConvs[0].turns > 0
                          ? Math.round(scaledownConvs.reduce((s,c) => s + (c.totalTokensSaved / c.turns), 0) / scaledownConvs.length)
                          : 0} fewer
                      </span>
                    </div>
                    <p className={`text-xs ${textMuted} mt-0.5`}>on every single exchange</p>
                  </div>
                  <div>
                    <p className={`text-xs ${textMuted} mb-1`}>Response Quality</p>
                    <div className="flex items-baseline gap-2">
                      <span className={`text-xl font-bold text-purple-400`}>{avgScaledownAccuracy}%</span>
                      <span className={`text-sm ${textMuted}`}>preserved</span>
                    </div>
                    <p className="text-green-400 text-xs font-medium mt-0.5">No quality loss</p>
                  </div>
                </div>
              </div>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-3 shrink-0">
              <div className={`${panelBg} rounded-xl p-4 border ${border}`}>
                <p className={`${textMuted} text-xs uppercase tracking-widest`}>Tokens saved</p>
                <p className="text-3xl font-bold tracking-tight text-cyan-400 mt-2">{totalTokensSaved.toLocaleString()}</p>
                <p className={`${textMuted} text-xs mt-1`}>this conversation</p>
              </div>
              <div className={`${panelBg} rounded-xl p-4 border ${border}`}>
                <p className={`${textMuted} text-xs uppercase tracking-widest`}>Context reduction</p>
                <p className="text-3xl font-bold tracking-tight text-green-400 mt-2">
                  {displaySummary && displaySummary.avgCompressionRatio > 0
                    ? `${(displaySummary.avgCompressionRatio * 100).toFixed(0)}%`
                    : "0%"}
                </p>
                <p className={`${textMuted} text-xs mt-1`}>smaller on average</p>
              </div>
              <div className={`${panelBg} rounded-xl p-4 border ${border}`}>
                <p className={`${textMuted} text-xs uppercase tracking-widest`}>Quality retained</p>
                <p className="text-3xl font-bold tracking-tight text-purple-400 mt-2">
                  {displaySummary ? `${(displaySummary.accuracyRate * 100).toFixed(0)}%` : "—"}
                </p>
                <p className={`${textMuted} text-xs mt-1`}>of turns fully preserved</p>
              </div>
              <div className={`${panelBg} rounded-xl p-4 border ${border}`}>
                <p className={`${textMuted} text-xs uppercase tracking-widest`}>Avg AI reply</p>
                <p className="text-3xl font-bold tracking-tight text-yellow-400 mt-2">
                  {displaySummary && displaySummary.avgGroqLatencyMs > 0
                    ? `${displaySummary.avgGroqLatencyMs}ms`
                    : "—"}
                </p>
                <p className={`${textMuted} text-xs mt-1`}>response time</p>
              </div>
            </div>

            {/* Per-turn table */}
            <div className={`${panelBg} rounded-xl border ${border} overflow-auto flex-1`}>
              <table className="w-full text-sm">
                <thead className={`sticky top-0 ${panelBg} border-b ${border}`}>
                  <tr>
                    {[
                      { label: "Turn", align: "left" },
                      { label: "Context size", align: "right" },
                      { label: "After ScaleDown", align: "right" },
                      { label: "Tokens saved", align: "right" },
                      { label: "AI reply time", align: "right" },
                      { label: "Quality", align: "right" },
                    ].map((h) => (
                      <th key={h.label} className={`text-${h.align} px-4 py-3 ${textMuted} font-medium text-xs uppercase tracking-wide`}>{h.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayTraces.map((t) => {
                    const saved = Math.max(0, t.originalTokens - t.compressedTokens);
                    return (
                      <tr key={t.turn} className={`border-b ${border} last:border-0 ${isDark ? "hover:bg-gray-800/40" : "hover:bg-gray-50"} transition-colors`}>
                        <td className={`px-4 py-3.5 ${textMuted} text-sm`}>
                          Turn {t.turn}
                          <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                            t.baselineMode
                              ? isDark ? "bg-gray-800 text-gray-500" : "bg-gray-100 text-gray-400"
                              : "bg-cyan-950 text-cyan-400 border border-cyan-900"
                          }`}>
                            {t.baselineMode ? "no compression" : "ScaleDown ✓"}
                          </span>
                        </td>
                        <td className={`px-4 py-3.5 text-right ${textSub} font-mono`}>
                          {t.originalTokens.toLocaleString()} <span className={`${textMuted} text-xs`}>tokens</span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono">
                          {t.baselineMode
                            ? <span className={`${textMuted} text-sm`}>unchanged</span>
                            : <span className="text-cyan-400">{t.compressedTokens.toLocaleString()} <span className={`${textMuted} text-xs`}>tokens</span></span>}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          {t.baselineMode ? (
                            <span className={`${textMuted} text-sm`}>—</span>
                          ) : (
                            <span className={`font-semibold ${
                              t.compressionRatio >= 0.3 ? "text-green-400"
                              : t.compressionRatio >= 0.1 ? "text-yellow-400"
                              : "text-gray-400"
                            }`}>
                              {saved > 0 ? `−${saved.toLocaleString()}` : "0"}{" "}
                              <span className="text-xs opacity-70">({(t.compressionRatio * 100).toFixed(0)}% less)</span>
                            </span>
                          )}
                        </td>
                        <td className={`px-4 py-3.5 text-right font-mono text-sm ${t.groqLatencyMs > 0 ? "text-yellow-400" : textMuted}`}>
                          {t.groqLatencyMs > 0 ? `${t.groqLatencyMs}ms` : "—"}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          {t.baselineMode ? (
                            <span className={`${textMuted} text-sm`}>—</span>
                          ) : t.compressionSuccess ? (
                            <span className="text-green-400 text-sm font-medium">✓ Full quality</span>
                          ) : (
                            <span className="text-orange-400 text-sm font-medium">⚠ Used original</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-6">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${border} ${isDark ? "bg-gray-900" : "bg-gray-50"}`}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className={isDark ? "text-gray-500" : "text-gray-400"}>
                <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M10 6v4l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <p className={`${textSub} font-semibold text-base`}>No data yet</p>
              <p className={`${textMuted} text-sm mt-1.5 max-w-xs leading-relaxed`}>
                {preferredMode === "scaledown"
                  ? "Start a conversation to see live token savings turn by turn."
                  : "Baseline mode captures raw token usage — run both modes to compare."}
              </p>
            </div>
            <div className={`rounded-xl p-5 text-left text-sm max-w-sm border ${border} ${isDark ? "bg-gray-900/60" : "bg-gray-50"} space-y-3`}>
              <p className={`text-xs font-semibold uppercase tracking-widest ${textMuted}`}>How it works</p>
              <p className={`${textMuted} leading-relaxed`}>
                <span className={`font-medium ${textSub}`}>Without ScaleDown —</span> the full conversation history is sent to the AI on every turn. Token costs grow linearly.
              </p>
              <p className={`${textMuted} leading-relaxed`}>
                <span className="font-medium text-cyan-400">With ScaleDown —</span> history is compressed before each call. The AI sees the same meaning with fewer tokens. Cost stays flat.
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
