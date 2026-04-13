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
  qualityScore?: number | null;
}

interface Summary {
  avgOriginalTokens: number;
  avgCompressedTokens: number;
  avgCompressionRatio: number;
  avgScaledownLatencyMs: number;
  avgGroqLatencyMs: number;
  avgTotalLatencyMs: number;
  successfulCompressionRate: number;
  avgQualityScore?: number | null;
  qualityCoverage?: number;
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
  avgTotalLatencyMs?: number;
  successfulCompressionRate?: number;
  avgQualityScore?: number | null;
  qualityCoverage?: number;
}

interface EvalConvResult {
  id: string;
  mode: "baseline" | "scaledown";
  label: string;
  turns: number;
  totalOriginalTokens: number;
  totalCompressedTokens: number;
  tokensSaved: number;
  avgCompressionRatio: number;
  avgGroqLatencyMs: number;
  avgScaledownLatencyMs: number;
  avgTotalLatencyMs: number;
  avgQualityScore?: number | null;
}

interface EvalModeAgg {
  conversations: number;
  totalTurns: number;
  totalOriginalTokens: number;
  totalCompressedTokens: number;
  tokensSaved: number;
  compressionPct: number;
  avgGroqLatencyMs: number;
  avgScaledownLatencyMs: number;
  avgTotalLatencyMs?: number;
  avgQualityScore?: number | null;
  qualityCoverage?: number;
}

interface EvalData {
  results: EvalConvResult[];
  baseline: EvalModeAgg | null;
  scaledown: EvalModeAgg | null;
  comparison: {
    tokenSavingsPct: number;
    latencyDiffMs: number;
    groqLatencyDiffMs?: number;
    scaledownOverheadMs: number;
  } | null;
  summary: {
    totalConversations: number;
    baselineCount: number;
    scaledownCount: number;
    totalTurns: number;
    totalTokensSaved: number;
    overallCompressionPct: number;
    overallCostSavings?: number;
    avgQualityScore?: number | null;
    qualityCoverage?: number;
  };
}

type Tab = "conversation" | "eval";

