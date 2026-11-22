import pino, { type Logger } from "pino";
import { StoreError } from "./store/supabaseStore.ts";

/**
 * Logging rules for the bridge:
 * - never log a QR payload, a credential, a key, message text, a file name, a
 *   phone number or a group's content;
 * - identify a user only by the first 8 characters of their id;
 * - log errors by NAME (and the store operation/code), never by `.message`,
 *   because library messages can embed JIDs, URLs or statement fragments.
 */
export function createLogger(level: string): Logger {
  return pino({ level, base: { service: "whatsapp-bridge" } });
}

export function shortId(userId: string): string {
  return userId.slice(0, 8);
}

export function safeError(error: unknown): { error: string; operation?: string; code?: string } {
  if (error instanceof StoreError) {
    const out: { error: string; operation?: string; code?: string } = {
      error: error.name,
      operation: error.operation,
    };
    if (error.code) out.code = error.code;
    return out;
  }
  if (error instanceof Error) return { error: error.name };
  return { error: "UnknownError" };
}
