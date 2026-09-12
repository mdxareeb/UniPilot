/**
 * Task 24.7 — text normalization and the scan heuristic.
 *
 * Normalization is deliberately conservative: 25.x embeds this text, so the
 * goal is to remove extraction artefacts (CRLF, hyphenation across line
 * breaks, ragged spacing, blank-line runs) without rewriting the author's
 * words. Everything is pure, so both the handler and the benchmark harness
 * normalize identically — the harness measures what the pipeline stores.
 */

/**
 * PDFs with (essentially) no text layer are scans; OCR is 24.6 (blocked).
 *
 * The threshold is deliberately tiny: extraction artefacts can leave a stray
 * character, but a *real* text PDF with a short page (a cover sheet, a
 * one-line handout) must never be misread as a scan — its few characters are
 * still its text. Only "no usable text at all" means "this needs OCR".
 */
const SCANNED_TEXT_THRESHOLD = 4;

export function normalizeText(raw) {
  if (typeof raw !== "string") return "";

  return (
    raw
      .normalize("NFKC")
      .replace(/\r\n?/g, "\n")
      // Join words hyphenated across a line break: "exam-\nple" → "example".
      .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2")
      // Collapse horizontal whitespace runs, keeping line structure.
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      // A page break should not read as three blank paragraphs.
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * True when a text-based format produced no text layer at all (a scan), not
 * merely "little" text. `isProbablyScanned("")` is true; a one-word page is
 * not.
 */
export function isProbablyScanned(text) {
  return normalizeText(text).replace(/\s/g, "").length < SCANNED_TEXT_THRESHOLD;
}
