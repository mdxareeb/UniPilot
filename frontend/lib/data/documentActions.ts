"use server";

/**
 * The documents Server Actions (Tasks 23.2–23.13), the repo pattern of
 * `lib/data/taskActions.ts` / `eventActions.ts`: the gate runs first and
 * outside the try block, untrusted payloads are parsed and validated on the
 * server, the service does the work, and only sanitized copy ever travels
 * back to the client.
 *
 * The gate is `requireOnboardedUser("/documents")` — the same session +
 * completion check the page itself runs. Ownership comes from the session
 * (`user.id`); RLS on `documents` and the owner-folder policies on
 * `storage.objects` are the enforcement layer, and the service's
 * request-scoped client is the authenticated one — the service role is never
 * used here.
 *
 * The upload pipeline speaks two extra verbs beyond CRUD: `reserve` (row +
 * path, before the browser's direct upload) and `finalize` (verify the
 * object, then trust the reservation). `abort` is the client's cleanup path
 * for an upload that never completed.
 */
import { revalidatePath } from "next/cache";
import { requireOnboardedUser } from "@/lib/onboarding/gate";
import { enqueueJob } from "./jobs";
import {
  DOCUMENT_DELETE_ERROR,
  DOCUMENT_INVALID_INPUT_ERROR,
  DOCUMENT_NOT_FOUND_ERROR,
  DOCUMENT_PREVIEW_ERROR,
  DOCUMENT_QUOTA_ERROR,
  DOCUMENT_RENAME_ERROR,
  DOCUMENT_SAVE_ERROR,
} from "./documentErrors";
import {
  parseDocumentName,
  parseDocumentUpload,
  type DocumentItem,
} from "./documentValues";
import {
  abortDocumentReservation,
  deleteDocument,
  finalizeDocument,
  getDocument,
  getDocumentPreview,
  markDocumentIndexing,
  renameDocument,
  reserveDocument,
  type DocumentPreview,
} from "./documents";

export type DocumentActionResult = {
  error: string | null;
  /** The settled row on success; null on every failure. */
  document: DocumentItem | null;
};

export type DocumentReserveResult = {
  error: string | null;
  /** The reserved row's id and the object path the browser must upload to. */
  upload: { id: string; path: string } | null;
};

export type DocumentDeleteResult = {
  error: string | null;
};

export type DocumentPreviewResult = {
  error: string | null;
  preview: DocumentPreview | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseDocumentId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return UUID_PATTERN.test(id) ? id : null;
}

/** 23.2 — reserve a row + object path for the browser's direct upload. */
export async function reserveDocumentAction(
  payload: unknown,
): Promise<DocumentReserveResult> {
  const user = await requireOnboardedUser("/documents");

  const draft = parseDocumentUpload(payload);
  if (draft === null) {
    return { error: DOCUMENT_INVALID_INPUT_ERROR, upload: null };
  }

  let reserved: Awaited<ReturnType<typeof reserveDocument>>;
  try {
    reserved = await reserveDocument(user.id, draft);
  } catch {
    return { error: DOCUMENT_SAVE_ERROR, upload: null };
  }

  if (reserved.status === "quota") {
    return { error: DOCUMENT_QUOTA_ERROR, upload: null };
  }

  return {
    error: null,
    upload: { id: reserved.document.id, path: reserved.uploadPath },
  };
}

/**
 * 23.2/23.4/23.5 — verify the uploaded object and settle the reservation.
 * Invalid objects were already discarded by the service; the caller sees the
 * sanitized copy and no row survives either way.
 */
export async function finalizeDocumentAction(
  documentId: unknown,
): Promise<DocumentActionResult> {
  const user = await requireOnboardedUser("/documents");

  const id = parseDocumentId(documentId);
  if (id === null) return { error: DOCUMENT_NOT_FOUND_ERROR, document: null };

  let result: Awaited<ReturnType<typeof finalizeDocument>>;
  try {
    result = await finalizeDocument(user.id, id);
  } catch {
    return { error: DOCUMENT_SAVE_ERROR, document: null };
  }

  if (result.status === "not-found") {
    return { error: DOCUMENT_NOT_FOUND_ERROR, document: null };
  }
  if (result.status === "rejected") {
    return { error: DOCUMENT_INVALID_INPUT_ERROR, document: null };
  }

  revalidatePath("/documents");

  // 24.2 — queue the processing pass. The document is settled either way: a
  // queue write that fails leaves it `uploaded` (visible and honest) rather
  // than pretending it was processed; re-upload or a 29.x sweep is the
  // recovery path.
  try {
    await enqueueJob(
      "document.process",
      { documentId: result.document.id },
      { userId: user.id },
    );
    const indexing = await markDocumentIndexing(user.id, id);
    return { error: null, document: indexing ?? result.document };
  } catch {
    return { error: null, document: result.document };
  }
}

