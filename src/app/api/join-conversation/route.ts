import { NextRequest, NextResponse } from "next/server";
import { getAgoraAuthHeader } from "@/lib/utils";
import { resetTurnCounter } from "@/lib/scaledown";
import { getSupabase } from "@/lib/supabase";

/**
 * POST /api/join-conversation
 *
 * Invites the Agora Conversational AI agent into the voice channel.
 * Configures ASR (Deepgram), TTS (Cartesia), and LLM (Groq).
 *
 * KEY INTEGRATION POINT:
 * In ScaleDown mode, the LLM URL points to our /api/llm-proxy route.
 * The proxy compresses context with ScaleDown before forwarding to Groq.
 * In baseline mode, the LLM URL points directly to Groq.
 *
 * API Reference: https://docs.agora.io/en/conversational-ai/rest-api/agent/join
 */
export async function POST(req: NextRequest) {
  try {
    const { channelName, token, uid, botUid, podcastContext } = await req.json();

    const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;

    if (!appId) {
      return NextResponse.json({ error: "Agora App ID not configured" }, { status: 500 });
    }

    // Reset turn counter for new conversation
    resetTurnCounter();

    // Single mode: always ScaleDown — proxy runs both paths internally
    const { data: convData, error: convError } = await getSupabase()
      .from("conversations")
      .insert({ label: `Conversation`, mode: "scaledown" })
      .select("id")
      .single();

    if (convError) {
      console.error("[Supabase] Failed to create conversation:", convError.message);
    } else {
      console.log("[Supabase] Created conversation:", convData?.id);
    }

    const conversationId = convData?.id || "unknown";

    const proxyBase = getProxyBaseUrl(req);
    const llmUrl = `${proxyBase}/api/llm-proxy?conversationId=${conversationId}`;
    const llmApiKey = "proxy-internal";
    const model = process.env.LLM_MODEL || "gpt-4o-mini";

    // Build the request body per Agora's REST API schema
    // Ref: https://docs.agora.io/en/conversational-ai/rest-api/agent/join
    const requestBody = {
      name: `agent_${Date.now()}`,
      properties: {
        channel: channelName,
        token: token,
        agent_rtc_uid: "0",             // "0" = Agora auto-assigns UID
        remote_rtc_uids: [String(uid)],
        enable_string_uid: false,
        idle_timeout: 120,

        // LLM configuration
        llm: {
          url: llmUrl,
          api_key: llmApiKey || "",
          system_messages: [
            {
              role: "system",
              content: podcastContext
                ? `You are a helpful voice AI assistant. The user wants to discuss a podcast episode. Here is the transcript/context:\n\n${podcastContext}\n\nAnswer questions about this podcast episode. Keep responses concise and conversational since this is a real-time voice conversation. Be natural and friendly.`
                : "You are a helpful voice AI assistant. Keep responses concise and conversational since this is a real-time voice conversation. Be natural and friendly.",
            },
          ],
          greeting_message: "Hello! How can I help you today?",
          failure_message: "I'm sorry, I'm having trouble with that. Could you try again?",
          max_history: 10,
          params: {
            model: model,
          },
        },

        // TTS configuration — Cartesia
        tts: {
          vendor: "cartesia",
          params: {
            api_key: process.env.CARTESIA_API_KEY || "",
            model_id: "sonic-2",
            base_url: "wss://api.cartesia.ai",
            voice: {
              mode: "id",
              id: process.env.CARTESIA_VOICE_ID || "f786b574-daa5-4673-aa0c-cbe3e8534c02",
            },
            output_format: {
              container: "raw",
              encoding: "pcm_s16le",
              sample_rate: 16000,
            },
            language: "en",
          },
        },

        // ASR configuration — Deepgram via Agora ConvAI
        asr: {
          vendor: "deepgram",
          params: {
            url: "wss://api.deepgram.com/v1/listen",
            key: process.env.DEEPGRAM_API_KEY || "",
            model: "nova-2",
            language: "en-US",
          },
        },
      },
    };

    // Call Agora's Conversational AI REST API to start the agent
    const response = await fetch(
      `https://api.agora.io/api/conversational-ai-agent/v2/projects/${appId}/join`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: getAgoraAuthHeader(),
        },
        body: JSON.stringify(requestBody),
      }
    );

    console.log("[join-conversation] Request body sent to Agora:", JSON.stringify(requestBody, null, 2));

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Agora API error:", response.status, errorData);
      return NextResponse.json(
        { error: "Failed to start AI agent", details: errorData },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json({
      success: true,
      agentId: data.agent_id,
      createTs: data.create_ts,
      status: data.status,
      mode: "scaledown",
      conversationId,
    });
  } catch (error) {
    console.error("Error joining conversation:", error);
    return NextResponse.json(
      { error: "Failed to join conversation" },
      { status: 500 }
    );
  }
}

/**
 * Get the base URL for the proxy endpoint.
 *
 * IMPORTANT: For local dev, Agora's cloud agent can't reach localhost.
 * You MUST use ngrok or a similar tunnel and set PROXY_BASE_URL in .env.local.
 * Example: PROXY_BASE_URL=https://abc123.ngrok-free.app
 */
function getProxyBaseUrl(req: NextRequest): string {
  // Prefer explicit env var (required for ScaleDown mode in dev)
  if (process.env.PROXY_BASE_URL) {
    return process.env.PROXY_BASE_URL;
  }
  // Fallback for production deployments
  const host = req.headers.get("host") || "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}
