import { NextRequest, NextResponse } from "next/server";
import { compressContext } from "@/lib/scaledown";

/**
 * POST /api/llm-proxy
 *
 * ============================================================
 * THIS IS THE CORE SCALEDOWN INTEGRATION POINT
 * ============================================================
 *
 * This endpoint acts as an OpenAI-compatible proxy that:
 * 1. Receives conversation messages from Agora's AI agent
 * 2. Compresses the accumulated context with ScaleDown /compress
 * 3. Forwards the compressed context to Groq
 * 4. Returns Groq's response back to Agora
 *
 * Agora's agent sees this as a normal LLM endpoint.
 * ScaleDown compression is invisible to the rest of the pipeline.
 *
 * Flow:
 *   Agora agent -> this proxy -> ScaleDown /compress -> Groq -> response -> Agora
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages = body.messages || [];
    const model = body.model || process.env.LLM_MODEL || "llama-3.3-70b-versatile";
    const stream = body.stream ?? false;

    // ---- STEP 1: Compress with ScaleDown ----
    // compressContext handles logging the trace internally via logTrace()
    const { messages: compressedMessages, originalTokens, compressedTokens } =
      await compressContext(messages, { targetModel: model });

    console.log(
      `[LLM Proxy] Compressed ${originalTokens} -> ${compressedTokens} tokens ` +
      `(${originalTokens > 0 ? ((1 - compressedTokens / originalTokens) * 100).toFixed(1) : 0}% reduction)`
    );

    // ---- STEP 2: Forward to Groq ----
    const llmUrl = `${process.env.LLM_BASE_URL}/chat/completions`;
    const llmResponse = await fetch(llmUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: compressedMessages,
        stream,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
      }),
    });

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();
      console.error("Groq API error:", llmResponse.status, errorText);
      return NextResponse.json(
        { error: "LLM request failed", details: errorText },
        { status: llmResponse.status }
      );
    }

    // ---- STEP 3: Return response to Agora ----
    if (stream) {
      // For streaming responses, pipe through directly
      const responseHeaders = new Headers();
      responseHeaders.set("Content-Type", "text/event-stream");
      responseHeaders.set("Cache-Control", "no-cache");
      responseHeaders.set("Connection", "keep-alive");
      return new NextResponse(llmResponse.body, {
        status: 200,
        headers: responseHeaders,
      });
    }

    // Non-streaming: return JSON response
    const data = await llmResponse.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("LLM proxy error:", error);
    return NextResponse.json(
      { error: "Internal proxy error" },
      { status: 500 }
    );
  }
}
