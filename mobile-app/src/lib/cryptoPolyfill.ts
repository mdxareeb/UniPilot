import { CryptoDigestAlgorithm, digest, getRandomValues } from "expo-crypto";

/**
 * The WebCrypto bridge for Supabase's PKCE flow (M2b) and any future
 * crypto use.
 *
 * `@supabase/auth-js` generates the PKCE verifier with `crypto.getRandomValues`
 * and the S256 challenge with `crypto.subtle.digest("SHA-256", …)`; Hermes has
 * neither, and without them the library silently degrades to the weaker
 * `plain` code-challenge method. This module installs both from `expo-crypto`
 * once, before the Supabase client is created, so the S256 path is real.
 */

type DigestLike = (
  algorithm: string,
  data: Uint8Array<ArrayBuffer>,
) => Promise<ArrayBuffer>;

type WebCryptoLike = {
  getRandomValues?: (array: Uint8Array) => Uint8Array;
  subtle?: { digest: DigestLike };
};

const scope = globalThis as unknown as { crypto?: WebCryptoLike };

/** A minimal UTF-8 TextEncoder, installed only when the runtime lacks one. */
function installTextEncoder(): void {
  const scopeWithEncoder = globalThis as unknown as { TextEncoder?: unknown };
  if (typeof scopeWithEncoder.TextEncoder !== "undefined") return;

  class Utf8TextEncoder {
    encode(input: string): Uint8Array {
      const bytes: number[] = [];
      for (const char of input) {
        const code = char.codePointAt(0) ?? 0;
        if (code < 0x80) {
          bytes.push(code);
        } else if (code < 0x800) {
          bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code < 0x10000) {
          bytes.push(
            0xe0 | (code >> 12),
            0x80 | ((code >> 6) & 0x3f),
            0x80 | (code & 0x3f),
          );
        } else {
          bytes.push(
            0xf0 | (code >> 18),
            0x80 | ((code >> 12) & 0x3f),
            0x80 | ((code >> 6) & 0x3f),
            0x80 | (code & 0x3f),
          );
        }
      }
      return new Uint8Array(bytes);
    }
  }

  (globalThis as unknown as { TextEncoder?: unknown }).TextEncoder =
    Utf8TextEncoder;
}

export function installCryptoPolyfill(): void {
  installTextEncoder();

  const target: WebCryptoLike = scope.crypto ?? {};
  if (typeof target.getRandomValues !== "function") {
    target.getRandomValues = (array) => getRandomValues(array);
  }
  if (typeof target.subtle === "undefined") {
    target.subtle = {
      digest: async (_algorithm, data) =>
        digest(CryptoDigestAlgorithm.SHA256, data),
    };
  }
  scope.crypto = target;
}
