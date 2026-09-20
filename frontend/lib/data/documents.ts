/**
 * The documents service (Tasks 23.1–23.13) — the only module that reads or
 * writes a student's document rows and their private storage objects.
 *
 * The repo pattern of `lib/data/tasks.ts` / `events.ts`: server-only, typed
 * against the generated `Database` view, using the request-scoped cookie
 * client, so the authenticated session identifies the caller and the
 * owner-only RLS policies on `documents` (plus the owner-folder policies on
 * `storage.objects`, 23.1) are the enforcement layer. Every query is
 * additionally scoped by `user_id`; the service role is never used.
 *
 * Upload ordering (decided here, 23.2/23.8): the reserve write creates the
 * row and the storage path in one step, the browser uploads directly to that
 * reserved path, and `finalizeDocument` verifies the object exists in the
 * caller's folder, re-checks its real size and magic bytes, and updates the
 * row. Any failure after a reservation discards the object (best effort) and
 * the row, so no partial upload leaves a readable record behind.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { readProfileTimeZone } from "./profileTime";
import {
  DOCUMENT_BUCKET,
  DOCUMENT_FREE_MAX_COUNT,
  DOCUMENT_FREE_MAX_TOTAL_BYTES,
  DOCUMENT_MAX_BYTES,
  documentRowToItem,
  isDocumentMimeType,
  magicBytesMatch,
  pathBelongsToUser,
  storagePathFor,
  type DocumentItem,
  type DocumentUploadDraft,
} from "./documentValues";

const DOCUMENT_COLUMNS =
  "id, name, storage_path, mime_type, size_bytes, page_count, status, error_message, created_at, source";

/** How many bytes the finalize sniff reads; every signature is ≤ 8. */
const MAGIC_SNIFF_BYTES = 16;

/** What the free-tier guard measures (23.12). */
export type DocumentUsage = {
  count: number;
  totalBytes: number;
};

/** `listDocuments`: the caller's documents, newest first. */
export async function listDocuments(userId: string): Promise<DocumentItem[]> {
  const supabase = await createClient();

  const [timeZone, result] = await Promise.all([
    readProfileTimeZone(supabase, userId),
    supabase
      .from("documents")
      .select(DOCUMENT_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true }),
  ]);

  if (result.error) throw new Error("Failed to load documents.");
  return (result.data ?? []).map((row) => documentRowToItem(row, timeZone));
}

