import { createHash } from "node:crypto";

/** Unit separator: cannot appear in a JID, a name or a hash, so fields never blur together. */
const SEP = "\u001f";

/**
 * Lower-case, NFKC-normalise and collapse whitespace so cosmetic differences
 * (a trailing space, a different Unicode form of the same letter) do not make
 * the same message look new.
 */
export function normalizeText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Truncate an instant to the start of its minute (UTC), as epoch milliseconds. */
export function floorToMinute(at: Date): number {
  return Math.floor(at.getTime() / 60_000) * 60_000;
}

export interface FingerprintInput {
  userId: string;
  groupJid: string;
  senderName: string;
  sentAt: Date;
  /** The message text, or the attachment's sha256 for a file message. */
  textOrFileSha256: string;
  /** True when `textOrFileSha256` is a file hash (kept verbatim, not normalised). */
  isFileHash?: boolean;
}

/**
 * `sha256(user_id | group_jid | sender | floor_to_minute(sent_at) | text-or-file)`.
 *
 * The idempotency key for `raw_messages`: a re-sync, a history replay or a
 * redelivered event hashes to the same value and is dropped, so it can never
 * create a second task or file. Per user: another user's copy of the same group
 * message is a separate row (the unique key is `(user_id, fingerprint)`).
 */
export function computeFingerprint(input: FingerprintInput): string {
  const last = input.isFileHash
    ? input.textOrFileSha256.toLowerCase()
    : normalizeText(input.textOrFileSha256);
  return createHash("sha256")
    .update(
      [
        input.userId,
        input.groupJid,
        normalizeText(input.senderName),
        String(floorToMinute(input.sentAt)),
        last,
      ].join(SEP),
    )
    .digest("hex");
}
