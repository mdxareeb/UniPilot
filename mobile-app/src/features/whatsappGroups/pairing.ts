/**
 * Pairing-code helpers: the countdown, the display grouping and the Copy Code
 * action. Pure, with the clipboard injected, so the behaviour is testable
 * without a device.
 */

/** Whole seconds until `expiresAt`, never negative; 0 for an unparsable value. */
export function secondsLeft(expiresAt: string, now: number): number {
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/** `m:ss`, e.g. 102 → "1:42". */
export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

/** The raw code as WhatsApp wants it typed: eight letters/digits, no separator. */
export function normalizeCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/** `ABCD1234` → `ABCD-1234` (how WhatsApp shows it); anything else is left alone. */
export function displayCode(code: string): string {
  const raw = normalizeCode(code);
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}

export type CopyResult = "copied" | "failed" | "expired";

/**
 * Copy the code so it can be pasted into WhatsApp. An expired code is never
 * copied (it would only fail in WhatsApp), and a clipboard error is reported,
 * not swallowed, so the button never claims "Copied" when nothing was.
 */
export async function copyPairingCode(
  pairing: { code: string; expiresAt: string },
  setString: (text: string) => Promise<boolean | void>,
  now: number,
): Promise<CopyResult> {
  if (secondsLeft(pairing.expiresAt, now) <= 0) return "expired";
  try {
    const result = await setString(normalizeCode(pairing.code));
    return result === false ? "failed" : "copied";
  } catch {
    return "failed";
  }
}
