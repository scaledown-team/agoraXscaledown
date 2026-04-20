import { NextRequest, NextResponse } from "next/server";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require("podcast-api");

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const apiKey = process.env.LISTENNOTES_API_KEY || null;
  const client = Client({ apiKey });

  try {
    const response = await client.fetchEpisodeById({ id, show_transcript: 1 });
    const ep = response.data;

    // ListenNotes returns transcript as an array of segments or a plain string
    let transcript: string | null = null;
    if (ep.transcript) {
      if (typeof ep.transcript === "string") {
        transcript = ep.transcript;
      } else if (Array.isArray(ep.transcript)) {
        transcript = ep.transcript.map((s: any) => s.text ?? "").join(" ");
      }
    }

    return NextResponse.json({
      id: ep.id,
      title: ep.title,
      podcast: ep.podcast?.title ?? "",
      description: ep.description,
      transcript,
      audioLengthSec: ep.audio_length_sec,
    });
  } catch (err: any) {
    console.error("[podcast/episode] error:", err?.message);
    return NextResponse.json({ error: "Failed to fetch episode" }, { status: 500 });
  }
}
