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
  });

  const clientRef = useRef<any>(null);

  const startConversation = useCallback(async () => {
    setState((prev) => ({ ...prev, status: "connecting", error: null }));

    try {
      // Step 1: Get token and channel from our API
      const setupRes = await fetch("/api/setup-conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!setupRes.ok) throw new Error("Failed to setup conversation");
      const { appId, channelName, token, uid, botUid } = await setupRes.json();

      // Step 2: Initialize Agora RTC client and join channel
      const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
      const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      clientRef.current = client;

      // Subscribe to remote audio (the bot's voice)
      client.on("user-published", async (user: any, mediaType: string) => {
        await client.subscribe(user, mediaType);
        if (mediaType === "audio") {
          user.audioTrack?.play();
        }
      });

      await client.join(appId, channelName, token, uid);

      // Create and publish local audio track (user's microphone)
      const localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
      await client.publish([localAudioTrack]);

      // Step 3: Invite the AI agent to join
      const joinRes = await fetch("/api/join-conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelName, token, uid, botUid }),
      });
      if (!joinRes.ok) throw new Error("Failed to start AI agent");
      const { agentId, mode } = await joinRes.json();

      setState({
        status: "active",
        channelName,
        token,
        uid,
        botUid,
        agentId,
        appId,
        mode,
        error: null,
      });
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
      if (clientRef.current) {
        clientRef.current.localTracks?.forEach((track: any) => {
          track.stop();
          track.close();
        });
        await clientRef.current.leave();
        clientRef.current = null;
      }
    } catch (error) {
      console.error("Error ending conversation:", error);
    }

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
    });
  }, [state.agentId]);

  return { ...state, startConversation, endConversation };
}
