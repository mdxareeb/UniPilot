/**
 * POST /api/mobile/tools/ocr
 *
 * Two accepted shapes:
 * - multipart: `documentId` + one or more `pages` JPEG/PNG files (the mobile
 *   Image-to-PDF flow sends the same normalized pages it embedded);
 * - JSON `{ documentId }`: the stored PDF is read and sent to Gemini as inline
 *   PDF data.
 *
 * The route owns input bounds, the page/token ledger and the provider error
 * vocabulary; `runDocumentOcr` owns the database write and the honest
 * unconfigured/failed outcomes.
 */
import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";

import { authenticateBearer, noStoreJson } from "@/lib/auth/apiAuth";
import type { Database } from "@/lib/supabase/database.types";
import { MOBILE_TOOL_COPY } from "@/lib/data/mobileToolValues";
import {
  OCR_MAX_PAGES,
  OCR_MAX_PAGE_BYTES,
  OCR_MAX_PDF_BYTES,
  OCR_MAX_TOTAL_BYTES,
} from "@/lib/ai/ocr";
import { loadOcrDocument, type OcrDocumentRow } from "@/lib/data/mobileDocuments";
import {
  runDocumentOcr,
  type OcrImagesInput,
  type OcrPdfInput,
  type OcrRunResult,
} from "@/lib/tools/documentOcr";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REQUEST_BYTES = OCR_MAX_TOTAL_BYTES + 1024 * 1024;

export type OcrRouteDependencies = {
  authenticate: typeof authenticateBearer;
  runOcr: typeof runDocumentOcr;
};

const defaults: OcrRouteDependencies = {
  authenticate: authenticateBearer,
  runOcr: runDocumentOcr,
};

type ParsedInput =
  | { ok: true; input: OcrImagesInput | OcrPdfInput }
  | { ok: false; response: Response };

function bad(status: 400 | 404 | 413, error: string): ParsedInput {
  return { ok: false, response: noStoreJson({ error }, status) };
}

async function readMultipartForm(
  form: FormData,
  document: OcrDocumentRow,
): Promise<ParsedInput> {
  const rawId = form.get("documentId");
  if (typeof rawId !== "string" || !UUID_PATTERN.test(rawId)) {
    return bad(400, MOBILE_TOOL_COPY.INVALID_DOCUMENT);
  }
  if (rawId !== document.id) {
    return bad(404, MOBILE_TOOL_COPY.INVALID_DOCUMENT);
  }

  const files = form.getAll("pages");
  if (files.length === 0) {
    return bad(400, MOBILE_TOOL_COPY.INVALID_PAGES);
  }
  if (files.length > OCR_MAX_PAGES) {
    return bad(413, MOBILE_TOOL_COPY.OCR_TOO_MANY_PAGES);
  }

  const images: OcrImagesInput["images"] = [];
  let total = 0;
  for (const entry of files) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Blob).arrayBuffer !== "function"
    ) {
      return bad(400, MOBILE_TOOL_COPY.INVALID_PAGES);
    }
    const file = entry as File;
    const mimeType =
      file.type === "image/jpg"
        ? "image/jpeg"
        : file.type === "image/jpeg" || file.type === "image/png"
          ? file.type
          : null;
    if (mimeType === null) {
      return bad(400, MOBILE_TOOL_COPY.OCR_INVALID_TYPE);
    }
    if (file.size <= 0 || file.size > OCR_MAX_PAGE_BYTES) {
      return bad(413, MOBILE_TOOL_COPY.OCR_TOO_LARGE);
    }
    total += file.size;
    if (total > OCR_MAX_TOTAL_BYTES) {
      return bad(413, MOBILE_TOOL_COPY.OCR_TOO_LARGE);
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    images.push({
      base64: bytes.toString("base64"),
      mimeType,
      page: images.length + 1,
    });
  }

  return { ok: true, input: { kind: "images", images } };
}

async function readJsonBody(
  body: unknown,
  document: OcrDocumentRow,
): Promise<ParsedInput> {
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const documentId = record.documentId;
  if (typeof documentId !== "string" || !UUID_PATTERN.test(documentId)) {
    return bad(400, MOBILE_TOOL_COPY.INVALID_DOCUMENT);
  }
  if (documentId !== document.id) {
    return bad(404, MOBILE_TOOL_COPY.INVALID_DOCUMENT);
  }
  if (document.mime_type !== "application/pdf") {
    return bad(400, MOBILE_TOOL_COPY.OCR_INVALID_TYPE);
  }
  return {
    ok: true,
    input: { kind: "pdf", base64: "", pageCount: 0 },
  };
}

