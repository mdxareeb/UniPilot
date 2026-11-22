/**
 * Phone-number sanitising for WhatsApp pairing codes.
 *
 * `requestPairingCode()` wants digits only, in E.164 shape WITHOUT the plus:
 * `919876543210`, never `+91 98765-43210`. This turns what a person types into
 * that, or says why it cannot.
 *
 * Deliberately conservative:
 * - separators a person naturally types (space, dash, dot, brackets) are
 *   dropped; letters and anything else are rejected, never silently stripped;
 * - a leading `+` or international prefix `00` is accepted and removed;
 * - a number that still starts with `0` (a national format like 098765 43210)
 *   is REJECTED rather than guessed: without a country code it would link the
 *   wrong account or fail confusingly;
 * - 8 to 15 digits (the E.164 maximum is 15).
 *
 * The same rules are enforced again in the database (`set_whatsapp_pairing_phone`)
 * and in the web/mobile API layer; this copy is the bridge's last line of
 * defence before it hands a number to WhatsApp.
 */

export type PhoneRejection = "empty" | "characters" | "country_code" | "length";

export type PhoneResult =
  | { ok: true; digits: string }
  | { ok: false; reason: PhoneRejection };

const SEPARATORS = /[\s\-.()]/g;

export function sanitizePhone(input: unknown): PhoneResult {
  if (typeof input !== "string") return { ok: false, reason: "empty" };
  let value = input.trim();
  if (value === "") return { ok: false, reason: "empty" };

  value = value.replace(SEPARATORS, "");
  if (value.startsWith("+")) value = value.slice(1);
  else if (value.startsWith("00")) value = value.slice(2);

  if (!/^\d+$/.test(value)) return { ok: false, reason: "characters" };
  if (value.startsWith("0")) return { ok: false, reason: "country_code" };
  if (value.length < 8 || value.length > 15) return { ok: false, reason: "length" };
  return { ok: true, digits: value };
}

/** Plain-language reasons, safe to show a user. */
export const PHONE_REJECTION_COPY: Record<PhoneRejection, string> = {
  empty: "Enter the phone number linked to your WhatsApp.",
  characters: "Use digits only, with the country code (for example 919876543210).",
  country_code: "Start with the country code, not a leading 0 (for example 91 for India).",
  length: "That number is the wrong length. Include the country code and the full number.",
};
