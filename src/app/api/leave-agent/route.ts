import { NextRequest, NextResponse } from "next/server";
import { getAgoraAuthHeader } from "@/lib/utils";

/**
 * POST /api/leave-agent
 *
 * Stops the Agora Conversational AI agent and removes it from the channel.
 */
export async function POST(req: NextRequest) {
  try {
    const { agentId } = await req.json();
    const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;

    if (!appId || !agentId) {
      return NextResponse.json(
        { error: "Missing appId or agentId" },
        { status: 400 }
      );
    }

    const response = await fetch(
      `https://api.agora.io/api/conversational-ai-agent/v2/projects/${appId}/agents/${agentId}/leave`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: getAgoraAuthHeader(),
        },
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Error stopping agent:", errorData);
      return NextResponse.json(
        { error: "Failed to stop agent" },
        { status: response.status }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error leaving agent:", error);
    return NextResponse.json(
      { error: "Failed to leave agent" },
      { status: 500 }
    );
  }
}
