"use client";

import { useState, useCallback, useRef } from "react";

interface ConversationState {
  status: "idle" | "connecting" | "active" | "ending";
  channelName: string | null;
  token: string | null;
  uid: number | null;
  botUid: number | null;
  agentId: string | null;
  appId: string | null;
  mode: "baseline" | "scaledown";
  conversationId: string | null;
  error: string | null;
  audioAutoplayFailed: boolean;
  agentAudioReceived: boolean;
  userSpeaking: boolean;
  agentSpeaking: boolean;
}

export function useConversation(preferredMode?: "baseline" | "scaledown") {
  const [state, setState] = useState<ConversationState>({
    status: "idle",
    channelName: null,
    token: null,
    uid: null,
    botUid: null,
    agentId: null,
    appId: null,
    mode: "scaledown",
    conversationId: null,
    error: null,
    audioAutoplayFailed: false,
    agentAudioReceived: false,
    userSpeaking: false,
    agentSpeaking: false,
  });

  const clientRef = useRef<any>(null);
  const localAudioTrackRef = useRef<any>(null);
  const pendingAudioTracksRef = useRef<any[]>([]);
  const audioPollerRef = useRef<any>(null);
  const volumePollerRef = useRef<any>(null);

  const startConversation = useCallback(async (modeOverride?: "baseline" | "scaledown", podcastContext?: string) => {
    setState((prev) => ({ ...prev, status: "connecting", error: null }));

    // Unlock Web Audio context immediately while we still have the user gesture.
    // Chrome suspends AudioContext until a gesture happens; doing this now ensures
    // Agora can play audio when the bot's track arrives seconds later.
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContext) {
        const ctx = new AudioContext();
        if (ctx.state === "suspended") await ctx.resume();
        // Play a silent buffer to fully unlock the context
        const buf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
      }
    } catch (_) { /* ignore — audio unlock is best-effort */ }

    try {
      // Step 1: Get token and channel from our API
      const setupRes = await fetch("/api/setup-conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!setupRes.ok) throw new Error("Failed to setup conversation");
      const { appId, channelName, token, botToken, uid, botUid } = await setupRes.json();

      // Step 2: Initialize Agora RTC client and join channel
      const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
      const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      clientRef.current = client;

      // Handle browser autoplay policy failures
      // Browsers block audio autoplay without user gesture; this fires if that happens
      AgoraRTC.onAudioAutoplayFailed = () => {
        console.warn("[Agora] Autoplay blocked by browser — user needs to click 'Enable Audio'");
        setState((prev) => ({ ...prev, audioAutoplayFailed: true }));
      };

      // Helper: play a remote audio track with autoplay fallback
      const playRemoteAudio = (track: any, uid: any) => {
        try {
          track.play();
          console.log(`[Agora] ✅ Audio playing for uid=${uid}`);
          setState((prev) => ({ ...prev, agentAudioReceived: true, audioAutoplayFailed: false }));
        } catch (e) {
          console.warn(`[Agora] ⚠ play() threw for uid=${uid}, storing for manual unlock:`, e);
          pendingAudioTracksRef.current.push(track);
          setState((prev) => ({ ...prev, audioAutoplayFailed: true }));
        }
      };

      // Subscribe to remote audio (the bot's voice)
      client.on("user-published", async (user: any, mediaType: "audio" | "video" | "datachannel") => {
        console.log(`[Agora] user-published uid=${user.uid} mediaType=${mediaType}`);
        try {
          await client.subscribe(user, mediaType);
          console.log(`[Agora] subscribed to ${mediaType} for uid=${user.uid}`);
        } catch (e) {
          console.error(`[Agora] subscribe(${mediaType}) failed for uid=${user.uid}:`, e);
          return;
        }
        if (mediaType === "audio") {
          const track = user.audioTrack;
          console.log(`[Agora] audio track received:`, track ? "present" : "NULL");
          if (track) {
            playRemoteAudio(track, user.uid);
          } else {
            console.warn(`[Agora] audioTrack is null after subscribe — will retry via poller`);
          }
        }
      });

      // user-joined fires when ANY user enters the channel (before publishing)
      client.on("user-joined", (user: any) => {
        console.log(`[Agora] user-joined uid=${user.uid}`);
      });

      client.on("user-left", (user: any, reason: string) => {
        console.log(`[Agora] user-left uid=${user.uid} reason=${reason}`);
      });

      client.on("connection-state-change", (cur: string, prev: string) => {
        console.log(`[Agora] connection: ${prev} → ${cur}`);
      });

      await client.join(appId, channelName, token, uid);

      // Create and publish local audio track (user's microphone)
      const localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
      localAudioTrackRef.current = localAudioTrack;
      await client.publish([localAudioTrack]);

      // Step 3: Invite the AI agent to join
      const joinRes = await fetch("/api/join-conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelName, token: botToken, uid, botUid, requestedMode: modeOverride ?? preferredMode, podcastContext }),
      });
      if (!joinRes.ok) throw new Error("Failed to start AI agent");
      const { agentId, mode, conversationId } = await joinRes.json();

      // Polling fallback: if user-published missed, manually subscribe to any
      // remote users that have audio tracks we haven't played yet.
      audioPollerRef.current = setInterval(() => {
        const remoteUsers = client.remoteUsers || [];
        console.log(`[Agora] poller: ${remoteUsers.length} remote user(s)`, remoteUsers.map((u: any) => `uid=${u.uid} hasAudio=${u.hasAudio}`));
        remoteUsers.forEach(async (user: any) => {
          if (user.hasAudio && !user.audioTrack) {
            console.log(`[Agora] poller: subscribing to missed audio for uid=${user.uid}`);
            try {
              await client.subscribe(user, "audio");
              const track = user.audioTrack;
              if (track) playRemoteAudio(track, user.uid);
            } catch (e) {
              console.warn(`[Agora] poller subscribe failed:`, e);
            }
          } else if (user.audioTrack) {
            // Already subscribed — just ensure it's playing
            const trackState = user.audioTrack.isPlaying;
            if (!trackState) {
              console.log(`[Agora] poller: track not playing for uid=${user.uid}, calling play()`);
              playRemoteAudio(user.audioTrack, user.uid);
            }
          }
        });
      }, 2000);

      setState((prev) => ({
        ...prev,
        status: "active",
        channelName,
        token,
        uid,
        botUid,
        agentId,
        appId,
        mode,
        conversationId: conversationId || null,
        error: null,
      }));

      // Poll volume levels to detect user/agent speaking
      const SPEAK_THRESHOLD = 0.05;
      volumePollerRef.current = setInterval(() => {
        const userVol = localAudioTrackRef.current?.getVolumeLevel?.() ?? 0;
        const agentTrack = (clientRef.current?.remoteUsers ?? []).find((u: any) => u.audioTrack)?.audioTrack;
        const agentVol = agentTrack?.getVolumeLevel?.() ?? 0;
        setState((prev) => ({
          ...prev,
          userSpeaking: userVol > SPEAK_THRESHOLD,
          agentSpeaking: agentVol > SPEAK_THRESHOLD,
        }));
      }, 200);
    } catch (error: any) {
      console.error("Error starting conversation:", error);
      setState((prev) => ({
        ...prev,
        status: "idle",
        error: error.message || "Failed to start conversation",
      }));
    }
  }, [preferredMode]);

  const endConversation = useCallback(async () => {
    setState((prev) => ({ ...prev, status: "ending" }));

    try {
      if (state.agentId) {
        await fetch("/api/leave-agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: state.agentId }),
        });
      }
      if (localAudioTrackRef.current) {
        localAudioTrackRef.current.stop();
        localAudioTrackRef.current.close();
        localAudioTrackRef.current = null;
      }
      if (clientRef.current) {
        await clientRef.current.leave();
        clientRef.current = null;
      }
    } catch (error) {
      console.error("Error ending conversation:", error);
    }

    if (audioPollerRef.current) {
      clearInterval(audioPollerRef.current);
      audioPollerRef.current = null;
    }
    if (volumePollerRef.current) {
      clearInterval(volumePollerRef.current);
      volumePollerRef.current = null;
    }
    pendingAudioTracksRef.current = [];
    setState({
      status: "idle",
      channelName: null,
      token: null,
      uid: null,
      botUid: null,
      agentId: null,
      appId: null,
      mode: "scaledown",
      conversationId: null,
      error: null,
      audioAutoplayFailed: false,
      agentAudioReceived: false,
      userSpeaking: false,
      agentSpeaking: false,
    });
  }, [state.agentId]);

  // Called when user clicks "Enable Audio" after autoplay was blocked
  const unlockAudio = useCallback(() => {
    console.log("[unlockAudio] Replaying", pendingAudioTracksRef.current.length, "pending tracks");
    pendingAudioTracksRef.current.forEach((track) => {
      try { track.play(); } catch (e) { console.warn("Failed to replay track:", e); }
    });
    pendingAudioTracksRef.current = [];
    setState((prev) => ({ ...prev, audioAutoplayFailed: false }));
  }, []);

  return { ...state, startConversation, endConversation, unlockAudio };
}
