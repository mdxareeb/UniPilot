/**
 * Ask AI's Gemini chat client (server-only).
 *
 * The mobile study chat needs a non-streaming, single-turn completion. This
 * client mirrors the tested worker shape (`backend/worker/groupsync/gemini.mjs`)
 * instead of adding an SDK:
 *
 * - configuration is environment only (`GEMINI_API_KEY` + `GEMINI_MODEL`);
 *   a missing pair is an honest "not configured", never a guessed default;
 * - the key travels in the `x-goog-api-key` header, never in a URL or a log;
 * - temperature is low and `maxOutputTokens` is bounded, so one turn cannot
 *   become an unbounded spend;
 * - 429 and 5xx are marked retryable; 4xx are permanent;
 * - every error message is a fixed sanitized string. Provider response bodies
 *   are never logged or stored — they can echo the student's material.
 *
 * The prompt is assembled by `lib/ai/prompt.ts` (one system message + one
 * `<workspace_data>` user turn), so this module only translates roles and
 * carries the result back.
 */
import type { ChatMessage, ProviderUsage } from "./provider";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Low, not zero: summaries read less mechanically while staying grounded. */
export const GEMINI_CHAT_TEMPERATURE = 0.2;
export const GEMINI_CHAT_MAX_OUTPUT_TOKENS = 2048;
/** A hard ceiling regardless of caller input. */
export const GEMINI_CHAT_MAX_OUTPUT_TOKENS_LIMIT = 4096;
export const GEMINI_CHAT_TIMEOUT_MS = 45_000;

export type GeminiChatConfig = { apiKey: string; model: string };

export type GeminiChatStatus =
  | { configured: true; reason: null; model: string }
  | { configured: false; reason: string; model: null };

export type GeminiChatErrorCode =
  | "not_configured"
  | "rate_limited"
  | "unavailable"
  | "rejected"
  | "blocked"
  | "invalid_response";

export class GeminiChatError extends Error {
  readonly code: GeminiChatErrorCode;
  readonly retryable: boolean;

  constructor(code: GeminiChatErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "GeminiChatError";
    this.code = code;
    this.retryable = retryable;
  }
}

/** The only strings that ever reach a response or a log from this client. */
export const GEMINI_CHAT_COPY = {
  not_configured:
    "The study assistant isn't configured on this server yet. No answer was generated.",
  rate_limited: "The AI service is busy. Try again in a moment.",
  unavailable: "The AI service is temporarily unavailable. Try again in a moment.",
  rejected: "The AI service rejected the request.",
  blocked: "The AI service declined to process this content.",
  invalid_response: "The AI service returned an unusable response.",
} as const;

/**
 * `{ apiKey, model }` or a status that says exactly what is missing. The model
 * name is validated because it becomes a URL path segment.
 */
export function geminiChatStatus(
  env: NodeJS.ProcessEnv = process.env,
): GeminiChatStatus {
  const apiKey = (env.GEMINI_API_KEY ?? "").trim();
  const model = (env.GEMINI_MODEL ?? "").trim();

  if (apiKey === "") {
    return {
      configured: false,
      reason: "GEMINI_API_KEY is not set on this server.",
      model: null,
    };
  }
  if (model === "") {
    return {
      configured: false,
      reason: "GEMINI_MODEL is not set on this server.",
      model: null,
    };
  }
  if (!/^[A-Za-z0-9._-]+$/.test(model)) {
    return {
      configured: false,
      reason: "GEMINI_MODEL contains characters a model id cannot contain.",
      model: null,
    };
  }
  return { configured: true, reason: null, model };
}

export function readGeminiChatConfig(
  env: NodeJS.ProcessEnv = process.env,
): GeminiChatConfig | null {
  const status = geminiChatStatus(env);
  if (!status.configured) return null;
  return { apiKey: (env.GEMINI_API_KEY ?? "").trim(), model: status.model };
}

type GeminiPart = { text: string };
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

