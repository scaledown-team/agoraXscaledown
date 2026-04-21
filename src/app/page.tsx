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
  responseText?: string | null;
  baselineResponseText?: string | null;
  baselineLatencyMs?: number | null;
  baselineTokens?: number | null;
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
}

interface EvalData {
  results: any[];
  baseline: EvalModeAgg | null;
  scaledown: EvalModeAgg | null;
  comparison: { tokenSavingsPct: number; latencyDiffMs: number; scaledownOverheadMs: number } | null;
  summary: {
    totalConversations: number;
    baselineCount: number;
    scaledownCount: number;
    totalTurns: number;
    totalTokensSaved: number;
    overallCompressionPct: number;
  };
}

export default function Home() {
  const [liveTraceData, setLiveTraceData] = useState<TraceData | null>(null);
  const [conversations, setConversations] = useState<SavedConversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [selectedTraceData, setSelectedTraceData] = useState<TraceData | null>(null);
  const [evalData, setEvalData] = useState<EvalData | null>(null);
  const [evalRunning, setEvalRunning] = useState(false);
  const lastConvIdRef = useRef<string | null>(null);

  const {
    status, error, conversationId,
    audioAutoplayFailed, agentAudioReceived,
    startConversation, endConversation, unlockAudio,
  } = useConversation("scaledown");

  // ── Podcast state ─────────────────────────────────────────
  interface PodcastResult {
    id: string; title: string; podcast: string;
    description: string; thumbnail: string; audioLengthSec: number;
  }
  const [podcastQuery, setPodcastQuery] = useState("");
  const [podcastResults, setPodcastResults] = useState<PodcastResult[]>([]);
  const [podcastSearching, setPodcastSearching] = useState(false);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [selectedEpisodeTitle, setSelectedEpisodeTitle] = useState<string | null>(null);
  const [podcastTranscript, setPodcastTranscript] = useState<string | null>(null);
  const [podcastContextSource, setPodcastContextSource] = useState<"transcript" | "description" | null>(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);

  const searchPodcasts = useCallback(async () => {
    if (!podcastQuery.trim()) return;
    setPodcastSearching(true);
    setPodcastResults([]);
    try {
      const res = await fetch(`/api/podcast/search?q=${encodeURIComponent(podcastQuery)}`);
      if (res.ok) setPodcastResults((await res.json()).results ?? []);
    } catch { } finally { setPodcastSearching(false); }
  }, [podcastQuery]);

  const selectEpisode = useCallback(async (ep: PodcastResult) => {
    setSelectedEpisodeId(ep.id);
    setSelectedEpisodeTitle(ep.title);
    setPodcastTranscript(null);
    setLoadingTranscript(true);
    setPodcastResults([]);
    try {
      const res = await fetch(`/api/podcast/episode?id=${ep.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.transcript) { setPodcastTranscript(data.transcript); setPodcastContextSource("transcript"); }
        else if (data.description) { setPodcastTranscript(data.description); setPodcastContextSource("description"); }
        else { setPodcastTranscript(null); setPodcastContextSource(null); }
      }
    } catch { } finally { setLoadingTranscript(false); }
  }, []);

  const clearPodcast = useCallback(() => {
    setSelectedEpisodeId(null); setSelectedEpisodeTitle(null);
    setPodcastTranscript(null); setPodcastContextSource(null);
    setPodcastQuery(""); setPodcastResults([]);
  }, []);

  // ── Data loading ──────────────────────────────────────────
  const runEval = useCallback(async () => {
    setEvalRunning(true);
    try {
      const res = await fetch("/api/eval", { method: "POST" });
      if (res.ok) setEvalData(await res.json());
    } catch { } finally { setEvalRunning(false); }
  }, []);

  const clearHistory = useCallback(async () => {
    if (!confirm("Delete all conversations and trace data? This cannot be undone.")) return;
    await fetch("/api/clear-history", { method: "DELETE" });
    setEvalData(null); setConversations([]); setSelectedConvId(null); setSelectedTraceData(null);
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      if (res.ok) setConversations((await res.json()).conversations || []);
    } catch { }
  }, []);

  useEffect(() => { refreshConversations(); runEval(); }, []);
  useEffect(() => { if (conversationId) lastConvIdRef.current = conversationId; }, [conversationId]);

  useEffect(() => {
    if (status === "idle" && lastConvIdRef.current) {
      const endedId = lastConvIdRef.current;
      refreshConversations().then(() => setSelectedConvId(endedId));
      runEval();
    }
  }, [status]);

  const pastConvs = conversations.filter(c => c.turns > 0);
  useEffect(() => {
    if (pastConvs.length > 0 && !selectedConvId) setSelectedConvId(pastConvs[0].id);
  }, [pastConvs.length]);

  // Live polling
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

  // Load selected conversation
  useEffect(() => {
    if (!selectedConvId) { setSelectedTraceData(null); return; }
    fetch(`/api/traces?conversationId=${selectedConvId}`)
      .then(r => r.ok ? r.json() : null).then(d => d && setSelectedTraceData(d)).catch(() => {});
  }, [selectedConvId]);

  const isLive = status === "active";
  const displayData = isLive ? liveTraceData : selectedTraceData;

  const [isDark, setIsDark] = useState(true);

  // ── Theme ─────────────────────────────────────────────────
  const border      = isDark ? "border-gray-800"  : "border-gray-200";
  const textMuted   = isDark ? "text-gray-600"    : "text-gray-400";
  const textSub     = isDark ? "text-gray-400"    : "text-gray-600";
  const mainBg      = isDark ? "bg-gray-950 text-white"  : "bg-gray-100 text-gray-900";
  const headerBg    = isDark ? "bg-gray-900/50"          : "bg-white";
  const headerBorder= isDark ? "border-gray-800/60"      : "border-gray-200";
  const tableBg     = isDark ? "bg-gray-950"             : "bg-white";
  const sdColBg     = isDark ? "bg-cyan-950/10"          : "bg-cyan-50/30";
  const tableHdrBg  = isDark ? "bg-gray-950"             : "bg-gray-50";
  const tableHover  = isDark ? "hover:bg-gray-900/40"    : "hover:bg-gray-50";
  const btnBase     = isDark ? "bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white" : "bg-gray-200 hover:bg-gray-300 text-gray-600 hover:text-gray-900";
  const clearBtn    = isDark ? "bg-gray-800 hover:bg-red-900/60 text-gray-600 hover:text-red-400" : "bg-gray-200 hover:bg-red-100 text-gray-500 hover:text-red-600";
  const convSelect  = isDark ? `bg-gray-900 border ${border} ${textSub}` : `bg-white border border-gray-200 text-gray-600`;

  // ── Turn table ────────────────────────────────────────────
  function renderTable(data: TraceData | null) {
    if (!data || data.traces.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center h-full">
          <p className={`text-sm ${textMuted}`}>
            {isLive ? "Waiting for first turn..." : "No data — start or select a conversation"}
          </p>
        </div>
      );
    }

    return (
      <table className="w-full text-xs">
        <thead className={`sticky top-0 border-b ${border} ${tableHdrBg}`}>
          <tr className="h-8">
            <th className={`text-left px-3 ${textMuted} font-medium uppercase tracking-wide w-10`}>Turn</th>
            <th className={`text-left px-3 ${textMuted} font-medium uppercase tracking-wide w-28`}>Baseline</th>
            <th className={`text-left px-3 text-cyan-600 font-medium uppercase tracking-wide w-28`}>ScaleDown</th>
            <th className={`text-left px-3 ${textMuted} font-medium uppercase tracking-wide w-14`}>Saved</th>
            <th className={`text-left px-3 ${textMuted} font-medium uppercase tracking-wide`}>Baseline response</th>
            <th className={`text-left px-3 text-cyan-600 font-medium uppercase tracking-wide`}>ScaleDown response</th>
          </tr>
        </thead>
        <tbody>
          {data.traces.map((t) => (
            <tr key={t.turn} className={`border-b ${border} last:border-0 transition-colors ${tableHover} align-top`}>
              <td className={`px-3 py-2.5 font-mono ${textMuted}`}>{t.turn}</td>
              {/* Baseline: latency + tokens */}
              <td className="px-3 py-2.5">
                <div className={`font-mono ${textSub}`}>{t.baselineLatencyMs != null ? `${t.baselineLatencyMs}ms` : "—"}</div>
                <div className={`text-[10px] ${textMuted}`}>{(t.baselineTokens ?? t.originalTokens).toLocaleString()} tok</div>
              </td>
              {/* ScaleDown: latency + tokens */}
              <td className={`px-3 py-2.5 ${sdColBg}`}>
                <div className="font-mono text-cyan-400">{t.totalLatencyMs > 0 ? `${t.totalLatencyMs}ms` : "—"}</div>
                <div className="text-[10px] text-cyan-700">
                  {t.compressionSuccess
                    ? `${t.compressedTokens.toLocaleString()} tok`
                    : <span className="text-orange-400">fallback</span>}
                </div>
              </td>
              {/* Compression savings */}
              <td className="px-3 py-2.5 font-semibold">
                {t.compressionSuccess
                  ? <span className="text-cyan-400">{(t.compressionRatio * 100).toFixed(0)}%</span>
                  : <span className={textMuted}>—</span>}
              </td>
              {/* Baseline response text */}
              <td className="px-3 py-2.5 max-w-xs">
                <span className={`${textSub} line-clamp-3 leading-relaxed`}>{t.baselineResponseText || "—"}</span>
              </td>
              {/* ScaleDown response text */}
              <td className={`px-3 py-2.5 max-w-xs ${sdColBg}`}>
                <span className="text-cyan-300 line-clamp-3 leading-relaxed">{t.responseText || "—"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // ── Main render ───────────────────────────────────────────
  return (
    <main className={`flex flex-col h-screen overflow-hidden ${mainBg}`}>

      {/* ── TOP HEADER ── */}
      <header className={`shrink-0 border-b ${border} ${headerBg}`}>

        {/* Branding + controls */}
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
                {evalData.summary.totalConversations} conversations · {evalData.summary.totalTurns} turns
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

            {status === "idle" ? (
              <button
                onClick={() => { setLiveTraceData(null); lastConvIdRef.current = null; startConversation("scaledown", podcastTranscript ?? undefined); }}
                className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-xl text-xs font-bold transition-colors text-white whitespace-nowrap">
                Start Conversation
              </button>
            ) : status === "active" ? (
              <button onClick={endConversation}
                className="px-5 py-2 bg-red-700 hover:bg-red-600 rounded-xl text-xs font-bold transition-colors text-white whitespace-nowrap">
                End Session
              </button>
            ) : (
              <button disabled
                className="px-5 py-2 bg-gray-800 text-gray-500 rounded-xl text-xs font-bold opacity-60 whitespace-nowrap">
                {status === "connecting" ? "Connecting..." : "Ending..."}
              </button>
            )}
          </div>
        </div>

        {/* ── Stats bar ── */}
        {evalData && evalData.scaledown ? (() => {
          const s = evalData.scaledown;
          const compressionPct = s.compressionPct;
          const tokensSaved = s.tokensSaved;
          const sdLatency = s.avgTotalLatencyMs ?? 0;
          const baseLatency = s.avgGroqLatencyMs ?? 0;
          const diff = sdLatency - baseLatency;

          return (
            <div className="grid grid-cols-3 divide-x divide-gray-800">
              <div className="px-8 py-4 flex flex-col gap-1">
                <p className={`text-[10px] uppercase tracking-widest ${textMuted}`}>Tokens Saved</p>
                <div className="flex items-baseline gap-3">
                  <p className="text-2xl font-black text-cyan-400">{tokensSaved.toLocaleString()}</p>
                  <p className="text-sm font-bold text-cyan-600">↓ {compressionPct}%</p>
                </div>
                <div className="h-2 bg-gray-800 rounded overflow-hidden mt-1">
                  <div className="h-full bg-cyan-500 rounded" style={{ width: `${100 - compressionPct}%` }} />
                </div>
              </div>
              <div className="px-8 py-4 flex flex-col gap-1">
                <p className={`text-[10px] uppercase tracking-widest ${textMuted}`}>Avg Latency per Turn</p>
                <div className="flex items-baseline gap-4">
                  <div>
                    <p className={`text-[10px] ${textMuted}`}>Baseline</p>
                    <p className={`text-2xl font-black ${textSub}`}>{baseLatency}ms</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-cyan-700">ScaleDown</p>
                    <p className="text-2xl font-black text-cyan-400">{sdLatency}ms</p>
                  </div>
                  <p className={`text-xs self-end mb-1 ${diff <= 0 ? "text-green-400" : textMuted}`}>
                    {diff > 0 ? `+${diff}ms` : `${diff}ms`}
                  </p>
                </div>
              </div>
              <div className="px-8 py-4 flex flex-col gap-2">
                <p className={`text-[10px] uppercase tracking-widest ${textMuted}`}>History</p>
                <div className="flex items-center gap-2">
                  {pastConvs.length > 0 ? (
                    <select value={selectedConvId || ""} onChange={e => setSelectedConvId(e.target.value || null)}
                      className={`text-xs rounded-lg px-2.5 py-1.5 cursor-pointer ${convSelect}`}>
                      <option value="">Select conversation</option>
                      {pastConvs.map(c => <option key={c.id} value={c.id}>{c.label} · {c.turns} turns</option>)}
                    </select>
                  ) : (
                    <p className={`text-xs ${textMuted}`}>No conversations yet</p>
                  )}
                  {isLive && (
                    <span className="flex items-center gap-1 text-xs text-green-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
                      {agentAudioReceived ? "Live · audio receiving" : "Live · waiting..."}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })() : (
          <div className="px-6 py-3">
            <p className={`text-xs ${textMuted}`}>
              {evalRunning ? "Calculating..." : "Start a conversation to see metrics"}
            </p>
          </div>
        )}
      </header>

      {/* ── PODCAST SEARCH PANEL ── */}
      {status === "idle" && (
        <div className={`shrink-0 border-b ${border} ${headerBg} px-6 py-3`}>
          {selectedEpisodeId ? (
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className={`text-[10px] uppercase tracking-widest ${textMuted} mb-0.5`}>Podcast context loaded</p>
                <p className="text-xs font-semibold truncate">{selectedEpisodeTitle}</p>
                {loadingTranscript && <p className={`text-[10px] ${textMuted}`}>Transcribing via Deepgram... (10–30s)</p>}
                {!loadingTranscript && podcastTranscript && (
                  <p className={`text-[10px] ${textMuted}`}>
                    {podcastTranscript.length.toLocaleString()} chars ·{" "}
                    {podcastContextSource === "transcript" ? "transcript via Deepgram" : "episode description"}
                  </p>
                )}
              </div>
              <button onClick={clearPodcast} className={`shrink-0 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${btnBase}`}>
                Clear
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <p className={`text-[10px] uppercase tracking-widest ${textMuted} shrink-0`}>Podcast</p>
                <input type="text" value={podcastQuery} onChange={e => setPodcastQuery(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && searchPodcasts()}
                  placeholder="Search for a podcast episode to discuss..."
                  className={`flex-1 text-xs rounded-lg px-3 py-1.5 outline-none ${isDark ? "bg-gray-900 border border-gray-800 text-white placeholder-gray-600" : "bg-white border border-gray-200 text-gray-900 placeholder-gray-400"}`}
                />
                <button onClick={searchPodcasts} disabled={podcastSearching || !podcastQuery.trim()}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 ${btnBase}`}>
                  {podcastSearching ? "Searching..." : "Search"}
                </button>
              </div>
              {podcastResults.length > 0 && (
                <div className={`rounded-xl border ${border} divide-y ${border} overflow-hidden max-h-48 overflow-y-auto`}>
                  {podcastResults.map(ep => (
                    <button key={ep.id} onClick={() => selectEpisode(ep)}
                      className={`w-full text-left px-3 py-2 transition-colors ${tableHover} flex items-start gap-3`}>
                      {ep.thumbnail && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={ep.thumbnail} alt="" className="w-8 h-8 rounded shrink-0 mt-0.5 object-cover" />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{ep.title}</p>
                        <p className={`text-[10px] ${textMuted} truncate`}>{ep.podcast}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Audio unlock overlay ── */}
      {audioAutoplayFailed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-gray-900 border border-yellow-500/50 rounded-2xl px-10 py-8 flex flex-col items-center gap-4 shadow-2xl">
            <p className="text-white font-bold text-lg">Browser blocked audio</p>
            <button onClick={unlockAudio}
              className="px-8 py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-xl transition-colors animate-pulse">
              Enable Audio
            </button>
          </div>
        </div>
      )}

      {/* ── TURN TABLE ── */}
      <div className={`flex-1 overflow-auto ${tableBg}`}>
        {renderTable(displayData)}
      </div>

      {error && (
        <div className="fixed bottom-4 left-4 right-4 max-w-sm p-3 bg-red-900/90 border border-red-700 rounded-xl text-red-300 text-xs z-50">
          {error}
        </div>
      )}
    </main>
  );
}
