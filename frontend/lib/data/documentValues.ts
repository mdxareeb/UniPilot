/**
 * The documents domain's shared vocabulary, validation and display mapping
 * (Tasks 23.1–23.13), imported by the service, the Server Actions, the upload
 * pipeline and the tests.
 *
 * Pure by design — no server imports — so the exact functions that guard the
 * write boundary can be exercised directly, and the client can run the same
 * pre-checks for instant feedback without becoming the authority. The bucket
 * migration (`..._documents_storage_bucket.sql`) mirrors the allowlist and the
 * size cap, and the finalize Server Action re-checks both server-side; this
 * module is the one place the numbers are written.
 *
 * Path convention: `{user_id}/{document_id}/{sanitized-name}`. The leading
 * folder is the RLS key on `storage.objects`; the per-document folder keeps
 * names collision-free and makes an object's owner provable from its path.
 *
 * Decisions recorded here (not invented per call site):
 * - Accepted types: PDF, DOCX, PNG, JPEG — 24.3–24.5's launch set; widening it
 *   is a one-line change plus a migration for the bucket constraint.
 * - Max size: 25 MiB (26214400 bytes).
 * - Free-tier guard (23.12): 50 documents or 250 MiB total, whichever comes
 *   first. Plan-driven entitlements wait for billing (49.x) — this is the
 *   documented default a free account gets, not a fake plan matrix.
 */
import type { Database } from "@/lib/supabase/database.types";
import { formatTaskDueDate } from "./taskDates";

/** The subset of the row the calendar-style display contract maps. */
export type DocumentRow = Pick<
  Database["public"]["Tables"]["documents"]["Row"],
  | "id"
  | "name"
  | "storage_path"
  | "mime_type"
  | "size_bytes"
  | "page_count"
  | "status"
  | "error_message"
  | "created_at"
>;

export const DOCUMENT_BUCKET = "documents";
export const DOCUMENT_NAME_MAX_LENGTH = 200;

/** 25 MiB — the documented 23.5 cap, matching the bucket constraint. */
export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

/** 23.12's documented default free-tier guard (billing 49.x owns plans). */
export const DOCUMENT_FREE_MAX_COUNT = 50;
export const DOCUMENT_FREE_MAX_TOTAL_BYTES = 250 * 1024 * 1024;

/** The closed launch set; each entry names the label and file extensions. */
export const DOCUMENT_MIME_TYPES = {
  "application/pdf": { label: "PDF", extensions: ["pdf"] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    label: "DOCX",
    extensions: ["docx"],
  },
  "image/png": { label: "PNG", extensions: ["png"] },
  "image/jpeg": { label: "JPEG", extensions: ["jpg", "jpeg"] },
} as const;

export type DocumentMimeType = keyof typeof DOCUMENT_MIME_TYPES;

export const DOCUMENT_MIME_VALUES = Object.keys(
  DOCUMENT_MIME_TYPES,
) as DocumentMimeType[];

/** What the native file input advertises; the server decides for real. */
export const DOCUMENT_ACCEPT_ATTRIBUTE = ".pdf,.docx,.png,.jpg,.jpeg";

export function isDocumentMimeType(value: unknown): value is DocumentMimeType {
  return (
    typeof value === "string" &&
    (DOCUMENT_MIME_VALUES as readonly string[]).includes(value)
  );
}

export const DOCUMENT_STATUSES = [
  "uploaded",
  "indexing",
  "indexed",
  "failed",
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** The schema's status vocabulary in display words (18.x renders these). */
export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  uploaded: "Uploaded",
  indexing: "Indexing",
  indexed: "Indexed",
  failed: "Failed",
};

/**
 * What the documents surface renders: display-ready strings mapped by the
 * data layer, plus the machine values a later preview/rename needs.
 */
export type DocumentItem = {
  id: string;
  name: string;
  /** Object path in the private bucket; owner-only by RLS. */
  storagePath?: string;
  mimeType?: string;
  /** Display word ("PDF" | "DOCX" | "PNG" | "JPEG"). */
  mimeLabel?: string;
  sizeBytes?: number;
  /** Display size, e.g. "2.4 MB". */
  sizeLabel?: string;
  statusValue: DocumentStatus;
  statusLabel: string;
  /**
   * Sanitized processing failure copy (24.12) — set only for `failed` rows,
   * written by the worker; the UI renders it verbatim, never a raw error.
   */
  errorMessage?: string;
  pageCount?: number;
  /** Display-ready upload date, e.g. "Sat, Sep 12". */
  createdLabel: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A trimmed, bounded display name, or null when it is junk. */
export function parseDocumentName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > DOCUMENT_NAME_MAX_LENGTH) {
    return null;
  }
  return trimmed;
}

