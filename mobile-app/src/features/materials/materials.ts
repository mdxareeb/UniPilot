/**
 * Course materials: files captured from the student's active WhatsApp groups
 * (owner RLS). The mapping mirrors the web's documents contract — labels for
 * status and type, a display size, the AI summary and topic tags — so the two
 * surfaces never describe the same row differently.
 */
import { formatDay } from "../agenda/agenda";

export const DOCUMENTS_BUCKET = "documents";

export type MaterialStatus = "uploaded" | "indexing" | "indexed" | "failed";

const STATUS_LABELS: Record<MaterialStatus, string> = {
  uploaded: "Uploaded",
  indexing: "Parsing…",
  indexed: "Searchable",
  failed: "Failed",
};

const STATUS_VALUES: readonly string[] = ["uploaded", "indexing", "indexed", "failed"];

const MIME_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "DOCX",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "PPTX",
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/gif": "GIF",
  "image/webp": "WEBP",
};

export type MaterialSubject = {
  name: string;
  color_tag?: string | null;
};

export type MaterialRowInput = {
  id: string;
  name: string;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  status: string;
  created_at: string;
  ai_summary: string | null;
  topic_tags: string[] | null;
  source: string;
  subject_id: string | null;
  subject: MaterialSubject | null;
};

export type MaterialItem = {
  id: string;
  name: string;
  storagePath: string | null;
  mimeType: string | null;
  typeLabel: string;
  sizeLabel: string | null;
  addedLabel: string;
  statusValue: MaterialStatus;
  statusLabel: string;
  summary: string | null;
  tags: string[];
  subjectId: string | null;
  subjectName: string | null;
  subjectColorTag: string | null;
  fromWhatsApp: boolean;
  canOpen: boolean;
};

export type MaterialFilter = {
  id: string;
  name: string;
  count: number;
};

/** A display size, e.g. "824 B", "12.4 KB", "102 MB" (the web's rule). */
export function formatMaterialSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kibibytes = bytes / 1024;
  if (kibibytes < 1024) {
    return `${kibibytes < 100 ? kibibytes.toFixed(1) : Math.round(kibibytes)} KB`;
  }
  const mebibytes = kibibytes / 1024;
  return `${mebibytes < 100 ? mebibytes.toFixed(1) : Math.round(mebibytes)} MB`;
}

/** "PDF", "DOCX", "PPTX", an image label, or the neutral "File". */
export function materialTypeLabel(mimeType: string | null): string {
  if (mimeType === null) return "File";
  return MIME_LABELS[mimeType] ?? "File";
}

export function toMaterialItem(
  row: MaterialRowInput,
  timeZone: string,
): MaterialItem {
  const status = (STATUS_VALUES.includes(row.status)
    ? row.status
    : "uploaded") as MaterialStatus;
  const tags =
    row.topic_tags?.filter((tag) => tag.trim() !== "").map((tag) => tag.trim()) ??
    [];

  return {
    id: row.id,
    name: row.name,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    typeLabel: materialTypeLabel(row.mime_type),
    sizeLabel: row.size_bytes === null ? null : formatMaterialSize(row.size_bytes),
    addedLabel: formatDay(row.created_at, timeZone),
    statusValue: status,
    statusLabel: STATUS_LABELS[status],
    summary:
      row.ai_summary !== null && row.ai_summary.trim() !== ""
        ? row.ai_summary.trim()
        : null,
    tags,
    subjectId: row.subject_id,
    subjectName: row.subject?.name ?? null,
    subjectColorTag: row.subject?.color_tag ?? null,
    fromWhatsApp: row.source === "whatsapp_group",
    canOpen: row.storage_path !== null,
  };
}

/** The courses present among the files, A→Z, each with its file count. */
export function subjectFilters(items: MaterialItem[]): MaterialFilter[] {
  const counts = new Map<string, MaterialFilter>();
  for (const item of items) {
    if (item.subjectId === null || item.subjectName === null) continue;
    const existing = counts.get(item.subjectId);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(item.subjectId, {
        id: item.subjectId,
        name: item.subjectName,
        count: 1,
      });
    }
  }
  return [...counts.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** All files, or only one course's. */
export function filterMaterials(
  items: MaterialItem[],
  subjectId: string | null,
): MaterialItem[] {
  if (subjectId === null) return items;
  return items.filter((item) => item.subjectId === subjectId);
}
