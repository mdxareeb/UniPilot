/**
 * Tasks 24.5/24.6 — the OCR boundary.
 *
 * Status: **blocked, deliberately not faked.** Rasterising images and scanned
 * PDFs needs an OCR provider (Tesseract in the worker image, or a hosted API
 * such as Google Vision / AWS Textract / Azure Document Intelligence) plus a
 * credential that does not exist in this environment. This module is the
 * seam every future provider implements:
 *
 *     extractWithOcr(buffer, mimeType) -> { pages: string[], pageCount }
 *
 * Today it throws `OcrUnavailableError`, which the document handler converts
 * into the sanitized `OCR_UNAVAILABLE` copy and a permanent failure — the
 * user is told the truth ("isn't available yet") and no text is invented.
 * When a provider lands, only this file changes: the handler already routes
 * images here and the pipeline already stores whatever it returns.
 */
export class OcrUnavailableError extends Error {
  constructor(reason) {
    super(reason ?? "No OCR provider is configured.");
    this.name = "OcrUnavailableError";
  }
}

export const OCR_DEPENDENCY =
  "An OCR provider and credential (e.g. Tesseract in the worker image, or a hosted OCR API key).";

export async function extractWithOcr(_buffer, _mimeType) {
  throw new OcrUnavailableError(
    `OCR is not configured. Required dependency: ${OCR_DEPENDENCY}`,
  );
}
