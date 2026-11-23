/**
 * POST /api/mobile/tools/pdf-probe
 *
 * A cheap text-layer check used by the studio's "Save & index" action. It runs
 * the same server-side `pdfjs-dist` extractor as the converter but never calls
 * Gemini, so a readable PDF can go straight to `document.process` while a
 * scanned one is routed to the ledgered OCR path. The response is sanitized
 * JSON: `{ hasText, pageCount, characters }`.
 */
import { authenticateBearer, noStoreJson } from "@/lib/auth/apiAuth";
import { MOBILE_TOOL_COPY } from "@/lib/data/mobileToolValues";
import { CONVERT_MAX_INPUT_BYTES } from "@/lib/tools/documentConvert";
import {
  extractPdfTextPages,
  pdfTextStats,
} from "@/lib/tools/pdfText";

const MAX_REQUEST_BYTES = CONVERT_MAX_INPUT_BYTES + 512 * 1024;

export type PdfProbeDependencies = {
  authenticate: typeof authenticateBearer;
  extract: typeof extractPdfTextPages;
};

const defaults: PdfProbeDependencies = {
  authenticate: authenticateBearer,
  extract: extractPdfTextPages,
};

export function createPdfProbePost(
  dependencies: PdfProbeDependencies = defaults,
): (request: Request) => Promise<Response> {
  return async function POST(request: Request): Promise<Response> {
    const auth = await dependencies.authenticate(request);
    if (!auth.ok) return auth.response;

    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
      return noStoreJson({ error: MOBILE_TOOL_COPY.CONVERT_TOO_LARGE }, 413);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return noStoreJson({ error: MOBILE_TOOL_COPY.CONVERT_UNSUPPORTED }, 415);
    }

    const upload = form.get("file");
    if (
      typeof upload !== "object" ||
      upload === null ||
      typeof (upload as Blob).arrayBuffer !== "function"
    ) {
      return noStoreJson({ error: MOBILE_TOOL_COPY.CONVERT_UNSUPPORTED }, 415);
    }
    const file = upload as File;
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return noStoreJson({ error: MOBILE_TOOL_COPY.CONVERT_UNSUPPORTED }, 415);
    }
    if (file.size <= 0) {
      return noStoreJson({ error: MOBILE_TOOL_COPY.CONVERT_EMPTY }, 400);
    }
    if (file.size > CONVERT_MAX_INPUT_BYTES) {
      return noStoreJson({ error: MOBILE_TOOL_COPY.CONVERT_TOO_LARGE }, 413);
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const extraction = await dependencies.extract(bytes);
      const stats = pdfTextStats(extraction.pages);
      return noStoreJson({
        hasText: stats.hasText,
        pageCount: extraction.pageCount,
        characters: stats.characters,
      });
    } catch {
      return noStoreJson({ error: MOBILE_TOOL_COPY.CONVERT_EMPTY }, 400);
    }
  };
}

export const POST = createPdfProbePost();
