/**
 * The Presenton integration adapter (Task 31.x) — server-only, typed, HTTP.
 *
 * Presenton is a separate, Apache-2.0-licensed service (see
 * `docs/integrations/presenton.md`); UniPilot never vendors it and never talks
 * to any LLM provider directly. This module is the single place that speaks
 * Presenton's REST API, so the provider is whatever the service was configured
 * with and switching it is a config change on Presenton's side only.
 *
 * Consumers:
 * - the tool page's Server Actions read the configured state and list
 *   templates;
 * - the native editor's Server Actions (C4) read the deck and write through
 *   `updatePresentation`/`updateSlide`/`requestPresentationExport`; structural
 *   writes stay gated by `isStructuralEditingEnabled`;
 * - the Node worker (`backend/worker/presentationJobs.mjs`) drives the full
 *   generate → poll → download flow. The worker cannot import this module
 *   (plain `.mjs`, no TypeScript build step), so its HTTP calls mirror the
 *   request shapes documented here — the integration doc is the shared
 *   contract, and the shapes below carry the exact comments.
 *
 * Secrets: `PRESENTON_URL`, `PRESENTON_API_KEY` and `PRESENTON_PUBLIC_URL` are
 * read from the server environment only. No api key ever appears in a return
 * value, an error message or a log line; nothing here is importable from a
 * client component by construction (process.env access + `node:` timeouts).
 *
 * Failure classification (the worker's 29.1 mapping depends on it):
 * - `not-configured` — `PRESENTON_URL` is unset. Permanent, honest; no call
 *   was attempted.
 * - `unreachable`    — DNS/refused/timeout/5xx/!ok-from-the-gateway. Retryable.
 * - `rejected`       — Presenton answered 4xx: a malformed request or a bad
 *   template/task id. Permanent.
 * - `failed`         — the service answered ok but the operation itself is in
 *   an error state (an async task that ended `error`). Permanent for that
 *   request: retrying the identical request would burn the same provider call.
 */
import {
  isPresentonConfigured,
  presentonApiKey,
  presentonBaseUrl,
  presentonPublicUrl,
  presentonUiUrl,
} from "./presentonConfig";
import type {
  DeckSlide,
  DeckTheme,
  DeckThemePackage,
  IconType,
  PresentationDeck,
  PresentationTemplate,
  TemplateLayouts,
} from "../presentation/types";
import { assetContentType, isSafeAssetPath } from "../presentation/assets";
import {
  CHAT_MESSAGE_MAX_LENGTH,
  parseSseBlocks,
} from "../presentation/chatFrames";
import {
  DEFAULT_ICON_WEIGHT,
  iconWeightFromPath,
  normalizeIconPath,
  normalizeIconWeight,
} from "../presentation/icons";
import {
  IMAGE_UPLOAD_EXTENSIONS,
  IMAGE_UPLOAD_MAX_BYTES,
} from "../presentation/imageLimits";

/** Defensive cap on the prompt forwarded to the service (the UI enforces less). */
export const PRESENTON_CONTENT_MAX_LENGTH = 8_000;
export const PRESENTON_INSTRUCTIONS_MAX_LENGTH = 2_000;
export const PRESENTON_TEMPLATE_MAX_LENGTH = 120;
export const PRESENTON_MAX_SLIDES = 50;
export const PRESENTON_SOURCE_FILE_MAX_BYTES = 25 * 1024 * 1024;
/** Image search/prompt bounds; the UI enforces less, the wire never more. */
export const PRESENTON_IMAGE_QUERY_MAX_LENGTH = 200;
export const PRESENTON_IMAGE_PROMPT_MAX_LENGTH = 1_000;
/** The engine's `/images/search` `limit` maximum (its own `le=30`). */
export const PRESENTON_IMAGE_SEARCH_MAX_LIMIT = 30;
/** The engine's default `limit` when the caller does not ask (`Query(default=12)`). */
export const PRESENTON_IMAGE_SEARCH_DEFAULT_LIMIT = 12;
/**
 * The upload bound UniPilot enforces, shared with the browser picker through
 * `lib/presentation/imageLimits.ts` (the engine documents no image size
 * limit; this is UniPilot's own request-memory bound).
 */
export { IMAGE_UPLOAD_MAX_BYTES as PRESENTON_IMAGE_UPLOAD_MAX_BYTES } from "../presentation/imageLimits";
/** The engine's `ALLOWED_UPLOAD_IMAGE_EXTENSIONS` (`images.py`). */
export { IMAGE_UPLOAD_EXTENSIONS as PRESENTON_IMAGE_UPLOAD_EXTENSIONS } from "../presentation/imageLimits";
/** Icon search bounds: the engine's own default is 20 with no stated maximum;
 * UniPilot asks at most 40 per picker page (the fork's own request). */
export const PRESENTON_ICON_QUERY_MAX_LENGTH = 200;
export const PRESENTON_ICON_SEARCH_DEFAULT_LIMIT = 20;
export const PRESENTON_ICON_SEARCH_MAX_LIMIT = 40;

const START_TIMEOUT_MS = 30_000;
const STATUS_TIMEOUT_MS = 15_000;
const TEMPLATES_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 120_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
/** A full deck (slides + hydrated `ui`) is the largest JSON the adapter reads. */
const DECK_TIMEOUT_MS = 30_000;
/** One editor write (metadata, slide or the full-array replace). */
const MUTATION_TIMEOUT_MS = 30_000;
/** `POST /{id}/export` builds the file synchronously; allow a slow large deck. */
const EXPORT_REQUEST_TIMEOUT_MS = 60_000;
/** One engine asset for the owner-gated proxy (B2); bytes, not JSON. */
const ASSET_TIMEOUT_MS = 30_000;
/** One image library/search read (the stock providers answer within ~20 s). */
const IMAGES_TIMEOUT_MS = 30_000;
/** One provider-backed generation (the engine's own provider call is slow). */
const IMAGE_GENERATE_TIMEOUT_MS = 120_000;
/** One image upload: multipart bytes to the engine's image store. */
const IMAGE_UPLOAD_TIMEOUT_MS = 120_000;
/** One icon-catalog search (the vector store answers once initialized). */
const ICONS_TIMEOUT_MS = 30_000;
/**
 * One chat read (conversation list / history). The chat stream has **no**
 * timeout by design (spec §7.8: no truncation); only the reads are bounded.
 */
const CHAT_READ_TIMEOUT_MS = 15_000;

/** Presenton's async-task lifecycle (mirror of `enums.async_task_status.py`). */
export type PresentonTaskStatus = "pending" | "processing" | "completed" | "error";

export type PresentonTaskData = {
  created_slides?: number;
  remaining_slides?: number;
  presentation_id?: string;
  path?: string;
  edit_path?: string;
};

export type PresentonAsyncTask = {
  id: string;
  type: string;
  status: PresentonTaskStatus;
  message?: string | null;
  data?: PresentonTaskData | null;
  error?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
};

/** The engine's export formats (`export_as` on the generate and export routes). */
export type PresentonExportFormat = "pptx" | "pdf";

/** The `GeneratePresentationRequest` fields UniPilot sends (all of them). */
export type PresentonGenerationInput = {
  content: string;
  nSlides?: number | null;
  language?: string | null;
  template: string;
  format: PresentonExportFormat;
  /** Presenton-side paths returned by {@link uploadPresentationSourceFile}. */
  sourceFiles?: string[];
  /** Free-form steering; clipped to {@link PRESENTON_INSTRUCTIONS_MAX_LENGTH}. */
  instructions?: string | null;
  /** Presenton's `ChatTone` (`default` | `casual` | `professional` | …). */
  tone?: string | null;
  /** Presenton's verbosity (`concise` | `standard` | `text-heavy`). */
  verbosity?: string | null;
  /**
   * Always sent either way: Presenton's service defaults differ from the
   * UniPilot request defaults (the parser leaves contents off, title on).
   */
  includeTableOfContents?: boolean;
  includeTitleSlide?: boolean;
};

