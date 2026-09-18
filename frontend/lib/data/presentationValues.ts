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
  | "export_status"
  | "export_error_message"
  | "exported_at"
>;

export const PRESENTATION_PROMPT_MAX_LENGTH = 2_000;
export const PRESENTATION_TEMPLATE_MAX_LENGTH = 120;
export const PRESENTATION_MIN_SLIDES = 5;
export const PRESENTATION_MAX_SLIDES = 30;
export const PRESENTATION_MAX_SOURCES = 8;
export const PRESENTATION_INSTRUCTIONS_MAX_LENGTH = 2_000;

/** The stored language values; the UI adds "Auto", which maps to null. */
export const PRESENTATION_LANGUAGE_VALUES = [
  "Arabic",
  "Bengali",
  "Chinese (Simplified)",
  "Dutch",
  "English",
  "French",
  "German",
  "Hindi",
  "Indonesian",
  "Italian",
  "Japanese",
  "Korean",
  "Malay",
  "Polish",
  "Portuguese",
  "Russian",
  "Spanish",
  "Swedish",
  "Thai",
  "Turkish",
  "Ukrainian",
  "Urdu",
  "Vietnamese",
] as const;
export const PRESENTATION_LANGUAGE_OPTIONS = [
  "Auto",
  ...PRESENTATION_LANGUAGE_VALUES,
] as const;
export const PRESENTATION_TONES = [
  "default",
  "casual",
  "professional",
  "funny",
  "educational",
  "sales_pitch",
] as const;
export const PRESENTATION_VERBOSITIES = [
  "concise",
  "standard",
  "text-heavy",
] as const;

export const PRESENTATION_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;
export type PresentationStatusValue = (typeof PRESENTATION_STATUSES)[number];

/**
 * The export mirror's vocabulary (Task C1) — the same four states; null until
 * an export has ever been requested. The UI treats `queued`/`running` as
 * "exporting" and disables the export control.
 */
export const PRESENTATION_EXPORT_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;
export type PresentationExportStatusValue =
  (typeof PRESENTATION_EXPORT_STATUSES)[number];

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
  /** The export mirror (Task C1) — absent until an export has been requested. */
  exportStatus?: PresentationExportStatusValue;
  /** Sanitized export failure copy; absent unless an export failed. */
  exportErrorMessage?: string;
  /** When the last successful export replaced the deck's document. */
  exportedAt?: string;
  createdLabel: string;
};

/** The validated request the Server Action accepts. */
export type PresentationDraft = {
  prompt: string;
  template: string;
  nSlides: number | null;
  format: PresentationFormat;
  language: string | null; // a PRESENTATION_LANGUAGE_VALUES entry, or null for Auto
  instructions: string | null;
  tone: (typeof PRESENTATION_TONES)[number] | null;
  verbosity: (typeof PRESENTATION_VERBOSITIES)[number] | null;
  includeTableOfContents: boolean;
  includeTitleSlide: boolean;
  sourceDocumentIds: string[];
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPresentationUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when `value` is one of the closed vocabulary's exact entries. */
function isVocabularyValue<T extends readonly string[]>(
  vocabulary: T,
  value: unknown,
): value is T[number] {
  return (
    typeof value === "string" && (vocabulary as readonly string[]).includes(value)
  );
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

  const rawLanguage = input.language;
  let language: string | null = null;
  if (rawLanguage !== null && rawLanguage !== undefined) {
    if (!isVocabularyValue(PRESENTATION_LANGUAGE_VALUES, rawLanguage)) {
      return null;
    }
    language = rawLanguage;
  }

  const rawInstructions = input.instructions;
  let instructions: string | null = null;
  if (rawInstructions !== null && rawInstructions !== undefined) {
    if (typeof rawInstructions !== "string") return null;
    const trimmed = rawInstructions.trim();
    if (trimmed !== "") {
      if (trimmed.length > PRESENTATION_INSTRUCTIONS_MAX_LENGTH) return null;
      instructions = trimmed;
    }
  }

  const rawTone = input.tone;
  let tone: PresentationDraft["tone"] = null;
  if (rawTone !== null && rawTone !== undefined) {
    if (!isVocabularyValue(PRESENTATION_TONES, rawTone)) return null;
    tone = rawTone;
  }

  const rawVerbosity = input.verbosity;
  let verbosity: PresentationDraft["verbosity"] = null;
  if (rawVerbosity !== null && rawVerbosity !== undefined) {
    if (!isVocabularyValue(PRESENTATION_VERBOSITIES, rawVerbosity)) return null;
    verbosity = rawVerbosity;
  }

  // Contents defaults off; the title slide defaults on (the DB/service default
  // is true), and only an explicit false turns it off.
  const includeTableOfContents = input.includeTableOfContents === true;
  const includeTitleSlide = input.includeTitleSlide !== false;

  const rawSourceIds = input.sourceDocumentIds;
  const sourceDocumentIds: string[] = [];
  if (rawSourceIds !== null && rawSourceIds !== undefined) {
    if (
      !Array.isArray(rawSourceIds) ||
      rawSourceIds.length > PRESENTATION_MAX_SOURCES
    ) {
      return null;
    }
    const seen = new Set<string>();
    for (const rawId of rawSourceIds) {
      if (!isPresentationUuid(rawId)) return null;
      const id = rawId.trim();
      const key = id.toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);
      sourceDocumentIds.push(id);
    }
  }

  return {
    prompt,
    template,
    nSlides,
    format,
    language,
    instructions,
    tone,
    verbosity,
    includeTableOfContents,
    includeTitleSlide,
    sourceDocumentIds,
  };
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
  if (
    row.export_status !== null &&
    (PRESENTATION_EXPORT_STATUSES as readonly string[]).includes(
      row.export_status,
    )
  ) {
    item.exportStatus = row.export_status as PresentationExportStatusValue;
  }
  if (row.export_error_message !== null) {
    item.exportErrorMessage = row.export_error_message;
  }
  if (row.exported_at !== null) item.exportedAt = row.exported_at;

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
