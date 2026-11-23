/**
 * The mobile documents channel: reserve → direct upload → finalize.
 *
 * This mirrors the web's 23.2/23.4/23.8 contract without the cookie client:
 * the Bearer route passes the caller's own JWT, so owner RLS and the bucket's
 * owner-folder policies remain the authority. The service role is used only to
 * enqueue the `document.process` job, which has no client write policy.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { enqueueJob } from "./jobs";
import {
  DOCUMENT_BUCKET,
  DOCUMENT_FREE_MAX_COUNT,
  DOCUMENT_FREE_MAX_TOTAL_BYTES,
  DOCUMENT_MAX_BYTES,
  isDocumentMimeType,
  magicBytesMatch,
  parseDocumentName,
  pathBelongsToUser,
  storagePathFor,
  type DocumentMimeType,
} from "./documentValues";

type Client = SupabaseClient<Database>;

const MAGIC_SNIFF_BYTES = 16;

export type MobileReserveInput = {
  name: string;
  mimeType: DocumentMimeType;
  sizeBytes: number;
  subjectId: string | null;
};

export type MobileReserveResult =
  | { status: "ok"; documentId: string; uploadPath: string }
  | { status: "quota" }
  | { status: "subject_not_found" };

export async function reserveMobileDocument(
  client: Client,
  userId: string,
  input: MobileReserveInput,
): Promise<MobileReserveResult> {
  if (input.subjectId !== null) {
    const subject = await client
      .from("subjects")
      .select("id")
      .eq("id", input.subjectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (subject.error) throw new Error("Failed to verify the subject.");
    if (!subject.data) return { status: "subject_not_found" };
  }

  const usage = await client
    .from("documents")
    .select("id, size_bytes")
    .eq("user_id", userId)
    .limit(DOCUMENT_FREE_MAX_COUNT + 1);
  if (usage.error) throw new Error("Failed to read document usage.");

  const rows = usage.data ?? [];
  const totalBytes = rows.reduce(
    (total, row) => total + (row.size_bytes ?? 0),
    0,
  );
  if (
    rows.length >= DOCUMENT_FREE_MAX_COUNT ||
    totalBytes + input.sizeBytes > DOCUMENT_FREE_MAX_TOTAL_BYTES
  ) {
    return { status: "quota" };
  }

  const id = crypto.randomUUID();
  const uploadPath = storagePathFor(userId, id, input.name);
  const { error } = await client.from("documents").insert({
    id,
    user_id: userId,
    name: input.name,
    storage_path: uploadPath,
    mime_type: input.mimeType,
    size_bytes: input.sizeBytes,
    status: "uploaded",
    subject_id: input.subjectId,
  });
  if (error) throw new Error("Failed to reserve the document.");

  return { status: "ok", documentId: id, uploadPath };
}

export type FinalizeMode = "process" | "ocr";

export type MobileFinalizeResult =
  | { status: "indexing" | "ocr_required" }
  | { status: "not-found" }
  | { status: "rejected" };

/**
 * Verify the reserved object and hand the row to the right indexer:
 * `process` for a text-layered PDF, `ocr` for an image-generated one whose
 * page images the client will send to `/tools/ocr` straight after this call.
 */
export async function finalizeMobileDocument(
  client: Client,
  userId: string,
  documentId: string,
  mode: FinalizeMode,
): Promise<MobileFinalizeResult> {
  const { data: row, error } = await client
    .from("documents")
    .select("id, user_id, name, storage_path, mime_type, size_bytes")
    .eq("id", documentId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Failed to load the document.");
  if (!row) return { status: "not-found" };

  const path = row.storage_path;
  if (path === null || !pathBelongsToUser(path, userId)) {
    await discardReservation(client, userId, documentId, path);
    return { status: "rejected" };
  }

  const info = await client.storage.from(DOCUMENT_BUCKET).info(path);
  const size = info.data?.size ?? 0;
  if (info.error || size <= 0 || size > DOCUMENT_MAX_BYTES) {
    await discardReservation(client, userId, documentId, path);
    return { status: "rejected" };
  }

  let matches = false;
  if (row.mime_type !== null && isDocumentMimeType(row.mime_type)) {
    const download = await client.storage.from(DOCUMENT_BUCKET).download(path);
    if (!download.error && download.data) {
      const head = new Uint8Array(
        await download.data.slice(0, MAGIC_SNIFF_BYTES).arrayBuffer(),
      );
      matches = magicBytesMatch(head, row.mime_type);
    }
  }
  if (!matches) {
    await discardReservation(client, userId, documentId, path);
    return { status: "rejected" };
  }

  const updated = await client
    .from("documents")
    .update({
      size_bytes: size,
      status: "indexing",
      error_message: null,
    })
    .eq("id", documentId)
    .eq("user_id", userId);
  if (updated.error) throw new Error("Failed to finalize the document.");

  if (mode === "process") {
    // Enqueue before returning; if this fails, put the row back in `uploaded`
    // so it never claims an indexing job that doesn't exist.
    try {
      await enqueueJob("document.process", { documentId }, { userId });
    } catch (error) {
      await client
        .from("documents")
        .update({ status: "uploaded" })
        .eq("id", documentId)
        .eq("user_id", userId);
      throw error;
    }
    return { status: "indexing" };
  }

  return { status: "ocr_required" };
}

export type OcrDocumentRow = {
  id: string;
  name: string;
  storage_path: string | null;
  mime_type: string | null;
  status: string;
};

export async function loadOcrDocument(
  client: Client,
  userId: string,
  documentId: string,
): Promise<OcrDocumentRow | null> {
  const { data, error } = await client
    .from("documents")
    .select("id, name, storage_path, mime_type, status")
    .eq("id", documentId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Failed to load the document.");
  return data;
}

export async function markDocumentOcrFailed(
  client: Client,
  userId: string,
  documentId: string,
  message: string,
): Promise<void> {
  try {
    await client
      .from("documents")
      .update({ status: "failed", error_message: message })
      .eq("id", documentId)
      .eq("user_id", userId);
  } catch {
    // Best effort: the route's response is still honest about the failure.
  }
}

async function discardReservation(
  client: Client,
  userId: string,
  documentId: string,
  path: string | null,
): Promise<void> {
  if (path !== null && pathBelongsToUser(path, userId)) {
    try {
      await client.storage.from(DOCUMENT_BUCKET).remove([path]);
    } catch {
      // Best effort; the orphan sweep is the backstop.
    }
  }
  try {
    await client
      .from("documents")
      .delete()
      .eq("id", documentId)
      .eq("user_id", userId);
  } catch {
    // Never surface cleanup failure as success.
  }
}

export function isDocumentName(value: unknown): value is string {
  return parseDocumentName(value) !== null;
}
