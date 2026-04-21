"use client";

import { useState, useCallback, useRef } from "react";

interface SingleConvState {
  status: "idle" | "connecting" | "active" | "ending";
  agentId: string | null;
  conversationId: string | null;
  channelName: string | null;
  error: string | null;
}

const IDLE: SingleConvState = {
  status: "idle", agentId: null, conversationId: null, channelName: null, error: null,
};

export function useDualConversation() {
  const [baseline, setBaseline] = useState<SingleConvState>(IDLE);
  const [scaledown, setScaledown] = useState<SingleConvState>(IDLE);
  const [audioAutoplayFailed, setAudioAutoplayFailed] = useState(false);
  const [agentAudioReceived, setAgentAudioReceived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shared mic track across both channels
  const localTrackRef = useRef<any>(null);
  const baselineClientRef = useRef<any>(null);
  const scaledownClientRef = useRef<any>(null);
  const pendingAudioRef = useRef<any[]>([]);
  const pollerRef = useRef<any>(null);

  const isActive = baseline.status === "active" && scaledown.status === "active";
  const isConnecting = baseline.status === "connecting" || scaledown.status === "connecting";
  const isEnding = baseline.status === "ending" || scaledown.status === "ending";

  const status = isActive ? "active" : isConnecting ? "connecting" : isEnding ? "ending" : "idle";

  const startBoth = useCallback(async (podcastContext?: string) => {
    setBaseline(IDLE);
    setScaledown(IDLE);
    setError(null);
    setAgentAudioReceived(false);

    // Unlock Web Audio context on the user gesture
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContext) {
        const ctx = new AudioContext();
        if (ctx.state === "suspended") await ctx.resume();
        const buf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
      }
    } catch (_) { /* best-effort */ }

    setBaseline(s => ({ ...s, status: "connecting" }));
    setScaledown(s => ({ ...s, status: "connecting" }));

    try {
      // Set up two separate channels in parallel
      const [setupB, setupS] = await Promise.all([
        fetch("/api/setup-conversation", { method: "POST", headers: { "Content-Type": "application/json" } }).then(r => r.json()),
        fetch("/api/setup-conversation", { method: "POST", headers: { "Content-Type": "application/json" } }).then(r => r.json()),
      ]);

      const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;

      AgoraRTC.onAudioAutoplayFailed = () => {
        setAudioAutoplayFailed(true);
      };

      const playRemoteAudio = (track: any, uid: any) => {
        try {
          track.play();
          console.log(`[Agora] audio playing uid=${uid}`);
          setAgentAudioReceived(true);
          setAudioAutoplayFailed(false);
        } catch {
          pendingAudioRef.current.push(track);
          setAudioAutoplayFailed(true);
        }
      };

      const makeClient = (label: string) => {
        const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        client.on("user-published", async (user: any, mediaType: string) => {
          try { await client.subscribe(user, mediaType as any); } catch { return; }
          if (mediaType === "audio" && user.audioTrack) playRemoteAudio(user.audioTrack, `${label}:${user.uid}`);
        });
        client.on("connection-state-change", (cur: string, prev: string) =>
          console.log(`[Agora:${label}] ${prev} → ${cur}`)
        );
        return client;
      };

      const bClient = makeClient("baseline");
      const sClient = makeClient("scaledown");
      baselineClientRef.current = bClient;
      scaledownClientRef.current = sClient;

      // Join both channels
      await Promise.all([
        bClient.join(setupB.appId, setupB.channelName, setupB.token, setupB.uid),
        sClient.join(setupS.appId, setupS.channelName, setupS.token, setupS.uid),
      ]);

      // Create mic track once, publish to both
      const localTrack = await AgoraRTC.createMicrophoneAudioTrack();
      localTrackRef.current = localTrack;
      await Promise.all([
        bClient.publish([localTrack]),
        sClient.publish([localTrack]),
      ]);

      // Invite agents for both channels in parallel
      const [joinB, joinS] = await Promise.all([
        fetch("/api/join-conversation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelName: setupB.channelName, token: setupB.botToken, uid: setupB.uid, botUid: setupB.botUid, requestedMode: "baseline", podcastContext }),
        }).then(r => r.json()),
        fetch("/api/join-conversation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelName: setupS.channelName, token: setupS.botToken, uid: setupS.uid, botUid: setupS.botUid, requestedMode: "scaledown", podcastContext }),
        }).then(r => r.json()),
      ]);

      // Audio poller fallback
      pollerRef.current = setInterval(() => {
        for (const [client, label] of [[bClient, "baseline"], [sClient, "scaledown"]] as const) {
          (client.remoteUsers || []).forEach(async (user: any) => {
            if (user.hasAudio && !user.audioTrack) {
              try {
                await client.subscribe(user, "audio");
                if (user.audioTrack) playRemoteAudio(user.audioTrack, `${label}:${user.uid}`);
              } catch { /* ignore */ }
            } else if (user.audioTrack && !user.audioTrack.isPlaying) {
              playRemoteAudio(user.audioTrack, `${label}:${user.uid}`);
            }
          });
        }
      }, 2000);

      setBaseline({ status: "active", agentId: joinB.agentId, conversationId: joinB.conversationId, channelName: setupB.channelName, error: null });
      setScaledown({ status: "active", agentId: joinS.agentId, conversationId: joinS.conversationId, channelName: setupS.channelName, error: null });

    } catch (err: any) {
      console.error("[useDualConversation] start failed:", err);
      setError(err.message || "Failed to start");
      setBaseline(IDLE);
      setScaledown(IDLE);
    }
  }, []);

  const endBoth = useCallback(async () => {
    setBaseline(s => ({ ...s, status: "ending" }));
    setScaledown(s => ({ ...s, status: "ending" }));

    if (pollerRef.current) { clearInterval(pollerRef.current); pollerRef.current = null; }

    await Promise.allSettled([
      baseline.agentId && fetch("/api/leave-agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: baseline.agentId }) }),
      scaledown.agentId && fetch("/api/leave-agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: scaledown.agentId }) }),
    ]);

    if (localTrackRef.current) {
      localTrackRef.current.stop();
      localTrackRef.current.close();
      localTrackRef.current = null;
    }
    await Promise.allSettled([
      baselineClientRef.current?.leave(),
      scaledownClientRef.current?.leave(),
    ]);
    baselineClientRef.current = null;
    scaledownClientRef.current = null;
    pendingAudioRef.current = [];

    setBaseline(IDLE);
    setScaledown(IDLE);
    setAgentAudioReceived(false);
  }, [baseline.agentId, scaledown.agentId]);

  const unlockAudio = useCallback(() => {
    pendingAudioRef.current.forEach(t => { try { t.play(); } catch { /* ignore */ } });
    pendingAudioRef.current = [];
    setAudioAutoplayFailed(false);
  }, []);

  return {
    status,
    error,
    audioAutoplayFailed,
    agentAudioReceived,
    baselineConversationId: baseline.conversationId,
    scaledownConversationId: scaledown.conversationId,
    startBoth,
    endBoth,
    unlockAudio,
  };
}
