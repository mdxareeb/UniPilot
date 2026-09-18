/**
 * Task D3 — the owner-gated image upload proxy (spec §5.4, §7.2, §7.4).
 *
 * POST /api/presentation/{id}/images
 *
 * The browser can never hold `PRESENTON_API_KEY`, and a Server Action is the
 * wrong transport for image bytes (its default request bound is small), so one
 * multipart POST travels through this Node route:
 *
 * 1. session gate — no session → 401;
 * 2. owner read (`getPresentation`, RLS) — not owned/unknown/malformed →
 *    404 before any engine call, with no existence oracle;
 * 3. missing row engine id → 404;
 * 4. missing/empty file, non-image media type or a disallowed extension →
 *    400/415; a bounded size (`PRESENTON_IMAGE_UPLOAD_MAX_BYTES`, UniPilot's
 *    own bound — the engine documents none) → 413, with an oversized declared
 *    body refused before the multipart parse and the exact file size checked
 *    after it;
 * 5. adapter upload with the adapter's bearer, timeout and classification —
 *    the engine's own 4xx (an unreadable image, an unsupported format) → 400,
 *    engine/transport failure → 502 with sanitized copy;
 * 6. success returns the normalized created image (`{ image }` — no engine
 *    filesystem path) and mints the short-lived insert permit that lets the
 *    editor's insert validation accept it before the slide save references it.
 *
 * The adapter (not this handler) owns every Presenton detail; this file is
 * only the gate and the multipart boundary.
 */
import { sessionUser } from "@/lib/auth/session";
import { PRESENTATION_NOT_FOUND_ERROR } from "@/lib/data/presentationErrors";
import { getPresentation } from "@/lib/data/presentations";
import { grantImageInsertPermit } from "@/lib/data/presentationImageScope";
import { isPresentationUuid } from "@/lib/data/presentationValues";
import {
  PRESENTON_IMAGE_UPLOAD_EXTENSIONS,
  PRESENTON_IMAGE_UPLOAD_MAX_BYTES,
  PresentonError,
  uploadPresentationImage,
} from "@/lib/integrations/presenton";

const INVALID_UPLOAD_ERROR = "Choose an image file to upload.";
const UNSUPPORTED_IMAGE_ERROR =
  "That file isn't a supported image type (PNG, JPEG, GIF, WebP, AVIF, BMP or TIFF).";
const TOO_LARGE_ERROR = "That image is too large to upload.";
const IMAGE_REJECTED_ERROR =
  "The presentation service didn't accept that image. Try a different file.";
const IMAGE_UNAVAILABLE_ERROR =
  "The image couldn't be uploaded right now. Try again in a moment.";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/** Engine 4xx (a rejected file, a bad route) → 400; anything else → 502. */
function engineFailure(error: unknown): Response {
  if (error instanceof PresentonError && error.code === "rejected") {
    return jsonError(IMAGE_REJECTED_ERROR, 400);
  }
  return jsonError(IMAGE_UNAVAILABLE_ERROR, 502);
}

/** One multipart part must be a real file with bytes, not a text field. */
function isUploadedFile(value: unknown): value is File {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { arrayBuffer?: unknown; size?: unknown };
  return (
    typeof candidate.arrayBuffer === "function" &&
    typeof candidate.size === "number"
  );
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { user } = await sessionUser();
  if (!user) {
    return jsonError("Sign in to add images to this presentation.", 401);
  }

  const { id } = await params;
  const presentationId = id.trim();
  if (!isPresentationUuid(presentationId)) {
    return jsonError(PRESENTATION_NOT_FOUND_ERROR, 404);
  }

  let presentation: Awaited<ReturnType<typeof getPresentation>>;
  try {
    presentation = await getPresentation(user.id, presentationId);
  } catch {
    // A data-store failure is not "not found": answer the same JSON envelope
    // every other refusal uses instead of letting Next render an HTML 500.
    return jsonError(IMAGE_UNAVAILABLE_ERROR, 500);
  }
  if (!presentation) {
    return jsonError(PRESENTATION_NOT_FOUND_ERROR, 404);
  }

  const presentonPresentationId = presentation.presentonPresentationId;
  if (!presentonPresentationId) {
    return jsonError(PRESENTATION_NOT_FOUND_ERROR, 404);
  }

  /* Cheap memory bound before multipart parsing: a declared body beyond the
     file bound plus framing slack can never hold an acceptable file. The
     exact per-file check still runs after parsing. */
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > PRESENTON_IMAGE_UPLOAD_MAX_BYTES + 256 * 1024
  ) {
    return jsonError(TOO_LARGE_ERROR, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(INVALID_UPLOAD_ERROR, 400);
  }

  const file = form.get("file");
  if (!isUploadedFile(file) || file.size === 0) {
    return jsonError(INVALID_UPLOAD_ERROR, 400);
  }
  if (file.size > PRESENTON_IMAGE_UPLOAD_MAX_BYTES) {
    return jsonError(TOO_LARGE_ERROR, 413);
  }
  const mediaType = typeof file.type === "string" ? file.type : "";
  if (mediaType !== "" && !mediaType.startsWith("image/")) {
    return jsonError(UNSUPPORTED_IMAGE_ERROR, 415);
  }
  const name = typeof file.name === "string" ? file.name : "";
  if (
    !(PRESENTON_IMAGE_UPLOAD_EXTENSIONS as readonly string[]).includes(
      extensionOf(name),
    )
  ) {
    return jsonError(UNSUPPORTED_IMAGE_ERROR, 415);
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const image = await uploadPresentationImage({
      name,
      mimeType: mediaType,
      bytes,
    });
    /* The caller's own upload is insertable before the slide save references
       it: mint a short-lived permit for the insert validation (review fix). */
    grantImageInsertPermit(user.id, image.fileUrl);
    return Response.json({ image }, { status: 201 });
  } catch (error) {
    return engineFailure(error);
  }
}