export type PresentonTemplate = {
  id: string;
  name: string;
  description: string | null;
  layoutCount: number;
  isDefault: boolean;
};

/** One §3.5 page: the normalized items plus the pagination they were read with. */
export type PresentonTemplatePage = {
  items: PresentonTemplate[];
  /** Matching templates across every page, as the engine counted them. */
  total: number;
  page: number;
  pageSize: number;
};

export type PresentonExport = {
  /** The raw exported bytes (PPTX or PDF). */
  bytes: ArrayBuffer;
  /** Resolved from the export path's extension; never from a header string. */
  mimeType: string;
};

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export class PresentonError extends Error {
  readonly code: "not-configured" | "unreachable" | "rejected" | "failed";

  constructor(
    code: PresentonError["code"],
    message: string,
  ) {
    super(message);
    this.name = "PresentonError";
    this.code = code;
  }
}

export { isPresentonConfigured };

function requireBaseUrl(): string {
  const base = presentonBaseUrl();
  if (base === null) {
    throw new PresentonError(
      "not-configured",
      "Presentation generation isn't connected in this environment.",
    );
  }
  return base;
}

function requestHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = presentonApiKey();
  if (key !== null) headers.Authorization = `Bearer ${key}`;
  return headers;
}

/** Join a base URL and a slash-rooted path without losing the base's origin. */
function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
}

/**
 * A task id or remote path must be usable as a URL segment and nothing else:
 * a `/` or `..` in either would let a stored value reach a different route on
 * the Presenton host, so both are rejected before any fetch.
 */
function assertSafeSegment(value: string, label: string): void {
  if (
    value.trim() === "" ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("..") ||
    value.includes("?") ||
    value.includes("#")
  ) {
    throw new PresentonError("rejected", `Invalid Presenton ${label}.`);
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new PresentonError(
      "unreachable",
      "Couldn't reach the presentation service.",
    );
  }
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.trim() !== "") {
      return body.detail.slice(0, 300);
    }
  } catch {
    // Not JSON; the status alone is the detail.
  }
  return `Presenton answered ${response.status}.`;
}

function classifyHttpFailure(response: Response, detail: string): PresentonError {
  return response.status >= 500 || response.status === 429
    ? new PresentonError("unreachable", detail)
    : new PresentonError("rejected", detail);
}

function readTask(value: unknown): PresentonAsyncTask {
  if (typeof value !== "object" || value === null) {
    throw new PresentonError("failed", "The service returned an unreadable response.");
  }
  const task = value as Record<string, unknown>;
  if (typeof task.id !== "string" || typeof task.status !== "string") {
    throw new PresentonError("failed", "The service returned an unreadable response.");
  }
  const known: PresentonTaskStatus[] = [
    "pending",
    "processing",
    "completed",
    "error",
  ];
  return {
    id: task.id,
    type: typeof task.type === "string" ? task.type : "presentation.generate",
    status: known.includes(task.status as PresentonTaskStatus)
      ? (task.status as PresentonTaskStatus)
      : "error",
    message: typeof task.message === "string" ? task.message : null,
    data:
      typeof task.data === "object" && task.data !== null
        ? (task.data as PresentonTaskData)
        : null,
    error:
      typeof task.error === "object" && task.error !== null
        ? (task.error as Record<string, unknown>)
        : null,
    created_at: typeof task.created_at === "string" ? task.created_at : undefined,
    updated_at: typeof task.updated_at === "string" ? task.updated_at : undefined,
  };
}

/**
 * Build the §3.1 request body — pure and exported so the exact wire shape is
 * provable in an environment with no Presenton service;
 * {@link startPresentationGeneration} is the only production caller.
 *
 * Omission rules: an absent or empty optional never appears in the body — a
 * `null` would read as a real value on the service — while both booleans are
 * always present, because Presenton's own defaults differ from UniPilot's
 * request defaults (contents off, title slide on). Validation here is the same
 * pre-fetch gate as before: same inputs are rejected, with the same codes.
 */
export function buildGenerationRequestBody(
  input: PresentonGenerationInput,
): Record<string, unknown> {
  const content = input.content.trim().slice(0, PRESENTON_CONTENT_MAX_LENGTH);
  if (content === "") {
    throw new PresentonError("rejected", "A topic is required.");
  }
  if (
    input.nSlides !== null &&
    input.nSlides !== undefined &&
    (!Number.isInteger(input.nSlides) ||
      input.nSlides < 1 ||
      input.nSlides > PRESENTON_MAX_SLIDES)
  ) {
    throw new PresentonError("rejected", "Invalid slide count.");
  }
  const template = input.template.trim();
  if (template === "" || template.length > PRESENTON_TEMPLATE_MAX_LENGTH) {
    throw new PresentonError("rejected", "Invalid template.");
  }

  const instructions = input.instructions
    ?.trim()
    .slice(0, PRESENTON_INSTRUCTIONS_MAX_LENGTH);

  const body: Record<string, unknown> = {
    content,
    template,
    export_as: input.format,
    include_table_of_contents: input.includeTableOfContents === true,
    include_title_slide: input.includeTitleSlide !== false,
  };
  if (input.nSlides) body.n_slides = input.nSlides;
  if (input.language) body.language = input.language;
  if (instructions) body.instructions = instructions;
  if (input.tone) body.tone = input.tone;
  if (input.verbosity) body.verbosity = input.verbosity;
  if (input.sourceFiles && input.sourceFiles.length > 0) {
    body.files = input.sourceFiles;
  }

  return body;
}

/**
 * §3.1 (docs/integrations/presenton.md) — start an async generation. The
 * response is Presenton's `AsyncTaskModel`; poll it with
 * {@link getPresentationTaskStatus} until `completed`/`error`.
 */
