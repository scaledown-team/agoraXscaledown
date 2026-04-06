/**
 * ScaleDown compression middleware
 *
 * Sits between Agora's transcript accumulation and the LLM call.
 * Compresses the conversation context before forwarding to Groq.
 *
 * Flow:
 *   Accumulated transcript -> ScaleDown /compress -> compressed context -> Groq
 */

import { estimateTokens, logTrace } from "./tracing";

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CompressResult {
  messages: Message[];
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
}

let turnCounter = 0;

/**
 * Compress conversation messages using ScaleDown's /compress endpoint
 */
export async function compressContext(
  messages: Message[],
  options?: { targetModel?: string; rate?: string }
): Promise<CompressResult> {
  const apiKey = process.env.SCALEDOWN_API_KEY;
  const apiUrl = process.env.SCALEDOWN_API_URL || "https://api.scaledown.xyz";

  const fullContext = messages.map((m) => m.content).join("\n");
  const originalTokens = estimateTokens(fullContext);

  // If no API key configured, pass through without compression
  if (!apiKey) {
    console.warn("[ScaleDown] No API key configured, passing through uncompressed");
    return {
      messages,
      originalTokens,
      compressedTokens: originalTokens,
      compressionRatio: 0,
    };
  }

  // Separate system message from conversation history
  const systemMessages = messages.filter((m) => m.role === "system");
  const conversationMessages = messages.filter((m) => m.role !== "system");

  const startTime = Date.now();

  try {
    const response = await fetch(`${apiUrl}/compress/raw/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        context: conversationMessages.map((m) => `${m.role}: ${m.content}`).join("\n"),
        prompt: conversationMessages[conversationMessages.length - 1]?.content || "",
        scaledown: {
          rate: options?.rate || "auto",
        },
      }),
    });

    if (!response.ok) {
      console.error(`ScaleDown API error: ${response.status} ${response.statusText}`);
      // Fall back to uncompressed on error
      return {
        messages,
        originalTokens,
        compressedTokens: originalTokens,
        compressionRatio: 0,
      };
    }

    const data = await response.json();
    const latencyMs = Date.now() - startTime;

    // Reconstruct messages with compressed context
    const compressedContent = data.compressed_prompt || "";
    // Use API's exact token counts if available, fall back to estimates
    const compressedTokens = data.compressed_prompt_tokens || estimateTokens(compressedContent);
    const actualOriginalTokens = data.original_prompt_tokens || originalTokens;
    const compressionRatio = actualOriginalTokens > 0 ? 1 - compressedTokens / actualOriginalTokens : 0;

    // Build compressed message array: system prompt + compressed history + latest user message
    const lastUserMessage = conversationMessages.filter((m) => m.role === "user").pop();
    const compressedMessages: Message[] = [
      ...systemMessages,
      {
        role: "user" as const,
        content: `[Previous conversation context (compressed)]:\n${compressedContent}\n\n[Current message]:\n${lastUserMessage?.content || ""}`,
      },
    ];

    turnCounter++;
    logTrace({
      turn: turnCounter,
      timestamp: Date.now(),
      originalTokens: actualOriginalTokens,
      compressedTokens,
      compressionRatio,
      latencyMs,
      model: process.env.LLM_MODEL || "llama-3.3-70b-versatile",
      baselineMode: false,
    });

    return {
      messages: compressedMessages,
      originalTokens: actualOriginalTokens,
      compressedTokens,
      compressionRatio,
    };
  } catch (error) {
    console.error("ScaleDown compression failed, falling back to uncompressed:", error);
    return {
      messages,
      originalTokens,
      compressedTokens: originalTokens,
      compressionRatio: 0,
    };
  }
}

/**
 * Reset the turn counter (call at start of new conversation)
 */
export function resetTurnCounter(): void {
  turnCounter = 0;
}
