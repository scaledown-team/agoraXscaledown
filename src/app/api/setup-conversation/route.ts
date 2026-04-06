import { NextRequest, NextResponse } from "next/server";
import { RtcTokenBuilder, RtcRole } from "agora-token";
import { generateChannelName, generateUid } from "@/lib/utils";

/**
 * POST /api/setup-conversation
 *
 * Generates an Agora RTC token and channel name for a new conversation.
 * The token allows the user to join the voice channel.
 */
export async function POST(req: NextRequest) {
  try {
    const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;

    if (!appId || !appCertificate) {
      return NextResponse.json(
        { error: "Agora credentials not configured" },
        { status: 500 }
      );
    }

    const channelName = generateChannelName();
    const uid = generateUid();
    const botUid = parseInt(process.env.NEXT_PUBLIC_AGORA_BOT_UID || "1001");
    // agora-token v2: tokenExpire and privilegeExpire are in SECONDS from now (not Unix timestamps)
    const tokenExpire = 3600;     // token valid for 1 hour
    const privilegeExpire = 3600; // privileges valid for 1 hour

    // Generate token for the user (to join RTC channel)
    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      uid,
      RtcRole.PUBLISHER,
      tokenExpire,
      privilegeExpire
    );

    // Generate a separate token for the bot/agent
    // uid=0 is a wildcard token that works for any auto-assigned UID
    const botToken = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      0,
      RtcRole.PUBLISHER,
      tokenExpire,
      privilegeExpire
    );

    return NextResponse.json({
      appId,
      channelName,
      token,
      botToken,
      uid,
      botUid,
    });
  } catch (error) {
    console.error("Error setting up conversation:", error);
    return NextResponse.json(
      { error: "Failed to setup conversation" },
      { status: 500 }
    );
  }
}