export async function startPresentationGeneration(
  input: PresentonGenerationInput,
): Promise<PresentonAsyncTask> {
  const base = requireBaseUrl();
  const body = buildGenerationRequestBody(input);

  const response = await fetchWithTimeout(
    joinUrl(base, "/api/v1/ppt/presentation/generate/async"),
    {
      method: "POST",
      headers: { ...requestHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    START_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw classifyHttpFailure(response, await readErrorDetail(response));
  }

  return readTask(await response.json());
}

/** §3.2 — one poll. Includes progress (`created_slides`/`remaining_slides`). */
export async function getPresentationTaskStatus(
  taskId: string,
): Promise<PresentonAsyncTask> {
  const base = requireBaseUrl();
  assertSafeSegment(taskId, "task id");

  // Upstream workaround (2026-09-14, see docs/integrations/presenton.md §3.2):
  // `GET /presentation/status/{id}` 500s for any task with data on the current
  // upstream image (an ORM bug mutating a GC'd copy). The list endpoint reads
  // the same rows without the mutation; revert once upstream fixes the route.
  const response = await fetchWithTimeout(
    joinUrl(
      base,
      "/api/v1/async-tasks?type=presentation.generate&limit=200&order=desc",
    ),
    { method: "GET", headers: requestHeaders() },
    STATUS_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw classifyHttpFailure(response, await readErrorDetail(response));
  }

  const tasks: unknown = await response.json();
  const task = Array.isArray(tasks)
    ? (tasks as Record<string, unknown>[]).find(
        (candidate) => candidate.id === taskId,
      )
    : undefined;
  if (task === undefined) {
    throw new PresentonError("rejected", "Presentation task not found.");
  }
  return readTask(task);
}

/** §3.5's own defaults: the first page of up to 100 built-in templates. */
export const PRESENTON_TEMPLATE_PAGE_DEFAULT = 1;
export const PRESENTON_TEMPLATE_PAGE_SIZE_DEFAULT = 100;
/** The engine route's own bound (`Query(default=20, ge=1, le=100)`). */
export const PRESENTON_TEMPLATE_PAGE_SIZE_MAX = 100;

/** The §3.5 list request's caller options; the defaults preserve the picker's original query. */
export type PresentonTemplateListOptions = {
  /** 1-based page; validated before any fetch. */
  page?: number;
  /** Entries per page; the engine accepts 1–100. */
  pageSize?: number;
  /**
   * `false` (default) restricts the read to built-in templates (`default=true`).
   * `true` omits the engine's `default` filter, so the page carries built-ins
   * plus custom templates: the route has no "custom only" filter, and
   * `default=false` would mean exactly that.
   */
  includeCustom?: boolean;
};

/**
 * Build the §3.5 request path — pure and exported so the exact query is
 * provable in an environment with no service. The bounds are the engine
 * route's own (`page ≥ 1`, `1 ≤ page_size ≤ 100`); an out-of-range value is a
 * caller bug and fails the pre-fetch gate (`rejected`) rather than being
 * clamped into a different page than the caller asked for.
 */
export function buildTemplateListQuery(
  options: PresentonTemplateListOptions = {},
): string {
  const page = options.page ?? PRESENTON_TEMPLATE_PAGE_DEFAULT;
  const pageSize = options.pageSize ?? PRESENTON_TEMPLATE_PAGE_SIZE_DEFAULT;
  if (!Number.isInteger(page) || page < 1) {
    throw new PresentonError("rejected", "Invalid template page.");
  }
  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > PRESENTON_TEMPLATE_PAGE_SIZE_MAX
  ) {
    throw new PresentonError("rejected", "Invalid template page size.");
  }

  const params = new URLSearchParams();
  if (options.includeCustom !== true) params.set("default", "true");
  params.set("page", String(page));
  params.set("page_size", String(pageSize));
  return `/api/v1/ppt/template/all?${params.toString()}`;
}

/**
 * §3.5 — one page of templates. Built-ins only, first page, up to 100, by
 * default; {@link PresentonTemplateListOptions} widens the read faithfully
 * (`includeCustom` omits the `default` filter, `page`/`pageSize` go as asked).
 * The returned `page`/`pageSize` are the request's own validated values, never
 * the engine's echo, and `total` is the engine's count of matching templates
 * (falling back to the page's usable item count when the envelope omits it).
 * Item normalization and the failure vocabulary are unchanged.
 */
export async function listPresentationTemplates(
  options: PresentonTemplateListOptions = {},
): Promise<PresentonTemplatePage> {
  const base = requireBaseUrl();
  const path = buildTemplateListQuery(options);

  const response = await fetchWithTimeout(
    joinUrl(base, path),
    { method: "GET", headers: requestHeaders() },
    TEMPLATES_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw classifyHttpFailure(response, await readErrorDetail(response));
  }

  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !Array.isArray((body as { items?: unknown }).items)
  ) {
    throw new PresentonError("failed", "The service returned an unreadable response.");
  }

  const items = (body as { items: unknown[] }).items
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null,
    )
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "",
      name: typeof item.name === "string" ? item.name : "",
      description:
        typeof item.description === "string" && item.description.trim() !== ""
          ? item.description
          : null,
      layoutCount: typeof item.layout_count === "number" ? item.layout_count : 0,
      isDefault: item.is_default === true,
    }))
    .filter((template) => template.id !== "" && template.name !== "");

  const total = (body as { total?: unknown }).total;
  return {
    items,
    total:
      typeof total === "number" && Number.isFinite(total)
        ? total
        : items.length,
    page: options.page ?? PRESENTON_TEMPLATE_PAGE_DEFAULT,
    pageSize: options.pageSize ?? PRESENTON_TEMPLATE_PAGE_SIZE_DEFAULT,
  };
}

/**
 * A deck response must at least be the documented envelope before any consumer
 * treats it as one. `ui`/element payloads stay unvalidated service JSON (the
 * engine stores them unvalidated too), so the renderer's helpers default on
 * absent fields rather than the read rejecting a renderable deck.
 */
function readDeck(value: unknown): PresentationDeck {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as Record<string, unknown>).id !== "string" ||
    !Array.isArray((value as Record<string, unknown>).slides)
  ) {
    throw new PresentonError("failed", "The service returned an unreadable response.");
  }
  return value as PresentationDeck;
}

/**
 * The template read's normalization, same envelope posture as {@link readDeck}.
 * The engine serves `layouts`, `theme` and `fonts` on this route (probed live
 * 2026-09-20: `general` carries all three); the fields a preview depends on are
 * normalized to the type's contract here — a malformed or absent value becomes
 * `null`/`{}` instead of reaching the renderer, which states absence honestly.
 * Layout/theme payloads stay unvalidated service JSON, exactly as stored.
 */
function readTemplate(value: unknown): PresentationTemplate {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as Record<string, unknown>).id !== "string" ||
    typeof (value as Record<string, unknown>).name !== "string"
  ) {
    throw new PresentonError("failed", "The service returned an unreadable response.");
  }
  const template = value as Record<string, unknown>;
  return {
    ...(value as PresentationTemplate),
    layouts:
      typeof template.layouts === "object" &&
      template.layouts !== null &&
      !Array.isArray(template.layouts) &&
      Array.isArray((template.layouts as { layouts?: unknown }).layouts)
        ? (template.layouts as TemplateLayouts)
        : null,
    theme:
      typeof template.theme === "object" &&
      template.theme !== null &&
      !Array.isArray(template.theme)
        ? (template.theme as DeckTheme)
        : null,
    fonts: normalizeTemplateFonts(template.fonts),
  };
}

/** `{family: url}` as stored in the template's assets; trimmed, non-empty entries only. */
function normalizeTemplateFonts(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const fonts: Record<string, string> = {};
  for (const [family, url] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (family.trim() !== "" && typeof url === "string" && url.trim() !== "") {
      fonts[family.trim()] = url.trim();
    }
  }
  return fonts;
}

/**
 * §7.3 — the native viewer's deck read: slides, hydrated `ui`, `theme`, `fonts`
 * and the `generation_mode`/`type` flags. Returned as stored by the engine;
 * {@link readDeck} checks only the envelope.
 */
export async function getPresentationDeck(
  presentationId: string,
): Promise<PresentationDeck> {
  const base = requireBaseUrl();
  assertSafeSegment(presentationId, "presentation id");

  const response = await fetchWithTimeout(
    joinUrl(base, `/api/v1/ppt/presentation/${presentationId}`),
    { method: "GET", headers: requestHeaders() },
    DECK_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw classifyHttpFailure(response, await readErrorDetail(response));
  }

  return readDeck(await response.json());
}

/**
 * §7.3 — one template's layouts, theme and fonts (template previews and the
 * hydration module in C share this read). The live engine carries the theme on
 * this route; {@link getTemplateTheme} is the explicit read for a template
 * whose stored theme is absent (`theme: null`). Same guards and failure
 * vocabulary as {@link listPresentationTemplates}.
 */
export async function getPresentationTemplate(
  templateId: string,
): Promise<PresentationTemplate> {
  const base = requireBaseUrl();
  assertSafeSegment(templateId, "template id");

  const response = await fetchWithTimeout(
    joinUrl(base, `/api/v1/ppt/template/${templateId}`),
    { method: "GET", headers: requestHeaders() },
    TEMPLATES_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw classifyHttpFailure(response, await readErrorDetail(response));
  }

  return readTemplate(await response.json());
}

/**
 * §7.3 — one template's semantic theme through the engine's deriving route
 * (`GET /template/{id}/theme`). Unlike {@link getPresentationTemplate}'s stored
 * `theme`, this route derives and persists the theme when the stored one is
 * absent (engine `_derive_template_theme`), which is how a custom template
 * created before theme derivation becomes previewable. `null` is an honest
 * "the engine has nothing to derive", not an error; the usual guards apply.
 * The adapter never calls this from inside `getPresentationTemplate`: the
 * deriving route persists engine state, so the read stays side-effect-free and
 * a caller that needs the derived theme asks for it explicitly.
 */
