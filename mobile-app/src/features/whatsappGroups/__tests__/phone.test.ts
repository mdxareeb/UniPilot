import {
  PHONE_REJECTION_COPY as WEB_COPY,
  sanitizePhone as webSanitize,
} from "../../../../../frontend/lib/data/groupSyncValues";
import { PHONE_REJECTION_COPY, sanitizePhone } from "../phone";

/**
 * The mobile sanitizer is a copy of the web one. These cases run BOTH, so any
 * drift between the two shows up as a failing test, not a rejected number.
 */
const CASES: unknown[] = [
  "919876543210",
  "+91 98765 43210",
  "00919876543210",
  "(91) 98765-43210",
  "+91-98765.43210",
  "  919876543210  ",
  "09876543210",
  "0",
  "91 98x76",
  "abc",
  "12345",
  "1234567",
  "12345678",
  "123456789012345",
  "1234567890123456",
  "",
  "   ",
  "+",
  "++919876543210",
  "+٩١٩٨٧٦٥٤٣٢١٠",
  null,
  undefined,
  919876543210,
  {},
];

describe("sanitizePhone", () => {
  it("returns digits-only E.164 with no +, spaces or dashes", () => {
    expect(sanitizePhone("+91 98765 43210")).toEqual({ ok: true, digits: "919876543210" });
    expect(sanitizePhone("00919876543210")).toEqual({ ok: true, digits: "919876543210" });
    expect(sanitizePhone("(91) 98765-43210")).toEqual({ ok: true, digits: "919876543210" });
  });

  it("refuses rather than guesses", () => {
    expect(sanitizePhone("09876543210")).toEqual({ ok: false, reason: "country_code" });
    expect(sanitizePhone("91 98x76")).toEqual({ ok: false, reason: "characters" });
    expect(sanitizePhone("12345")).toEqual({ ok: false, reason: "length" });
    expect(sanitizePhone("")).toEqual({ ok: false, reason: "empty" });
    expect(sanitizePhone(919876543210)).toEqual({ ok: false, reason: "empty" });
  });

  it.each(CASES.map((value) => [JSON.stringify(value) ?? "undefined", value]))(
    "matches the web sanitizer on %s",
    (_label, value) => {
      expect(sanitizePhone(value)).toEqual(webSanitize(value));
    },
  );

  it("uses the same rejection copy as the web, and never echoes input", () => {
    expect(PHONE_REJECTION_COPY).toEqual(WEB_COPY);
    for (const copy of Object.values(PHONE_REJECTION_COPY)) {
      expect(copy.replace("919876543210", "")).not.toMatch(/\d{5,}/);
    }
  });
});
