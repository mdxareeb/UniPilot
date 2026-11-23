/**
 * POST /api/mobile/tools/convert
 *
 * Multipart `.docx` / `.pptx` / `.txt` → a text-layered PDF. The response is
 * binary (`application/pdf`); every failure is sanitized JSON. The file is
 * bounded before extraction and the archive readers are bounded internally.
 */
import { authenticateBearer, noStoreJson } from "@/lib/auth/apiAuth";
import { MOBILE_TOOL_COPY } from "@/lib/data/mobileToolValues";
import {
  CONVERT_MAX_INPUT_BYTES,
  ConvertError,
  convertDocumentToPdf,
  convertedPdfName,
  detectConvertKind,
} from "@/lib/tools/documentConvert";

const MAX_REQUEST_BYTES = CONVERT_MAX_INPUT_BYTES + 512 * 1024;

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateBearer(request);
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
  if (detectConvertKind(file.name, file.type) === null) {
    return noStoreJson({ error: MOBILE_TOOL_COPY.CONVERT_UNSUPPORTED }, 400);
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await convertDocumentToPdf({
      bytes,
      name: file.name,
      mimeType: file.type || null,
    });
    const name = convertedPdfName(file.name);
    const body = new Uint8Array(pdf);
    return new Response(body.buffer as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Content-Length": String(body.byteLength),
        "Cache-Control": "no-store",
        "X-Unipilot-Filename": name,
      },
    });
  } catch (error) {
    if (error instanceof ConvertError) {
      if (error.code === "too_large") {
        return noStoreJson({ error: MOBILE_TOOL_COPY.CONVERT_TOO_LARGE }, 413);
      }
      if (error.code === "empty") {
        return noStoreJson({ error: MOBILE_TOOL_COPY.CONVERT_EMPTY }, 400);
      }
      return noStoreJson(
        { error: MOBILE_TOOL_COPY.CONVERT_UNSUPPORTED },
        400,
      );
    }
    return noStoreJson({ error: MOBILE_TOOL_COPY.CONVERT_FAILED }, 500);
  }
}
