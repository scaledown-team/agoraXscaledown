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

  const isLiveBaseline = status === "active" && mode === "baseline";
  const isLiveScaledown = status === "active" && mode === "scaledown";
  const leftData = isLiveBaseline ? liveTraceData : baselineTraceData;
  const rightData = isLiveScaledown ? liveTraceData : scaledownTraceData;

  const border = "border-gray-800";
  const textMuted = "text-gray-600";
  const textSub = "text-gray-400";

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
      <div className="overflow-auto flex-1">
        <table className="w-full text-xs">
          <thead className={`sticky top-0 border-b ${border} ${isBaseline ? "bg-gray-950" : "bg-[#030d0f]"}`}>
            <tr>
              <th className={`text-left px-3 py-2 ${textMuted} font-medium uppercase tracking-wide`}>Turn</th>
              <th className={`text-left px-3 py-2 ${textMuted} font-medium uppercase tracking-wide`}>Tokens in</th>
              {!isBaseline && <th className={`text-left px-3 py-2 ${textMuted} font-medium uppercase tracking-wide`}>After SD</th>}
              {!isBaseline && <th className={`text-left px-3 py-2 ${textMuted} font-medium uppercase tracking-wide`}>Saved</th>}
              <th className={`text-left px-3 py-2 ${textMuted} font-medium uppercase tracking-wide`}>Latency</th>
              <th className={`text-left px-3 py-2 ${textMuted} font-medium uppercase tracking-wide`}>{isBaseline ? "Status" : "Fidelity"}</th>
            </tr>
          </thead>
          <tbody>
            {data.traces.map((t) => (
              <tr key={`${t.turn}-${t.originalTokens}`}
                className={`border-b ${border} last:border-0 transition-colors ${isBaseline ? "hover:bg-gray-900/40" : "hover:bg-cyan-950/20"}`}>
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
                      ? <span className={t.compressionRatio >= 0.5 ? "text-green-400" : "text-yellow-400"}>{(t.compressionRatio * 100).toFixed(0)}%</span>
                      : <span className="text-orange-400">fallback</span>}
                  </td>
                )}
                <td className={`px-3 py-2.5 font-mono ${t.totalLatencyMs > 0 ? "text-yellow-400" : textMuted}`}>
                  {t.totalLatencyMs > 0 ? `${t.totalLatencyMs}ms` : "—"}
                </td>
                <td className="px-3 py-2.5">
                  {isBaseline
                    ? <span className={textMuted}>reference</span>
                    : t.qualityScore != null && t.qualityScore >= 0
                      ? <span className="text-green-400 font-semibold">{(t.qualityScore * 100).toFixed(0)}%</span>
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
    <main className="flex flex-col h-screen bg-gray-950 text-white overflow-hidden">

      {/* ── TOP HEADER ── */}
      <header className={`shrink-0 border-b ${border} bg-gray-900/50`}>

        {/* Branding row */}
        <div className={`flex items-center justify-between px-6 py-2.5 border-b border-gray-800/60`}>
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
            <button onClick={runEval} disabled={evalRunning}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${evalRunning ? "opacity-40 bg-gray-800 text-gray-500" : "bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white"}`}>
              {evalRunning ? "..." : "↻ Refresh"}
            </button>
          </div>
        </div>

        {/* Delta comparison table */}
        {evalData && evalData.baseline && evalData.scaledown ? (() => {
          const b = evalData.baseline;
          const s = evalData.scaledown;
          const cmp = evalData.comparison;
          const latencyDiff = (s.avgTotalLatencyMs ?? 0) - (b.avgTotalLatencyMs ?? 0);
          const fidelity = evalData.summary.avgQualityScore ?? evalData.scaledown?.avgQualityScore ?? null;
          const rouge = evalData.summary.avgRougeScore ?? evalData.scaledown?.avgRougeScore ?? null;

          return (
            <div className="grid grid-cols-[1fr_auto_1fr] divide-x divide-gray-800">

              {/* ── Row labels (3 metrics) ── */}
              {/* We render 3 rows: tokens, latency, fidelity */}
              {/* Each row: [baseline value] [delta center] [scaledown value] */}

              {/* TOKENS */}
              <div className="px-6 py-3 flex items-center gap-6">
                <div>
                  <p className={`text-[10px] uppercase tracking-widest ${textMuted} mb-1`}>Total Tokens</p>
                  <p className="text-xl font-bold text-gray-300">{b.totalOriginalTokens.toLocaleString()}</p>
                  <p className={`text-[10px] ${textMuted} mt-0.5`}>{b.totalTurns} turns · no compression</p>
                </div>
                <div className="ml-auto text-right">
                  <p className={`text-[10px] uppercase tracking-widest ${textMuted} mb-1`}>Avg / turn</p>
                  <p className={`text-base font-semibold ${textSub}`}>
                    {Math.round(b.totalOriginalTokens / Math.max(1, b.totalTurns))}
                  </p>
                </div>
              </div>

              {/* DELTA: tokens */}
              <div className="px-8 py-3 flex flex-col items-center justify-center gap-1 bg-gray-900/30 min-w-[220px]">
                <p className={`text-[10px] uppercase tracking-widest ${textMuted}`}>Token Delta</p>
                <p className="text-2xl font-bold text-cyan-400">↓ {evalData.summary.overallCompressionPct}%</p>
                <p className={`text-xs text-cyan-600`}>{evalData.summary.totalTokensSaved.toLocaleString()} tokens never hit Groq</p>
              </div>

              <div className="px-6 py-3 flex items-center gap-6">
                <div>
                  <p className={`text-[10px] uppercase tracking-widest text-cyan-900 mb-1`}>Total Tokens</p>
                  <p className="text-xl font-bold text-cyan-300">{s.totalCompressedTokens.toLocaleString()}</p>
                  <p className={`text-[10px] text-cyan-900 mt-0.5`}>{s.totalTurns} turns · after compression</p>
                </div>
                <div className="ml-auto text-right">
                  <p className={`text-[10px] uppercase tracking-widest text-cyan-900 mb-1`}>Avg / turn</p>
                  <p className="text-base font-semibold text-cyan-400">
                    {Math.round(s.totalCompressedTokens / Math.max(1, s.totalTurns))}
                  </p>
                </div>
              </div>

              {/* divider row */}
              <div className={`col-span-3 h-px bg-gray-800/60`} />

              {/* LATENCY */}
              <div className="px-6 py-3 flex items-center gap-6">
                <div>
                  <p className={`text-[10px] uppercase tracking-widest ${textMuted} mb-1`}>Avg Latency</p>
                  <p className="text-xl font-bold text-yellow-400">{b.avgTotalLatencyMs ?? "—"}ms</p>
                  <p className={`text-[10px] ${textMuted} mt-0.5`}>pure LLM · 0ms overhead</p>
                </div>
                <div className="ml-auto text-right">
                  <p className={`text-[10px] uppercase tracking-widest ${textMuted} mb-1`}>LLM only</p>
                  <p className={`text-base font-semibold ${textSub}`}>{b.avgGroqLatencyMs}ms</p>
                </div>
              </div>

              {/* DELTA: latency */}
              <div className="px-8 py-3 flex flex-col items-center justify-center gap-1 bg-gray-900/30">
                <p className={`text-[10px] uppercase tracking-widest ${textMuted}`}>Latency Delta</p>
                <p className={`text-2xl font-bold ${latencyDiff > 0 ? "text-orange-400" : "text-green-400"}`}>
                  {latencyDiff > 0 ? "+" : ""}{latencyDiff}ms
                </p>
                {cmp && (
                  <p className={`text-xs text-center ${textMuted}`}>
                    {cmp.scaledownOverheadMs}ms compress overhead
                    {cmp.groqLatencyDiffMs != null && cmp.groqLatencyDiffMs < 0
                      ? ` · ${Math.abs(cmp.groqLatencyDiffMs)}ms faster LLM`
                      : ""}
                  </p>
                )}
                <p className={`text-[10px] text-center text-gray-700`}>SD wins latency as context grows</p>
              </div>

              <div className="px-6 py-3 flex items-center gap-6">
                <div>
                  <p className={`text-[10px] uppercase tracking-widest text-cyan-900 mb-1`}>Avg Latency</p>
                  <p className="text-xl font-bold text-yellow-400">{s.avgTotalLatencyMs ?? "—"}ms</p>
                  <p className={`text-[10px] text-cyan-900 mt-0.5`}>{s.avgScaledownLatencyMs}ms SD + {s.avgGroqLatencyMs}ms LLM</p>
                </div>
                <div className="ml-auto text-right">
                  <p className={`text-[10px] uppercase tracking-widest text-cyan-900 mb-1`}>LLM only</p>
                  <p className="text-base font-semibold text-cyan-400">{s.avgGroqLatencyMs}ms</p>
                </div>
              </div>

              {/* divider row */}
              <div className={`col-span-3 h-px bg-gray-800/60`} />

              {/* FIDELITY */}
              <div className="px-6 py-3 flex items-center gap-6">
                <div>
                  <p className={`text-[10px] uppercase tracking-widest ${textMuted} mb-1`}>Answer Fidelity</p>
                  <p className={`text-xl font-bold text-gray-400`}>Reference</p>
                  <p className={`text-[10px] ${textMuted} mt-0.5`}>uncompressed · ground truth</p>
                </div>
              </div>

              {/* DELTA: fidelity */}
              <div className="px-8 py-3 flex flex-col items-center justify-center gap-1 bg-gray-900/30">
                <p className={`text-[10px] uppercase tracking-widest ${textMuted}`}>Accuracy Delta</p>
                {fidelity != null ? (
                  <>
                    <p className="text-xl font-bold text-green-400">{((fidelity) * 100).toFixed(0)}%</p>
                    <p className={`text-[10px] text-green-700`}>LLM-judge fidelity</p>
                    {rouge != null && (
                      <>
                        <p className="text-lg font-bold text-green-300 mt-0.5">{((rouge) * 100).toFixed(0)}%</p>
                        <p className={`text-[10px] text-green-800`}>ROUGE-1 F1</p>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <p className={`text-xl font-bold ${textMuted}`}>—</p>
                    <p className={`text-xs ${textMuted}`}>run ScaleDown conversation</p>
                  </>
                )}
              </div>

              <div className="px-6 py-3 flex items-center gap-6">
                <div>
                  <p className={`text-[10px] uppercase tracking-widest text-cyan-900 mb-1`}>Answer Accuracy</p>
                  {fidelity != null ? (
                    <>
                      <p className={`text-base font-bold text-green-400`}>{((fidelity) * 100).toFixed(0)}% <span className="text-[10px] font-normal text-cyan-900">LLM-judge</span></p>
                      {rouge != null && (
                        <p className={`text-base font-bold text-green-300`}>{((rouge) * 100).toFixed(0)}% <span className="text-[10px] font-normal text-cyan-900">ROUGE-1 F1</span></p>
                      )}
                      <p className={`text-[10px] text-cyan-900 mt-0.5`}>{((evalData.summary.qualityCoverage ?? 0) * 100).toFixed(0)}% turns scored</p>
                    </>
                  ) : (
                    <>
                      <p className={`text-xl font-bold text-gray-600`}>Pending</p>
                      <p className={`text-[10px] text-cyan-900 mt-0.5`}>run with SHADOW_BASELINE=true</p>
                    </>
                  )}
                </div>
              </div>

            </div>
          );
        })() : (
          <div className="px-6 py-4 flex items-center gap-3">
            <p className={`text-xs ${textMuted}`}>
              {evalRunning
                ? "Calculating delta..."
                : "Run a baseline and a ScaleDown conversation to see the comparison"}
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

      {/* ── MAIN: two-column wall ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ══════════════════ LEFT: BASELINE ══════════════════ */}
        <div className={`flex-1 flex flex-col overflow-hidden border-r-2 border-gray-800 bg-gray-950`}>

          {/* Column header */}
          <div className={`shrink-0 border-b ${border} px-5 pt-4 pb-3`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold bg-gray-800 text-gray-400 px-2.5 py-0.5 rounded-full uppercase tracking-widest">
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
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-xl text-xs font-semibold transition-colors text-white whitespace-nowrap">
                    Start Baseline
                  </button>
                ) : isLiveBaseline ? (
                  <button onClick={endConversation}
                    className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded-xl text-xs font-semibold transition-colors text-white whitespace-nowrap">
                    End Session
                  </button>
                ) : (
                  <button disabled
                    className="px-4 py-2 bg-gray-800 rounded-xl text-xs font-semibold opacity-40 text-gray-500 whitespace-nowrap">
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

            {/* Baseline hero stats */}
            {leftData && leftData.traces.length > 0 && (
              <div className={`mt-3 grid grid-cols-3 gap-px bg-gray-800 rounded-xl overflow-hidden`}>
                <div className="bg-gray-900 px-4 py-3">
                  <p className={`text-[10px] uppercase tracking-widest ${textMuted}`}>Total tokens sent</p>
                  <p className="text-2xl font-bold text-gray-300 mt-1">
                    {leftData.traces.reduce((s, t) => s + t.originalTokens, 0).toLocaleString()}
                  </p>
                  <p className={`text-[10px] ${textMuted} mt-0.5`}>{leftData.totalTurns} turns · no compression</p>
                </div>
                <div className="bg-gray-900 px-4 py-3">
                  <p className={`text-[10px] uppercase tracking-widest ${textMuted}`}>Avg latency</p>
                  <p className="text-2xl font-bold text-yellow-400 mt-1">
                    {leftData.summary.avgTotalLatencyMs > 0 ? `${leftData.summary.avgTotalLatencyMs}ms` : "—"}
                  </p>
                  <p className={`text-[10px] ${textMuted} mt-0.5`}>pure LLM · 0ms overhead</p>
                </div>
                <div className="bg-gray-900 px-4 py-3">
                  <p className={`text-[10px] uppercase tracking-widest ${textMuted}`}>Fidelity</p>
                  <p className={`text-2xl font-bold text-gray-400 mt-1`}>Reference</p>
                  <p className={`text-[10px] ${textMuted} mt-0.5`}>uncompressed baseline</p>
                </div>
              </div>
            )}

            {/* Baseline conv selector */}
            {!isLiveBaseline && (
              <div className="mt-3 flex items-center gap-2">
                {baselineConvs.length > 0 ? (
                  <select
                    value={selectedBaselineConvId || ""}
                    onChange={e => setSelectedBaselineConvId(e.target.value || null)}
                    className={`text-xs bg-gray-900 border ${border} rounded-lg px-2.5 py-1.5 ${textSub} cursor-pointer`}>
                    <option value="">Select conversation</option>
                    {baselineConvs.map(c => (
                      <option key={c.id} value={c.id}>{c.label} · {c.turns} turns</option>
                    ))}
                  </select>
                ) : (
                  <p className={`text-xs ${textMuted}`}>No baseline conversations yet</p>
                )}
                {leftData && <span className={`text-[10px] ${textMuted} ml-auto`}>{leftData.totalTurns} turns</span>}
              </div>
            )}
          </div>

          {renderTable(leftData, true, isLiveBaseline)}
        </div>

        {/* ══════════════════ RIGHT: SCALEDOWN ══════════════════ */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#010c0e]">

          {/* Column header */}
          <div className={`shrink-0 border-b border-cyan-900/50 px-5 pt-4 pb-3 bg-cyan-950/10`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold bg-cyan-950 text-cyan-300 border border-cyan-800 px-2.5 py-0.5 rounded-full uppercase tracking-widest">
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
                    className="px-4 py-2 bg-cyan-950 rounded-xl text-xs font-semibold opacity-40 text-cyan-600 whitespace-nowrap">
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

            {/* ScaleDown hero stats — the "OMG" section */}
            {rightData && rightData.traces.length > 0 && (() => {
              const totalIn = rightData.traces.reduce((s, t) => s + t.originalTokens, 0);
              const totalOut = rightData.traces.reduce((s, t) => s + t.compressedTokens, 0);
              const saved = totalIn - totalOut;
              const pct = totalIn > 0 ? ((saved / totalIn) * 100) | 0 : 0;
              const barPct = 100 - pct;

              return (
                <div className="mt-3 space-y-2">
                  <div className="grid grid-cols-3 gap-px bg-cyan-900/20 rounded-xl overflow-hidden border border-cyan-900/30">
                    {/* Token compression */}
                    <div className="bg-[#010c0e] px-4 py-3">
                      <p className={`text-[10px] uppercase tracking-widest text-cyan-900`}>Tokens sent to LLM</p>
                      <div className="flex items-baseline gap-1.5 mt-1">
                        <span className={`text-sm line-through ${textMuted}`}>{totalIn.toLocaleString()}</span>
                        <span className="text-cyan-900 text-xs">→</span>
                        <span className="text-2xl font-bold text-cyan-300">{totalOut.toLocaleString()}</span>
                      </div>
                      {/* Visual compression bar */}
                      <div className="mt-2 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                        <div className="h-full bg-cyan-500 rounded-full transition-all" style={{ width: `${barPct}%` }} />
                      </div>
                      <p className="text-[10px] text-cyan-600 mt-1 font-semibold">{pct}% never reached Groq</p>
                    </div>

                    {/* Latency */}
                    <div className="bg-[#010c0e] px-4 py-3">
                      <p className={`text-[10px] uppercase tracking-widest text-cyan-900`}>Avg latency</p>
                      <p className="text-2xl font-bold text-yellow-400 mt-1">
                        {rightData.summary.avgTotalLatencyMs > 0 ? `${rightData.summary.avgTotalLatencyMs}ms` : "—"}
                      </p>
                      <p className={`text-[10px] text-cyan-900 mt-0.5`}>
                        {rightData.summary.avgGroqLatencyMs}ms LLM + {rightData.summary.avgScaledownLatencyMs}ms SD
                      </p>
                    </div>

                    {/* Fidelity */}
                    <div className="bg-[#010c0e] px-4 py-3">
                      <p className={`text-[10px] uppercase tracking-widest text-cyan-900`}>Answer fidelity</p>
                      <p className={`text-2xl font-bold mt-1 ${rightData.summary.avgQualityScore != null ? "text-green-400" : "text-gray-600"}`}>
                        {rightData.summary.avgQualityScore != null
                          ? `${((rightData.summary.avgQualityScore) * 100).toFixed(0)}%`
                          : "—"}
                      </p>
                      <p className={`text-[10px] text-cyan-900 mt-0.5`}>
                        {rightData.summary.avgQualityScore != null
                          ? `${rightData.traces.filter(t => t.qualityScore != null).length} turns scored vs baseline`
                          : "enable SHADOW_BASELINE"}
                      </p>
                    </div>
                  </div>
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
                    className="text-xs bg-[#010c0e] border border-cyan-900/50 rounded-lg px-2.5 py-1.5 text-cyan-400 cursor-pointer">
                    <option value="">Select conversation</option>
                    {scaledownConvs.map(c => (
                      <option key={c.id} value={c.id}>{c.label} · {c.turns} turns</option>
                    ))}
                  </select>
                ) : (
                  <p className={`text-xs text-cyan-900`}>No ScaleDown conversations yet</p>
                )}
                {rightData && <span className={`text-[10px] text-cyan-900 ml-auto`}>{rightData.totalTurns} turns</span>}
              </div>
            )}
          </div>

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
