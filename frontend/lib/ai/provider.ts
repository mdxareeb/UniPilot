/**
 * Task 26.1 — the provider abstraction (R21: no lock-in).
 *
 * One interface, one registry, env-only configuration — and an honest
 * "not configured" state that every caller can render without inventing a
 * reply. No provider client exists in this repo (no key, no SDK dependency),
 * so `providerStatus()` reports exactly what is missing and the turn pipeline
 * persists that honesty instead of an answer.
 *
 * When a provider lands: add its factory to `PROVIDER_REGISTRY`, implement
 * `chat`/`stream`/`embed`, and nothing else changes — the pipeline, the
 * limits, the persistence and the streaming frame contract all consume this
 * interface.
 *
 * Pure by design (env reads at call time, no server imports) so the contract,
 * the status logic and the timeout/retry machinery are unit-testable and the
 * UI can read the status without crossing a server boundary.
 */

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ProviderUsage = {
  promptTokens: number;
  completionTokens: number;
};

export type ProviderChatResult = {
  text: string;
  usage?: ProviderUsage;
};

export type ProviderStreamFrame =
  | { type: "delta"; text: string }
  | { type: "done"; usage?: ProviderUsage };

export type ChatProvider = {
  /** Stable id, matching the registry key / env value. */
  id: string;
  chat(
    messages: ChatMessage[],
    options: { model: string; signal: AbortSignal },
  ): Promise<ProviderChatResult>;
  stream(
    messages: ChatMessage[],
    options: { model: string; signal: AbortSignal },
  ): AsyncIterable<ProviderStreamFrame>;
  embed(texts: string[]): Promise<number[][]>;
};

export const ASSISTANT_PROVIDER_ENV = "ASSISTANT_PROVIDER";
export const ASSISTANT_API_KEY_ENV = "ASSISTANT_API_KEY";
export const ASSISTANT_MODEL_ENV = "ASSISTANT_MODEL";

/** The exact dependency, so a blocked deployment states it truthfully. */
export const ASSISTANT_PROVIDER_DEPENDENCY =
  "A chat provider client and credential: set ASSISTANT_PROVIDER to a registered provider id, ASSISTANT_API_KEY to its key, and ASSISTANT_MODEL to the model name (all server-only).";

export const ASSISTANT_UNCONFIGURED_COPY =
  "The assistant isn't configured yet. No AI provider is connected in this environment, so I can't answer questions.";

export const PROVIDER_TIMEOUT_MS = 30_000;
export const PROVIDER_MAX_ATTEMPTS = 2;

/**
 * The registry. Deliberately empty in this build: adding a key here without a
 * real client would be worse than the honest unconfigured state. A provider
 * lands as `{ openai: () => createOpenAiProvider(...) }` (or any id), and the
 * env names it.
 */
const PROVIDER_REGISTRY: Record<string, () => ChatProvider> = {};

export type ProviderStatus = {
  configured: boolean;
  providerId: string | null;
  model: string | null;
  /** Sanitized explanation, safe to render or persist. */
  reason: string;
};

export function providerStatus(): ProviderStatus {
  const providerId = process.env[ASSISTANT_PROVIDER_ENV]?.trim() ?? "";
  const apiKey = process.env[ASSISTANT_API_KEY_ENV]?.trim() ?? "";
  const model = process.env[ASSISTANT_MODEL_ENV]?.trim() ?? "";

  if (providerId === "" || apiKey === "") {
    return {
      configured: false,
      providerId: providerId || null,
      model: model || null,
      reason: `No chat provider is configured. Required: ${ASSISTANT_PROVIDER_DEPENDENCY}`,
    };
  }

  if (PROVIDER_REGISTRY[providerId] === undefined) {
    const registered = Object.keys(PROVIDER_REGISTRY);
    return {
      configured: false,
      providerId,
      model: model || null,
      reason:
        registered.length === 0
          ? `No assistant provider client is implemented in this build. Required: ${ASSISTANT_PROVIDER_DEPENDENCY}`
          : `Unknown assistant provider "${providerId}". Registered: ${registered.join(", ")}.`,
    };
  }

  // Unreachable until a real factory exists; kept so the contract is complete.
  return {
    configured: true,
    providerId,
    model: model || null,
    reason: "Provider configured.",
  };
}

export function resolveChatProvider(): {
  status: ProviderStatus;
  provider: ChatProvider | null;
} {
  const status = providerStatus();
  if (!status.configured || status.providerId === null) {
    return { status, provider: null };
  }
  return { status, provider: PROVIDER_REGISTRY[status.providerId]() };
}

/**
 * 26.12 — timeout + bounded retries around any provider call. The timeout
 * aborts through the signal the provider receives; every attempt is
 * independent. Pure and injectable, so the policy is tested without a
 * provider.
 */
export async function withTimeoutAndRetries<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: { timeoutMs?: number; attempts?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  const attempts = Math.max(1, options.attempts ?? PROVIDER_MAX_ATTEMPTS);

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await operation(controller.signal);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("The provider call failed.");
}
