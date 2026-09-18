/**
 * Task 31.x — the `presentation.generate` handler.
 *
 * Drives the separate Presenton service (docs/integrations/presenton.md) for
 * one `public.presentations` row and stores the exported deck as a
 * `documents` row (`source = 'presentation'`) so it appears in /documents with
 * the existing preview/download:
 *
 *   queued → running → succeeded (deck stored)
 *                    ↘ failed (permanent) | back to queued (retryable)
 *
 * The payload is ids-only (`{ presentationId }`); the request itself lives in
 * the row. Flow, with the 29.1 retry contract:
 *
 * 1. an existing Presenton task is resumed when one is recorded — a retry
 *    after a transport failure polls that task instead of paying for a second
 *    generation; a 404 clears it and starts fresh;
 * 2. otherwise every source document is read from the private bucket,
 *    ownership re-checked per id, and uploaded to Presenton;
 * 3. the async task is started and polled (touch_job heartbeat; bounded by
 *    `PRESENTON_POLL_TIMEOUT_MS`, default 10 minutes) with real slide progress
 *    mirrored to the row on every change;
 * 4. the export is downloaded, quota- and size-checked, uploaded to the
 *    `documents` bucket, and recorded as a document row; the deck's
 *    presentation row settles `succeeded` with its document id.
 *
 * Failure policy follows `documentProcessing.mjs`: unreadable source, a
 * Presenton task that ended `error`, a missing/oversized export and a full
 * quota are permanent (`failed`); network failures, 5xx/429 answers, DB
 * writes and poll timeouts retry with the runner's backoff (the row returns to
 * `queued` so the UI never claims "Generating…" while nothing is running).
 * Every user-facing string is sanitized copy from this module; the worker
 * logs ids/status only, never prompts, bytes or keys.
 *
 * Task C1 adds `exportPresentation` (spec §7.7): re-export an existing deck
 * through the engine and replace its `documents` row/key in place (one deck →
 * one document, no version history), settling the `export_status` mirror.
 * Same failure policy, with export-specific copy.
 */
import { startJobHeartbeat } from "./heartbeat.mjs";

const DOCUMENT_BUCKET = "documents";
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const PDF_MIME = "application/pdf";

/**
 * Mirrors `frontend/lib/data/documentValues.ts` and the 31.x migration
 * (25 MiB per file; free tier 50 documents / 250 MiB). The worker host has no
 * TypeScript build step, so the numbers are duplicated deliberately and
 * pinned by the committed qa spec.
 */
const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
const DOCUMENT_FREE_MAX_COUNT = 50;
const DOCUMENT_FREE_MAX_TOTAL_BYTES = 250 * 1024 * 1024;
const DOCUMENT_NAME_MAX_LENGTH = 200;

/** Sanitized, user-facing copy. The only strings that reach the DB. */
export const PRESENTATION_COPY = {
  NOT_CONNECTED:
    "Presentation generation isn't connected yet. It needs a configured Presenton service, and this environment doesn't have one.",
  TRANSIENT:
    "We couldn't finish generating this deck. We'll try again shortly.",
  TERMINAL:
    "We couldn't generate this deck after several attempts. Try again.",
  SERVICE_FAILED:
    "The presentation service couldn't generate this deck. Try again.",
  EXPORT_MISSING:
    "The presentation service didn't return a downloadable file. Try again.",
  EXPORT_TOO_LARGE:
    "The generated file is larger than the 25 MB document limit, so it wasn't saved.",
  QUOTA:
    "Your document storage is full. Free up space in Documents and try again.",
  SOURCE_UNREADABLE:
    "The source document couldn't be read. Upload it again and retry.",
  EXPORT_NOT_READY:
    "This deck can't be exported yet. It hasn't finished generating.",
  EXPORT_FAILED:
    "The presentation service couldn't export this deck. Try again.",
  EXPORT_TRANSIENT:
    "We couldn't export this deck. We'll try again shortly.",
  EXPORT_TERMINAL:
    "We couldn't export this deck after several attempts. Try again.",
  EXPORT_DOCUMENT_UNREADABLE:
    "This deck's stored file couldn't be read, so it can't be replaced. Generate the deck again and retry.",
};

