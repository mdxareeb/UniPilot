/**
 * Task 24.3 — PDF text extraction (pdfjs-dist, the maintained Mozilla
 * parser; the legacy build is the one that runs in plain Node).
 *
 * Returns one string per page, in order — the unit 24.8 stores and 25.x will
 * re-chunk for embeddings. A parse failure throws: the handler maps it to a
 * retryable processing error unless the failure is clearly the file's fault
 * (the handler's sanitized copy covers both cases without leaking the
 * library's message).
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function extractPdf(buffer) {
  const task = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  });

  const document = await task.promise;
  const pageCount = document.numPages;

  try {
    const pages = [];
    for (let number = 1; number <= pageCount; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .trim(),
      );
      page.cleanup();
    }
    return { pages, pageCount };
  } finally {
    await task.destroy();
  }
}
