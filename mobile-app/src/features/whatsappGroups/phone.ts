/**
 * The phone number for the pairing-code link.
 *
 * A copy of `sanitizePhone` / `PHONE_REJECTION_COPY` in
 * `frontend/lib/data/groupSyncValues.ts`, so the form can answer instantly. The
 * server (API, database and bridge) validates again with the same rules and is
 * the authority; `__tests__/phone.test.ts` pins the two together on the same
 * cases. Digits only, no `+`, spaces or dashes: `919876543210`.
 */
export type PhoneRejection = "empty" | "characters" | "country_code" | "length";

export type PhoneResult =
  | { ok: true; digits: string }
  | { ok: false; reason: PhoneRejection };

export function sanitizePhone(input: unknown): PhoneResult {
  if (typeof input !== "string") return { ok: false, reason: "empty" };
  let value = input.trim();
  if (value === "") return { ok: false, reason: "empty" };
  value = value.replace(/[\s\-.()]/g, "");
  if (value.startsWith("+")) value = value.slice(1);
  else if (value.startsWith("00")) value = value.slice(2);
  if (!/^\d+$/.test(value)) return { ok: false, reason: "characters" };
  if (value.startsWith("0")) return { ok: false, reason: "country_code" };
  if (value.length < 8 || value.length > 15) return { ok: false, reason: "length" };
  return { ok: true, digits: value };
}

/** Plain-language reasons; they never echo what was typed. */
export const PHONE_REJECTION_COPY: Record<PhoneRejection, string> = {
  empty: "Enter the phone number linked to your WhatsApp.",
  characters: "Use digits only, with the country code (for example 919876543210).",
  country_code:
    "Start with the country code, not a leading 0 (for example 91 for India).",
  length:
    "That number is the wrong length. Include the country code and the full number.",
};