class PresentationFailure extends Error {
  /**
   * @param {string} message sanitized, user-facing copy
   * @param {boolean} retryable
   * @param {string} [code] internal classifier ("not-found" | "rejected" | …)
   */
  constructor(message, retryable, code = "generic") {
    super(message);
    this.name = "PresentationFailure";
    this.retryable = retryable;
    this.code = code;
  }
}

function permanent(message, code = "rejected") {
  return new PresentationFailure(message, false, code);
}

function transient(message = PRESENTATION_COPY.TRANSIENT) {
  return new PresentationFailure(message, true, "transient");
}

function envInt(name, fallback, min) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

function presentonBase() {
  const value = (process.env.PRESENTON_URL ?? "").trim();
  return value === "" ? null : value.replace(/\/+$/, "");
}

function pollIntervalMs() {
  return envInt("PRESENTON_POLL_INTERVAL_MS", 5_000, 500);
}

function pollTimeoutMs() {
  return envInt("PRESENTON_POLL_TIMEOUT_MS", 600_000, 10_000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readPresentationId(payload) {
  if (payload === null || typeof payload !== "object") return null;
  const id = payload.presentationId;
  return typeof id === "string" && id.trim() !== "" ? id.trim() : null;
}

function authHeaders() {
  const headers = { Accept: "application/json" };
  const key = (process.env.PRESENTON_API_KEY ?? "").trim();
  if (key !== "") headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function presentonFetch(
  ctx,
  url,
  init,
  timeoutMs,
  transientMessage = PRESENTATION_COPY.TRANSIENT,
) {
  let response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...authHeaders(), ...(init?.headers ?? {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    ctx.log(`presenton_unreachable ${error?.name ?? "error"}`);
    throw transient(transientMessage);
  }
  return response;
}

/**
 * An ok JSON answer, or the classified failure (5xx/429 retryable; 4xx not).
 * `copy` lets a flow answer with its own words (the export mirror uses export
 * copy); omitted, it keeps the generation copy every original caller expects.
 */
async function presentonJson(ctx, url, init = {}, timeoutMs = 30_000, copy = {}) {
  const response = await presentonFetch(ctx, url, init, timeoutMs, copy.transient);
  if (!response.ok) {
    ctx.log(`presenton_http status=${response.status}`);
    if (response.status >= 500 || response.status === 429) {
      throw transient(copy.transient);
    }
    throw permanent(
      copy.permanent ?? PRESENTATION_COPY.SERVICE_FAILED,
      response.status === 404 ? "not-found" : "rejected",
    );
  }
  return response.json();
}

async function loadPresentation(ctx, presentationId) {
  const { data, error } = await ctx.client
    .from("presentations")
    .select(
      "id, user_id, prompt, template, n_slides, format, language, instructions, " +
        "tone, verbosity, include_table_of_contents, include_title_slide, " +
        "source_document_ids, document_id, presenton_task_id, " +
        "presenton_presentation_id, status, slides_done, slides_total",
    )
    .eq("id", presentationId)
    .maybeSingle();
  if (error) throw transient();
  return data;
}

async function updateRow(ctx, presentationId, fields) {
  const { error } = await ctx.client
    .from("presentations")
    .update(fields)
    .eq("id", presentationId);
  if (error) throw transient();
}

/** The HTTP status inside a task's structured `error` (APIErrorModel), or null. */
function taskErrorStatus(task) {
  const value = task?.error?.status_code;
  return typeof value === "number" ? value : null;
}

/**
 * A task that ended `error` is normally permanent — re-running the identical
 * request would burn the same provider call. Two statuses are transport-class
 * exceptions: 429 (provider rate limit — Google's free tier answers 429 for
 * the whole deck if calls arrive too fast) and 5xx. Those retry with the
 * runner's backoff, and because the failed task itself is dead, the retry
 * starts a fresh one (the recorded id is cleared).
 */
function isRetryableTaskError(task) {
  const status = taskErrorStatus(task);
  return status === 429 || (status !== null && status >= 500 && status <= 599);
}

/**
 * Read one async task's current state.
 *
 * Upstream workaround (2026-09-14, reported in docs/integrations/presenton.md
 * §3.2): on the current `ghcr.io/presenton/presenton:latest` (built 2026-09-08)
 * both `GET /presentation/status/{id}` and `GET /async-tasks/status/{id}`
 * answer 500 for every task whose `data` is set — their handler assigns
 * `response.data = absolute_mcp_result_links(...)` onto a `model_copy` whose
 * SQLAlchemy state was garbage-collected (`ObjectDereferencedError`,
 * presentation.py:3212). The list endpoint reads the same rows without that
 * mutation, so the worker resolves its task from the newest page instead.
 * Revert to the status route once upstream fixes it (the response fields are
 * identical).
 */
async function getTask(ctx, taskId) {
  const tasks = await presentonJson(
    ctx,
    `${presentonBase()}/api/v1/async-tasks?type=presentation.generate&limit=200&order=desc`,
    { method: "GET" },
    15_000,
  );
  const task = Array.isArray(tasks)
    ? tasks.find((candidate) => candidate && candidate.id === taskId)
    : null;
  if (task === null) {
    // Not in the newest page: treat like the old 404 — the recorded id is
    // stale, so a resumed attempt starts a fresh task.
    ctx.log(`presenton_task_not_listed task=${taskId}`);
    throw permanent(PRESENTATION_COPY.SERVICE_FAILED, "not-found");
  }
  return task;
}

/**
 * Mirror the task's real progress onto the row — only fields that changed, so
 * a five-second poll is not a five-second write. `state` is the per-run cache
 * of what the row already holds.
 */
async function mirrorProgress(ctx, row, task, state) {
  const data = task?.data ?? {};
  const fields = {};

  if (Number.isInteger(data.created_slides) && data.created_slides !== state.done) {
    fields.slides_done = data.created_slides;
    state.done = data.created_slides;
  }
  if (Number.isInteger(data.created_slides) && Number.isInteger(data.remaining_slides)) {
    const total = Math.max(data.created_slides + data.remaining_slides, 1);
    if (total !== state.total) {
      fields.slides_total = total;
      state.total = total;
    }
  }
  if (
    typeof data.presentation_id === "string" &&
    data.presentation_id !== state.presentationId
  ) {
    fields.presenton_presentation_id = data.presentation_id;
    state.presentationId = data.presentation_id;
  }

  if (Object.keys(fields).length > 0) {
    await updateRow(ctx, row.id, fields);
  }
}

/** Poll one task to completion (heartbeat-held), mirroring progress as it goes. */
async function pollUntilDone(ctx, row, taskId, state, initialTask = null) {
  const deadline = Date.now() + pollTimeoutMs();
  const interval = pollIntervalMs();
  const stopHeartbeat = startJobHeartbeat(ctx);

  try {
    let task = initialTask;
    for (;;) {
      if (task === null) task = await getTask(ctx, taskId);

      if (task.status === "completed") return task;
      if (task.status === "error") {
        ctx.log(
          `presenton_task_error task=${taskId} status=${taskErrorStatus(task) ?? "n/a"}`,
        );
        if (isRetryableTaskError(task)) {
          if (row.presenton_task_id !== null) {
            await updateRow(ctx, row.id, { presenton_task_id: null });
          }
          throw transient();
        }
        throw permanent(PRESENTATION_COPY.SERVICE_FAILED);
      }
      if (task.status !== "pending" && task.status !== "processing") {
        ctx.log(`presenton_task_unknown_status task=${taskId}`);
        throw transient();
      }

      await mirrorProgress(ctx, row, task, state);

      if (Date.now() >= deadline) {
        ctx.log(`presenton_poll_timeout task=${taskId}`);
        throw transient();
      }
      await sleep(interval);
      task = null;
    }
  } finally {
    stopHeartbeat();
  }
}

/**
 * Read one source document from the private bucket and re-upload it to
 * Presenton, returning the service-side paths. `startGeneration` walks every
 * id on the row; a document that is missing, not owned, outside the caller's
 * storage folder or answered 4xx by the upload route is permanently
 * unreadable (a 5xx/429 answer stays retryable).
 */
async function uploadSourceDocument(ctx, row, sourceDocumentId) {
  const { data: document, error } = await ctx.client
    .from("documents")
    .select("id, user_id, name, storage_path, mime_type")
    .eq("id", sourceDocumentId)
    .maybeSingle();
  if (error) throw transient();

  if (
    document === null ||
    document.user_id !== row.user_id ||
    document.storage_path === null ||
    !document.storage_path.startsWith(`${row.user_id}/`)
  ) {
    throw permanent(PRESENTATION_COPY.SOURCE_UNREADABLE);
  }

  const download = await ctx.client.storage
    .from(DOCUMENT_BUCKET)
    .download(document.storage_path);
  if (download.error || !download.data) {
    throw permanent(PRESENTATION_COPY.SOURCE_UNREADABLE);
  }
  const buffer = Buffer.from(await download.data.arrayBuffer());

  const form = new FormData();
  form.append(
    "files",
    new Blob([buffer], { type: document.mime_type ?? "application/octet-stream" }),
    document.name,
  );

  const response = await presentonFetch(
    ctx,
    `${presentonBase()}/api/v1/ppt/files/upload`,
    { method: "POST", body: form },
    120_000,
  );
  if (!response.ok) {
    ctx.log(`presenton_upload_http status=${response.status}`);
    if (response.status >= 500 || response.status === 429) throw transient();
    throw permanent(PRESENTATION_COPY.SOURCE_UNREADABLE);
  }

  const paths = await response.json();
  if (!Array.isArray(paths) || !paths.every((path) => typeof path === "string")) {
    throw permanent(PRESENTATION_COPY.SOURCE_UNREADABLE);
  }
  return paths;
}

/** A non-empty trimmed string, or null when the row's value is absent/blank. */
function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Start the async generation and persist its task id.
 *
 * The body mirrors the adapter's `buildGenerationRequestBody`
 * (`frontend/lib/integrations/presenton.ts`): both booleans are always sent —
 * Presenton's own defaults differ from the UniPilot request defaults — while
 * an absent optional is omitted, never sent as null. Every source id is
 * uploaded first and the returned paths are concatenated into `files`.
 */
async function startGeneration(ctx, row) {
  const payload = {
    content: row.prompt,
    template: row.template,
    export_as: row.format,
    include_table_of_contents: row.include_table_of_contents === true,
    include_title_slide: row.include_title_slide !== false,
  };
  if (Number.isInteger(row.n_slides)) payload.n_slides = row.n_slides;
  const language = nonEmpty(row.language);
  if (language !== null) payload.language = language;
  const instructions = nonEmpty(row.instructions);
  if (instructions !== null) payload.instructions = instructions;
  const tone = nonEmpty(row.tone);
  if (tone !== null) payload.tone = tone;
  const verbosity = nonEmpty(row.verbosity);
  if (verbosity !== null) payload.verbosity = verbosity;

  const sourceIds = Array.isArray(row.source_document_ids)
    ? row.source_document_ids
    : [];
  const files = [];
  for (const sourceDocumentId of sourceIds) {
    files.push(...(await uploadSourceDocument(ctx, row, sourceDocumentId)));
  }
  if (files.length > 0) payload.files = files;

  const task = await presentonJson(
    ctx,
    `${presentonBase()}/api/v1/ppt/presentation/generate/async`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    30_000,
  );

  if (typeof task.id !== "string" || task.id === "") {
    throw permanent(PRESENTATION_COPY.EXPORT_MISSING);
  }
  return task;
}

/** Free-tier guard (23.12's documented default, mirrored from documentValues.ts). */
async function assertQuota(ctx, userId, incomingBytes) {
  const { data, error } = await ctx.client
    .from("documents")
    .select("id, size_bytes")
    .eq("user_id", userId)
    .limit(DOCUMENT_FREE_MAX_COUNT + 1);
  if (error) throw transient();

  const rows = data ?? [];
  const totalBytes = rows.reduce((sum, row) => sum + (row.size_bytes ?? 0), 0);
  if (
    rows.length >= DOCUMENT_FREE_MAX_COUNT ||
    totalBytes + incomingBytes > DOCUMENT_FREE_MAX_TOTAL_BYTES
  ) {
    throw permanent(PRESENTATION_COPY.QUOTA);
  }
}

/** The object name under the document's own folder — mirror of sanitizeStorageName. */
function sanitizeStorageName(name) {
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

function exportFileName(remotePath, mimeType) {
  const raw = remotePath.split("/").pop() ?? "";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Keep the raw segment; it is only a display name.
  }
  const trimmed = decoded.trim().slice(0, DOCUMENT_NAME_MAX_LENGTH);
  if (trimmed !== "") return trimmed;
  return `presentation.${mimeType === PDF_MIME ? "pdf" : "pptx"}`;
}

/**
 * Download one engine export and apply the existing guards: the path must be
 * app-relative under `/app_data/`, the bytes non-empty, ≤ 25 MiB, and the MIME
 * derived from the extension. Shared by generation (first store) and the
 * re-export (in-place replace); `transientMessage` lets the caller answer
 * transport failures in its own words.
 */
async function downloadExport(
  ctx,
  remotePath,
  transientMessage = PRESENTATION_COPY.TRANSIENT,
) {
  if (!remotePath.startsWith("/app_data/") || remotePath.includes("..")) {
    throw permanent(PRESENTATION_COPY.EXPORT_MISSING);
  }

  const response = await presentonFetch(
    ctx,
    `${presentonBase()}${remotePath}`,
    { method: "GET" },
    120_000,
    transientMessage,
  );
  if (!response.ok) {
    ctx.log(`presenton_export_http status=${response.status}`);
    if (response.status >= 500 || response.status === 429) {
      throw transient(transientMessage);
    }
    throw permanent(PRESENTATION_COPY.EXPORT_MISSING);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw permanent(PRESENTATION_COPY.EXPORT_MISSING);
  }
  if (buffer.byteLength > DOCUMENT_MAX_BYTES) {
    throw permanent(PRESENTATION_COPY.EXPORT_TOO_LARGE);
  }

  const lower = remotePath.toLowerCase();
  const mimeType = lower.endsWith(".pdf")
    ? PDF_MIME
    : lower.endsWith(".pptx")
      ? PPTX_MIME
      : null;
  if (mimeType === null) {
    throw permanent(PRESENTATION_COPY.EXPORT_MISSING);
  }

  return { buffer, mimeType };
}

/** Download the export and store it as a `documents` row + bucket object. */
async function storeExport(ctx, row, task) {
  const remotePath =
    typeof task.data?.path === "string" ? task.data.path : "";
  const { buffer, mimeType } = await downloadExport(ctx, remotePath);

  await assertQuota(ctx, row.user_id, buffer.byteLength);

  const fileName = exportFileName(remotePath, mimeType);
  const documentId = crypto.randomUUID();
  const storagePath = `${row.user_id}/${documentId}/${sanitizeStorageName(fileName)}`;

  const upload = await ctx.client.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, buffer, { contentType: mimeType, upsert: false });
  if (upload.error) throw transient();

  const { error: insertError } = await ctx.client.from("documents").insert({
    id: documentId,
    user_id: row.user_id,
    name: fileName,
    mime_type: mimeType,
    size_bytes: buffer.byteLength,
    storage_path: storagePath,
    status: "uploaded",
    source: "presentation",
  });
  if (insertError) {
    // The row is the record; without it the object is an orphan — remove it
    // (best effort) and let the runner retry the whole settle.
    try {
      await ctx.client.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
    } catch {
      // Ignored deliberately; the document-object sweep is the backstop.
    }
    throw transient();
  }

  return { documentId };
}

/** The raw cause stays in server logs; the DB and the user see sanitized copy. */
function classify(caught, ctx) {
  if (caught instanceof PresentationFailure) return caught;
  const reason = caught instanceof Error ? caught.message : String(caught);
  ctx.log(`presentation_error ${reason}`);
  return transient();
}

export async function generatePresentation(payload, ctx) {
  const presentationId = readPresentationId(payload);
  if (presentationId === null) {
    throw permanent("Invalid presentation job payload.");
  }

  let row = null;
  try {
    row = await loadPresentation(ctx, presentationId);
    if (row === null) {
      ctx.log(`presentation=${presentationId} no longer exists; nothing to do`);
      return;
    }
    if (row.status === "succeeded" && row.document_id !== null) {
      ctx.log(`presentation=${presentationId} already succeeded; nothing to do`);
      return;
    }
    if (presentonBase() === null) {
      throw permanent(PRESENTATION_COPY.NOT_CONNECTED, "not-configured");
    }

    await updateRow(ctx, row.id, { status: "running", error_message: null });

    const state = {
      done: row.slides_done,
      total: row.slides_total,
      presentationId: row.presenton_presentation_id,
    };

    // Resume a recorded Presenton task where one exists (a retry after a
    // transport failure must not pay for a second generation).
    let task = null;
    if (typeof row.presenton_task_id === "string" && row.presenton_task_id !== "") {
      try {
        const existing = await getTask(ctx, row.presenton_task_id);
        if (existing.status === "completed") {
          task = existing;
        } else if (existing.status === "error") {
          ctx.log(
            `presenton_task_error task=${row.presenton_task_id} status=${taskErrorStatus(existing) ?? "n/a"}`,
          );
          if (isRetryableTaskError(existing)) {
            // Transport-class (429/5xx): the recorded task is dead, so clear
            // it and let this attempt start a fresh one.
            await updateRow(ctx, row.id, { presenton_task_id: null });
            task = null;
          } else {
            throw permanent(PRESENTATION_COPY.SERVICE_FAILED, "task-error");
          }
        } else {
          task = await pollUntilDone(ctx, row, row.presenton_task_id, state, existing);
        }
      } catch (caught) {
        if (caught instanceof PresentationFailure && caught.code === "not-found") {
          ctx.log(
            `presenton_task_missing task=${row.presenton_task_id}; starting fresh`,
          );
          task = null;
        } else {
          throw caught;
        }
      }
    }

    if (task === null) {
      const started = await startGeneration(ctx, row);
      const startFields = { presenton_task_id: started.id };
      if (typeof started.data?.presentation_id === "string") {
        startFields.presenton_presentation_id = started.data.presentation_id;
        state.presentationId = started.data.presentation_id;
      }
      if (Number.isInteger(started.data?.remaining_slides)) {
        startFields.slides_total = Math.max(started.data.remaining_slides, 1);
        state.total = startFields.slides_total;
      }
      await updateRow(ctx, row.id, startFields);
      task = await pollUntilDone(ctx, row, started.id, state);
    }

    await mirrorProgress(ctx, row, task, state);
    const stored = await storeExport(ctx, row, task);
    await updateRow(ctx, row.id, {
      status: "succeeded",
      document_id: stored.documentId,
      error_message: null,
    });
    ctx.log(`stored document=${stored.documentId} for presentation=${row.id}`);
  } catch (caught) {
    const failure = classify(caught, ctx);
    if (row !== null) {
      const terminal =
        failure.retryable === false || ctx.attempt >= ctx.maxAttempts;
      const message = !failure.retryable
        ? failure.message
        : terminal
          ? PRESENTATION_COPY.TERMINAL
          : PRESENTATION_COPY.TRANSIENT;
      const status = failure.retryable && !terminal ? "queued" : "failed";
      // Best effort: the runner's own failure record is what settles the job,
      // and a failed status write must not mask the original error.
      try {
        await updateRow(ctx, row.id, { status, error_message: message });
      } catch {
        // Ignored deliberately; the runner still reports the failure.
      }
    }
    throw failure;
  }
}

/**
 * The export mirror's row read (Task C1): only what the re-export needs.
 */
async function loadExportRow(ctx, presentationId) {
  const { data, error } = await ctx.client
    .from("presentations")
    .select(
      "id, user_id, format, presenton_presentation_id, document_id, export_status",
    )
    .eq("id", presentationId)
    .maybeSingle();
  if (error) throw transient(PRESENTATION_COPY.EXPORT_TRANSIENT);
  return data;
}

/**
 * The deck document a re-export replaces. It must exist, belong to the row's
 * owner, and sit under that owner's storage folder (the same guard
 * `uploadSourceDocument` applies to sources). A missing or unowned document is
 * permanent — re-running cannot conjure it, the deck must be regenerated.
 */
async function loadExportDocument(ctx, row) {
  const { data, error } = await ctx.client
    .from("documents")
    .select("id, user_id, storage_path")
    .eq("id", row.document_id)
    .maybeSingle();
  if (error) throw transient(PRESENTATION_COPY.EXPORT_TRANSIENT);

  if (
    data === null ||
    data.user_id !== row.user_id ||
    data.storage_path === null ||
    !data.storage_path.startsWith(`${row.user_id}/`)
  ) {
    throw permanent(PRESENTATION_COPY.EXPORT_DOCUMENT_UNREADABLE);
  }
  return data;
}

/**
 * Task C1 — the `presentation.export` handler (spec §7.7).
 *
 * Re-exports an existing deck through the engine and replaces the deck's
 * document in place: same `documents` row, same bucket key, `upsert: true`.
 * One deck → one document; no version history (D9). The `presentations` row's
 * export mirror settles `running → succeeded | failed`, or back to `queued`
 * while the runner retries — exactly `generatePresentation`'s contract:
 *
 * - permanent: not configured, missing deck ids, an unsafe/missing/oversized/
 *   unknown-mime export, an unreadable or unowned document, a 4xx answer;
 * - retryable: transport failures, 5xx/429 answers, and failed DB writes.
 *
 * The free-tier document count is deliberately not re-checked (this export
 * replaces an existing document, it does not add one); the 25 MiB size guard
 * still applies. Logs carry ids and status only.
 */
export async function exportPresentation(payload, ctx) {
  const presentationId = readPresentationId(payload);
  if (presentationId === null) {
    throw permanent("Invalid presentation job payload.");
  }

  let row = null;
  try {
    row = await loadExportRow(ctx, presentationId);
    if (row === null) {
      ctx.log(`presentation=${presentationId} no longer exists; nothing to export`);
      return;
    }
    if (presentonBase() === null) {
      throw permanent(PRESENTATION_COPY.NOT_CONNECTED, "not-configured");
    }
    if (
      row.document_id === null ||
      typeof row.presenton_presentation_id !== "string" ||
      row.presenton_presentation_id === ""
    ) {
      throw permanent(PRESENTATION_COPY.EXPORT_NOT_READY);
    }

    await updateRow(ctx, row.id, {
      export_status: "running",
      export_error_message: null,
    });

    const exported = await presentonJson(
      ctx,
      `${presentonBase()}/api/v1/ppt/presentation/${encodeURIComponent(row.presenton_presentation_id)}/export`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ export_as: row.format }),
      },
      120_000,
      {
        transient: PRESENTATION_COPY.EXPORT_TRANSIENT,
        permanent: PRESENTATION_COPY.EXPORT_FAILED,
      },
    );

    const remotePath = typeof exported?.path === "string" ? exported.path : "";
    const { buffer, mimeType } = await downloadExport(
      ctx,
      remotePath,
      PRESENTATION_COPY.EXPORT_TRANSIENT,
    );

    const document = await loadExportDocument(ctx, row);
    const fileName = exportFileName(remotePath, mimeType);

    const upload = await ctx.client.storage
      .from(DOCUMENT_BUCKET)
      .upload(document.storage_path, buffer, {
        contentType: mimeType,
        upsert: true,
      });
    if (upload.error) throw transient(PRESENTATION_COPY.EXPORT_TRANSIENT);

    const { error: updateError } = await ctx.client
      .from("documents")
      .update({
        name: fileName,
        size_bytes: buffer.byteLength,
        mime_type: mimeType,
        updated_at: new Date().toISOString(),
      })
      .eq("id", document.id)
      .eq("user_id", row.user_id);
    if (updateError) throw transient(PRESENTATION_COPY.EXPORT_TRANSIENT);

    await updateRow(ctx, row.id, {
      export_status: "succeeded",
      export_error_message: null,
      exported_at: new Date().toISOString(),
    });
    ctx.log(`re-exported document=${document.id} for presentation=${row.id}`);
  } catch (caught) {
    const failure = classify(caught, ctx);
    if (row !== null) {
      const terminal =
        failure.retryable === false || ctx.attempt >= ctx.maxAttempts;
      const message = !failure.retryable
        ? failure.message
        : terminal
          ? PRESENTATION_COPY.EXPORT_TERMINAL
          : PRESENTATION_COPY.EXPORT_TRANSIENT;
      const exportStatus =
        failure.retryable && !terminal ? "queued" : "failed";
      // Best effort: the runner's own failure record is what settles the job,
      // and a failed mirror write must not mask the original error.
      try {
        await updateRow(ctx, row.id, {
          export_status: exportStatus,
          export_error_message: message,
        });
      } catch {
        // Ignored deliberately; the runner still reports the failure.
      }
    }
    throw failure;
  }
}
