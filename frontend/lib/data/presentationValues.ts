/**
 * The presentation domain's shared vocabulary, validation and display mapping
 * (Task 31.x), imported by the service, the Server Actions, the tool page and
 * the tests. Pure by design — no server imports — so the exact parser that
 * guards the write boundary can be exercised directly.
 *
 * Mirrors `documentValues.ts`'s posture: the worker re-checks everything it
 * stores, the adapter re-validates what it forwards, and this module is the
 * one place the UI-facing limits and words are written.
 */
import type { Database } from "@/lib/supabase/database.types";
import { formatDocumentSize } from "./documentValues";
import { formatTaskDueDate } from "./taskDates";

/** The subset of the row the display contract maps (joined document included). */
export type PresentationRow = Pick<
  Database["public"]["Tables"]["presentations"]["Row"],
  | "id"
  | "prompt"
  | "template"
  | "n_slides"
  | "format"
  | "status"
  | "error_message"
  | "slides_done"
  | "slides_total"
  | "document_id"
  | "presenton_presentation_id"
  | "created_at"
>;

export const PRESENTATION_PROMPT_MAX_LENGTH = 2_000;
export const PRESENTATION_TEMPLATE_MAX_LENGTH = 120;
export const PRESENTATION_MIN_SLIDES = 5;
export const PRESENTATION_MAX_SLIDES = 30;

export const PRESENTATION_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;
export type PresentationStatusValue = (typeof PRESENTATION_STATUSES)[number];

/** The schema's status vocabulary in the tool's words. */
export const PRESENTATION_STATUS_LABELS: Record<PresentationStatusValue, string> = {
  queued: "Queued",
  running: "Generating…",
  succeeded: "Ready",
  failed: "Failed",
};

export type PresentationFormat = "pptx" | "pdf";

export const PRESENTATION_FORMAT_LABELS: Record<PresentationFormat, string> = {
  pptx: "PowerPoint (.pptx)",
  pdf: "PDF (.pdf)",
};

/** The generated document's joined metadata, when it exists. */
export type PresentationDocumentInfo = {
  id: string;
  name: string;
  mimeType?: string;
  sizeLabel?: string;
};

/** What the tool page renders for one request. */
export type PresentationItem = {
  id: string;
  prompt: string;
  template: string;
  format: PresentationFormat;
  formatLabel: string;
  statusValue: PresentationStatusValue;
  statusLabel: string;
  slidesDone?: number;
  slidesTotal?: number;
  /** Sanitized failure copy — written by the action/worker, rendered verbatim. */
  errorMessage?: string;
  /** The stored deck once it exists (the result card). */
  document?: PresentationDocumentInfo;
  documentId?: string;
  /** The Presenton service's presentation id (Phase-2 editor link). */
  presentonPresentationId?: string;
  createdLabel: string;
};

/** The validated request the Server Action accepts. */
export type PresentationDraft = {
  prompt: string;
  template: string;
  nSlides: number | null;
  format: PresentationFormat;
  sourceDocumentId: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPresentationUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates an untrusted generation request. Null rejects: the action answers
 * with the sanitized invalid-input copy and nothing is written.
 */
export function parsePresentationRequest(
  input: unknown,
): PresentationDraft | null {
  if (!isRecord(input)) return null;

  const rawPrompt = input.prompt;
  if (typeof rawPrompt !== "string") return null;
  const prompt = rawPrompt.trim();
  if (prompt === "" || prompt.length > PRESENTATION_PROMPT_MAX_LENGTH) {
    return null;
  }

  const rawTemplate = input.template;
  const template =
    typeof rawTemplate === "string" && rawTemplate.trim() !== ""
      ? rawTemplate.trim()
      : "general";
  if (template.length > PRESENTATION_TEMPLATE_MAX_LENGTH) return null;

  // The count is optional; when given it is a bounded whole number.
  const rawSlides = input.nSlides;
  let nSlides: number | null = null;
  if (rawSlides !== null && rawSlides !== undefined) {
    if (
      typeof rawSlides !== "number" ||
      !Number.isInteger(rawSlides) ||
      rawSlides < PRESENTATION_MIN_SLIDES ||
      rawSlides > PRESENTATION_MAX_SLIDES
    ) {
      return null;
    }
    nSlides = rawSlides;
  }

  const format = input.format === "pdf" ? "pdf" : input.format === "pptx" ? "pptx" : null;
  if (format === null) return null;

  const rawSource = input.sourceDocumentId;
  let sourceDocumentId: string | null = null;
  if (rawSource !== null && rawSource !== undefined && rawSource !== "") {
    if (!isPresentationUuid(rawSource)) return null;
    sourceDocumentId = rawSource.trim();
  }

  return { prompt, template, nSlides, format, sourceDocumentId };
}

/** Which statuses mean "the worker is on it" (the page polls then). */
export function isPresentationInFlight(status: PresentationStatusValue): boolean {
  return status === "queued" || status === "running";
}

/** The joined `document` embed shape (many-to-one: object or null). */
export type PresentationDocumentRow = {
  id: string;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
};

/**
 * Row → display contract. Optional fields are omitted rather than defaulted —
 * a row without a generated document renders no result card, never "0 B".
 */
export function presentationRowToItem(
  row: PresentationRow,
  document: PresentationDocumentRow | null,
  timeZone: string,
): PresentationItem {
  const status = (PRESENTATION_STATUSES as readonly string[]).includes(row.status)
    ? (row.status as PresentationStatusValue)
    : "queued";
  const format: PresentationFormat = row.format === "pdf" ? "pdf" : "pptx";

  const item: PresentationItem = {
    id: row.id,
    prompt: row.prompt,
    template: row.template,
    format,
    formatLabel: PRESENTATION_FORMAT_LABELS[format],
    statusValue: status,
    statusLabel: PRESENTATION_STATUS_LABELS[status],
    createdLabel: formatTaskDueDate(row.created_at, timeZone),
  };

  if (row.slides_done !== null) item.slidesDone = row.slides_done;
  if (row.slides_total !== null) item.slidesTotal = row.slides_total;
  if (row.error_message !== null) item.errorMessage = row.error_message;
  if (row.document_id !== null) item.documentId = row.document_id;
  if (row.presenton_presentation_id !== null) {
    item.presentonPresentationId = row.presenton_presentation_id;
  }

  if (document !== null) {
    const info: PresentationDocumentInfo = {
      id: document.id,
      name: document.name,
    };
    if (document.mime_type !== null) info.mimeType = document.mime_type;
    if (document.size_bytes !== null) {
      info.sizeLabel = formatDocumentSize(document.size_bytes);
    }
    item.document = info;
  }

  return item;
}
