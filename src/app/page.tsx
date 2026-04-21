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
  groqPromptTokens?: number | null;
  groqCompletionTokens?: number | null;
}

interface TraceData {
  totalTurns: number;
  traces: TraceEvent[];
  summary: Record<string, number | null>;
}

// ROUGE-1 F1 computed locally between two strings
function rouge1F1(ref: string, hyp: string): number {
  const tokenize = (s: string) => s.toLowerCase().match(/\b\w+\b/g) ?? [];
  const refTokens = tokenize(ref);
  const hypTokens = tokenize(hyp);
  if (refTokens.length === 0 || hypTokens.length === 0) return 0;
  const refSet = new Map<string, number>();
  refTokens.forEach(t => refSet.set(t, (refSet.get(t) ?? 0) + 1));
  let overlap = 0;
  const hypCount = new Map<string, number>();
  hypTokens.forEach(t => hypCount.set(t, (hypCount.get(t) ?? 0) + 1));
  hypCount.forEach((cnt, tok) => {
    const refCnt = refSet.get(tok) ?? 0;
    overlap += Math.min(cnt, refCnt);
  });
  const precision = overlap / hypTokens.length;
  const recall = overlap / refTokens.length;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

export default function Home() {
  const [liveTraceData, setLiveTraceData] = useState<TraceData | null>(null);
  const lastConvIdRef = useRef<string | null>(null);
  const [endedConversationId, setEndedConversationId] = useState<string | null>(null);

  const {
    status, error, conversationId,
    audioAutoplayFailed, agentAudioReceived,
    userSpeaking, agentSpeaking,
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

  useEffect(() => { if (conversationId) lastConvIdRef.current = conversationId; }, [conversationId]);

  // When session ends, save the conversationId so we can offer "Continue"
  useEffect(() => {
    if (status === "idle" && lastConvIdRef.current) {
      setEndedConversationId(lastConvIdRef.current);
    }
  }, [status]);

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

  const isLive = status === "active";

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

  // ── Computed stats from current session only ──────────────
  const traces = liveTraceData?.traces ?? [];

  // originalTokens = canonical uncompressed input (from baseline LLM usage.prompt_tokens)
  const totalOriginalContextTokens = traces.reduce((s, t) => s + (t.baselineTokens ?? t.originalTokens), 0);
  const totalCompressedContextTokens = traces.reduce((s, t) => s + t.compressedTokens, 0);
  const tokensSaved = totalOriginalContextTokens - totalCompressedContextTokens;
  const tokensSavedPct = totalOriginalContextTokens > 0 ? Math.round((tokensSaved / totalOriginalContextTokens) * 100) : 0;

  const bTurns = traces.filter(t => t.baselineLatencyMs != null);
  const sdTurns = traces.filter(t => t.groqLatencyMs > 0);
  const avgBaselineLatency = bTurns.length > 0
    ? Math.round(bTurns.reduce((s, t) => s + (t.baselineLatencyMs ?? 0), 0) / bTurns.length)
    : 0;
  // groqLatencyMs = pure LLM call time for SD path (excludes ScaleDown API overhead)
  const avgSDLatency = sdTurns.length > 0
    ? Math.round(sdTurns.reduce((s, t) => s + t.groqLatencyMs, 0) / sdTurns.length)
    : 0;
  const avgSDOverhead = traces.filter(t => t.scaledownLatencyMs > 0).length > 0
    ? Math.round(traces.filter(t => t.scaledownLatencyMs > 0).reduce((s, t) => s + t.scaledownLatencyMs, 0) / traces.filter(t => t.scaledownLatencyMs > 0).length)
    : 0;
  const latencyDiff = avgSDLatency - avgBaselineLatency;

  const rougeScores = traces
    .filter(t => t.responseText && t.baselineResponseText)
    .map(t => rouge1F1(t.baselineResponseText!, t.responseText!));
  const avgRouge = rougeScores.length > 0
    ? rougeScores.reduce((s, v) => s + v, 0) / rougeScores.length
    : null;

  const judgeScores = traces.filter(t => t.qualityScore != null).map(t => t.qualityScore!);
  const avgJudge = judgeScores.length > 0
    ? judgeScores.reduce((s, v) => s + v, 0) / judgeScores.length
    : null;

  // ── Turn table ────────────────────────────────────────────
  function renderTable() {
    if (traces.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center h-full">
          <p className={`text-sm ${textMuted}`}>
            {isLive ? "Waiting for first turn..." : "Start a conversation to see metrics"}
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
            <th className={`text-left px-3 ${textMuted} font-medium uppercase tracking-wide w-28`}>Tokens Saved</th>
            <th className={`text-left px-3 ${textMuted} font-medium uppercase tracking-wide w-16`}>ROUGE-1</th>
            <th className={`text-left px-3 ${textMuted} font-medium uppercase tracking-wide w-16`}>LLM Judge</th>
            <th className={`text-left px-3 ${textMuted} font-medium uppercase tracking-wide`}>Baseline response</th>
            <th className={`text-left px-3 text-cyan-600 font-medium uppercase tracking-wide`}>ScaleDown response</th>
          </tr>
        </thead>
        <tbody>
          {traces.map((t) => {
            const rougeScore = (t.responseText && t.baselineResponseText)
              ? rouge1F1(t.baselineResponseText, t.responseText)
              : null;
            return (
              <tr key={t.turn} className={`border-b ${border} last:border-0 transition-colors ${tableHover} align-top`}>
                <td className={`px-3 py-2.5 font-mono ${textMuted}`}>{t.turn}</td>
                {/* Baseline: LLM latency + uncompressed input tokens */}
                <td className="px-3 py-2.5">
                  <div className={`font-mono ${textSub}`}>{t.baselineLatencyMs != null ? `${t.baselineLatencyMs}ms` : "—"}</div>
                  <div className={`font-mono ${textMuted}`}>{(t.baselineTokens ?? t.originalTokens).toLocaleString()} tok</div>
                </td>
                {/* ScaleDown: LLM latency + compressed token count */}
                <td className={`px-3 py-2.5 ${sdColBg}`}>
                  <div className="font-mono text-cyan-400">
                    {t.groqLatencyMs > 0 ? `${t.groqLatencyMs}ms` : "—"}
                  </div>
                  <div className="font-mono text-cyan-700">
                    {t.compressionSuccess
                      ? `${t.compressedTokens.toLocaleString()} tok`
                      : <span className="text-orange-400">fallback</span>}
                  </div>
                </td>
                {/* Tokens saved */}
                <td className="px-3 py-2.5">
                  {t.compressionSuccess ? (() => {
                    const saved = (t.baselineTokens ?? t.originalTokens) - t.compressedTokens;
                    const pct = (t.compressionRatio * 100).toFixed(0);
                    return (
                      <div>
                        <div className="font-mono text-cyan-400">{saved.toLocaleString()}</div>
                        <div className={`font-mono text-cyan-700`}>{pct}%</div>
                      </div>
                    );
                  })() : <span className={textMuted}>—</span>}
                </td>
                {/* ROUGE-1 F1 */}
                <td className="px-3 py-2.5 font-mono">
                  {rougeScore != null
                    ? <span className={rougeScore >= 0.7 ? "text-green-400" : rougeScore >= 0.4 ? "text-yellow-400" : "text-orange-400"}>
                        {rougeScore.toFixed(2)}
                      </span>
                    : <span className={textMuted}>—</span>}
                </td>
                {/* LLM Judge score */}
                <td className="px-3 py-2.5 font-mono">
                  {t.qualityScore != null
                    ? <span className={t.qualityScore >= 0.7 ? "text-green-400" : t.qualityScore >= 0.4 ? "text-yellow-400" : "text-orange-400"}>
                        {t.qualityScore.toFixed(2)}
                      </span>
                    : <span className={`text-[10px] ${textMuted}`}>…</span>}
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
            );
          })}
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
            {isLive && (
              <div className="flex items-center gap-2">
                {/* User speaking indicator */}
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                  userSpeaking
                    ? "bg-blue-500/20 text-blue-300 border border-blue-500/40"
                    : "bg-gray-800/60 text-gray-600 border border-gray-700/40"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full inline-block transition-all ${userSpeaking ? "bg-blue-400 animate-pulse" : "bg-gray-600"}`} />
                  You
                </div>
                {/* Agent state indicator */}
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                  agentSpeaking
                    ? "bg-green-500/20 text-green-300 border border-green-500/40"
                    : agentAudioReceived
                    ? "bg-yellow-500/10 text-yellow-600 border border-yellow-700/30"
                    : "bg-gray-800/60 text-gray-600 border border-gray-700/40"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full inline-block transition-all ${
                    agentSpeaking ? "bg-green-400 animate-pulse" : agentAudioReceived ? "bg-yellow-600 animate-pulse" : "bg-gray-600"
                  }`} />
                  {agentSpeaking ? "Agent speaking" : agentAudioReceived ? "Processing..." : "Waiting..."}
                </div>
              </div>
            )}
            <button onClick={() => setIsDark(d => !d)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${btnBase}`}>
              {isDark ? "☀ Light" : "☾ Dark"}
            </button>

            {status === "idle" ? (
              <div className="flex items-center gap-2">
                {endedConversationId && (
                  <button
                    onClick={() => { startConversation("scaledown", podcastTranscript ?? undefined, endedConversationId); }}
                    disabled={loadingTranscript}
                    className="px-5 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-xs font-bold transition-colors text-white whitespace-nowrap">
                    Continue
                  </button>
                )}
                <button
                  onClick={() => { setLiveTraceData(null); lastConvIdRef.current = null; setEndedConversationId(null); startConversation("scaledown", podcastTranscript ?? undefined); }}
                  disabled={loadingTranscript}
                  className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-xs font-bold transition-colors text-white whitespace-nowrap">
                  Start New
                </button>
              </div>
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
        {traces.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 divide-x-0 sm:divide-x divide-gray-800">
            {/* Tokens */}
            <div className="px-8 py-4 flex flex-col gap-1">
              <p className={`text-[10px] uppercase tracking-widest ${textMuted}`}>Context Tokens Compressed</p>
              <div className="flex items-baseline gap-3">
                <div>
                  <p className={`text-[10px] ${textMuted}`}>Original</p>
                  <p className={`text-xl font-black ${textSub}`}>{totalOriginalContextTokens.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[10px] text-cyan-700">Compressed</p>
                  <p className="text-xl font-black text-cyan-400">{totalCompressedContextTokens.toLocaleString()}</p>
                </div>
                <p className="text-sm font-bold text-cyan-600 self-end mb-1">↓ {tokensSavedPct}%</p>
              </div>
              <div className="h-1.5 rounded overflow-hidden mt-1 flex">
                <div className="h-full bg-cyan-500" style={{ width: `${100 - tokensSavedPct}%` }} />
                <div className="h-full bg-red-400/60 flex-1" />
              </div>
            </div>
            {/* Latency */}
            <div className="px-8 py-4 flex flex-col gap-1">
              <p className={`text-[10px] uppercase tracking-widest ${textMuted}`}>Avg LLM Latency per Turn</p>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
                <div>
                  <p className={`text-[10px] ${textMuted}`}>Baseline</p>
                  <p className={`text-2xl font-black ${textSub}`}>{avgBaselineLatency > 0 ? `${avgBaselineLatency}ms` : "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] text-cyan-700">ScaleDown LLM</p>
                  <p className="text-2xl font-black text-cyan-400">{avgSDLatency > 0 ? `${avgSDLatency}ms` : "—"}</p>
                </div>
                {avgBaselineLatency > 0 && avgSDLatency > 0 && (
                  <div>
                    <p className={`text-[10px] ${latencyDiff <= 0 ? "text-green-700" : textMuted}`}>Latency Saved</p>
                    <p className={`text-2xl font-black ${latencyDiff <= 0 ? "text-green-400" : textMuted}`}>
                      {latencyDiff > 0 ? `+${latencyDiff}ms` : `${Math.abs(latencyDiff)}ms`}
                    </p>
                  </div>
                )}
                {avgSDOverhead > 0 && (
                  <div>
                    <p className="text-[10px] text-blue-700">SD API</p>
                    <p className="text-2xl font-black text-blue-400">+{avgSDOverhead}ms</p>
                  </div>
                )}
              </div>
            </div>
            {/* Quality scores — ROUGE + LLM Judge side by side */}
            <div className="px-8 py-4 flex flex-col gap-1">
              <p className={`text-[10px] uppercase tracking-widest ${textMuted}`}>Response Quality</p>
              <div className="flex items-start gap-6 mt-0.5">
                <div>
                  <p className={`text-[10px] ${textMuted} mb-0.5`}>ROUGE-1 F1</p>
                  <div className="flex items-baseline gap-2">
                    {avgRouge != null ? (
                      <>
                        <p className={`text-2xl font-black ${avgRouge >= 0.7 ? "text-green-400" : avgRouge >= 0.4 ? "text-yellow-400" : "text-orange-400"}`}>
                          {avgRouge.toFixed(2)}
                        </p>
                        <p className={`text-xs ${textMuted} self-end mb-1`}>
                          {avgRouge >= 0.7 ? "high" : avgRouge >= 0.4 ? "mod" : "low"}
                        </p>
                      </>
                    ) : (
                      <p className={`text-2xl font-black ${textMuted}`}>—</p>
                    )}
                  </div>
                  <p className={`text-[10px] ${textMuted}`}>
                    {rougeScores.length > 0 ? `${rougeScores.length}/${traces.length} turns` : "lexical overlap"}
                  </p>
                </div>
                <div className={`w-px self-stretch ${isDark ? "bg-gray-800" : "bg-gray-200"}`} />
                <div>
                  <p className={`text-[10px] ${textMuted} mb-0.5`}>LLM Judge</p>
                  <div className="flex items-baseline gap-2">
                    {avgJudge != null ? (
                      <>
                        <p className={`text-2xl font-black ${avgJudge >= 0.7 ? "text-green-400" : avgJudge >= 0.4 ? "text-yellow-400" : "text-orange-400"}`}>
                          {avgJudge.toFixed(2)}
                        </p>
                        <p className={`text-xs ${textMuted} self-end mb-1`}>
                          {avgJudge >= 0.7 ? "high" : avgJudge >= 0.4 ? "mod" : "low"}
                        </p>
                      </>
                    ) : (
                      <p className={`text-2xl font-black ${textMuted}`}>…</p>
                    )}
                  </div>
                  <p className={`text-[10px] ${textMuted}`}>
                    {judgeScores.length > 0 ? `${judgeScores.length}/${traces.length} turns` : "semantic similarity"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-6 py-3">
            <p className={`text-xs ${textMuted}`}>
              {status === "connecting" ? "Connecting..." : "Start a conversation to see metrics"}
            </p>
          </div>
        )}
      </header>

      {/* ── PODCAST SEARCH PANEL ── */}
      {status === "idle" && (
        <div className={`shrink-0 border-b ${border} ${headerBg} px-6 py-3`}>
          {selectedEpisodeId ? (
            loadingTranscript ? (
              <div className="flex items-center gap-4 py-1">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse inline-block" />
                  <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse inline-block" style={{ animationDelay: "0.2s" }} />
                  <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse inline-block" style={{ animationDelay: "0.4s" }} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-yellow-400">Transcribing podcast via Deepgram…</p>
                  <p className={`text-[10px] ${textMuted}`}>{selectedEpisodeTitle} · this may take 15–45s · start button will unlock when done</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className={`text-[10px] uppercase tracking-widest ${textMuted} mb-0.5`}>Podcast context loaded</p>
                  <p className="text-xs font-semibold truncate">{selectedEpisodeTitle}</p>
                  {podcastTranscript && (
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
            )
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
        {renderTable()}
      </div>

      {error && (
        <div className="fixed bottom-4 left-4 right-4 max-w-sm p-3 bg-red-900/90 border border-red-700 rounded-xl text-red-300 text-xs z-50">
          {error}
        </div>
      )}
    </main>
  );
}
