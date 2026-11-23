/**
 * Server-side PDF text extraction for the universal converter.
 *
 * `pdfjs-dist` is the same maintained Mozilla parser the worker uses; the
 * legacy build is the one that runs in a plain Node/Next server. Imported
 * lazily so the client bundle never sees it.
 */
export type PdfTextExtraction = {
  pages: string[];
  pageCount: number;
};

export async function extractPdfTextPages(
  bytes: Uint8Array,
): Promise<PdfTextExtraction> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    disableFontFace: true,
  });

  const document = await task.promise;
  const pageCount = document.numPages;
  try {
    const pages: string[] = [];
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
