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
  error: string | null;
  audioAutoplayFailed: boolean;
  agentAudioReceived: boolean;
}

export function useConversation() {
  const [state, setState] = useState<ConversationState>({
    status: "idle",
    channelName: null,
    token: null,
    uid: null,
    botUid: null,
    agentId: null,
    appId: null,
    mode: "scaledown",
    error: null,
    audioAutoplayFailed: false,
    agentAudioReceived: false,
  });

  const clientRef = useRef<any>(null);
  const localAudioTrackRef = useRef<any>(null);
  const pendingAudioTracksRef = useRef<any[]>([]);

  const startConversation = useCallback(async () => {
    setState((prev) => ({ ...prev, status: "connecting", error: null }));

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

      // Subscribe to remote audio (the bot's voice)
      client.on("user-published", async (user: any, mediaType: "audio" | "video" | "datachannel") => {
        console.log(`[user-published] uid=${user.uid} mediaType=${mediaType}`);
        try {
          await client.subscribe(user, mediaType);
        } catch (e) {
          console.error("[user-published] subscribe() failed:", e);
          return;
        }
        if (mediaType === "audio") {
          console.log(`[user-published] Playing audio track for uid=${user.uid}`);
          setState((prev) => ({ ...prev, agentAudioReceived: true }));
          const track = user.audioTrack;
          if (track) {
            try {
              track.play();
            } catch (e) {
              console.warn("[user-published] play() threw, storing for manual unlock:", e);
              pendingAudioTracksRef.current.push(track);
              setState((prev) => ({ ...prev, audioAutoplayFailed: true }));
            }
          }
        }
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
        body: JSON.stringify({ channelName, token: botToken, uid, botUid }),
      });
      if (!joinRes.ok) throw new Error("Failed to start AI agent");
      const { agentId, mode } = await joinRes.json();

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
        error: null,
      }));
    } catch (error: any) {
      console.error("Error starting conversation:", error);
      setState((prev) => ({
        ...prev,
        status: "idle",
        error: error.message || "Failed to start conversation",
      }));
    }
  }, []);

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
      error: null,
      audioAutoplayFailed: false,
      agentAudioReceived: false,
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