/** The client's cleanup after a direct upload that never completed. */
export async function abortDocumentAction(
  documentId: unknown,
): Promise<DocumentDeleteResult> {
  const user = await requireOnboardedUser("/documents");

  const id = parseDocumentId(documentId);
  if (id === null) return { error: DOCUMENT_NOT_FOUND_ERROR };

  try {
    await abortDocumentReservation(user.id, id);
  } catch {
    return { error: DOCUMENT_SAVE_ERROR };
  }

  return { error: null };
}

/** 23.10 — rename the display name; the storage path stays put. */
export async function renameDocumentAction(
  documentId: unknown,
  name: unknown,
): Promise<DocumentActionResult> {
  const user = await requireOnboardedUser("/documents");

  const id = parseDocumentId(documentId);
  const parsedName = parseDocumentName(name);
  if (id === null || parsedName === null) {
    return { error: DOCUMENT_INVALID_INPUT_ERROR, document: null };
  }

  let document: DocumentItem | null;
  try {
    document = await renameDocument(user.id, id, parsedName);
  } catch {
    return { error: DOCUMENT_RENAME_ERROR, document: null };
  }

  if (document === null) {
    return { error: DOCUMENT_NOT_FOUND_ERROR, document: null };
  }

  revalidatePath("/documents");
  return { error: null, document };
}

/** 23.9 — remove the object, then the row (chunks cascade). */
export async function deleteDocumentAction(
  documentId: unknown,
): Promise<DocumentDeleteResult> {
  const user = await requireOnboardedUser("/documents");

  const id = parseDocumentId(documentId);
  if (id === null) return { error: DOCUMENT_NOT_FOUND_ERROR };

  let deleted: boolean;
  try {
    deleted = await deleteDocument(user.id, id);
  } catch {
    return { error: DOCUMENT_DELETE_ERROR };
  }

  if (!deleted) return { error: DOCUMENT_NOT_FOUND_ERROR };

  revalidatePath("/documents");
  return { error: null };
}

/**
 * 18.11 — a short-lived signed URL for the preview surface. The bucket's
 * privacy is unchanged (23.1); this action only mints the URL through the
 * owner's session, and the service decides inline vs download-only by MIME.
 */
export async function previewDocumentAction(
  documentId: unknown,
): Promise<DocumentPreviewResult> {
  const user = await requireOnboardedUser("/documents");

  const id = parseDocumentId(documentId);
  if (id === null) return { error: DOCUMENT_NOT_FOUND_ERROR, preview: null };

  let preview: DocumentPreview | null;
  try {
    preview = await getDocumentPreview(user.id, id);
  } catch {
    return { error: DOCUMENT_PREVIEW_ERROR, preview: null };
  }

  if (preview === null) {
    return { error: DOCUMENT_NOT_FOUND_ERROR, preview: null };
  }
  return { error: null, preview };
}

/**
 * 18.15 — the user-facing retry: a failed document is put back into
 * `indexing` and a fresh `document.process` job is enqueued, so the 29.1
 * runner owns the attempt/backoff/dead-letter policy as it always does. Only
 * `failed` documents re-enqueue; any other status is returned unchanged
 * (idempotent — a double click cannot queue two processing runs).
 */
export async function retryDocumentAction(
  documentId: unknown,
): Promise<DocumentActionResult> {
  const user = await requireOnboardedUser("/documents");

  const id = parseDocumentId(documentId);
  if (id === null) return { error: DOCUMENT_NOT_FOUND_ERROR, document: null };

  let current: DocumentItem | null;
  try {
    current = await getDocument(user.id, id);
  } catch {
    return { error: DOCUMENT_SAVE_ERROR, document: null };
  }

  if (current === null) {
    return { error: DOCUMENT_NOT_FOUND_ERROR, document: null };
  }
  if (current.statusValue !== "failed") {
    return { error: null, document: current };
  }

  try {
    await enqueueJob(
      "document.process",
      { documentId: id },
      { userId: user.id },
    );
    const indexing = await markDocumentIndexing(user.id, id);
    revalidatePath("/documents");
    return { error: null, document: indexing ?? current };
  } catch {
    return { error: DOCUMENT_SAVE_ERROR, document: null };
  }
}