export async function getTemplateTheme(
  templateId: string,
): Promise<DeckTheme | null> {
  const base = requireBaseUrl();
  assertSafeSegment(templateId, "template id");

  const response = await fetchWithTimeout(
    joinUrl(base, `/api/v1/ppt/template/${templateId}/theme`),
    { method: "GET", headers: requestHeaders() },
    TEMPLATES_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw classifyHttpFailure(response, await readErrorDetail(response));
  }

  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    typeof (body as { template_id?: unknown }).template_id !== "string"
  ) {
    throw new PresentonError("failed", "The service returned an unreadable response.");
  }
  const theme = (body as { theme?: unknown }).theme;
  return typeof theme === "object" && theme !== null && !Array.isArray(theme)
    ? (theme as DeckTheme)
    : null;
}

/**
 * §7.3 — one custom theme as the engine serves it (`GET /themes/all`,
 * `ThemeResponse`). `theme` is the whole response entry, returned verbatim:
 * the entry's `data` carries the palette (`{colors, fonts}`), so it reads as
 * a `DeckThemePackage` everywhere a theme value is used — the editor forwards
 * it to `PATCH /update` exactly as received, never flattened or rebuilt.
 */
export type PresentonTheme = {
  id: string;
  /** The picker's label when the engine names the theme, else null. */
  name: string | null;
  /** The entry as served; the theme value forwarded on selection. */
  theme: Record<string, unknown>;
};

/**
 * §7.3/§5.4 — the theme picker's custom list. The same envelope posture as the
 * template list: a non-array body or a non-2xx answer throws the adapter's
 * classified error, entries without a usable id are dropped (never guessed
 * at), and every surviving entry is passed through untouched.
 */
export async function listPresentationThemes(): Promise<PresentonTheme[]> {
  const base = requireBaseUrl();

  const response = await fetchWithTimeout(
    joinUrl(base, "/api/v1/ppt/themes/all"),
    { method: "GET", headers: requestHeaders() },
    TEMPLATES_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw classifyHttpFailure(response, await readErrorDetail(response));
  }

  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    throw new PresentonError("failed", "The service returned an unreadable response.");
  }

  return body
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null && !Array.isArray(entry),
    )
    .filter((entry) => typeof entry.id === "string" && entry.id !== "")
    .map((entry) => ({
      id: entry.id as string,
      name:
        typeof entry.name === "string" && entry.name.trim() !== ""
          ? entry.name.trim()
          : null,
      theme: entry,
    }));
}

// ---------------------------------------------------------------------------
// Editor mutations (§7.4–§7.5) — pure bodies first, then the wire calls
// ---------------------------------------------------------------------------

/** Every structural slide id must be a UUID (`slides.id` is a UUID pk). */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The theme slot is never omitted and never null. Upstream writes `None` for
 * an absent key, and `JSON.stringify` would drop an `undefined` value anyway,
 * so untrusted input (C4's Server Action forwards browser state through here)
 * must fail the pre-fetch gate instead of silently wiping a deck's theme.
 */
function requireTheme(theme: unknown): DeckTheme | DeckThemePackage {
  if (typeof theme !== "object" || theme === null) {
    throw new PresentonError("rejected", "A theme is required.");
  }
  return theme as DeckTheme | DeckThemePackage;
}

/**
 * §7.4 — the rename/theme-change body for `PATCH /presentation/update`.
 *
 * `theme` must be the deck's current theme object — a resolved flat theme or
 * the stored `DeckThemePackage`, forwarded verbatim so a rename never flattens
 * the stored shape. It is always present even for a pure rename: upstream
 * writes `None` whenever the key is absent (`if theme or theme is None`),
 * which wipes the deck's theme. `title` is omitted when absent and trimmed
 * otherwise; upstream ignores a falsy title, so an empty rename must never
 * silently become a no-op.
 */
export function buildPresentationUpdateBody(input: {
  id: string;
  title?: string;
  theme: DeckTheme | DeckThemePackage;
}): Record<string, unknown> {
  assertSafeSegment(input.id, "presentation id");
  const body: Record<string, unknown> = {
    id: input.id,
    theme: requireTheme(input.theme),
  };
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (title === "") {
      throw new PresentonError("rejected", "A deck title is required.");
    }
    body.title = title;
  }
  return body;
}

/**
 * The ten fields every slide write carries. `ui`, `html_content`, `properties`
 * and `speaker_note` are sent as explicit nulls when absent: the engine types
 * them optional, and a deck state that had no value must not keep a stale one.
 */
function slideWriteRecord(slide: DeckSlide): Record<string, unknown> {
  return {
    id: slide.id,
    presentation: slide.presentation,
    layout_group: slide.layout_group,
    layout: slide.layout,
    index: slide.index,
    content: slide.content,
    properties: slide.properties ?? null,
    ui: slide.ui ?? null,
    html_content: slide.html_content ?? null,
    speaker_note: slide.speaker_note ?? null,
  };
}

/**
 * §7.4 — the single-slide body for `PATCH /presentation/slide_update` (text,
 * notes, single-side layouts, element properties). The engine ignores
 * `id`/`presentation`/`index` on the stored row (and rejects a slide whose
 * `presentation` does not match), so the full loaded slide is sent unchanged:
 * no id rotation.
 */
export function buildSlideUpdateBody(
  slide: DeckSlide,
): { slide: Record<string, unknown> } {
  return { slide: slideWriteRecord(slide) };
}

/**
 * §7.5 — the full-array body for a structural edit (add/delete/duplicate/
 * reorder) through `PATCH /presentation/update`.
 *
 * The engine deletes the deck's rows scoped to the request's owner and then
 * inserts the incoming rows as given (`presentation.py:2488-2494`; the delete
 * precedes `add_all`). Whenever the request's owner scope does not match the
 * deck's slides — this runtime runs `DISABLE_AUTH` (owner `None`) while the
 * existing decks are owner-scoped — the delete removes nothing, so a reused id
 * collides with `UNIQUE(slides.id)` (controller ruling 2026-09-16). Every
 * slide **must therefore carry a freshly generated UUID**; freshness against
 * the stored deck is not checkable here (the existing ids are unknowable — the
 * caller guarantees it), so this builder enforces everything it can: at least
 * one slide, at most {@link PRESENTON_MAX_SLIDES}, every id a UUID, no two
 * slides sharing one (case-insensitively), and every slide owned by `id` — a
 * foreign `presentation` would insert another deck's slide into this deck's
 * replacement, corrupting both.
 *
 * `theme` must be a theme object and is always present for the same reason as
 * the metadata body; the full field set is sent because the route re-inserts
 * the rows wholesale.
 *
 * `nSlides` (C4) is the stored count the route keeps beside the array: the
 * engine's replace path re-inserts slides but never recomputes `n_slides`, so
 * a caller that does not send it leaves the deck's count stale. When provided
 * it must equal the array length (a mismatch is a caller bug, not a request to
 * make); when omitted the field is left out exactly as before.
 */
export function buildSlidesReplaceBody(input: {
  id: string;
  theme: DeckTheme | DeckThemePackage;
  slides: DeckSlide[];
  nSlides?: number;
}): Record<string, unknown> {
  assertSafeSegment(input.id, "presentation id");
  const theme = requireTheme(input.theme);
  if (input.slides.length === 0 || input.slides.length > PRESENTON_MAX_SLIDES) {
    throw new PresentonError("rejected", "Invalid slide list.");
  }
  if (
    input.nSlides !== undefined &&
    (!Number.isInteger(input.nSlides) || input.nSlides !== input.slides.length)
  ) {
    throw new PresentonError("rejected", "Invalid slide count.");
  }

  const seen = new Set<string>();
  for (const slide of input.slides) {
    if (!UUID_PATTERN.test(slide.id)) {
      throw new PresentonError("rejected", "Invalid slide id.");
    }
    if (slide.presentation !== input.id) {
      throw new PresentonError(
        "rejected",
        "A slide belongs to a different deck.",
      );
    }
    const key = slide.id.toLowerCase();
    if (seen.has(key)) {
      throw new PresentonError("rejected", "Duplicate slide id.");
    }
    seen.add(key);
  }

  const body: Record<string, unknown> = {
    id: input.id,
    theme,
    slides: input.slides.map(slideWriteRecord),
  };
  if (input.nSlides !== undefined) body.n_slides = input.nSlides;
  return body;
}