function objectResponse(result: OcrRunResult): Response {
  if (result.status === "not_found") {
    return noStoreJson({ error: MOBILE_TOOL_COPY.INVALID_DOCUMENT }, 404);
  }
  if (result.status === "limited") {
    return Response.json(
      { error: result.error },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(result.retryAfterSeconds),
        },
      },
    );
  }
  if (result.status === "too_large") {
    return noStoreJson({ error: result.error }, 413);
  }
  if (result.status === "empty") {
    return noStoreJson({ error: result.error }, 422);
  }
  if (result.status === "provider_error") {
    return noStoreJson(
      { error: result.error, retryable: result.retryable },
      result.retryable ? 503 : 502,
    );
  }
  if (result.status !== "ok") {
    return noStoreJson({ error: result.error }, 400);
  }
  if (!result.configured) {
    return noStoreJson({
      configured: false,
      status: "saved_not_searchable",
      error: result.error,
    });
  }
  return noStoreJson({
    configured: true,
    status: "indexed",
    pages: result.pages,
    characters: result.characters,
    tokens: result.tokens,
    alreadyIndexed: result.alreadyIndexed,
  });
}

export function createOcrPost(
  dependencies: OcrRouteDependencies = defaults,
): (request: Request) => Promise<Response> {
  return async function POST(request: Request): Promise<Response> {
    const auth = await dependencies.authenticate(request);
    if (!auth.ok) return auth.response;

    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
      return noStoreJson({ error: MOBILE_TOOL_COPY.OCR_TOO_LARGE }, 413);
    }

    const contentType = request.headers.get("content-type") ?? "";
    const isMultipart = contentType.includes("multipart/form-data");

    let form: FormData | null = null;
    let jsonBody: unknown = null;
    try {
      if (isMultipart) form = await request.formData();
      else jsonBody = await request.json();
    } catch {
      return noStoreJson({ error: MOBILE_TOOL_COPY.INVALID_DOCUMENT }, 400);
    }

    const rawId = isMultipart
      ? form?.get("documentId")
      : (jsonBody as { documentId?: unknown })?.documentId;
    const documentId = typeof rawId === "string" ? rawId.trim() : "";
    if (!UUID_PATTERN.test(documentId)) {
      return noStoreJson({ error: MOBILE_TOOL_COPY.INVALID_DOCUMENT }, 400);
    }

    try {
      const document = await loadOcrDocument(
        auth.user.client,
        auth.user.id,
        documentId,
      );
      if (document === null) {
        return noStoreJson({ error: MOBILE_TOOL_COPY.INVALID_DOCUMENT }, 404);
      }

      let parsed: ParsedInput;
      if (isMultipart && form !== null) {
        parsed = await readMultipartForm(form, document);
      } else {
        parsed = await readJsonBody(jsonBody, document);
        if (parsed.ok && parsed.input.kind === "pdf") {
          const pdf = await loadPdfInput(
            auth.user.client,
            document,
          );
          if (!pdf.ok) return pdf.response;
          parsed = { ok: true, input: pdf.input };
        }
      }
      if (!parsed.ok) return parsed.response;

      const result = await dependencies.runOcr({
        client: auth.user.client,
        userId: auth.user.id,
        documentId,
        input: parsed.input,
      });
      return objectResponse(result);
    } catch {
      return noStoreJson({ error: MOBILE_TOOL_COPY.OCR_FAILED }, 500);
    }
  };
}

async function loadPdfInput(
  client: SupabaseClient<Database>,
  document: OcrDocumentRow,
): Promise<
  | { ok: true; input: OcrPdfInput }
  | { ok: false; response: Response }
> {
  if (document.storage_path === null) {
    return { ok: false, response: noStoreJson({ error: MOBILE_TOOL_COPY.INVALID_DOCUMENT }, 400) };
  }
  const download = await client.storage
    .from("documents")
    .download(document.storage_path);
  if (download.error || !download.data) {
    return { ok: false, response: noStoreJson({ error: MOBILE_TOOL_COPY.INVALID_DOCUMENT }, 400) };
  }
  const bytes = new Uint8Array(await download.data.arrayBuffer());
  if (bytes.byteLength > OCR_MAX_PDF_BYTES) {
    return { ok: false, response: noStoreJson({ error: MOBILE_TOOL_COPY.OCR_TOO_LARGE }, 413) };
  }
  let pageCount: number;
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    pageCount = pdf.getPageCount();
  } catch {
    return { ok: false, response: noStoreJson({ error: MOBILE_TOOL_COPY.OCR_INVALID_TYPE }, 400) };
  }
  if (pageCount < 1 || pageCount > OCR_MAX_PAGES) {
    return { ok: false, response: noStoreJson({ error: MOBILE_TOOL_COPY.OCR_TOO_MANY_PAGES }, 413) };
  }
  return {
    ok: true,
    input: {
      kind: "pdf",
      base64: Buffer.from(bytes).toString("base64"),
      pageCount,
    },
  };
}

export const POST = createOcrPost();