/** One owned document by immutable id, or null when it is not ours. */
export async function getDocument(
  userId: string,
  documentId: string,
): Promise<DocumentItem | null> {
  const supabase = await createClient();

  const [timeZone, result] = await Promise.all([
    readProfileTimeZone(supabase, userId),
    supabase
      .from("documents")
      .select(DOCUMENT_COLUMNS)
      .eq("id", documentId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (result.error) throw new Error("Failed to load document.");
  return result.data ? documentRowToItem(result.data, timeZone) : null;
}

/**
 * The free guard's inputs. The count/sum read fetches at most the cap's worth
 * of size values, which is the honest ceiling this tier can hold; a plan with
 * a different cap passes its own numbers once billing exists (49.x).
 */
export async function getDocumentUsage(userId: string): Promise<DocumentUsage> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("documents")
    .select("id, size_bytes")
    .eq("user_id", userId)
    .limit(DOCUMENT_FREE_MAX_COUNT + 1);

  if (error) throw new Error("Failed to read document usage.");

  const rows = data ?? [];
  return {
    count: rows.length,
    totalBytes: rows.reduce((sum, row) => sum + (row.size_bytes ?? 0), 0),
  };
}

/** Quota rejected the reservation; the action maps it to the sanitized copy. */
export type ReserveDocumentResult =
  | { status: "ok"; document: DocumentItem; uploadPath: string }
  | { status: "quota" };

/**
 * 23.2 — reserve: one row and one storage path, created together. The object
 * does not exist yet; `finalizeDocument` is what turns the reservation into a
 * readable document, and every failure path discards both halves.
 */
export async function reserveDocument(
  userId: string,
  draft: DocumentUploadDraft,
): Promise<ReserveDocumentResult> {
  const supabase = await createClient();

  const [timeZone, usage] = await Promise.all([
    readProfileTimeZone(supabase, userId),
    getDocumentUsage(userId),
  ]);

  if (
    usage.count >= DOCUMENT_FREE_MAX_COUNT ||
    usage.totalBytes + draft.sizeBytes > DOCUMENT_FREE_MAX_TOTAL_BYTES
  ) {
    return { status: "quota" };
  }

  const id = crypto.randomUUID();
  const uploadPath = storagePathFor(userId, id, draft.name);

  const { data, error } = await supabase
    .from("documents")
    .insert({
      id,
      user_id: userId,
      name: draft.name,
      mime_type: draft.mimeType,
      size_bytes: draft.sizeBytes,
      storage_path: uploadPath,
      status: "uploaded",
    })
    .select(DOCUMENT_COLUMNS)
    .single();

  if (error || !data) throw new Error("Failed to reserve document.");

  return {
    status: "ok",
    document: documentRowToItem(data, timeZone),
    uploadPath,
  };
}

/** Finalize's three honest outcomes; "rejected" cleaned up after itself. */
export type FinalizeDocumentResult =
  | { status: "ok"; document: DocumentItem }
  | { status: "not-found" }
  | { status: "rejected" };

/**
 * 23.2/23.4/23.5 — verify and finalize a reservation: the object must exist
 * under the caller's own prefix, its real size must be within the cap, and
 * its leading bytes must match the declared type. A rejected object and its
 * row are discarded before the caller hears about it; an accepted one keeps
 * the database's `size_bytes` honest with the object Storage actually holds.
 */
export async function finalizeDocument(
  userId: string,
  documentId: string,
): Promise<FinalizeDocumentResult> {
  const supabase = await createClient();
  const timeZone = await readProfileTimeZone(supabase, userId);

  const { data: row, error } = await supabase
    .from("documents")
    .select(DOCUMENT_COLUMNS)
    .eq("id", documentId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error("Failed to load document.");
  if (!row) return { status: "not-found" };

  const path = row.storage_path;
  if (path === null || !pathBelongsToUser(path, userId)) {
    await discardReservation(supabase, userId, documentId, path);
    return { status: "rejected" };
  }

  const info = await supabase.storage.from(DOCUMENT_BUCKET).info(path);
  const size = info.data?.size ?? 0;
  if (info.error || size <= 0 || size > DOCUMENT_MAX_BYTES) {
    await discardReservation(supabase, userId, documentId, path);
    return { status: "rejected" };
  }

  let matches = false;
  if (isDocumentMimeType(row.mime_type)) {
    const download = await supabase.storage.from(DOCUMENT_BUCKET).download(path);
    if (!download.error && download.data) {
      const head = new Uint8Array(
        await download.data.slice(0, MAGIC_SNIFF_BYTES).arrayBuffer(),
      );
      matches = magicBytesMatch(head, row.mime_type);
    }
  }
  if (!matches) {
    await discardReservation(supabase, userId, documentId, path);
    return { status: "rejected" };
  }

  const { data: settled, error: updateError } = await supabase
    .from("documents")
    .update({ size_bytes: size })
    .eq("id", documentId)
    .eq("user_id", userId)
    .select(DOCUMENT_COLUMNS)
    .maybeSingle();

  if (updateError || !settled) {
    await discardReservation(supabase, userId, documentId, path);
    return { status: "rejected" };
  }

  return { status: "ok", document: documentRowToItem(settled, timeZone) };
}

/**
 * 23.8 — the reservation's cleanup: object first (best effort), then the row,
 * so a failure can never leave an object whose record still claims a size.
 * Safe to call for a reservation that never uploaded anything.
 */
async function discardReservation(
  supabase: SupabaseClient<Database>,
  userId: string,
  documentId: string,
  path: string | null,
): Promise<void> {
  if (path !== null && pathBelongsToUser(path, userId)) {
    try {
      await supabase.storage.from(DOCUMENT_BUCKET).remove([path]);
    } catch {
      // Best effort: the row below still goes, and the orphan sweep (29.x)
      // is the backstop for a Storage outage mid-discard.
    }
  }

  try {
    await supabase
      .from("documents")
      .delete()
      .eq("id", documentId)
      .eq("user_id", userId);
  } catch {
    // Same posture: never surface a cleanup failure as success.
  }
}

/** The client's abort path after a failed direct upload. */
export async function abortDocumentReservation(
  userId: string,
  documentId: string,
): Promise<void> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("id", documentId)
    .eq("user_id", userId)
    .maybeSingle();

  await discardReservation(supabase, userId, documentId, data?.storage_path ?? null);
}

/**
 * 23.10 — display-name rename. The storage path never moves: the object is
 * addressed by the immutable id, so a rename is one row update.
 */
export async function renameDocument(
  userId: string,
  documentId: string,
  name: string,
): Promise<DocumentItem | null> {
  const supabase = await createClient();
  const timeZone = await readProfileTimeZone(supabase, userId);

  const { data, error } = await supabase
    .from("documents")
    .update({ name })
    .eq("id", documentId)
    .eq("user_id", userId)
    .select(DOCUMENT_COLUMNS)
    .maybeSingle();

  if (error) throw new Error("Failed to rename document.");
  return data ? documentRowToItem(data, timeZone) : null;
}

/**
 * 24.2 — the finalize hand-off: once a document's processing job is enqueued
 * it is honestly "indexing", so the status flips before the worker even
 * claims the job and the UI never shows a settled upload that silently isn't
 * queued. The worker flips it to `indexed`/`failed` from there.
 */
export async function markDocumentIndexing(
  userId: string,
  documentId: string,
): Promise<DocumentItem | null> {
  const supabase = await createClient();
  const timeZone = await readProfileTimeZone(supabase, userId);

  const { data, error } = await supabase
    .from("documents")
    .update({ status: "indexing", error_message: null })
    .eq("id", documentId)
    .eq("user_id", userId)
    .select(DOCUMENT_COLUMNS)
    .maybeSingle();

  if (error) throw new Error("Failed to mark document indexing.");
  return data ? documentRowToItem(data, timeZone) : null;
}

/** What a preview surface may do with a document (18.11). */
export type DocumentPreview = {
  /** Short-lived signed URL into the private bucket (60 seconds). */
  url: string;
  /**
   * `inline` for types a browser renders safely in place (PDF via its own
   * viewer, PNG/JPEG as images); `download` for everything else (DOCX), where
   * the signed URL carries `Content-Disposition: attachment` so no OOXML is
   * ever handed to a renderer.
   */
  mode: "inline" | "download";
};

/**
 * 18.11 — a short-lived, owner-scoped preview URL. The bucket stays private:
 * the object is addressed with a 60-second signed URL minted through the
 * caller's session (RLS authorizes the object), the server's content type is
 * the stored MIME type, and DOCX-class types are forced to an attachment
 * download (23.13's posture: nothing unknown is rendered). Null when no owned
 * row matched or the row has no object yet.
 */
export async function getDocumentPreview(
  userId: string,
  documentId: string,
): Promise<DocumentPreview | null> {
  const supabase = await createClient();

  const { data: row, error } = await supabase
    .from("documents")
    .select("id, name, storage_path, mime_type")
    .eq("id", documentId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error("Failed to load document.");
  if (!row || row.storage_path === null) return null;

  const inline =
    row.mime_type === "application/pdf" ||
    row.mime_type === "image/png" ||
    row.mime_type === "image/jpeg";

  const { data, error: signError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(
      row.storage_path,
      60,
      inline ? { download: false } : { download: row.name },
    );

  if (signError || !data?.signedUrl) {
    throw new Error("Failed to sign document URL.");
  }

  return { url: data.signedUrl, mode: inline ? "inline" : "download" };
}

/**
 * 23.9 — delete: the storage object first, then the row. `document_chunks`
 * cascades from the row delete. False when no owned row matched; a Storage
 * failure throws before the row is touched, so the document stays deletable.
 */
export async function deleteDocument(
  userId: string,
  documentId: string,
): Promise<boolean> {
  const supabase = await createClient();

  const { data: row, error: readError } = await supabase
    .from("documents")
    .select("id, storage_path")
    .eq("id", documentId)
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) throw new Error("Failed to load document.");
  if (!row) return false;

  if (row.storage_path !== null && pathBelongsToUser(row.storage_path, userId)) {
    const removed = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .remove([row.storage_path]);
    if (removed.error) throw new Error("Failed to remove document object.");
  }

  const { data: deleted, error: deleteError } = await supabase
    .from("documents")
    .delete()
    .eq("id", documentId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (deleteError) throw new Error("Failed to delete document.");
  return deleted !== null;
}
