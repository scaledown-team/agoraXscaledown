import { NextRequest, NextResponse } from "next/server";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require("podcast-api");

const TRANSCRIPT_CHAR_LIMIT = 20000; // ~5-6 mins of speech

async function transcribeWithDeepgram(audioUrl: string): Promise<string | null> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch("https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true", {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: audioUrl }),
    });

    if (!res.ok) {
      console.error("[deepgram] transcription failed:", res.status, await res.text());
      return null;
    }

    const data = await res.json();
    const transcript: string = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
    if (!transcript) return null;

    // Cap to limit to keep system prompt size reasonable
    return transcript.length > TRANSCRIPT_CHAR_LIMIT
      ? transcript.slice(0, TRANSCRIPT_CHAR_LIMIT) + "...[truncated]"
      : transcript;
  } catch (err: any) {
    console.error("[deepgram] error:", err?.message);
    return null;
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const apiKey = process.env.LISTENNOTES_API_KEY || null;
  const client = Client({ apiKey });

  try {
    const response = await client.fetchEpisodeById({ id, show_transcript: 1 });
    const ep = response.data;

    // Try ListenNotes transcript first (available on paid plans)
    let transcript: string | null = null;
    if (ep.transcript) {
      let raw: string | null = null;
      if (typeof ep.transcript === "string") {
        raw = ep.transcript;
      } else if (Array.isArray(ep.transcript)) {
        raw = ep.transcript.map((s: any) => s.text ?? "").join(" ");
      }
      if (raw && !raw.toLowerCase().includes("upgrade") && !raw.toLowerCase().includes("plan to see")) {
        transcript = raw;
      }
    }

    // Fall back to Deepgram transcription from the audio URL
    if (!transcript && ep.audio) {
      console.log(`[podcast/episode] transcribing via Deepgram: ${ep.audio}`);
      transcript = await transcribeWithDeepgram(ep.audio);
    }

    // Strip HTML tags from description for cleaner context
    const description = (ep.description ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    return NextResponse.json({
      id: ep.id,
      title: ep.title,
      podcast: ep.podcast?.title ?? "",
      description,
      transcript,
      audioUrl: ep.audio ?? null,
      audioLengthSec: ep.audio_length_sec,
    });
  } catch (err: any) {
    console.error("[podcast/episode] error:", err?.message);
    return NextResponse.json({ error: "Failed to fetch episode" }, { status: 500 });
  }
}