/** Translate the provider-neutral messages into Gemini's role vocabulary. */
function toGeminiContents(messages: readonly ChatMessage[]): {
  system: string | null;
  contents: GeminiContent[];
} {
  const systemParts: string[] = [];
  const contents: GeminiContent[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(message.content);
      continue;
    }
    const role = message.role === "assistant" ? "model" : "user";
    const last = contents.at(-1);
    // Gemini requires alternating turns; merge adjacent equal roles rather
    // than sending a request it will reject.
    if (last !== undefined && last.role === role) {
      last.parts[0].text = `${last.parts[0].text}\n\n${message.content}`;
      continue;
    }
    contents.push({ role, parts: [{ text: message.content }] });
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : null,
    contents,
  };
}

function extractText(body: unknown): string | null {
  const candidate = (
    body as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] }
  )?.candidates?.[0];
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
  return text === "" ? null : text;
}

function readUsage(body: unknown): ProviderUsage {
  const usage = (body as { usageMetadata?: Record<string, unknown> })
    ?.usageMetadata;
  return {
    promptTokens: Number(usage?.promptTokenCount) || 0,
    completionTokens: Number(usage?.candidatesTokenCount) || 0,
  };
}

function mapStatus(status: number): GeminiChatError {
  if (status === 429) {
    return new GeminiChatError(
      "rate_limited",
      GEMINI_CHAT_COPY.rate_limited,
      true,
    );
  }
  if (status >= 500) {
    return new GeminiChatError(
      "unavailable",
      GEMINI_CHAT_COPY.unavailable,
      true,
    );
  }
  return new GeminiChatError("rejected", GEMINI_CHAT_COPY.rejected, false);
}

export type GeminiChatResult = {
  text: string;
  usage: ProviderUsage;
};

/**
 * One bounded completion. The caller owns retries (the turn route does not
 * silently retry a paid call) and persistence; this function either returns a
 * non-empty text or throws a sanitized `GeminiChatError`.
 */
export async function chatWithGemini(options: {
  messages: readonly ChatMessage[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<GeminiChatResult> {
  const config = readGeminiChatConfig();
  if (config === null) {
    throw new GeminiChatError(
      "not_configured",
      GEMINI_CHAT_COPY.not_configured,
      false,
    );
  }

  const { system, contents } = toGeminiContents(options.messages);
  if (contents.length === 0) {
    throw new GeminiChatError(
      "rejected",
      GEMINI_CHAT_COPY.rejected,
      false,
    );
  }

  const maxOutputTokens = Math.min(
    Math.max(options.maxOutputTokens ?? GEMINI_CHAT_MAX_OUTPUT_TOKENS, 1),
    GEMINI_CHAT_MAX_OUTPUT_TOKENS_LIMIT,
  );
  const temperature = Math.min(
    Math.max(options.temperature ?? GEMINI_CHAT_TEMPERATURE, 0),
    1,
  );

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens,
    },
  };
  if (system !== null) {
    body.systemInstruction = { parts: [{ text: system }] };
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? GEMINI_CHAT_TIMEOUT_MS,
  );
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(
      `${ENDPOINT}/${config.model}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": config.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
  } catch {
    throw new GeminiChatError(
      "unavailable",
      GEMINI_CHAT_COPY.unavailable,
      true,
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }

  if (!response.ok) throw mapStatus(response.status);

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new GeminiChatError(
      "invalid_response",
      GEMINI_CHAT_COPY.invalid_response,
      true,
    );
  }

  if (
    (parsed as { promptFeedback?: { blockReason?: unknown } })?.promptFeedback
      ?.blockReason
  ) {
    throw new GeminiChatError("blocked", GEMINI_CHAT_COPY.blocked, false);
  }

  const text = extractText(parsed);
  if (text === null) {
    throw new GeminiChatError(
      "invalid_response",
      GEMINI_CHAT_COPY.invalid_response,
      true,
    );
  }

  return { text, usage: readUsage(parsed) };
}