/**
 * §7.5 capability gate — the structural replace only works when the delete's
 * owner scope matches the deck's slides (auth plus an owner-scoped API key, or
 * decks created in the same `DISABLE_AUTH` runtime). This engine runs
 * `DISABLE_AUTH` (owner is `None`), so the replace is blocked for existing
 * decks; the capability therefore ships dark behind this server-only flag.
 * Any value other than `"1"` — including unset — is off. `updatePresentation`'s
 * structural branch enforces the same gate server-side, C4's editor renders
 * structural controls disabled with an honest reason unless this is true, and
 * neither ever fakes a structural edit. Read at call time, never inlined at
 * build.
 */
export function isStructuralEditingEnabled(): boolean {
  return process.env.PRESENTON_STRUCTURAL_EDITS === "1";
}

/**
 * The shared write transport: one JSON PATCH/POST with the adapter's headers,
 * timeout and failure classification. Nothing is parsed from the response —
 * the editor re-reads the deck through {@link getPresentationDeck} instead.
 */
async function sendJsonWrite(
  method: "PATCH" | "POST",
  url: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<void> {
  const response = await fetchWithTimeout(
    url,
    {
      method,
      headers: { ...requestHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
  if (!response.ok) {
    throw classifyHttpFailure(response, await readErrorDetail(response));
  }
}

/**
 * §7.4 — rename a deck and/or apply a theme, or replace the whole slide array
 * (structural saves) through the same route. The engine answers with the whole
 * deck; callers re-read it rather than trusting the write response.
 *
 * The structural branch is the gated wiring: it never sends unless
 * {@link isStructuralEditingEnabled} is true, so with the flag off (this
 * runtime) the honest failure is a permanent `rejected` instead of a write
 * that would delete nothing. A structural call may not carry a rename — the
 * editor saves one change reason at a time — so an ambiguous input is refused
 * rather than silently dropping the title.
 */
export async function updatePresentation(input: {
  id: string;
  title?: string;
  theme: DeckTheme | DeckThemePackage;
  /** Present ⇒ a full-array structural write ({@link buildSlidesReplaceBody}). */
  slides?: DeckSlide[];
  /** The count the structural write stores; only meaningful with `slides`. */
  nSlides?: number;
}): Promise<void> {
  const base = requireBaseUrl();
  const url = joinUrl(base, "/api/v1/ppt/presentation/update");

  if (input.slides !== undefined) {
    if (!isStructuralEditingEnabled()) {
      throw new PresentonError(
        "rejected",
        "Structural editing isn't enabled in this environment.",
      );
    }
    if (input.title !== undefined) {
      throw new PresentonError(
        "rejected",
        "A structural write can't rename the deck.",
      );
    }
    await sendJsonWrite(
      "PATCH",
      url,
      buildSlidesReplaceBody({
        id: input.id,
        theme: input.theme,
        slides: input.slides,
        nSlides: input.nSlides,
      }),
      MUTATION_TIMEOUT_MS,
    );
    return;
  }

  await sendJsonWrite(
    "PATCH",
    url,
    buildPresentationUpdateBody(input),
    MUTATION_TIMEOUT_MS,
  );
}

/**
 * §7.4 — update one slide (text, notes, single-side layouts, element
 * properties). `presentationId` is checked against the slide's own
 * `presentation` before anything leaves this process: the engine rejects a
 * mismatch too, but a cross-deck write must never be attempted at all.
 */
export async function updateSlide(
  presentationId: string,
  slide: DeckSlide,
): Promise<void> {
  const base = requireBaseUrl();
  assertSafeSegment(presentationId, "presentation id");
  if (slide.presentation !== presentationId) {
    throw new PresentonError(
      "rejected",
      "The slide belongs to a different deck.",
    );
  }
  await sendJsonWrite(
    "PATCH",
    joinUrl(base, "/api/v1/ppt/presentation/slide_update"),
    buildSlideUpdateBody(slide),
    MUTATION_TIMEOUT_MS,
  );
}

/**
 * §7.4/§7.7 — ask the engine to export an existing deck. The worker is the
 * only production caller of the export path (C1); this request-only capability
 * never downloads or stores bytes.
 */
export async function requestPresentationExport(
  presentationId: string,
  format: PresentonExportFormat,
): Promise<void> {
  const base = requireBaseUrl();
  assertSafeSegment(presentationId, "presentation id");
  await sendJsonWrite(
    "POST",
    joinUrl(base, `/api/v1/ppt/presentation/${presentationId}/export`),
    { export_as: format },
    EXPORT_REQUEST_TIMEOUT_MS,
  );
}

/**
 * §3.4 — upload one source document (the bytes are read from UniPilot's own
 * private bucket by the worker) and return the Presenton-side paths to pass
 * into `files` on §3.1.
 */
export async function uploadPresentationSourceFile(input: {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<string[]> {
  const base = requireBaseUrl();

  if (input.bytes.byteLength === 0 || input.bytes.byteLength > PRESENTON_SOURCE_FILE_MAX_BYTES) {
    throw new PresentonError("rejected", "Invalid source document.");
  }

  const form = new FormData();
  form.append(
    "files",
    new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }),
    input.name,
  );

  const response = await fetchWithTimeout(
    joinUrl(base, "/api/v1/ppt/files/upload"),
    {
      method: "POST",
      headers: requestHeaders(),
      body: form,
    },
    UPLOAD_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw classifyHttpFailure(response, await readErrorDetail(response));
  }

  const body: unknown = await response.json();
  if (!Array.isArray(body) || !body.every((entry) => typeof entry === "string")) {
    throw new PresentonError("failed", "The service returned an unreadable response.");
  }
  return body as string[];
}

/**
 * §3.3 — fetch the exported file. The path is validated against Presenton's
 * own static mount (`/app_data/…`) before any request: a stored value can
 * never be turned into a request for another route or host.
 */
export async function downloadPresentationExport(
  remotePath: string,
): Promise<PresentonExport> {
  const base = requireBaseUrl();

  if (!remotePath.startsWith("/app_data/") || remotePath.includes("..")) {
    throw new PresentonError("rejected", "Invalid export path.");
  }

  const response = await fetchWithTimeout(
    joinUrl(base, remotePath),
    { method: "GET", headers: requestHeaders() },
    DOWNLOAD_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw classifyHttpFailure(response, await readErrorDetail(response));
  }

  const lower = remotePath.toLowerCase();
  const mimeType = lower.endsWith(".pdf")
    ? "application/pdf"
    : lower.endsWith(".pptx")
      ? PPTX_MIME
      : response.headers.get("content-type")?.split(";")[0]?.trim() ||
        "application/octet-stream";

  return { bytes: await response.arrayBuffer(), mimeType };
}

/** One proxied engine asset: the raw bytes plus the extension-derived type. */
export type PresentonAsset = {
  bytes: ArrayBuffer;
  /** Resolved from the path's extension by the shared asset policy (spec §6.9). */
  contentType: string;
};

/**
 * B2 — fetch one asset for the owner-gated proxy. The path has already passed
 * the route's policy (`classifyAssetPath`); the adapter re-enforces the same
 * prefix + traversal/encoding guard (`isSafeAssetPath`, which rejects `..`,
 * `\`, `//`, `%`, `?` and `#`) before any request, so no stored or caller value
 * can be turned into a request for another route or host. The content type is
 * derived from the path, never trusted from the engine (its static mount
 * answers `application/octet-stream` for fonts). No bytes and no paths are
 * ever logged; failures use the adapter's existing classification.
 */
export async function fetchPresentationAsset(
  path: string,
): Promise<PresentonAsset> {
  const base = requireBaseUrl();
  if (!isSafeAssetPath(path)) {
    throw new PresentonError("rejected", "Invalid asset path.");
  }

  const response = await fetchWithTimeout(
    joinUrl(base, path),
    { method: "GET", headers: requestHeaders() },
    ASSET_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw classifyHttpFailure(response, await readErrorDetail(response));
  }

  return {
    bytes: await response.arrayBuffer(),
    contentType: assetContentType(path),
  };
}

// ---------------------------------------------------------------------------
// Task D3 — the editor's image surface (§5.4 images row, §7.4)
//
// Search (Pexels/Pixabay through the engine), provider generation, the
// generated/uploaded library and deletion all live here; the browser reaches
// them through Server Actions, and uploads through the owner-gated route
// handler (the API key never leaves the server). Responses are normalized to
// the fields the UI actually renders. Prompts, query strings and filesystem
// paths are never logged.
// ---------------------------------------------------------------------------

/** The engine's two image-library partitions (`is_uploaded`). */
export type PresentonImageKind = "generated" | "uploaded";

/** One engine image asset, normalized (`GET /images/generated|uploaded`). */
export type PresentonImage = {
  id: string;
  /** The engine's `created_at` as served, when it carried one. */
  createdAt: string | null;
  /** True for `uploaded`, false for `generated`. */
  isUploaded: boolean;
  /**
   * The browser-facing `/app_data/images/…` path the asset proxy can serve.
   * The engine's filesystem path is deliberately not carried past this adapter
   * (review fix): it is not needed by any caller and must not reach the
   * browser.
   */
  fileUrl: string;
  /** The recorded image prompt (generated assets may carry one in `extras`). */
  prompt: string | null;
};

/**
 * The engine answers provider-less generation with a static placeholder
 * (`absolute_fastapi_asset_url("/static/images/placeholder.jpg")`). UniPilot
 * never inserts that placeholder (no fake images) — the caller detects it and
 * shows the honest "generation isn't configured" state instead. Pure and
 * exported so the check is provable without an engine.
 */
export function isPresentonPlaceholderImage(url: string): boolean {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (trimmed === "") return false;
  const [path] = trimmed.split(/[?#]/, 1);
  return path.endsWith("/static/images/placeholder.jpg");
}

/**
 * One library entry as `{id, created_at, is_uploaded, path, extras, file_url}`
 * (the engine's `_image_asset_api_dict`), normalized; null when the entry has
 * no usable id or browser-facing path (never guessed at). The filesystem `path`
 * is dropped here so it can never cross to a caller.
 */
export function normalizePresentonImage(value: unknown): PresentonImage | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  const fileUrl =
    typeof entry.file_url === "string" ? entry.file_url.trim() : "";
  if (id === "" || fileUrl === "") return null;
  const extras =
    typeof entry.extras === "object" && entry.extras !== null
      ? (entry.extras as Record<string, unknown>)
      : null;
  const prompt =
    extras !== null &&
    typeof extras.prompt === "string" &&
    extras.prompt.trim() !== ""
      ? extras.prompt.trim()
      : null;
  return {
    id,
    createdAt:
      typeof entry.created_at === "string" && entry.created_at !== ""
        ? entry.created_at
        : null,
    isUploaded: entry.is_uploaded === true,
    fileUrl,
    prompt,
  };
}

/** The search route's `List[str]`, keeping only non-empty strings. */
export function normalizePresentonImageSearch(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is string =>
        typeof entry === "string" && entry.trim() !== "",
    )
    .map((entry) => entry.trim());
}

/**
 * §5.4 — stock image search through the engine. `page` is not a route
 * parameter on this engine (the route takes `limit`, 1..30, default 12), so
 * the caller's limit is clamped to that range. A configured provider returns
 * absolute URL strings; an unconfigured one answers 4xx (classified
 * `rejected`) and the UI states that honestly.
 */
export async function searchPresentationImages(
  query: string,
  limit: number = PRESENTON_IMAGE_SEARCH_DEFAULT_LIMIT,
): Promise<string[]> {
  const base = requireBaseUrl();
  const normalizedQuery = typeof query === "string" ? query.trim() : "";
  if (normalizedQuery === "") {
    throw new PresentonError("rejected", "An image search query is required.");
  }
  if (normalizedQuery.length > PRESENTON_IMAGE_QUERY_MAX_LENGTH) {
    throw new PresentonError("rejected", "The image search query is too long.");
  }
  const boundedLimit = Number.isFinite(limit)
    ? Math.min(
        Math.max(Math.trunc(limit), 1),
        PRESENTON_IMAGE_SEARCH_MAX_LIMIT,
      )
    : PRESENTON_IMAGE_SEARCH_DEFAULT_LIMIT;

  const response = await fetchWithTimeout(
    joinUrl(
      base,
      `/api/v1/ppt/images/search?query=${encodeURIComponent(
        normalizedQuery,
      )}&limit=${boundedLimit}`,
    ),
    { method: "GET", headers: requestHeaders() },
    IMAGES_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw classifyHttpFailure(response, await readErrorDetail(response));
  }

  return normalizePresentonImageSearch(await response.json());
}

/**
 * §5.4 — generate one image from a prompt. The engine answers with a single
 * URL string (a provider URL, an `/app_data/images/…` file URL, or its
 * placeholder when generation is disabled); the raw string is returned
 * faithfully and the caller applies {@link isPresentonPlaceholderImage}.
 */
export async function generatePresentationImage(
  prompt: string,
): Promise<string> {
  const base = requireBaseUrl();
  const normalizedPrompt = typeof prompt === "string" ? prompt.trim() : "";
  if (normalizedPrompt === "") {
    throw new PresentonError("rejected", "An image prompt is required.");
  }
  if (normalizedPrompt.length > PRESENTON_IMAGE_PROMPT_MAX_LENGTH) {
    throw new PresentonError("rejected", "The image prompt is too long.");
  }

  const response = await fetchWithTimeout(
    joinUrl(
      base,
      `/api/v1/ppt/images/generate?prompt=${encodeURIComponent(
        normalizedPrompt,
      )}`,
    ),
    { method: "GET", headers: requestHeaders() },
    IMAGE_GENERATE_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw classifyHttpFailure(response, await readErrorDetail(response));
  }

  const body: unknown = await response.json();
  if (typeof body !== "string" || body.trim() === "") {
    throw new PresentonError(
      "failed",
      "The service returned an unreadable response.",
    );
  }
  return body.trim();
}

/** §5.4 — one library partition (`generated` or `uploaded`), newest first. */
export async function listPresentationImages(
  kind: PresentonImageKind,
): Promise<PresentonImage[]> {
  const base = requireBaseUrl();
  if (kind !== "generated" && kind !== "uploaded") {
    throw new PresentonError("rejected", "Invalid image library.");
  }

  const response = await fetchWithTimeout(
    joinUrl(base, `/api/v1/ppt/images/${kind}`),
    { method: "GET", headers: requestHeaders() },
    IMAGES_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw classifyHttpFailure(response, await readErrorDetail(response));
  }

  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    throw new PresentonError(
      "failed",
      "The service returned an unreadable response.",
    );
  }
  return body
    .map(normalizePresentonImage)
    .filter((image): image is PresentonImage => image !== null);
}

/**
 * §5.4/§7.4 — forward one uploaded image to the engine's image store and
 * return the created asset. Validation here mirrors the route's pre-checks
 * (bounded bytes, an allowed extension, an image/* type when the browser sent
 * one); the engine re-validates the actual bytes and rejects a corrupt file.
 */
export async function uploadPresentationImage(input: {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<PresentonImage> {
  const base = requireBaseUrl();

  if (
    input.bytes.byteLength === 0 ||
    input.bytes.byteLength > IMAGE_UPLOAD_MAX_BYTES
  ) {
    throw new PresentonError("rejected", "Invalid image file.");
  }
  const name = typeof input.name === "string" ? input.name : "";
  const dot = name.lastIndexOf(".");
  const extension = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  if (
    !(IMAGE_UPLOAD_EXTENSIONS as readonly string[]).includes(extension)
  ) {
    throw new PresentonError("rejected", "Invalid image file.");
  }
  if (input.mimeType !== "" && !input.mimeType.startsWith("image/")) {
    throw new PresentonError("rejected", "Invalid image file.");
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(input.bytes)], {
      type: input.mimeType || "application/octet-stream",
    }),
    name === "" ? `upload${extension}` : name,
  );

  const response = await fetchWithTimeout(
    joinUrl(base, "/api/v1/ppt/images/upload"),
    {
      method: "POST",
      headers: requestHeaders(),
      body: form,
    },
    IMAGE_UPLOAD_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw classifyHttpFailure(response, await readErrorDetail(response));
  }

  const image = normalizePresentonImage(await response.json());
  if (image === null) {
    throw new PresentonError(
      "failed",
      "The service returned an unreadable response.",
    );
  }
  return image;
}

/**
 * §5.4 — delete one engine image asset by id. A missing id makes the engine's
 * route answer 500 (its own `except Exception` wraps the 404), so callers
 * should only ask for ids the library listed; transport and classification are
 * the adapter's usual.
 */
export async function deletePresentationImage(id: string): Promise<void> {
  const base = requireBaseUrl();
  if (!UUID_PATTERN.test(id)) {
    throw new PresentonError("rejected", "Invalid image id.");
  }

  const response = await fetchWithTimeout(
    joinUrl(base, `/api/v1/ppt/images/${id}`),
    { method: "DELETE", headers: requestHeaders() },
    MUTATION_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw classifyHttpFailure(response, await readErrorDetail(response));
  }
}

// ---------------------------------------------------------------------------
// Task D4 — the editor's icon surface (§5.4 icons row, §7.4)
//
// The engine's icon catalog (`GET /icons/search`, a vector store over its
// bundled SVG icons) returns absolute or engine-relative `/static/icons/…`
// URLs. They are normalized to relative paths here so every consumer — the
// picker's proxy previews and the renderer's recolor fetch — uses the
// owner-gated asset proxy; `is_icon`/`color` land on the element through the
// single-slide `slide_update` path. Queries and paths are never logged.
// ---------------------------------------------------------------------------

/** One normalized catalog result: the engine-relative icon path + its weight. */
export type PresentonIcon = {
  /** The engine-relative `/static/icons/<weight>/<file>.svg` path. */
  path: string;
  /**
   * The weight embedded in the path. The engine falls back to its default
   * (`bold`) when the requested weight has no file for the matched icon, so
   * the path — not the request — is authoritative.
   */
  weight: IconType;
};

/**
 * One catalog entry as an engine path, or null when it is not a usable icon
 * asset (never guessed at). `normalizeIconPath` owns the prefix/extension/
 * traversal policy; the weight is read back from the path.
 */
export function normalizePresentonIcon(value: unknown): PresentonIcon | null {
  const path = normalizeIconPath(value);
  if (path === null) return null;
  return { path, weight: iconWeightFromPath(path) ?? DEFAULT_ICON_WEIGHT };
}

/**
 * §5.4/§7.4 — icon catalog search. Mirrors the engine route faithfully:
 * `query` is required, `limit` defaults to 20, and the optional type/weight
 * select the style directory (the route accepts both `icon_type` and
 * `icon_weight`; an invalid value normalizes to `bold` on the engine, so it
 * is normalized here the same way). Results are de-duplicated paths, in the
 * engine's relevance order.
 */
export async function searchPresentationIcons(
  query: string,
  options: { type?: IconType; weight?: IconType; limit?: number } = {},
): Promise<PresentonIcon[]> {
  const base = requireBaseUrl();
  const normalizedQuery = typeof query === "string" ? query.trim() : "";
  if (normalizedQuery === "") {
    throw new PresentonError("rejected", "An icon search query is required.");
  }
  if (normalizedQuery.length > PRESENTON_ICON_QUERY_MAX_LENGTH) {
    throw new PresentonError("rejected", "The icon search query is too long.");
  }
  const boundedLimit = Number.isFinite(options.limit)
    ? Math.min(
        Math.max(Math.trunc(options.limit as number), 1),
        PRESENTON_ICON_SEARCH_MAX_LIMIT,
      )
    : PRESENTON_ICON_SEARCH_DEFAULT_LIMIT;

  const params = new URLSearchParams({
    query: normalizedQuery,
    limit: String(boundedLimit),
  });
  if (options.type !== undefined) {
    params.set("icon_type", normalizeIconWeight(options.type));
  }
  if (options.weight !== undefined) {
    params.set("icon_weight", normalizeIconWeight(options.weight));
  }

  const response = await fetchWithTimeout(
    joinUrl(base, `/api/v1/ppt/icons/search?${params.toString()}`),
    { method: "GET", headers: requestHeaders() },
    ICONS_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw classifyHttpFailure(response, await readErrorDetail(response));
  }

  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    throw new PresentonError(
      "failed",
      "The service returned an unreadable response.",
    );
  }

  const seen = new Set<string>();
  const icons: PresentonIcon[] = [];
  for (const entry of body) {
    const icon = normalizePresentonIcon(entry);
    if (icon === null || seen.has(icon.path)) continue;
    seen.add(icon.path);
    icons.push(icon);
  }
  return icons;
}

/**
 * §3.6 — the Phase-2 editor wrapper's iframe source. Presenton's own edit UI
 * lives on the browser-reachable origin (`PRESENTON_PUBLIC_URL`, defaulting to
 * `PRESENTON_URL`); null when the integration is not configured. This value is
 * a URL, not a secret, and is only read by the server page that embeds it.
 */
export function presentonEditUrl(presentationId: string): string | null {
  if (!isPresentonConfigured()) return null;
  const publicBase = presentonPublicUrl() ?? presentonBaseUrl();
  if (publicBase === null) return null;
  assertSafeSegment(presentationId, "presentation id");
  return joinUrl(
    publicBase,
    `/presentation?id=${encodeURIComponent(presentationId)}`,
  );
}

/**
 * Task 31.x fork — the themed editor when it is configured AND reachable.
 *
 * Preference order:
 * 1. `PRESENTON_UI_URL` (the forked, UniPilot-themed frontend) when it answers
 *    a lightweight engine status probe through its own proxy;
 * 2. the engine's embedded editor (`presentonEditUrl`) when the fork URL is
 *    unset, unreachable, or answers an error — the link is never dead;
 * 3. `null` when the integration itself is unconfigured.
 */
export async function resolveEditorUrl(
  presentationId: string,
): Promise<string | null> {
  const engineUrl = presentonEditUrl(presentationId);
  if (engineUrl === null) return null;
  const uiUrl = presentonUiUrl();
  if (uiUrl === null) return engineUrl;

  try {
    const response = await fetch(joinUrl(uiUrl, "/api/v1/auth/status"), {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return engineUrl;
    assertSafeSegment(presentationId, "presentation id");
    return joinUrl(
      uiUrl,
      `/presentation?id=${encodeURIComponent(presentationId)}`,
    );
  } catch {
    return engineUrl;
  }
}

// ---------------------------------------------------------------------------
// Task D8 — the editor's chat surface (spec §7.8, §5.4 "AI chat edits")
//
// The engine's chat routes (`presenton-main/.../endpoints/chat.py`):
//   GET  /api/v1/ppt/chat/conversations?presentation_id=…
//   GET  /api/v1/ppt/chat/history?presentation_id=…&conversation_id=…
//   POST /api/v1/ppt/chat/message/stream  (SSE)
//
// The stream is deliberately unbounded: spec §7.8 requires no timeout
// truncation, so the only cancellation is the caller's optional `signal`.
// The route deliberately passes no signal (see its drain-workaround comment):
// hard-cancelling the engine's chat stream leaves its SQLAlchemy SQLite
// transaction open and locks the engine. Frames are yielded as the engine's
// parsed JSON payloads — normalization (including error sanitization) belongs
// to `lib/presentation/chatFrames.ts`, one pure place shared with the browser
// panel. Message text and conversation ids are never logged.
// ---------------------------------------------------------------------------

/** One engine conversation, normalized (`ChatConversationListItem`). */
export type PresentonChatConversation = {
  conversationId: string;
  updatedAt: string | null;
  lastMessagePreview: string | null;
};

/** One stored chat message, normalized (`ChatHistoryMessageItem`). */
export type PresentonChatMessage = {
  role: string;
  content: string;
  createdAt: string | null;
};

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** One conversation entry, or null when it has no usable id (never guessed). */
export function normalizeChatConversation(
  value: unknown,
): PresentonChatConversation | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const conversationId =
    typeof entry.conversation_id === "string" ? entry.conversation_id.trim() : "";
  if (conversationId === "") return null;
  return {
    conversationId,
    updatedAt: normalizeNullableString(entry.updated_at),
    lastMessagePreview: normalizeNullableString(entry.last_message_preview),
  };
}

/** One history row, or null when it has no usable role (never guessed). */
export function normalizeChatMessage(
  value: unknown,
): PresentonChatMessage | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const role = typeof entry.role === "string" ? entry.role.trim() : "";
  if (role === "") return null;
  return {
    role,
    content: typeof entry.content === "string" ? entry.content : "",
    createdAt: normalizeNullableString(entry.created_at),
  };
}

/**
 * The `/history` envelope (`ChatHistoryResponse`), normalized; null when the
 * envelope itself is unreadable. Message rows without a role are dropped.
 */
export function normalizeChatHistory(value: unknown): {
  presentationId: string;
  conversationId: string;
  messages: PresentonChatMessage[];
} | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const presentationId =
    typeof entry.presentation_id === "string" ? entry.presentation_id.trim() : "";
  const conversationId =
    typeof entry.conversation_id === "string" ? entry.conversation_id.trim() : "";
  if (
    presentationId === "" ||
    conversationId === "" ||
    !Array.isArray(entry.messages)
  ) {
    return null;
  }
  return {
    presentationId,
    conversationId,
    messages: entry.messages
      .map(normalizeChatMessage)
      .filter((message): message is PresentonChatMessage => message !== null),
  };
}

/**
 * §5.4/§7.8 — one deck's chat conversations, newest metadata first (the
 * engine's own order). An environment without a reachable engine answers the
 * adapter's classified error; an empty list is a valid answer.
 */
export async function listPresentationChatConversations(
  presentationId: string,
): Promise<PresentonChatConversation[]> {
  const base = requireBaseUrl();
  assertSafeSegment(presentationId, "presentation id");

  const response = await fetchWithTimeout(
    joinUrl(
      base,
      `/api/v1/ppt/chat/conversations?presentation_id=${encodeURIComponent(
        presentationId,
      )}`,
    ),
    { method: "GET", headers: requestHeaders() },
    CHAT_READ_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw classifyHttpFailure(response, await readErrorDetail(response));
  }

  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    throw new PresentonError("failed", "The service returned an unreadable response.");
  }
  return body
    .map(normalizeChatConversation)
    .filter(
      (conversation): conversation is PresentonChatConversation =>
        conversation !== null,
    );
}