export default function Home() {
  const [preferredMode, setPreferredMode] = useState<"baseline" | "scaledown">("baseline");
  const [traceData, setTraceData] = useState<TraceData | null>(null);
  const [conversations, setConversations] = useState<SavedConversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [selectedTraceData, setSelectedTraceData] = useState<TraceData | null>(null);
  const [evalData, setEvalData] = useState<EvalData | null>(null);
  const [evalRunning, setEvalRunning] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("conversation");

  const lastConversationIdRef = useRef<string | null>(null);

  const {
    status, mode, error, conversationId,
    audioAutoplayFailed, agentAudioReceived,
    startConversation, endConversation, unlockAudio,
  } = useConversation(preferredMode);

  const refreshConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch { /* ignore */ } finally {
      setConversationsLoading(false);
    }
  }, []);

  useEffect(() => { refreshConversations(); }, [refreshConversations]);

  useEffect(() => {
    if (conversationId) lastConversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    if (status === "idle" && lastConversationIdRef.current) {
      const endedId = lastConversationIdRef.current;
      refreshConversations().then(() => setSelectedConvId(endedId));
    }
  }, [status]);

  // Poll traces every 2s while active
  useEffect(() => {
    console.log("[Poll] Effect fired: status=", status, "conversationId=", conversationId);
    if (status !== "active" || !conversationId) return;
    console.log("[Poll] Starting polling for", conversationId);
    const poll = async () => {
      try {
        const res = await fetch(`/api/traces?conversationId=${conversationId}`);
        if (res.ok) {
          const data = await res.json();
          console.log("[Poll] Got", data.totalTurns, "turns");
          setTraceData(data);
        }
      } catch (e) {
        console.error("[Poll] Error:", e);
      }
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [status, conversationId]);

  useEffect(() => {
    if (!selectedConvId) { setSelectedTraceData(null); return; }
    const load = async () => {
      try {
        const res = await fetch(`/api/traces?conversationId=${selectedConvId}`);
        if (res.ok) {
          const d = await res.json();
          setSelectedTraceData(d);
        }
      } catch { /* ignore */ }
    };
    load();
  }, [selectedConvId]);

  const handleStart = useCallback(async () => {
    setTraceData(null);
    setSelectedConvId(null);
    setSelectedTraceData(null);
    lastConversationIdRef.current = null;
    setActiveTab("conversation");
    startConversation();
  }, [startConversation]);

  const runEval = useCallback(async () => {
    setEvalRunning(true);
    setEvalError(null);
    setEvalData(null);
    setActiveTab("eval");
    try {
      const res = await fetch("/api/eval", { method: "POST" });
      if (!res.ok) throw new Error(`Eval failed: ${res.status}`);
      setEvalData(await res.json());
    } catch (err) {
      setEvalError(String(err));
    } finally {
      setEvalRunning(false);
    }
  }, []);

  // Display logic
  const isLive = status === "active" && selectedConvId === null;
  const displayData = selectedConvId ? selectedTraceData : traceData;
  const displayTraces = displayData?.traces ?? [];
  const displaySummary = displayData?.summary;
  const hasTraces = displayTraces.length > 0;
  const selectedConvMode = selectedConvId
    ? conversations.find(c => c.id === selectedConvId)?.mode
    : mode;

  const baselineConvs = conversations.filter(c => c.mode === "baseline" && c.turns > 0);
  const scaledownConvs = conversations.filter(c => c.mode === "scaledown" && c.turns > 0);
  const totalTokensSaved = displayTraces.reduce(
    (sum, t) => sum + Math.max(0, t.originalTokens - t.compressedTokens), 0
  );
  const scoredTurns = displayTraces.filter((t) => !t.baselineMode && t.qualityScore != null && t.qualityScore >= 0);

  const bg = "bg-gray-950";
  const panelBg = "bg-gray-900";
  const border = "border-gray-800";
  const textSub = "text-gray-400";
  const textMuted = "text-gray-600";

  return (
    <main className={`flex h-screen ${bg} text-white overflow-hidden`}>

      {/* ── LEFT: Controls ── */}
      <div className={`w-72 border-r ${border} ${bg} flex flex-col p-5 gap-4 shrink-0`}>
        <div>
          <h1 className="text-lg font-bold tracking-tight">
            Agora <span className="text-blue-400">×</span> ScaleDown
          </h1>
          <p className={`${textMuted} text-xs mt-0.5`}>Voice AI + context compression</p>
        </div>

        {/* Mode toggle */}
        <div className={`flex gap-1 p-1 rounded-xl bg-gray-900`}>
          <button
            onClick={() => setPreferredMode("baseline")}
            disabled={status !== "idle"}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40 ${
              preferredMode === "baseline" ? "bg-gray-700 text-white shadow" : textMuted
            }`}
          >Baseline</button>
          <button
            onClick={() => setPreferredMode("scaledown")}
            disabled={status !== "idle"}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40 ${
              preferredMode === "scaledown" ? "bg-cyan-600 text-white shadow" : textMuted
            }`}
          >ScaleDown</button>
        </div>

        {/* Status */}
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full shrink-0 ${
            status === "active" ? "bg-green-400 animate-pulse"
            : status === "connecting" || status === "ending" ? "bg-yellow-400 animate-pulse"
            : "bg-gray-700"
          }`} />
          <span className={`text-sm ${textSub}`}>
            {status === "idle" && "Ready"}
            {status === "connecting" && "Connecting..."}
            {status === "active" && `Active · ${mode === "baseline" ? "Baseline" : "ScaleDown"}`}
            {status === "ending" && "Ending..."}
          </span>
        </div>

        {/* Action */}
        {status === "idle" ? (
          <button onClick={handleStart} className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-semibold transition-colors">
            Start Conversation
          </button>
        ) : status === "active" ? (
          <button onClick={endConversation} className="w-full py-3 bg-red-600 hover:bg-red-500 rounded-xl font-semibold transition-colors">
            End Conversation
          </button>
        ) : (
          <button disabled className="w-full py-3 rounded-xl font-semibold opacity-40 bg-gray-700">
            {status === "connecting" ? "Connecting..." : "Ending..."}
          </button>
        )}

        {error && <div className="p-2 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-xs">{error}</div>}
        {audioAutoplayFailed && (
          <button onClick={unlockAudio} className="w-full py-2.5 bg-yellow-600 hover:bg-yellow-500 rounded-xl text-sm font-medium animate-pulse">
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
        <div className={`mt-auto rounded-xl p-3 text-xs bg-gray-900`}>
          <p className={`font-semibold ${textMuted} mb-2 uppercase tracking-widest text-[10px]`}>Pipeline</p>
          <div className={`space-y-1.5 ${textMuted}`}>
            {[
              { label: "ASR", value: "Deepgram", dot: false },
              ...(preferredMode === "scaledown" ? [{ label: "Compress", value: "ScaleDown", dot: true }] : []),
              { label: "LLM", value: "Groq · Llama 3.3", dot: false },
              { label: "TTS", value: "Cartesia", dot: false },
              { label: "Transport", value: "Agora RTC", dot: false },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.dot ? "bg-cyan-500" : "bg-gray-700"}`} />
                <span>{item.label} · <span className={item.dot ? "text-cyan-400 font-semibold" : textSub}>{item.value}</span></span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── RIGHT: Dashboard ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Tab bar */}
        <div className={`flex items-center border-b ${border} px-6 shrink-0`}>
          <button
            onClick={() => setActiveTab("conversation")}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "conversation"
                ? "border-blue-500 text-white"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            Conversations
          </button>
          <button
            onClick={() => { setActiveTab("eval"); if (!evalData && !evalRunning) runEval(); }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "eval"
                ? "border-purple-500 text-white"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            Eval Summary
          </button>
          <div className="ml-auto" />
        </div>

        {/* ── Tab: Conversations ── */}
        {activeTab === "conversation" && (
          <div className="flex-1 flex flex-col p-6 gap-4 overflow-auto">

            {/* Conversation selector */}
            <div className="flex gap-3 items-center flex-wrap shrink-0">
              {status === "active" && (
                <button
                  onClick={() => setSelectedConvId(null)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    selectedConvId === null
                      ? "bg-green-900/40 text-green-400 border-green-800"
                      : "bg-gray-800/60 text-gray-500 hover:text-green-400 border-transparent"
                  }`}
                >● Live</button>
              )}
              {conversationsLoading && status !== "active" && <span className={`text-xs ${textMuted}`}>Loading...</span>}
              {baselineConvs.length > 0 && (
                <select
                  value={selectedConvId && baselineConvs.some(c => c.id === selectedConvId) ? selectedConvId : ""}
                  onChange={(e) => setSelectedConvId(e.target.value || null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border bg-gray-800 text-gray-300 border-gray-700 cursor-pointer"
                >
                  <option value="">Baseline...</option>
                  {baselineConvs.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              )}
              {scaledownConvs.length > 0 && (
                <select
                  value={selectedConvId && scaledownConvs.some(c => c.id === selectedConvId) ? selectedConvId : ""}
                  onChange={(e) => setSelectedConvId(e.target.value || null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border bg-gray-800 text-cyan-400 border-cyan-900 cursor-pointer"
                >
                  <option value="">ScaleDown...</option>
                  {scaledownConvs.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              )}
              {selectedConvId && status !== "active" && (
                <button onClick={() => setSelectedConvId(null)} className="text-xs text-gray-500 hover:text-gray-300">
                  ← clear
                </button>
              )}
            </div>

            {hasTraces ? (
              <>
                {/* 3 key metric cards */}
                <div className="grid grid-cols-3 gap-3 shrink-0">
                  <div className={`${panelBg} rounded-xl p-4 border ${border}`}>
                    <p className={`${textMuted} text-xs uppercase tracking-widest`}>Tokens saved</p>
                    <p className="text-3xl font-bold text-cyan-400 mt-2">{totalTokensSaved.toLocaleString()}</p>
                    <p className={`${textMuted} text-xs mt-1`}>
                      {selectedConvMode === "baseline" ? "no compression" : `${(displaySummary?.avgCompressionRatio ?? 0) * 100 | 0}% avg reduction`}
                    </p>
                  </div>
                  <div className={`${panelBg} rounded-xl p-4 border ${border}`}>
                    <p className={`${textMuted} text-xs uppercase tracking-widest`}>End-to-end latency</p>
                    <p className="text-3xl font-bold text-yellow-400 mt-2">
                      {displaySummary && displaySummary.avgTotalLatencyMs > 0
                        ? `${displaySummary.avgTotalLatencyMs}ms` : "—"}
                    </p>
                    <p className={`${textMuted} text-xs mt-1`}>
                      {displaySummary
                        ? `${displaySummary.avgGroqLatencyMs}ms LLM + ${displaySummary.avgScaledownLatencyMs}ms ScaleDown`
                        : "proxy + model roundtrip"}
                    </p>
                  </div>
                  <div className={`${panelBg} rounded-xl p-4 border ${border}`}>
                    <p className={`${textMuted} text-xs uppercase tracking-widest`}>Answer fidelity</p>
                    <p className="text-3xl font-bold text-green-400 mt-2">
                      {selectedConvMode === "baseline"
                        ? "Reference"
                        : displaySummary?.avgQualityScore != null
                          ? `${((displaySummary.avgQualityScore ?? 0) * 100).toFixed(0)}%`
                          : "Pending"}
                    </p>
                    <p className={`${textMuted} text-xs mt-1`}>
                      {selectedConvMode === "baseline"
                        ? "baseline answer stream"
                        : displaySummary?.avgQualityScore != null
                          ? `${scoredTurns.length} scored turn${scoredTurns.length === 1 ? "" : "s"} vs shadow baseline`
                          : "enable SHADOW_BASELINE to score quality"}
                    </p>
                  </div>
                </div>

                {/* Per-turn table */}
                <div className={`${panelBg} rounded-xl border ${border} overflow-auto flex-1`}>
                  <table className="w-full text-sm">
                    <thead className={`sticky top-0 ${panelBg} border-b ${border}`}>
                      <tr>
                        {["Turn", "Context", "After SD", "Saved", "Total latency", "Quality / Status"].map(h => (
                          <th key={h} className={`text-left px-4 py-3 ${textMuted} font-medium text-xs uppercase tracking-wide`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {displayTraces.map((t) => {
                        return (
                          <tr key={`${t.turn}-${t.originalTokens}`} className={`border-b ${border} last:border-0 hover:bg-gray-800/40 transition-colors`}>
                            <td className={`px-4 py-3 ${textMuted} text-sm`}>
                              {t.turn}
                              <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
                                t.baselineMode ? "bg-gray-800 text-gray-500" : "bg-cyan-950 text-cyan-400 border border-cyan-900"
                              }`}>
                                {t.baselineMode ? "Baseline" : "ScaleDown"}
                              </span>
                            </td>
                            <td className={`px-4 py-3 ${textSub} font-mono text-sm`}>
                              {t.originalTokens.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 font-mono text-sm">
                              {t.baselineMode
                                ? <span className={textMuted}>—</span>
                                : <span className="text-cyan-400">{t.compressedTokens.toLocaleString()}</span>}
                            </td>
                            <td className="px-4 py-3">
                              {t.baselineMode ? (
                                <span className={textMuted}>—</span>
                              ) : (
                                <span className={`font-semibold ${t.compressionRatio >= 0.2 ? "text-green-400" : "text-yellow-400"}`}>
                                  {(t.compressionRatio * 100).toFixed(0)}%
                                </span>
                              )}
                            </td>
                            <td className={`px-4 py-3 font-mono text-sm ${t.totalLatencyMs > 0 ? "text-yellow-400" : textMuted}`}>
                              {t.totalLatencyMs > 0 ? `${t.totalLatencyMs}ms` : "—"}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {t.baselineMode ? (
                                <span className={textSub}>baseline reference</span>
                              ) : t.qualityScore != null && t.qualityScore >= 0 ? (
                                <span className="text-green-400">{(t.qualityScore * 100).toFixed(0)}% match</span>
                              ) : t.compressionSuccess ? (
                                <span className="text-cyan-400">compressed</span>
                              ) : (
                                <span className="text-orange-400">fallback</span>
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
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
                <p className={`${textSub} font-semibold`}>No data yet</p>
                <p className={`${textMuted} text-sm max-w-xs`}>
                  {preferredMode === "scaledown"
                    ? "Start a conversation to see live token savings."
                    : "Baseline captures raw usage. Run both modes to compare."}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Eval ── */}
        {activeTab === "eval" && (
          <div className="flex-1 flex flex-col p-6 gap-4 overflow-auto">

            {evalRunning && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                <p className={`${textSub} text-sm`}>Analyzing conversations...</p>
              </div>
            )}

            {evalError && (
              <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-xs">{evalError}</div>
            )}

            {evalData && !evalRunning && (
              <>
                <div className="flex items-center justify-between shrink-0">
                  <div>
                    <h3 className="text-base font-semibold">All Conversations — Summary</h3>
                    <p className={`${textMuted} text-xs mt-0.5`}>
                      {evalData.summary.totalConversations} conversations · {evalData.summary.totalTurns} total turns
                    </p>
                  </div>
                  <button onClick={runEval} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-900/50 text-purple-300 hover:bg-purple-800/50 border border-purple-800">
                    Refresh
                  </button>
                </div>

                {/* Key metrics */}
                <div className="grid grid-cols-3 gap-3 shrink-0">
                  <div className={`${panelBg} rounded-xl p-4 border ${border}`}>
                    <p className={`${textMuted} text-xs uppercase tracking-widest`}>Token savings</p>
                    <p className="text-3xl font-bold text-cyan-400 mt-2">{evalData.summary.overallCompressionPct}%</p>
                    <p className={`${textMuted} text-xs mt-1`}>{evalData.summary.totalTokensSaved.toLocaleString()} tokens saved</p>
                  </div>
                  <div className={`${panelBg} rounded-xl p-4 border ${border}`}>
                    <p className={`${textMuted} text-xs uppercase tracking-widest`}>End-to-end latency</p>
                    <p className="text-3xl font-bold text-yellow-400 mt-2">
                      {evalData.scaledown?.avgTotalLatencyMs ? `${evalData.scaledown.avgTotalLatencyMs}ms` : "—"}
                    </p>
                    <p className={`${textMuted} text-xs mt-1`}>
                      {evalData.baseline?.avgTotalLatencyMs
                        ? `baseline: ${evalData.baseline.avgTotalLatencyMs}ms`
                        : "no baseline yet"}
                    </p>
                  </div>
                  <div className={`${panelBg} rounded-xl p-4 border ${border}`}>
                    <p className={`${textMuted} text-xs uppercase tracking-widest`}>Answer fidelity</p>
                    <p className="text-3xl font-bold text-green-400 mt-2">
                      {evalData.summary.avgQualityScore != null
                        ? `${((evalData.summary.avgQualityScore ?? 0) * 100).toFixed(0)}%`
                        : "Pending"}
                    </p>
                    <p className={`${textMuted} text-xs mt-1`}>
                      {evalData.summary.avgQualityScore != null
                        ? `${((evalData.summary.qualityCoverage ?? 0) * 100).toFixed(0)}% of ScaleDown turns scored`
                        : `${evalData.summary.baselineCount} baseline · ${evalData.summary.scaledownCount} scaledown`}
                    </p>
                  </div>
                </div>

                {/* Side-by-side comparison */}
                {evalData.baseline && evalData.scaledown && evalData.comparison && (
                  <div className={`rounded-xl p-4 border border-cyan-900 bg-cyan-950/30`}>
                    <p className="text-xs font-semibold uppercase tracking-widest text-cyan-400 mb-3">
                      Baseline vs ScaleDown
                    </p>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className={textMuted}>Avg tokens / turn</p>
                        <p className={textSub}>
                          {Math.round(evalData.baseline.totalOriginalTokens / evalData.baseline.totalTurns)}
                          <span className="text-cyan-400"> → {Math.round(evalData.scaledown.totalCompressedTokens / evalData.scaledown.totalTurns)}</span>
                        </p>
                      </div>
                      <div>
                        <p className={textMuted}>Avg total latency</p>
                        <p className={textSub}>
                          {evalData.baseline.avgTotalLatencyMs}ms
                          <span className="text-cyan-400"> → {evalData.scaledown.avgTotalLatencyMs}ms</span>
                        </p>
                      </div>
                      <div>
                        <p className={textMuted}>Answer fidelity</p>
                        <p className={textSub}>
                          {evalData.scaledown.avgQualityScore != null
                            ? `${((evalData.scaledown.avgQualityScore ?? 0) * 100).toFixed(0)}% vs baseline`
                            : "pending shadow baseline"}
                        </p>
                      </div>
                    </div>
                    <p className={`mt-3 text-xs ${textMuted}`}>
                      LLM-only delta: {evalData.comparison.groqLatencyDiffMs != null
                        ? `${evalData.comparison.groqLatencyDiffMs > 0 ? "+" : ""}${evalData.comparison.groqLatencyDiffMs}ms`
                        : "—"}
                      {" · "}
                      ScaleDown overhead: {evalData.comparison.scaledownOverheadMs}ms
                    </p>
                  </div>
                )}

                {!evalData.baseline && (
                  <div className="rounded-lg p-3 border border-yellow-900 bg-yellow-950/30">
                    <p className="text-xs text-yellow-400">Run baseline conversations to see side-by-side comparison.</p>
                  </div>
                )}

                {/* Per-conversation table */}
                <div className={`${panelBg} rounded-xl border ${border} overflow-auto flex-1`}>
                  <table className="w-full text-sm">
                    <thead className={`sticky top-0 ${panelBg} border-b ${border}`}>
                      <tr>
                        {["Conversation", "Mode", "Turns", "Tokens", "Saved", "Avg total latency", "Fidelity"].map(h => (
                          <th key={h} className={`text-left px-4 py-3 ${textMuted} font-medium text-xs uppercase tracking-wide`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {evalData.results.map((r) => (
                        <tr key={r.id} className={`border-b ${border} last:border-0 hover:bg-gray-800/40 transition-colors`}>
                          <td className="px-4 py-3 font-medium text-sm">{r.label}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              r.mode === "scaledown"
                                ? "bg-cyan-950 text-cyan-400 border border-cyan-900"
                                : "bg-gray-800 text-gray-400"
                            }`}>{r.mode === "scaledown" ? "ScaleDown" : "Baseline"}</span>
                          </td>
                          <td className={`px-4 py-3 ${textSub}`}>{r.turns}</td>
                          <td className="px-4 py-3 font-mono text-sm">
                            <span className={textSub}>{r.totalOriginalTokens.toLocaleString()}</span>
                            {r.mode === "scaledown" && (
                              <span className="text-cyan-400"> → {r.totalCompressedTokens.toLocaleString()}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {r.mode === "scaledown" ? (
                              <span className={`font-semibold ${r.avgCompressionRatio > 0.2 ? "text-green-400" : "text-yellow-400"}`}>
                                {(r.avgCompressionRatio * 100).toFixed(0)}%
                              </span>
                            ) : <span className={textMuted}>—</span>}
                          </td>
                          <td className={`px-4 py-3 font-mono text-sm text-yellow-400`}>
                            {r.avgTotalLatencyMs}ms
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {r.mode === "scaledown"
                              ? r.avgQualityScore != null
                                ? <span className="text-green-400">{(r.avgQualityScore * 100).toFixed(0)}%</span>
                                : <span className={textMuted}>pending</span>
                              : <span className={textMuted}>reference</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {!evalData && !evalRunning && !evalError && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <p className={`${textSub} font-semibold`}>No eval data</p>
                <button onClick={runEval} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium">
                  Analyze Conversations
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
