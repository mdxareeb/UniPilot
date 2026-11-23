/**
 * Ask AI OCR's pure text boundary.
 *
 * Gemini returns page text as prose; this module normalizes extraction
 * artefacts (CRLF, ragged spacing, hyphenation) exactly as the document
 * pipeline does, then turns readable pages into `document_chunks` rows. One
 * chunk per page keeps the citation's page provenance exact.
 */

export const OCR_MAX_PAGES = 20;
export const OCR_MAX_PAGE_BYTES = 4 * 1024 * 1024;
export const OCR_MAX_TOTAL_BYTES = 16 * 1024 * 1024;
export const OCR_MAX_PDF_BYTES = 16 * 1024 * 1024;
export const OCR_MAX_PAGE_CHARS = 200_000;
export const OCR_MAX_TEXT_CHARS = 2_000_000;

export type OcrPage = { page: number; text: string };
export type OcrChunk = {
  chunk_index: number;
  page: number;
  content: string;
};

export class OcrError extends Error {
  readonly code:
    | "not_configured"
    | "unreadable"
    | "too_large"
    | "empty"
    | "rate_limited"
    | "unavailable"
    | "rejected";

  constructor(code: OcrError["code"], message: string) {
    super(message);
    this.name = "OcrError";
    this.code = code;
  }
}

export const OCR_COPY = {
  NOT_CONFIGURED:
    "The AI OCR service isn't configured on this server, so this PDF can't be made searchable yet.",
  UNREADABLE:
    "No readable text could be extracted from these pages. Try clearer photos or a text-based PDF.",
  TOO_LARGE: `OCR is limited to ${OCR_MAX_PAGES} pages and ${Math.round(OCR_MAX_TOTAL_BYTES / (1024 * 1024))} MB per document.`,
  EMPTY: "The AI couldn't read any text from this file.",
  RATE_LIMITED:
    "You've reached the OCR limit for now. Try again in a minute.",
  UNAVAILABLE:
    "The AI OCR service is temporarily unavailable. Try again in a moment.",
  REJECTED:
    "The AI OCR service rejected these pages. Try clearer photos or a text-based PDF.",
  FAILED: "We couldn't make this PDF searchable. Try again.",
  INVALID_DOCUMENT: "That document no longer exists.",
  INVALID_PAGES: "Add at least one page image or a PDF to read.",
  INVALID_TYPE: "OCR accepts JPEG/PNG page images or a PDF.",
} as const;

/** Mirror of the worker's normalization, kept pure for direct tests. */
export function normalizeOcrText(raw: string): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateAtWord(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const slice = text.slice(0, limit);
  const boundary = slice.lastIndexOf(" ");
  return (boundary > limit * 0.7 ? slice.slice(0, boundary) : slice).trimEnd();
}

/** Normalize, bound and order pages into replaceable chunk rows. */
export function buildOcrChunks(pages: readonly OcrPage[]): OcrChunk[] {
  let total = 0;
  const chunks: OcrChunk[] = [];
  for (const item of [...pages].sort((a, b) => a.page - b.page)) {
    const page = Math.max(1, Math.floor(item.page));
    const text = truncateAtWord(normalizeOcrText(item.text), OCR_MAX_PAGE_CHARS);
    if (text === "") continue;
    total += text.length;
    if (total > OCR_MAX_TEXT_CHARS) {
      throw new OcrError("too_large", OCR_COPY.TOO_LARGE);
    }
    chunks.push({
      chunk_index: chunks.length,
      page,
      content: text,
    });
  }
  return chunks;
}