/**
 * §5.4/§7.8 — one conversation's stored messages. The engine requires both the
 * deck id and the conversation id (`Query(...)` on both), so both are
 * validated before any request.
 */
export async function getPresentationChatMessages(input: {
  presentationId: string;
  conversationId: string;
}): Promise<PresentonChatMessage[]> {
  const base = requireBaseUrl();
  assertSafeSegment(input.presentationId, "presentation id");
  if (!UUID_PATTERN.test(input.conversationId)) {
    throw new PresentonError("rejected", "Invalid conversation id.");
  }

  const response = await fetchWithTimeout(
    joinUrl(
      base,
      `/api/v1/ppt/chat/history?presentation_id=${encodeURIComponent(
        input.presentationId,
      )}&conversation_id=${encodeURIComponent(input.conversationId)}`,
    ),
    { method: "GET", headers: requestHeaders() },
    CHAT_READ_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw classifyHttpFailure(response, await readErrorDetail(response));
  }

  const history = normalizeChatHistory(await response.json());
  if (history === null) {
    throw new PresentonError("failed", "The service returned an unreadable response.");
  }
  return history.messages;
}

/**
 * §7.8 — open the engine's SSE chat turn and yield each parsed frame payload.
 *
 * No timeout signal is attached: the route owns cancellation, and the caller's
 * `signal` aborts the upstream fetch directly. A transport failure throws the
 * adapter's `unreachable`; an engine 4xx/5xx before the stream starts throws
 * the usual classified error; anything that fails mid-stream surfaces as
 * `unreachable` (the route turns it into the sanitized error frame). The
 * reader is always cancelled so an aborted browser request tears the upstream
 * response down instead of leaking it.
 */
