import { NextRequest, NextResponse } from "next/server";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require("podcast-api");

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  if (!q) return NextResponse.json({ error: "Missing query" }, { status: 400 });

  const apiKey = process.env.LISTENNOTES_API_KEY || null;
  const client = Client({ apiKey });

  try {
    const response = await client.search({ q, type: "episode", page_size: 10 });
    const results = (response.data?.results ?? []).map((r: any) => ({
      id: r.id,
      title: r.title_original,
      podcast: r.podcast?.title_original ?? "",
      description: r.description_original?.slice(0, 200) ?? "",
      thumbnail: r.thumbnail,
      audioLengthSec: r.audio_length_sec,
      pubDateMs: r.pub_date_ms,
    }));
    return NextResponse.json({ results });
  } catch (err: any) {
    console.error("[podcast/search] error:", err?.message);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
