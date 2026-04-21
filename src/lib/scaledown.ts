/**
 * ScaleDown compression middleware
 *
 * Sits between Agora's transcript accumulation and the LLM call.
 * Compresses the conversation context before forwarding to Groq.
 *
 * Flow:
 *   Accumulated transcript -> ScaleDown /compress -> compressed context -> Groq
 *
 * NOTE: This module does NOT call logTrace. The caller (llm-proxy) handles
 * all tracing so it can include Groq latency alongside compression metrics.
 */

import { estimateTokens } from "./tracing";

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompressResult {
  messages: Message[];
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  scaledownLatencyMs: number;
  compressionSuccess: boolean;
}

const turnCounters = new Map<string, number>();

export function getAndIncrementTurn(conversationId?: string): number {
  const key = conversationId || "__global__";
  const next = (turnCounters.get(key) ?? 0) + 1;
  turnCounters.set(key, next);
  return next;
}

export function resetTurnCounter(conversationId?: string): void {
  const key = conversationId || "__global__";
  turnCounters.delete(key);
}

/**
 * Compress conversation messages using ScaleDown's /compress endpoint.
 * Returns compression result — caller is responsible for logging the trace.
 */
export async function compressContext(
  messages: Message[],
  options?: { targetModel?: string; rate?: string; baseline?: boolean; conversationId?: string }
): Promise<CompressResult> {
  const apiKey = process.env.SCALEDOWN_API_KEY;
  const apiUrl = process.env.SCALEDOWN_API_URL || "https://api.scaledown.xyz";

  const originalTokens = estimateTokens(messages.map((m) => m.content).join("\n")); // fallback if ScaleDown doesn't return token counts

  // Baseline mode: skip ScaleDown, return raw messages for A/B comparison
  if (options?.baseline) {
    return {
      messages,
      originalTokens,
      compressedTokens: originalTokens,
      compressionRatio: 0,
      scaledownLatencyMs: 0,
      compressionSuccess: true,
    };
  }

  // If no API key configured, pass through without compression
  if (!apiKey) {
    console.warn("[ScaleDown] No API key configured, passing through uncompressed");
    return {
      messages,
      originalTokens,
      compressedTokens: originalTokens,
      compressionRatio: 0,
      scaledownLatencyMs: 0,
      compressionSuccess: false,
    };
  }

  // Separate system message from conversation history
  const systemMessages = messages.filter((m) => m.role === "system");
  const conversationMessages = messages.filter((m) => m.role !== "system");

  // Build full context for ScaleDown: system prompt (incl. podcast transcript) + conversation history
  const systemContext = systemMessages.map((m) => `system: ${m.content}`).join("\n");
  const convContext = conversationMessages.map((m) => `${m.role}: ${m.content}`).join("\n");
  const fullContext = [systemContext, convContext].filter(Boolean).join("\n\n");

  const startTime = Date.now();

  try {
    const response = await fetch(`${apiUrl}/compress/raw/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        context: fullContext,
        prompt: conversationMessages[conversationMessages.length - 1]?.content || "",
        scaledown: { rate: options?.rate || "0.5" },
      }),
    });

    const scaledownLatencyMs = Date.now() - startTime;

    if (!response.ok) {
      console.error(`ScaleDown API error: ${response.status} ${response.statusText}`);
      return {
        messages,
        originalTokens,
        compressedTokens: originalTokens,
        compressionRatio: 0,
        scaledownLatencyMs,
        compressionSuccess: false,
      };
    }

    const data = await response.json();

    // API returns fields nested under data.results
    const results = data.results;
    const actualOriginalTokens = data.total_original_tokens || results?.original_prompt_tokens || originalTokens;
    const compressedContent = results?.compressed_prompt || "";
    const compressedTokens = data.total_compressed_tokens || results?.compressed_prompt_tokens || estimateTokens(compressedContent);
    const compressionRatio = actualOriginalTokens > 0 ? 1 - compressedTokens / actualOriginalTokens : 0;

    console.log(`[ScaleDown] ${actualOriginalTokens} → ${compressedTokens} tokens (${(compressionRatio * 100).toFixed(1)}% saved) in ${scaledownLatencyMs}ms`);

    // If compression failed or returned no content, pass through original
    if (!data.successful || !compressedContent) {
      return {
        messages,
        originalTokens: actualOriginalTokens,
        compressedTokens: actualOriginalTokens,
        compressionRatio: 0,
        scaledownLatencyMs,
        compressionSuccess: false,
      };
    }

    // Build compressed message array — replace system + history with compressed context
    const lastUserMessage = conversationMessages.filter((m) => m.role === "user").pop();
    const compressedMessages: Message[] = [
      {
        role: "system" as const,
        content: `[Context compressed by ScaleDown]:\n${compressedContent}`,
      },
      {
        role: "user" as const,
        content: lastUserMessage?.content || "",
      },
    ];

    return {
      messages: compressedMessages,
      originalTokens: actualOriginalTokens,
      compressedTokens,
      compressionRatio,
      scaledownLatencyMs,
      compressionSuccess: true,
    };

  } catch (error) {
    const scaledownLatencyMs = Date.now() - startTime;
    console.error("ScaleDown compression failed, falling back to uncompressed:", error);
    return {
      messages,
      originalTokens,
      compressedTokens: originalTokens,
      compressionRatio: 0,
      scaledownLatencyMs,
      compressionSuccess: false,
    };
  }
}