export async function* streamPresentationChat(input: {
  presentationId: string;
  message: string;
  conversationId?: string | null;
  signal?: AbortSignal;
}): AsyncGenerator<unknown, void, void> {
  const base = requireBaseUrl();
  assertSafeSegment(input.presentationId, "presentation id");
  const message = input.message.trim();
  if (message === "") {
    throw new PresentonError("rejected", "A message is required.");
  }
  if (message.length > CHAT_MESSAGE_MAX_LENGTH) {
    throw new PresentonError("rejected", "The message is too long.");
  }
  if (
    input.conversationId !== undefined &&
    input.conversationId !== null &&
    !UUID_PATTERN.test(input.conversationId)
  ) {
    throw new PresentonError("rejected", "Invalid conversation id.");
  }

  const body: Record<string, unknown> = {
    presentation_id: input.presentationId,
    presentation_type: "standard",
    message,
  };
  if (input.conversationId) body.conversation_id = input.conversationId;

  let response: Response;
  try {
    response = await fetch(joinUrl(base, "/api/v1/ppt/chat/message/stream"), {
      method: "POST",
      headers: {
        ...requestHeaders(),
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: input.signal,
    });
  } catch (error) {
    if (input.signal?.aborted) throw error;
    throw new PresentonError("unreachable", "Couldn't reach the presentation service.");
  }

  if (!response.ok) {
    throw classifyHttpFailure(response, await readErrorDetail(response));
  }
  if (response.body === null) {
    throw new PresentonError("failed", "The service returned an unreadable response.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  const parseBlock = (block: string): unknown[] => {
    const payloads: unknown[] = [];
    const { events } = parseSseBlocks(block);
    for (const event of events) {
      if (event.event !== null && event.event !== "response") continue;
      try {
        payloads.push(JSON.parse(event.data));
      } catch {
        // A malformed frame is dropped; the route never forwards raw bytes.
      }
    }
    return payloads;
  };

  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseBlocks(buffer);
      buffer = rest;
      for (const event of events) {
        if (event.event !== null && event.event !== "response") continue;
        try {
          yield JSON.parse(event.data) as unknown;
        } catch {
          // Dropped, same as above.
        }
      }
    }
    /* The engine always terminates a frame with a blank line; a stream cut
       right after `data:` still carries a usable last frame. */
    if (buffer.trim() !== "") {
      for (const payload of parseBlock(`${buffer}\n\n`)) yield payload;
    }
  } catch (error) {
    if (input.signal?.aborted) return;
    if (error instanceof PresentonError) throw error;
    throw new PresentonError("unreachable", "Couldn't reach the presentation service.");
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream was already closed or aborted.
    }
  }
}
