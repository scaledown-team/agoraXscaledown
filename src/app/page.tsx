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
  avgRougeScore?: number | null;
  qualityCoverage?: number;
  rougeCoverage?: number;
}

interface EvalData {
  results: any[];
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
    avgQualityScore?: number | null;
    avgRougeScore?: number | null;
    qualityCoverage?: number;
    rougeCoverage?: number;
  };
}

export default function Home() {
  const [preferredMode, setPreferredMode] = useState<"baseline" | "scaledown">("baseline");
  const [liveTraceData, setLiveTraceData] = useState<TraceData | null>(null);
  const [conversations, setConversations] = useState<SavedConversation[]>([]);

  const [selectedBaselineConvId, setSelectedBaselineConvId] = useState<string | null>(null);
  const [selectedScaledownConvId, setSelectedScaledownConvId] = useState<string | null>(null);
  const [baselineTraceData, setBaselineTraceData] = useState<TraceData | null>(null);
  const [scaledownTraceData, setScaledownTraceData] = useState<TraceData | null>(null);

  const [evalData, setEvalData] = useState<EvalData | null>(null);
  const [evalRunning, setEvalRunning] = useState(false);

  const lastConversationIdRef = useRef<string | null>(null);
  const lastModeRef = useRef<"baseline" | "scaledown">("baseline");

  const {
    status, mode, error, conversationId,
    audioAutoplayFailed, agentAudioReceived,
    startConversation, endConversation, unlockAudio,
  } = useConversation(preferredMode);

  const runEval = useCallback(async () => {
    setEvalRunning(true);
    try {
      const res = await fetch("/api/eval", { method: "POST" });
      if (res.ok) setEvalData(await res.json());
    } catch { } finally {
      setEvalRunning(false);
    }
  }, []);

  const clearHistory = useCallback(async () => {
    if (!confirm("Delete all conversations and trace data from the database? This cannot be undone.")) return;
    await fetch("/api/clear-history", { method: "DELETE" });
    setEvalData(null);
    setConversations([]);
    setBaselineTraceData(null);
    setScaledownTraceData(null);
    setSelectedBaselineConvId(null);
    setSelectedScaledownConvId(null);
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch { }
  }, []);

  useEffect(() => { refreshConversations(); runEval(); }, []);

  useEffect(() => { if (status === "active") lastModeRef.current = mode; }, [status, mode]);
  useEffect(() => { if (conversationId) lastConversationIdRef.current = conversationId; }, [conversationId]);

  useEffect(() => {
    if (status === "idle" && lastConversationIdRef.current) {
      const endedId = lastConversationIdRef.current;
      const endedMode = lastModeRef.current;
      refreshConversations().then(() => {
        if (endedMode === "baseline") setSelectedBaselineConvId(endedId);
        else setSelectedScaledownConvId(endedId);
      });
      runEval();
    }
  }, [status]);

  const baselineConvs = conversations.filter(c => c.mode === "baseline" && c.turns > 0);
  const scaledownConvs = conversations.filter(c => c.mode === "scaledown" && c.turns > 0);

  useEffect(() => {
    if (baselineConvs.length > 0 && !selectedBaselineConvId)
      setSelectedBaselineConvId(baselineConvs[0].id);
  }, [baselineConvs.length]);

  useEffect(() => {
    if (scaledownConvs.length > 0 && !selectedScaledownConvId)
      setSelectedScaledownConvId(scaledownConvs[0].id);
  }, [scaledownConvs.length]);

  useEffect(() => {
    if (status !== "active" || !conversationId) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/traces?conversationId=${conversationId}`);
        if (res.ok) setLiveTraceData(await res.json());
      } catch { }
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [status, conversationId]);

  useEffect(() => {
    if (!selectedBaselineConvId) { setBaselineTraceData(null); return; }
    fetch(`/api/traces?conversationId=${selectedBaselineConvId}`)
      .then(r => r.ok ? r.json() : null).then(d => d && setBaselineTraceData(d)).catch(() => { });
  }, [selectedBaselineConvId]);

  useEffect(() => {
    if (!selectedScaledownConvId) { setScaledownTraceData(null); return; }
    fetch(`/api/traces?conversationId=${selectedScaledownConvId}`)
      .then(r => r.ok ? r.json() : null).then(d => d && setScaledownTraceData(d)).catch(() => { });
  }, [selectedScaledownConvId]);

  const startBaseline = useCallback(() => {
    setLiveTraceData(null);
    lastConversationIdRef.current = null;
    setPreferredMode("baseline");
    startConversation("baseline");
  }, [startConversation]);

  const startScaledown = useCallback(() => {
    setLiveTraceData(null);
    lastConversationIdRef.current = null;
    setPreferredMode("scaledown");
    startConversation("scaledown");
  }, [startConversation]);

  const [isDark, setIsDark] = useState(true);

  const isLiveBaseline = status === "active" && mode === "baseline";
  const isLiveScaledown = status === "active" && mode === "scaledown";
  const leftData = isLiveBaseline ? liveTraceData : baselineTraceData;
  const rightData = isLiveScaledown ? liveTraceData : scaledownTraceData;

  // ── Theme ─────────────────────────────────────────────────
  const border    = isDark ? "border-gray-800"  : "border-gray-200";
  const textMuted = isDark ? "text-gray-600"    : "text-gray-400";
  const textSub   = isDark ? "text-gray-400"    : "text-gray-600";

  const mainBg        = isDark ? "bg-gray-950 text-white"    : "bg-gray-100 text-gray-900";
  const headerBg      = isDark ? "bg-gray-900/50"            : "bg-white";
  const headerBorder  = isDark ? "border-gray-800/60"        : "border-gray-200";
  const panelBg       = isDark ? "bg-gray-950"               : "bg-white";
  const sdPanelBg     = isDark ? "bg-cyan-950/10"            : "bg-cyan-50/40";
  const sdBorderCol   = isDark ? "border-cyan-900/50"        : "border-cyan-200";
  const tableBg       = isDark ? "bg-gray-950"               : "bg-white";
  const sdTableBg     = isDark ? "bg-[#010c0e]"              : "bg-cyan-50/20";
  const tableHeaderBg = isDark ? "bg-gray-950"               : "bg-gray-50";
  const sdTableHdrBg  = isDark ? "bg-[#030d0f]"              : "bg-cyan-50/30";
  const tableHover    = isDark ? "hover:bg-gray-900/40"      : "hover:bg-gray-50";
  const sdTableHover  = isDark ? "hover:bg-cyan-950/20"      : "hover:bg-cyan-50/50";
  const baselineTag   = isDark ? "bg-gray-800 text-gray-400" : "bg-gray-100 text-gray-600 border border-gray-300";
  const sdTag         = isDark ? "bg-cyan-950 text-cyan-300 border border-cyan-800" : "bg-cyan-50 text-cyan-700 border border-cyan-300";
  const baselineBar   = isDark ? "bg-gray-600"               : "bg-gray-300";
  const baselineTotal = isDark ? "text-gray-300"             : "text-gray-800";
  const baselineSelect= isDark ? `bg-gray-900 border ${border} ${textSub}` : `bg-white border border-gray-200 text-gray-600`;
  const sdSelectCls   = isDark ? "bg-[#010c0e] border border-cyan-900/50 text-cyan-400" : "bg-white border border-cyan-200 text-cyan-700";
  const btnBase       = isDark ? "bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white" : "bg-gray-200 hover:bg-gray-300 text-gray-600 hover:text-gray-900";
  const clearBtn      = isDark ? "bg-gray-800 hover:bg-red-900/60 text-gray-600 hover:text-red-400" : "bg-gray-200 hover:bg-red-100 text-gray-500 hover:text-red-600";
  const baselineBtn   = isDark ? "bg-gray-700 hover:bg-gray-600 text-white" : "bg-gray-700 hover:bg-gray-600 text-white";
  const baselineBtnDis= isDark ? "bg-gray-800 text-gray-500" : "bg-gray-200 text-gray-400";
  const sdBtnDis      = isDark ? "bg-cyan-950 text-cyan-600" : "bg-cyan-100 text-cyan-400";
  const dividerBorder = isDark ? "border-gray-800" : "border-gray-200";

  // ── Per-turn trace table ──────────────────────────────────
  function renderTable(data: TraceData | null, isBaseline: boolean, isLive: boolean) {
    if (!data || data.traces.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <p className={`text-sm ${textMuted}`}>
            {isLive ? "Waiting for first turn..." : "No data — select or start a conversation"}
          </p>
        </div>
      );
    }

    return (
      <div>
        <table className="w-full text-xs">
          <thead className={`sticky top-0 border-b ${border} ${isBaseline ? tableHeaderBg : sdTableHdrBg}`}>
            <tr className="h-8">
              <th className={`text-left px-3 ${textMuted} font-medium uppercase tracking-wide`}>Turn</th>
              <th className={`text-left px-3 ${textMuted} font-medium uppercase tracking-wide`}>Tokens In</th>
              {!isBaseline && <th className={`text-left px-3 ${textMuted} font-medium uppercase tracking-wide`}>After SD</th>}
              {!isBaseline && <th className={`text-left px-3 ${textMuted} font-medium uppercase tracking-wide`}>Saved</th>}
              <th className={`text-left px-3 ${textMuted} font-medium uppercase tracking-wide`}>Latency</th>
              <th className={`text-left px-3 ${textMuted} font-medium uppercase tracking-wide`}>{isBaseline ? "Status" : "Fidelity"}</th>
            </tr>
          </thead>
          <tbody>
            {data.traces.map((t) => (
              <tr key={`${t.turn}-${t.originalTokens}`}
                className={`border-b ${border} last:border-0 transition-colors ${isBaseline ? tableHover : sdTableHover}`}>
                <td className={`px-3 py-2.5 font-mono ${textMuted}`}>{t.turn}</td>
                <td className={`px-3 py-2.5 font-mono ${textSub}`}>{t.originalTokens.toLocaleString()}</td>
                {!isBaseline && (
                  <td className="px-3 py-2.5 font-mono text-cyan-400">
                    {t.compressionSuccess ? t.compressedTokens.toLocaleString() : <span className={textMuted}>—</span>}
                  </td>
                )}
                {!isBaseline && (
                  <td className="px-3 py-2.5 font-semibold">
                    {t.compressionSuccess
                      ? <span className="text-cyan-400">{(t.compressionRatio * 100).toFixed(0)}%</span>
                      : <span className="text-orange-400">fallback</span>}
                  </td>
                )}
                <td className={`px-3 py-2.5 font-mono ${t.totalLatencyMs > 0 ? (isBaseline ? "text-gray-300" : "text-cyan-400") : textMuted}`}>
                  {t.totalLatencyMs > 0 ? `${t.totalLatencyMs}ms` : "—"}
                </td>
                <td className="px-3 py-2.5">
                  {isBaseline
                    ? <span className={textMuted}>reference</span>
                    : t.qualityScore != null && t.qualityScore >= 0
                      ? <span className="text-cyan-400 font-semibold">{(t.qualityScore * 100).toFixed(0)}%</span>
                      : t.compressionSuccess
                        ? <span className="text-cyan-500">compressed</span>
                        : <span className="text-orange-400">fallback</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────
  return (
    <main className={`flex flex-col h-screen overflow-hidden ${mainBg}`}>

      {/* ── TOP HEADER ── */}
      <header className={`shrink-0 border-b ${border} ${headerBg}`}>

        {/* Branding row */}
        <div className={`flex items-center justify-between px-6 py-2.5 border-b ${headerBorder}`}>
          <div>
            <h1 className="text-sm font-bold tracking-tight">
              Agora <span className="text-blue-400">×</span> ScaleDown
            </h1>
            <p className={`text-[10px] ${textMuted}`}>Voice AI · context compression</p>
          </div>
          <div className="flex items-center gap-3">
            {evalData && (
              <p className={`text-[10px] ${textMuted}`}>
                {evalData.summary.baselineCount} baseline · {evalData.summary.scaledownCount} scaledown · {evalData.summary.totalTurns} turns
              </p>
            )}
            <button onClick={() => setIsDark(d => !d)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${btnBase}`}>
              {isDark ? "☀ Light" : "☾ Dark"}
            </button>
            <button onClick={runEval} disabled={evalRunning}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${evalRunning ? `opacity-40 ${isDark ? "bg-gray-800 text-gray-500" : "bg-gray-200 text-gray-400"}` : btnBase}`}>
              {evalRunning ? "..." : "↻ Refresh"}
            </button>
            <button onClick={clearHistory} disabled={status !== "idle"}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-30 ${clearBtn}`}>
              Clear History
            </button>
          </div>
        </div>

        {/* ── Hero comparison: 3 big cards, Accuracy → Tokens → Latency ── */}
        {evalData && evalData.baseline && evalData.scaledown ? (() => {
          const b = evalData.baseline;
          const s = evalData.scaledown;
          const latencyDiff = (s.avgTotalLatencyMs ?? 0) - (b.avgTotalLatencyMs ?? 0);
          const tokensSaved = b.totalOriginalTokens - s.totalCompressedTokens;
          const compressionPct = b.totalOriginalTokens > 0
            ? Number(((tokensSaved / b.totalOriginalTokens) * 100).toFixed(1))
            : 0;
          const fidelity = evalData.summary.avgQualityScore ?? evalData.scaledown?.avgQualityScore ?? null;
          const rouge = evalData.summary.avgRougeScore ?? evalData.scaledown?.avgRougeScore ?? null;

          return (
            <div className="grid grid-cols-3 divide-x divide-gray-800">

              {/* 1 — ACCURACY (priority #1) */}
              <div className="px-8 py-5 flex flex-col gap-3">
                <p className={`text-[10px] uppercase tracking-widest ${textMuted}`}>Answer Quality Score</p>
                <p className={`text-[10px] ${textMuted} -mt-2`}>
                  How similar are the answers with and without compression? Scored by an LLM judge.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className={`text-[10px] uppercase tracking-widest ${textMuted} mb-1`}>Baseline</p>
                    {evalData.baseline?.avgQualityScore != null ? (
                      <>
                        <p className="text-3xl font-black text-gray-300">{(evalData.baseline.avgQualityScore * 100).toFixed(0)}%</p>
                        <p className={`text-[10px] ${textMuted} mt-0.5`}>vs ScaleDown shadow · LLM-judge</p>
                      </>
                    ) : (
                      <>
                        <p className="text-3xl font-black text-gray-500">—</p>
                        <p className={`text-[10px] ${textMuted} mt-0.5`}>run baseline conversation</p>
                      </>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-cyan-900 mb-1">ScaleDown</p>
                    {fidelity != null ? (
                      <>
                        <p className="text-3xl font-black text-cyan-400">{(fidelity * 100).toFixed(0)}%</p>
                        <p className="text-[10px] text-cyan-700 mt-0.5">LLM-judge · {rouge != null ? `${(rouge * 100).toFixed(0)}% ROUGE-1` : "semantic match"}</p>
                      </>
                    ) : (
                      <>
                        <p className="text-3xl font-black text-gray-600">—</p>
                        <p className={`text-[10px] ${textMuted} mt-0.5`}>run ScaleDown conversation</p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* 2 — TOKENS */}
              <div className="px-8 py-5 flex flex-col gap-4">
                <p className={`text-[10px] uppercase tracking-widest ${textMuted}`}>Tokens Sent to Groq · Same Conversation</p>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className={textMuted}>Baseline</span>
                      <span className={textSub}>{b.totalOriginalTokens.toLocaleString()}</span>
                    </div>
                    <div className={`h-5 rounded w-full ${baselineBar}`} />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-cyan-400 font-semibold">ScaleDown</span>
                      <span className="text-cyan-400 font-semibold">{s.totalCompressedTokens.toLocaleString()} <span className="text-cyan-700">↓ {compressionPct}%</span></span>
                    </div>
                    <div className="h-5 bg-gray-800 rounded overflow-hidden">
                      <div
                        className="h-full bg-cyan-500 rounded"
                        style={{ width: `${100 - compressionPct}%` }}
                      />
                    </div>
                  </div>
                </div>
                <p className={`text-[10px] ${textMuted}`}>{tokensSaved.toLocaleString()} tokens never reached Groq</p>
              </div>

              {/* 3 — LATENCY BREAKDOWN */}
              <div className="px-8 py-5 flex flex-col gap-3">
                <p className={`text-[10px] uppercase tracking-widest ${textMuted}`}>Avg Latency · Per Turn</p>
                <div className="grid grid-cols-2 gap-6">
                  {/* Baseline */}
                  <div>
                    <p className={`text-[10px] uppercase tracking-widest ${textMuted} mb-2`}>Baseline</p>
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className={textMuted}>Groq</span>
                        <span className={textSub}>{b.avgGroqLatencyMs}ms</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className={textMuted}>Overhead</span>
                        <span className={textMuted}>0ms</span>
                      </div>
                      <div className={`h-px bg-gray-800 my-1`} />
                      <div className="flex justify-between">
                        <span className={`text-xs font-semibold ${textSub}`}>Total</span>
                        <span className={`text-base font-black ${baselineTotal}`}>{b.avgTotalLatencyMs ?? "—"}ms</span>
                      </div>
                    </div>
                  </div>
                  {/* ScaleDown */}
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-cyan-900 mb-2">ScaleDown</p>
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-cyan-900">Groq</span>
                        <span className="text-cyan-400">{s.avgGroqLatencyMs}ms</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-cyan-900">ScaleDown</span>
                        <span className="text-cyan-400">{s.avgScaledownLatencyMs}ms</span>
                      </div>
                      <div className="h-px bg-cyan-900/30 my-1" />
                      <div className="flex justify-between">
                        <span className="text-xs font-semibold text-cyan-900">Total</span>
                        <span className="text-base font-black text-cyan-400">{s.avgTotalLatencyMs ?? "—"}ms</span>
                      </div>
                    </div>
                  </div>
                </div>
                <p className={`text-[10px] ${textMuted}`}>
                  +{latencyDiff}ms overhead today · closes as context grows (fewer tokens = faster Groq)
                </p>
              </div>

            </div>
          );
        })() : (
          <div className="px-6 py-4 flex items-center gap-3">
            <p className={`text-xs ${textMuted}`}>
              {evalRunning ? "Calculating..." : "Run a baseline and a ScaleDown conversation to see the comparison"}
            </p>
          </div>
        )}
      </header>

      {/* ── Audio unlock overlay — shown when browser blocks autoplay ── */}
      {audioAutoplayFailed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-gray-900 border border-yellow-500/50 rounded-2xl px-10 py-8 flex flex-col items-center gap-4 shadow-2xl">
            <div className="text-4xl">🔊</div>
            <p className="text-white font-bold text-lg">Browser blocked audio</p>
            <p className="text-gray-400 text-sm text-center max-w-xs">
              Click below to enable the agent's voice. This is a one-time Chrome autoplay requirement.
            </p>
            <button
              onClick={unlockAudio}
              className="mt-2 px-8 py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-xl text-base transition-colors animate-pulse"
            >
              Enable Audio
            </button>
          </div>
        </div>
      )}

      {/* ── MAIN: two-column grid — headers share row 1, tables share row 2 ── */}
      <div className="flex-1 overflow-hidden grid grid-cols-2" style={{ gridTemplateRows: "auto 1fr" }}>

        {/* ══════════════════ LEFT HEADER: BASELINE ══════════════════ */}
        <div className={`border-b border-r-2 ${border} px-5 pt-4 pb-3 ${panelBg}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full uppercase tracking-widest ${baselineTag}`}>
                    Baseline
                  </span>
                  {isLiveBaseline && (
                    <span className="flex items-center gap-1 text-xs text-green-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
                      Live
                    </span>
                  )}
                </div>
                <p className={`text-[11px] ${textMuted}`}>
                  Raw Agora agent · no compression · direct to Groq
                </p>
                <p className={`text-[10px] ${textMuted} mt-0.5`}>
                  ASR: Deepgram · LLM: Groq Llama 3.3 · TTS: Cartesia
                </p>
              </div>

              {/* Baseline action */}
              <div className="shrink-0 flex flex-col items-end gap-1.5">
                {status === "idle" ? (
                  <button onClick={startBaseline}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${baselineBtn}`}>
                    Start Baseline
                  </button>
                ) : isLiveBaseline ? (
                  <button onClick={endConversation}
                    className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded-xl text-xs font-semibold transition-colors text-white whitespace-nowrap">
                    End Session
                  </button>
                ) : (
                  <button disabled
                    className={`px-4 py-2 rounded-xl text-xs font-semibold opacity-40 whitespace-nowrap ${baselineBtnDis}`}>
                    {status === "connecting" ? "Connecting..." : status === "ending" ? "Ending..." : "ScaleDown active"}
                  </button>
                )}
                {isLiveBaseline && (
                  <p className={`text-[10px] ${agentAudioReceived ? "text-green-400" : "text-yellow-400"}`}>
                    {agentAudioReceived ? "● audio receiving" : "○ waiting for audio..."}
                  </p>
                )}
                {audioAutoplayFailed && isLiveBaseline && (
                  <button onClick={unlockAudio} className="px-3 py-1 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-xs font-medium animate-pulse">
                    Enable Audio
                  </button>
                )}
              </div>
            </div>

            {leftData && leftData.traces.length > 0 && (
              <div className={`mt-3 flex items-center gap-6 text-xs ${textMuted}`}>
                <span>{leftData.traces.reduce((s, t) => s + t.originalTokens, 0).toLocaleString()} tokens · {leftData.totalTurns} turns</span>
                <span>avg {leftData.summary.avgTotalLatencyMs > 0 ? `${leftData.summary.avgTotalLatencyMs}ms` : "—"} latency</span>
              </div>
            )}

            {/* Baseline conv selector */}
            {!isLiveBaseline && (
              <div className="mt-3 flex items-center gap-2">
                {baselineConvs.length > 0 ? (
                  <select
                    value={selectedBaselineConvId || ""}
                    onChange={e => setSelectedBaselineConvId(e.target.value || null)}
                    className={`text-xs rounded-lg px-2.5 py-1.5 cursor-pointer ${baselineSelect}`}>
                    <option value="">Select conversation</option>
                    {baselineConvs.map(c => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                ) : (
                  <p className={`text-xs ${textMuted}`}>No baseline conversations yet</p>
                )}
                {leftData && <span className={`text-[10px] ${textMuted} ml-auto`}>{leftData.totalTurns} turns</span>}
              </div>
            )}
        </div>

        {/* ══════════════════ RIGHT HEADER: SCALEDOWN ══════════════════ */}
        <div className={`border-b px-5 pt-4 pb-3 ${sdPanelBg} ${sdBorderCol}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full uppercase tracking-widest ${sdTag}`}>
                    ScaleDown
                  </span>
                  {isLiveScaledown && (
                    <span className="flex items-center gap-1 text-xs text-green-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
                      Live
                    </span>
                  )}
                </div>
                <p className={`text-[11px] text-cyan-700`}>
                  Agora agent · ScaleDown compression → Groq
                </p>
                <p className={`text-[10px] text-cyan-900 mt-0.5`}>
                  ASR: Deepgram · <span className="text-cyan-600 font-semibold">Compress: ScaleDown</span> · LLM: Groq Llama 3.3 · TTS: Cartesia
                </p>
              </div>

              {/* ScaleDown action */}
              <div className="shrink-0 flex flex-col items-end gap-1.5">
                {status === "idle" ? (
                  <button onClick={startScaledown}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-xl text-xs font-semibold transition-colors text-white whitespace-nowrap">
                    Start ScaleDown
                  </button>
                ) : isLiveScaledown ? (
                  <button onClick={endConversation}
                    className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded-xl text-xs font-semibold transition-colors text-white whitespace-nowrap">
                    End Session
                  </button>
                ) : (
                  <button disabled
                    className={`px-4 py-2 rounded-xl text-xs font-semibold opacity-40 whitespace-nowrap ${sdBtnDis}`}>
                    {status === "connecting" ? "Connecting..." : status === "ending" ? "Ending..." : "Baseline active"}
                  </button>
                )}
                {isLiveScaledown && (
                  <p className={`text-[10px] ${agentAudioReceived ? "text-green-400" : "text-yellow-400"}`}>
                    {agentAudioReceived ? "● audio receiving" : "○ waiting for audio..."}
                  </p>
                )}
                {audioAutoplayFailed && isLiveScaledown && (
                  <button onClick={unlockAudio} className="px-3 py-1 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-xs font-medium animate-pulse">
                    Enable Audio
                  </button>
                )}
              </div>
            </div>

            {rightData && rightData.traces.length > 0 && (() => {
              const totalIn = rightData.traces.reduce((s, t) => s + t.originalTokens, 0);
              const totalOut = rightData.traces.reduce((s, t) => s + t.compressedTokens, 0);
              const pct = totalIn > 0 ? (((totalIn - totalOut) / totalIn) * 100) | 0 : 0;
              return (
                <div className={`mt-3 flex items-center gap-6 text-xs text-cyan-900`}>
                  <span className="text-cyan-400 font-semibold">{pct}% tokens compressed</span>
                  <span>avg {rightData.summary.avgTotalLatencyMs > 0 ? `${rightData.summary.avgTotalLatencyMs}ms` : "—"} latency</span>
                  {rightData.summary.avgQualityScore != null && (
                    <span className="text-cyan-400 font-semibold">{(rightData.summary.avgQualityScore * 100).toFixed(0)}% fidelity</span>
                  )}
                </div>
              );
            })()}

            {/* ScaleDown conv selector */}
            {!isLiveScaledown && (
              <div className="mt-3 flex items-center gap-2">
                {scaledownConvs.length > 0 ? (
                  <select
                    value={selectedScaledownConvId || ""}
                    onChange={e => setSelectedScaledownConvId(e.target.value || null)}
                    className={`text-xs rounded-lg px-2.5 py-1.5 cursor-pointer ${sdSelectCls}`}>
                    <option value="">Select conversation</option>
                    {scaledownConvs.map(c => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                ) : (
                  <p className={`text-xs text-cyan-900`}>No ScaleDown conversations yet</p>
                )}
                {rightData && <span className={`text-[10px] text-cyan-900 ml-auto`}>{rightData.totalTurns} turns</span>}
              </div>
            )}
        </div>

        {/* ══ LEFT TABLE ══ */}
        <div className={`overflow-auto border-r-2 ${dividerBorder} ${tableBg}`}>
          {renderTable(leftData, true, isLiveBaseline)}
        </div>

        {/* ══ RIGHT TABLE ══ */}
        <div className={`overflow-auto ${sdTableBg}`}>
          {renderTable(rightData, false, isLiveScaledown)}
        </div>

      </div>

      {/* Global error / audio */}
      {error && (
        <div className="fixed bottom-4 left-4 right-4 max-w-sm p-3 bg-red-900/90 border border-red-700 rounded-xl text-red-300 text-xs z-50">
          {error}
        </div>
      )}
    </main>
  );
}
