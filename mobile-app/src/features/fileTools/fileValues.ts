/**
 * File Tools' pure vocabulary: names, page ranges, list order and the small
 * type/format labels. Every rule here is directly testable; the screens do not
 * re-implement validation.
 */

export const PDF_MIME = "application/pdf";
export const PDF_MAX_PAGES = 200;
export const CONVERT_MAX_BYTES = 10 * 1024 * 1024;

export const CONVERT_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
] as const;

export const CONVERT_PICKER_TYPES = [
  ...CONVERT_MIME_TYPES,
  "application/msword",
  "application/vnd.ms-powerpoint",
] as const;

export type ConvertKind = "docx" | "pptx" | "txt";

export function convertKindOf(
  name: string,
  mimeType: string | null,
): ConvertKind | null {
  const lower = name.trim().toLowerCase();
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".pptx")) return "pptx";
  if (lower.endsWith(".txt")) return "txt";
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return "pptx";
  }
  if (mimeType === "text/plain") return "txt";
  return null;
}

export function convertKindLabel(kind: ConvertKind): string {
  if (kind === "docx") return "DOCX";
  if (kind === "pptx") return "PPTX";
  return "TXT";
}

/** A display and storage-safe PDF name; always ends in `.pdf`. */
export function sanitizePdfFileName(
  input: string,
  fallback = "scanned-notes",
): string {
  const raw = input.trim();
  const withoutExtension = raw.toLowerCase().endsWith(".pdf")
    ? raw.slice(0, -4)
    : raw;
  const cleaned = withoutExtension
    .normalize("NFKD")
    .replace(/[\\/]+/g, " ")
    .replace(/\.{2,}/g, " ")
    .replace(/[:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .trim();
  const base = cleaned === "" ? fallback : cleaned;
  return `${base}.pdf`;
}

export type PageRangeResult =
  | { ok: true; pages: number[] }
  | { ok: false; error: string };

/**
 * Parse `1-3, 5` into the selected pages in the order typed, de-duplicated.
 * Every page must exist in the source; a reversed range is an error rather
 * than a silently swapped one.
 */
export function parsePageRanges(
  input: string,
  pageCount: number,
): PageRangeResult {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return { ok: false, error: "This PDF has no pages to extract." };
  }

  const normalized = input
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized === "") {
    return { ok: false, error: "Enter page numbers like 1-3, 5." };
  }

  const pages: number[] = [];
  const seen = new Set<number>();
  for (const token of normalized.split(",")) {
    const part = token.trim();
    if (part === "") continue;

    const single = /^(\d+)$/.exec(part);
    if (single) {
      const page = Number(single[1]);
      if (page < 1 || page > pageCount) {
        return { ok: false, error: `Pages must be between 1 and ${pageCount}.` };
      }
      if (!seen.has(page)) {
        seen.add(page);
        pages.push(page);
      }
      continue;
    }

    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (!range) {
      return { ok: false, error: "Enter page numbers like 1-3, 5." };
    }
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (start < 1 || end < 1 || start > pageCount || end > pageCount) {
      return { ok: false, error: `Pages must be between 1 and ${pageCount}.` };
    }
    if (start > end) {
      return {
        ok: false,
        error: "A range's start page must come before its end page.",
      };
    }
    for (let page = start; page <= end; page += 1) {
      if (!seen.has(page)) {
        seen.add(page);
        pages.push(page);
      }
    }
  }

  if (pages.length === 0) {
    return { ok: false, error: "Enter page numbers like 1-3, 5." };
  }
  return { ok: true, pages };
}

/** Move one list item up/down; out-of-bounds is a no-op. */
export function moveListItem<T>(
  items: readonly T[],
  index: number,
  delta: -1 | 1,
): T[] {
  const next = [...items];
  const target = index + delta;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) {
    return next;
  }
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function removeListItem<T>(items: readonly T[], index: number): T[] {
  if (index < 0 || index >= items.length) return [...items];
  return items.filter((_, itemIndex) => itemIndex !== index);
}

export type PdfImagePage = {
  id: string;
  uri: string;
  base64: string;
  width: number;
  height: number;
  fileName: string;
  mimeType: "image/jpeg";
};

export type PickedPdf = {
  id: string;
  uri: string;
  name: string;
  sizeBytes: number | null;
};

export type GeneratedPdf = {
  uri: string;
  name: string;
  pageCount: number | null;
  sizeBytes: number;
  bytes: Uint8Array;
  base64: string;
};

export type PickedConvertFile = {
  uri: string;
  name: string;
  sizeBytes: number | null;
  mimeType: string | null;
  kind: ConvertKind;
};

export function imagePageLabel(index: number): string {
  return `Page ${index + 1}`;
}
