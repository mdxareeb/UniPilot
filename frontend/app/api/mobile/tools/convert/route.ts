/**
 * POST /api/mobile/tools/convert
 *
 * Multipart input plus an optional `targetFormat` (`pdf` default, `txt`, `md`,
 * `docx`). Supports PDF, DOCX, PPTX, TXT, MD, CSV and JSON within a 10 MiB
 * bound. Successful responses are binary with the target Content-Type and
 * filename; failures are sanitized JSON (400/413/415/429/502/503).
 *
 * The PDF default remains backwards compatible with the existing Phase 4
 * callers.
 */
import { authenticateBearer, noStoreJson } from "@/lib/auth/apiAuth";
import { MOBILE_TOOL_COPY } from "@/lib/data/mobileToolValues";
import {
  CONVERT_MAX_INPUT_BYTES,
  ConvertError,
  canConvert,
  convertDocument,
  detectConvertKind,
  isConvertTarget,
  type ConvertTarget,
} from "@/lib/tools/documentConvert";

const MAX_REQUEST_BYTES = CONVERT_MAX_INPUT_BYTES + 512 * 1024;

export type ConvertRouteDependencies = {
  authenticate: typeof authenticateBearer;
  convert: typeof convertDocument;
};

const defaults: ConvertRouteDependencies = {
  authenticate: authenticateBearer,
  convert: convertDocument,
};

export function createConvertPost(
  dependencies: ConvertRouteDependencies = defaults,
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
      return noStoreJson({ error: MOBILE_TOOL_COPY.CONVERT_UNSUPPORTED }, 400);
    }

    const upload = form.get("file");
    if (
      typeof upload !== "object" ||
      upload === null ||
      typeof (upload as Blob).arrayBuffer !== "function"
    ) {
      return noStoreJson({ error: MOBILE_TOOL_COPY.CONVERT_UNSUPPORTED }, 400);
    }
    const file = upload as File;
    if (file.size === 0) {
      return noStoreJson({ error: MOBILE_TOOL_COPY.CONVERT_UNSUPPORTED }, 400);
    }
    if (file.size > CONVERT_MAX_INPUT_BYTES) {
      return noStoreJson({ error: MOBILE_TOOL_COPY.CONVERT_TOO_LARGE }, 413);
    }

    const rawTarget = form.get("targetFormat") ?? "pdf";
    if (!isConvertTarget(rawTarget)) {
      return noStoreJson({ error: MOBILE_TOOL_COPY.CONVERT_UNSUPPORTED }, 415);
    }
    const targetFormat: ConvertTarget = rawTarget;

    const kind = detectConvertKind(file.name, file.type || null);
    if (kind === null || !canConvert(kind, targetFormat)) {
      return noStoreJson({ error: MOBILE_TOOL_COPY.CONVERT_UNSUPPORTED }, 415);
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await dependencies.convert({
        bytes,
        name: file.name,
        mimeType: file.type || null,
        targetFormat,
        userId: auth.user.id,
      });
      const body = new Uint8Array(result.bytes);
      return new Response(body.buffer as ArrayBuffer, {
        status: 200,
        headers: {
          "Content-Type": result.mimeType,
          "Content-Disposition": `attachment; filename="${result.fileName}"`,
          "Content-Length": String(body.byteLength),
          "Cache-Control": "no-store",
          "X-Unipilot-Filename": result.fileName,
        },
      });
    } catch (error) {
      if (error instanceof ConvertError) {
        if (error.code === "unsupported") {
          return noStoreJson(
            { error: MOBILE_TOOL_COPY.CONVERT_UNSUPPORTED },
            415,
          );
        }
        if (error.code === "too_large") {
          return noStoreJson(
            { error: MOBILE_TOOL_COPY.CONVERT_TOO_LARGE },
            413,
          );
        }
        if (error.code === "empty" || error.code === "unreadable") {
          return noStoreJson(
            { error: MOBILE_TOOL_COPY.CONVERT_EMPTY },
            400,
          );
        }
        if (error.code === "rate_limited") {
          return Response.json(
            { error: error.message },
            {
              status: 429,
              headers: {
                "Cache-Control": "no-store",
                ...(error.retryAfterSeconds === null
                  ? null
                  : { "Retry-After": String(error.retryAfterSeconds) }),
              },
            },
          );
        }
        if (
          error.code === "ocr_unconfigured" ||
          error.code === "provider_unavailable"
        ) {
          return noStoreJson(
            { error: error.message, retryable: error.code !== "ocr_unconfigured" },
            503,
          );
        }
        return noStoreJson({ error: error.message, retryable: false }, 502);
      }
      return noStoreJson({ error: MOBILE_TOOL_COPY.CONVERT_FAILED }, 500);
    }
  };
}

export const POST = createConvertPost();
