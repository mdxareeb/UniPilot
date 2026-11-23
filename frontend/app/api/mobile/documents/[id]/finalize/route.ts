/**
 * POST /api/mobile/documents/{id}/finalize
 *
 * Verifies the reserved object (owner path, real size, magic bytes), then
 * either enqueues `document.process` for a text-layered PDF or returns
 * `ocr_required` so the client can post its page images to `/tools/ocr`.
 */
import { authenticateBearer, noStoreJson } from "@/lib/auth/apiAuth";
import {
  finalizeMobileDocument,
  type FinalizeMode,
} from "@/lib/data/mobileDocuments";
import { MOBILE_TOOL_COPY } from "@/lib/data/mobileToolValues";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await authenticateBearer(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return noStoreJson({ error: MOBILE_TOOL_COPY.INVALID_DOCUMENT }, 404);
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text.trim() === "" ? {} : (JSON.parse(text) as unknown);
  } catch {
    return noStoreJson({ error: MOBILE_TOOL_COPY.INVALID_FINALIZE }, 400);
  }
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const rawMode = record.mode ?? "process";
  if (rawMode !== "process" && rawMode !== "ocr") {
    return noStoreJson({ error: MOBILE_TOOL_COPY.INVALID_MODE }, 400);
  }
  const mode: FinalizeMode = rawMode;

  try {
    const result = await finalizeMobileDocument(
      auth.user.client,
      auth.user.id,
      id,
      mode,
    );
    if (result.status === "not-found") {
      return noStoreJson({ error: MOBILE_TOOL_COPY.INVALID_DOCUMENT }, 404);
    }
    if (result.status === "rejected") {
      return noStoreJson({ error: MOBILE_TOOL_COPY.INVALID_FINALIZE }, 400);
    }
    return noStoreJson({ status: result.status });
  } catch {
    return noStoreJson({ error: MOBILE_TOOL_COPY.GENERIC }, 500);
  }
}
