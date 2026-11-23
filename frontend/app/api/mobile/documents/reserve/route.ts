/**
 * POST /api/mobile/documents/reserve
 *
 * Validates a mobile upload and creates the pending `documents` row + storage
 * path in one step. The client uploads directly to `uploadPath` (owner-folder
 * RLS), then calls `/[id]/finalize`.
 */
import { authenticateBearer, noStoreJson } from "@/lib/auth/apiAuth";
import {
  DOCUMENT_MAX_BYTES,
  isDocumentMimeType,
  parseDocumentName,
} from "@/lib/data/documentValues";
import { reserveMobileDocument } from "@/lib/data/mobileDocuments";
import { MOBILE_TOOL_COPY } from "@/lib/data/mobileToolValues";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateBearer(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStoreJson({ error: MOBILE_TOOL_COPY.INVALID_RESERVE }, 400);
  }
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};

  const name = parseDocumentName(record.name);
  const mimeType = record.mimeType;
  const sizeBytes = record.sizeBytes;
  const subjectId = record.subjectId ?? null;

  if (!name || !isDocumentMimeType(mimeType)) {
    return noStoreJson({ error: MOBILE_TOOL_COPY.INVALID_RESERVE }, 400);
  }
  if (
    typeof sizeBytes !== "number" ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes <= 0
  ) {
    return noStoreJson({ error: MOBILE_TOOL_COPY.INVALID_RESERVE }, 400);
  }
  if (sizeBytes > DOCUMENT_MAX_BYTES) {
    return noStoreJson({ error: MOBILE_TOOL_COPY.TOO_LARGE }, 413);
  }
  if (subjectId !== null && typeof subjectId !== "string") {
    return noStoreJson({ error: MOBILE_TOOL_COPY.INVALID_RESERVE }, 400);
  }
  const trimmedSubject =
    typeof subjectId === "string" && subjectId.trim() !== ""
      ? subjectId.trim()
      : null;
  if (trimmedSubject !== null && !UUID_PATTERN.test(trimmedSubject)) {
    return noStoreJson({ error: MOBILE_TOOL_COPY.INVALID_RESERVE }, 400);
  }

  try {
    const result = await reserveMobileDocument(auth.user.client, auth.user.id, {
      name,
      mimeType,
      sizeBytes,
      subjectId: trimmedSubject,
    });

    if (result.status === "subject_not_found") {
      return noStoreJson({ error: MOBILE_TOOL_COPY.SUBJECT_NOT_FOUND }, 404);
    }
    if (result.status === "quota") {
      return noStoreJson({ error: MOBILE_TOOL_COPY.QUOTA }, 413);
    }
    return noStoreJson(
      { documentId: result.documentId, uploadPath: result.uploadPath },
      201,
    );
  } catch {
    return noStoreJson({ error: MOBILE_TOOL_COPY.GENERIC }, 500);
  }
}
