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

/** Defensive cap on the prompt forwarded to the service (the UI enforces less). */
export const PRESENTON_CONTENT_MAX_LENGTH = 8_000;
export const PRESENTON_INSTRUCTIONS_MAX_LENGTH = 2_000;
export const PRESENTON_TEMPLATE_MAX_LENGTH = 120;
export const PRESENTON_MAX_SLIDES = 50;
export const PRESENTON_SOURCE_FILE_MAX_BYTES = 25 * 1024 * 1024;

const START_TIMEOUT_MS = 30_000;
const STATUS_TIMEOUT_MS = 15_000;
const TEMPLATES_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 120_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

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

/** The `GeneratePresentationRequest` fields UniPilot sends (all of them). */
export type PresentonGenerationInput = {
  content: string;
  nSlides?: number | null;
  language?: string | null;
  template: string;
  format: "pptx" | "pdf";
  /** Presenton-side paths returned by {@link uploadPresentationSourceFile}. */
  sourceFiles?: string[];
};

export type PresentonTemplate = {
  id: string;
  name: string;
  description: string | null;
  layoutCount: number;
  isDefault: boolean;
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
 * §3.1 (docs/integrations/presenton.md) — start an async generation. The
 * response is Presenton's `AsyncTaskModel`; poll it with
 * {@link getPresentationTaskStatus} until `completed`/`error`.
 */
export async function startPresentationGeneration(
  input: PresentonGenerationInput,
): Promise<PresentonAsyncTask> {
  const base = requireBaseUrl();

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

  const body: Record<string, unknown> = {
    content,
    template,
    export_as: input.format,
  };
  if (input.nSlides) body.n_slides = input.nSlides;
  if (input.language) body.language = input.language;
  if (input.sourceFiles && input.sourceFiles.length > 0) {
    body.files = input.sourceFiles;
  }

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

/** §3.5 — the picker's options: built-in templates, first page, up to 100. */
export async function listPresentationTemplates(): Promise<PresentonTemplate[]> {
  const base = requireBaseUrl();

  const response = await fetchWithTimeout(
    joinUrl(base, "/api/v1/ppt/template/all?default=true&page=1&page_size=100"),
    { method: "GET", headers: requestHeaders() },
    TEMPLATES_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw classifyHttpFailure(response, await readErrorDetail(response));
  }

  const body = (await response.json()) as { items?: unknown };
  if (!Array.isArray(body.items)) {
    throw new PresentonError("failed", "The service returned an unreadable response.");
  }

  return body.items
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