/** What the reserve Server Action accepts, after validation. */
export type DocumentUploadDraft = {
  name: string;
  mimeType: DocumentMimeType;
  sizeBytes: number;
};

/**
 * Validates an untrusted upload reservation. Null rejects: the action answers
 * with the sanitized type/size copy and nothing is written. The declared size
 * must be a positive integer within the cap; the real object size is checked
 * again at finalize time.
 */
export function parseDocumentUpload(input: unknown): DocumentUploadDraft | null {
  if (!isRecord(input)) return null;

  const name = parseDocumentName(input.name);
  if (name === null) return null;

  if (!isDocumentMimeType(input.mimeType)) return null;

  const sizeBytes = input.sizeBytes;
  if (
    typeof sizeBytes !== "number" ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > DOCUMENT_MAX_BYTES
  ) {
    return null;
  }

  return { name, mimeType: input.mimeType, sizeBytes };
}

/**
 * The object name under the document's folder: path separators, control
 * characters and exotic punctuation never reach Storage, the extension is
 * preserved, and an all-symbol name falls back to "file".
 */
export function sanitizeStorageName(name: string): string {
  const lastDot = name.lastIndexOf(".");
  const rawBase = lastDot > 0 ? name.slice(0, lastDot) : name;
  const rawExtension = lastDot > 0 ? name.slice(lastDot + 1) : "";

  const base =
    rawBase
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 80) || "file";

  const extension = rawExtension
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 10);

  return extension === "" ? base : `${base}.${extension}`;
}

/** The one path builder; RLS reads the first folder as the owner. */
export function storagePathFor(
  userId: string,
  documentId: string,
  name: string,
): string {
  return `${userId}/${documentId}/${sanitizeStorageName(name)}`;
}

/** The suffix test an owned path must pass (defence in depth over RLS). */
export function pathBelongsToUser(
  path: string,
  userId: string,
): boolean {
  return path.startsWith(`${userId}/`);
}

/** The magic-byte prefixes of the accepted formats. */
const MAGIC_BYTES: Record<DocumentMimeType, readonly number[][]> = {
  "application/pdf": [[0x25, 0x50, 0x44, 0x46, 0x2d]],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    [0x50, 0x4b, 0x03, 0x04],
  ],
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  "image/jpeg": [[0xff, 0xd8, 0xff]],
};

/**
 * Basic magic-byte sniffing (23.4): the declared type must be one the actual
 * bytes start with. It is deliberately shallow — the browser-provided MIME
 * type is never trusted alone, and deep content parsing is 24.x's concern.
 * A DOCX is a ZIP container, so its signature is the ZIP local-file header.
 */
export function magicBytesMatch(
  bytes: Uint8Array,
  mimeType: DocumentMimeType,
): boolean {
  return MAGIC_BYTES[mimeType].some((signature) => {
    if (bytes.length < signature.length) return false;
    return signature.every((byte, index) => bytes[index] === byte);
  });
}

/** A display size a label can carry, e.g. "824 B", "12.4 KB", "102 MB". */
export function formatDocumentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kibibytes = bytes / 1024;
  if (kibibytes < 1024) {
    return `${kibibytes < 100 ? kibibytes.toFixed(1) : Math.round(kibibytes)} KB`;
  }
  const mebibytes = kibibytes / 1024;
  return `${mebibytes < 100 ? mebibytes.toFixed(1) : Math.round(mebibytes)} MB`;
}

/**
 * Row → display contract. Optional fields are omitted rather than defaulted —
 * a legacy row without a size renders no size line, never "0 B".
 */
export function documentRowToItem(
  row: DocumentRow,
  timeZone: string,
): DocumentItem {
  const status = (DOCUMENT_STATUSES as readonly string[]).includes(row.status)
    ? (row.status as DocumentStatus)
    : "uploaded";

  const item: DocumentItem = {
    id: row.id,
    name: row.name,
    statusValue: status,
    statusLabel: DOCUMENT_STATUS_LABELS[status],
    createdLabel: formatTaskDueDate(row.created_at, timeZone),
  };

  if (row.storage_path !== null) item.storagePath = row.storage_path;
  if (row.mime_type !== null) {
    item.mimeType = row.mime_type;
    if (isDocumentMimeType(row.mime_type)) {
      item.mimeLabel = DOCUMENT_MIME_TYPES[row.mime_type].label;
    }
  }
  if (row.size_bytes !== null) {
    item.sizeBytes = row.size_bytes;
    item.sizeLabel = formatDocumentSize(row.size_bytes);
  }
  if (row.page_count !== null) item.pageCount = row.page_count;
  if (row.error_message !== null) item.errorMessage = row.error_message;

  return item;
}
