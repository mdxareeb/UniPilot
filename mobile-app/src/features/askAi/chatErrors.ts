/**
 * The sanitized failure vocabulary for the Ask AI Bearer channel.
 *
 * A screen never sees a raw provider body or a fetch exception. The route's
 * own `{ error }` copy is trusted only for the statuses where it is already
 * sanitized (429/502/503/404); auth failures always use fixed copy.
 */
import { CHAT_COPY } from "./chatValues";

export type ChatApiErrorKind =
  | "config"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "rate_limited"
  | "unavailable"
  | "provider"
  | "network"
  | "server"
  | "parse";

export class ChatApiError extends Error {
  readonly kind: ChatApiErrorKind;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    kind: ChatApiErrorKind,
    message: string,
    options: { status?: number | null; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "ChatApiError";
    this.kind = kind;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serverMessage(body: unknown, fallback: string): string {
  if (!isRecord(body) || typeof body.error !== "string") return fallback;
  const message = body.error.trim();
  if (message === "" || message.length > 300) return fallback;
  return message;
}

export function chatErrorFromResponse(
  status: number,
  body: unknown,
): ChatApiError {
  if (status === 401) {
    return new ChatApiError("unauthorized", CHAT_COPY.SIGNED_OUT, {
      status,
    });
  }
  if (status === 403) {
    return new ChatApiError("forbidden", CHAT_COPY.FORBIDDEN, { status });
  }
  if (status === 404) {
    return new ChatApiError(
      "not_found",
      serverMessage(body, CHAT_COPY.NOT_FOUND),
      { status },
    );
  }
  if (status === 400) {
    return new ChatApiError(
      "invalid",
      serverMessage(body, CHAT_COPY.INVALID),
      { status },
    );
  }
  if (status === 429) {
    return new ChatApiError(
      "rate_limited",
      serverMessage(body, CHAT_COPY.RATE_LIMITED),
      { status, retryable: true },
    );
  }
  if (status === 503) {
    return new ChatApiError(
      "unavailable",
      serverMessage(body, CHAT_COPY.UNAVAILABLE),
      { status, retryable: true },
    );
  }
  if (status === 502) {
    return new ChatApiError(
      "provider",
      serverMessage(body, CHAT_COPY.PROVIDER),
      { status, retryable: true },
    );
  }
  return new ChatApiError("server", CHAT_COPY.SERVER, { status });
}

export function chatErrorFromNetwork(): ChatApiError {
  return new ChatApiError("network", CHAT_COPY.NETWORK, { retryable: true });
}

export function chatErrorFromConfig(): ChatApiError {
  return new ChatApiError("config", CHAT_COPY.NOT_CONNECTED);
}

export function chatErrorFromParse(): ChatApiError {
  return new ChatApiError("parse", CHAT_COPY.PARSE, { retryable: true });
}

export type ChatFailure = {
  kind: ChatApiErrorKind;
  message: string;
  retryable: boolean;
};

/** One UI-safe failure object for any thrown value. */
export function toChatFailure(error: unknown): ChatFailure {
  if (error instanceof ChatApiError) {
    return {
      kind: error.kind,
      message: error.message,
      retryable: error.retryable,
    };
  }
  return {
    kind: "server",
    message: CHAT_COPY.GENERIC,
    retryable: true,
  };
}
