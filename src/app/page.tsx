"use client";

import { useConversation } from "@/hooks/useConversation";

export default function Home() {
  const { status, mode, error, audioAutoplayFailed, agentAudioReceived, startConversation, endConversation, unlockAudio } =
    useConversation();

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-8">
      <div className="max-w-md w-full text-center space-y-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">
            Agora <span className="text-blue-400">x</span> ScaleDown
          </h1>
          <p className="text-gray-400 text-sm">Voice AI with context compression</p>
        </div>

        <div className="flex items-center justify-center gap-2">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              status === "active"
                ? "bg-green-400 animate-pulse"
                : status === "connecting" || status === "ending"
                ? "bg-yellow-400 animate-pulse"
                : "bg-gray-600"
            }`}
          />
          <span className="text-sm text-gray-300">
            {status === "idle" && "Ready to start"}
            {status === "connecting" && "Connecting..."}
            {status === "active" &&
              `Active - ${mode === "baseline" ? "Baseline" : "ScaleDown"} mode`}
            {status === "ending" && "Ending conversation..."}
          </span>
        </div>

        {status === "idle" ? (
          <button
            onClick={startConversation}
            className="w-full py-4 px-6 bg-blue-600 hover:bg-blue-500 rounded-xl text-lg font-medium transition-colors"
          >
            Start Conversation
          </button>
        ) : status === "active" ? (
          <button
            onClick={endConversation}
            className="w-full py-4 px-6 bg-red-600 hover:bg-red-500 rounded-xl text-lg font-medium transition-colors"
          >
            End Conversation
          </button>
        ) : (
          <button
            disabled
            className="w-full py-4 px-6 bg-gray-700 rounded-xl text-lg font-medium opacity-50 cursor-not-allowed"
          >
            {status === "connecting" ? "Connecting..." : "Ending..."}
          </button>
        )}

        {error && (
          <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Autoplay unlock button — shown when browser blocks audio */}
        {audioAutoplayFailed && (
          <button
            onClick={unlockAudio}
            className="w-full py-3 px-6 bg-yellow-600 hover:bg-yellow-500 rounded-xl text-base font-medium transition-colors animate-pulse"
          >
            🔊 Click to Enable Audio
          </button>
        )}

        {/* Debug status — shows whether agent audio has arrived at all */}
        {status === "active" && (
          <div className="text-xs text-gray-500 space-y-1">
            <p>
              Agent audio:{" "}
              <span className={agentAudioReceived ? "text-green-400" : "text-yellow-400"}>
                {agentAudioReceived ? "✓ received" : "⏳ waiting..."}
              </span>
            </p>
          </div>
        )}

        <div className="text-left bg-gray-900 rounded-xl p-5 space-y-3 text-sm">
          <h3 className="font-semibold text-gray-200">Pipeline</h3>
          <div className="text-gray-400 space-y-1">
            <p>Your voice &rarr; <span className="text-gray-300">Deepgram</span> (ASR)</p>
            <p>&rarr; Transcript &rarr; <span className="text-cyan-400">ScaleDown</span> (/compress)</p>
            <p>&rarr; Compressed context &rarr; <span className="text-gray-300">Groq</span> (LLM)</p>
            <p>&rarr; Response &rarr; <span className="text-gray-300">ElevenLabs</span> (TTS)</p>
            <p>&rarr; Audio back to you via <span className="text-gray-300">Agora</span></p>
          </div>
        </div>

        <div className="text-xs text-gray-500">
          Mode: {mode === "baseline" ? "Baseline (no compression)" : "ScaleDown compression active"}
          {" | "}Set BASELINE_MODE in .env.local to toggle
        </div>
      </div>
    </main>
  );
}
