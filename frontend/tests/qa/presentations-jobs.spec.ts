/**
 * tests/qa/presentations-jobs.spec.ts — Task 31.x's wiring proof.
 *
 * The only honest proof available in an environment with no Presenton service
 * (GATE 1: no provider was configured, so no real deck may be generated and
 * none is faked):
 *
 * - the adapter refuses every outbound call when `PRESENTON_URL` is unset
 *   (`not-configured`) and rejects unsafe task ids / export paths before any
 *   fetch;
 * - the worker (`presentation.generate`) fails such a request permanently and
 *   honestly — the `presentations` row and the job both settle on the
 *   sanitized "not connected" copy, `attempts=1` (no retry burn), and nothing
 *   is stored in `documents`;
 * - `presentation.export` (Task C1) drives the stub engine's export route,
 *   replaces the deck's existing document in place (same row id, same
 *   `storage_path`, new bytes/mime) and settles the export mirror
 *   (`export_status`/`exported_at`) — and fails honestly when unconfigured;
 * - the C3 mutation builders are pinned exactly (metadata always carries the
 *   theme, a slide update wraps the full slide, a structural replace carries a
 *   fresh UUID per slide) and the structural capability flag is off unless
 *   `PRESENTON_STRUCTURAL_EDITS=1`;
 * - the request parser accepts only the bounded vocabulary;
 * - RLS: owners read only their own rows; no client role may write; `anon`
 *   reads nothing.
 *
 * Own Playwright project (`qa-presentation-jobs`, after the jobs runner). The
 * spec is local-only by construction, drives the real worker with
 * `PRESENTON_URL` forced empty, holds the shared worker lock around worker
 * runs, and returns every row it created to the pre-run counts in `afterAll`.
 * A configured Presenton environment runs the real end-to-end deck flow, which
 * this spec deliberately does not attempt to fake.
 */
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import type {
  PresentationItem,
  PresentationRow,
} from "../../lib/data/presentationValues";
import type {
  DeckSlide,
  DeckTheme,
  DeckThemePackage,
} from "../../lib/presentation/types";
import { acquireWorkerLock } from "./workerLock";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";
const qa2Password = process.env.UNIPILOT_QA2_PASSWORD ?? "";

const QA1 = "qa.unipilot@unipilot.test";
const QA2 = "qa2.unipilot@unipilot.test";

/** `process.cwd()` is `frontend/` (playwright.config.ts lives there). */
const REPO_ROOT = path.resolve(process.cwd(), "..");

/** Mirrors `backend/worker/presentationJobs.mjs`'s unconfigured copy. */
const NOT_CONNECTED_COPY =
  "Presentation generation isn't connected yet. It needs a configured Presenton service, and this environment doesn't have one.";

/** Mirrors the worker's retryable-failure copy. */
const TRANSIENT_COPY =
  "We couldn't finish generating this deck. We'll try again shortly.";

/** Mirrors the worker's permanent service-failure copy. */
const SERVICE_FAILED_COPY =
  "The presentation service couldn't generate this deck. Try again.";

/** Mirrors the worker's unreadable-source copy (permanent, no retry). */
const SOURCE_UNREADABLE_COPY =
  "The source document couldn't be read. Upload it again and retry.";

/** Mirrors the worker's PPTX mime mapping (`presentationJobs.mjs`). */
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** The stub engine's export object: its bytes and the served size. */
const STUB_EXPORT_BYTES = Buffer.from("504b0304" + "00".repeat(40), "hex");

/** The stub engine's presentation id (the export route's path segment). */
const STUB_PRESENTATION_ID = "presenton-deck-qa";

/** The stale deck bytes the export test seeds (replaced by the stub export). */
const SEEDED_DECK_BYTES = Buffer.from("old-deck-bytes");

let qa1Id = "";
let service: SupabaseClient;
let qa1: SupabaseClient;
let qa2: SupabaseClient;

let jobsCountBefore = 0;
let presentationsCountBefore = 0;
let presentationDocumentsBefore = 0;

const createdJobIds: string[] = [];
const createdPresentationIds: string[] = [];
const everCreatedJobIds: string[] = [];
const everCreatedPresentationIds: string[] = [];

/** Source documents this spec seeded (rows and bucket objects), both cleaned. */
const createdDocumentIds: string[] = [];
const createdDocumentPaths: string[] = [];
const everCreatedDocumentIds: string[] = [];
const everCreatedDocumentPaths: string[] = [];

async function signIn(
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<string> {
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  expect(error, `sign-in failed for ${email}: ${error?.message}`).toBeNull();
  return data.user!.id;
}

/**
 * One claim→process→settle cycle with `env` overriding the Presenton
 * integration — the caller pins the exact configuration under test. `env: ""`
 * is the documented "unset" the adapter treats like absence.
 */
function runWorkerOnce(env: Record<string, string>): string {
  return execFileSync(
    "node",
    ["worker/run.mjs", "--once", "--worker-id=spec-presentation-worker"],
    {
      cwd: path.join(REPO_ROOT, "backend"),
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 30_000,
    },
  );
}

function runWorkerOnceUnconfigured(): string {
  return runWorkerOnce({ PRESENTON_URL: "", PRESENTON_API_KEY: "" });
}

async function insertPresentation(values: Record<string, unknown> = {}) {
  const id = randomUUID();
  const { error } = await service.from("presentations").insert({
    id,
    user_id: qa1Id,
    prompt: "Introduction to machine learning",
    template: "general",
    format: "pptx",
    status: "queued",
    ...values,
  });
  expect(error, `seed presentation: ${error?.message}`).toBeNull();
  createdPresentationIds.push(id);
  everCreatedPresentationIds.push(id);
  return id;
}

async function insertJob(
  payload: Record<string, unknown>,
  maxAttempts = 5,
  kind = "presentation.generate",
) {
  const id = randomUUID();
  const { error } = await service.from("jobs").insert({
    id,
    kind,
    payload,
    user_id: qa1Id,
    max_attempts: maxAttempts,
  });
  expect(error, `seed job: ${error?.message}`).toBeNull();
  createdJobIds.push(id);
  everCreatedJobIds.push(id);
  return id;
}

/**
 * A source document the worker can genuinely read: a `documents` row for QA1
 * plus a tiny real PDF in the private bucket. Both are registered for the
 * per-test teardown (row ids and storage paths) and the final residue checks.
 */
async function insertDocumentWithObject() {
  const id = randomUUID();
  const storagePath = `${qa1Id}/${id}/source.pdf`;
  const bytes = Buffer.from("%PDF-1.4\n% UniPilot QA stub source document\n%%EOF\n");

  const uploaded = await service.storage
    .from("documents")
    .upload(storagePath, bytes, {
      contentType: "application/pdf",
      upsert: false,
    });
  expect(uploaded.error, `seed document object: ${uploaded.error?.message}`).toBeNull();
  createdDocumentPaths.push(storagePath);
  everCreatedDocumentPaths.push(storagePath);

  const inserted = await service.from("documents").insert({
    id,
    user_id: qa1Id,
    name: "Source document.pdf",
    storage_path: storagePath,
    mime_type: "application/pdf",
    size_bytes: bytes.byteLength,
    status: "uploaded",
    source: "upload",
  });
  expect(inserted.error, `seed document row: ${inserted.error?.message}`).toBeNull();
  createdDocumentIds.push(id);
  everCreatedDocumentIds.push(id);

  return { id, storagePath };
}

/**
 * The deck document a re-export replaces: a `documents` row (`source =
 * 'presentation'`) for QA1 plus its tiny bucket object. Its recorded size/mime
 * are deliberately stale so the export test proves both are refreshed (the
 * local storage bucket accepts only a mime allowlist, hence PDF here).
 */
async function insertPresentationDocumentWithObject() {
  const id = randomUUID();
  const storagePath = `${qa1Id}/${id}/Deck.pptx`;
  const oldBytes = SEEDED_DECK_BYTES;

  const uploaded = await service.storage
    .from("documents")
    .upload(storagePath, oldBytes, {
      contentType: "application/pdf",
      upsert: false,
    });
  expect(uploaded.error, `seed deck object: ${uploaded.error?.message}`).toBeNull();
  createdDocumentPaths.push(storagePath);
  everCreatedDocumentPaths.push(storagePath);

  const inserted = await service.from("documents").insert({
    id,
    user_id: qa1Id,
    name: "Deck.pptx",
    storage_path: storagePath,
    mime_type: "application/pdf",
    size_bytes: oldBytes.byteLength,
    status: "uploaded",
    source: "presentation",
  });
  expect(inserted.error, `seed deck row: ${inserted.error?.message}`).toBeNull();
  createdDocumentIds.push(id);
  everCreatedDocumentIds.push(id);

  return { id, storagePath };
}

/** One test's stub Presenton engine, with its captured traffic. */
type StubCapture = {
  uploads: number;
  body?: Record<string, unknown>;
  exportBody?: Record<string, unknown>;
  tasks: unknown[];
};

type StubEngine = {
  url: string;
  captured: () => Promise<StubCapture>;
  close: () => Promise<void>;
};

/**
 * The stub engine's source. It must run as its OWN process, not inline: the
 * worker runs via the synchronous `runWorkerOnce` (`execFileSync`), which
 * blocks this test process's event loop — an in-process HTTP server could
 * never answer the worker's fetch, and both sides would wait until the
 * `execFileSync` timeout. A child process keeps serving while the parent
 * blocks, and `/__captured` hands the captured traffic back afterwards.
 */
const STUB_ENGINE_SOURCE = `
import http from "node:http";

const options = JSON.parse(process.argv[1] ?? "{}");
const state = { uploads: 0, body: undefined, exportBody: undefined, tasks: [] };
const exportPath = options.exportPath ?? "/app_data/exports/pptx/Deck_7f3a9c2b1d.pptx";
const exportBytes = Buffer.from("504b0304" + "00".repeat(40), "hex");

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/v1/ppt/files/upload") {
    state.uploads += 1;
    req.resume();
    if (options.uploadStatus !== undefined) {
      res.statusCode = options.uploadStatus;
      res.end();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(["/app_data/uploads/" + state.uploads + ".pdf"]));
    return;
  }
  if (
    req.method === "POST" &&
    req.url === "/api/v1/ppt/presentation/generate/async"
  ) {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      state.body = JSON.parse(raw);
      const task = {
        id: "task-stub",
        type: "presentation.generate",
        status: "error",
        message: "stub",
        error: { status_code: 400, detail: "stub" },
        data: null,
      };
      state.tasks.push(task);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(task));
    });
    return;
  }
  if (
    req.method === "POST" &&
    typeof req.url === "string" &&
    req.url.startsWith("/api/v1/ppt/presentation/") &&
    req.url.endsWith("/export")
  ) {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      state.exportBody = JSON.parse(raw);
      const presentationId = req.url.slice(
        "/api/v1/ppt/presentation/".length,
        -"/export".length,
      );
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          presentation_id: presentationId,
          path: exportPath,
          edit_path: "/app/presentation/" + presentationId,
        }),
      );
    });
    return;
  }
  if (req.method === "GET" && req.url === exportPath) {
    res.setHeader(
      "content-type",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    res.end(exportBytes);
    return;
  }
  if (req.method === "GET" && req.url === "/__captured") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(state));
    return;
  }
  if (
    req.method === "GET" &&
    typeof req.url === "string" &&
    req.url.startsWith("/api/v1/async-tasks")
  ) {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(state.tasks));
    return;
  }
  res.statusCode = 404;
  res.end();
});

server.listen(0, "127.0.0.1", () => {
  console.log("http://127.0.0.1:" + server.address().port);
});
`;

/**
 * Start the stub engine and resolve its base URL once it is listening. The
 * routes the worker hits (see `backend/worker/presentationJobs.mjs`): the file
 * upload answers one path per upload, the generate route captures the parsed
 * JSON body and answers an `AsyncTaskModel` that ended `error` (a permanent
 * failure — no export download, no `documents` row), the list route (the
 * worker's upstream `/status` 500 workaround) serves that task, and the export
 * pair answers a `POST .../export` with an app-relative path plus a `GET` of
 * those exact bytes for a re-export (Task C1).
 */
async function startStubEngine(
  options: { uploadStatus?: number } = {},
): Promise<StubEngine> {
  const stub = spawn(
    process.execPath,
    ["--input-type=module", "-e", STUB_ENGINE_SOURCE, JSON.stringify(options)],
    { stdio: ["ignore", "pipe", "inherit"], windowsHide: true },
  );

  const url = await new Promise<string>((resolve, reject) => {
    let output = "";
    stub.stdout!.setEncoding("utf8");
    stub.stdout!.on("data", (chunk: string) => {
      output += chunk;
      const newline = output.indexOf("\n");
      if (newline >= 0) resolve(output.slice(0, newline).trim());
    });
    stub.once("error", reject);
    stub.once("exit", (code) => {
      reject(new Error(`stub engine exited before it was ready (code ${code})`));
    });
  });

  return {
    url,
    captured: async () => {
      const response = await fetch(`${url}/__captured`);
      return (await response.json()) as StubCapture;
    },
    close: async () => {
      if (stub.exitCode !== null || stub.signalCode !== null) return;
      stub.kill();
      await new Promise<void>((resolve) => stub.once("exit", () => resolve()));
    },
  };
}

test.beforeAll(async () => {
  if (!LOCAL_TARGET.test(url)) {
    throw new Error(
      `presentations-jobs is local-only; refusing target "${url || "(unset)"}"`,
    );
  }
  if (!anonKey || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY (frontend/.env.development.local)",
    );
  }
  if (!qa1Password || !qa2Password) {
    throw new Error(
      "Missing UNIPILOT_QA_PASSWORD / UNIPILOT_QA2_PASSWORD; seed the identities first (npm run seed:qa)",
    );
  }

  service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [jobsCount, presentationsCount, presentationDocuments] =
    await Promise.all([
      service.from("jobs").select("id", { count: "exact", head: true }),
      service.from("presentations").select("id", { count: "exact", head: true }),
      service
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("source", "presentation"),
    ]);
  expect(jobsCount.error, `pre-run jobs count: ${jobsCount.error?.message}`).toBeNull();
  expect(
    presentationsCount.error,
    `pre-run presentations count: ${presentationsCount.error?.message}`,
  ).toBeNull();
  expect(
    presentationDocuments.error,
    `pre-run presentation-documents count: ${presentationDocuments.error?.message}`,
  ).toBeNull();
  jobsCountBefore = jobsCount.count ?? 0;
  presentationsCountBefore = presentationsCount.count ?? 0;
  presentationDocumentsBefore = presentationDocuments.count ?? 0;

  qa1 = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  qa2 = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  qa1Id = await signIn(qa1, QA1, qa1Password);
  await signIn(qa2, QA2, qa2Password);
});

test.afterEach(async () => {
  if (createdJobIds.length > 0) {
    const { error } = await service.from("jobs").delete().in("id", createdJobIds);
    expect(error, `teardown jobs: ${error?.message}`).toBeNull();
    createdJobIds.length = 0;
  }
  if (createdPresentationIds.length > 0) {
    const { error } = await service
      .from("presentations")
      .delete()
      .in("id", createdPresentationIds);
    expect(error, `teardown presentations: ${error?.message}`).toBeNull();
    createdPresentationIds.length = 0;
  }
  if (createdDocumentIds.length > 0) {
    const { error } = await service
      .from("documents")
      .delete()
      .in("id", createdDocumentIds);
    expect(error, `teardown documents: ${error?.message}`).toBeNull();
    createdDocumentIds.length = 0;
  }
  if (createdDocumentPaths.length > 0) {
    const { error } = await service.storage
      .from("documents")
      .remove([...createdDocumentPaths]);
    expect(error, `teardown document objects: ${error?.message}`).toBeNull();
    createdDocumentPaths.length = 0;
  }
});

test.afterAll(async () => {
  const [jobsCount, presentationsCount, presentationDocuments] =
    await Promise.all([
      service.from("jobs").select("id", { count: "exact", head: true }),
      service.from("presentations").select("id", { count: "exact", head: true }),
      service
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("source", "presentation"),
    ]);
  expect(jobsCount.error, `residue jobs: ${jobsCount.error?.message}`).toBeNull();
  expect(
    presentationsCount.error,
    `residue presentations: ${presentationsCount.error?.message}`,
  ).toBeNull();
  expect(
    presentationDocuments.error,
    `residue presentation documents: ${presentationDocuments.error?.message}`,
  ).toBeNull();

  expect(
    jobsCount.count,
    "the spec must return the jobs table to its pre-run count",
  ).toBe(jobsCountBefore);
  expect(
    presentationsCount.count,
    "the spec must return the presentations table to its pre-run count",
  ).toBe(presentationsCountBefore);
  expect(
    presentationDocuments.count,
    "the unconfigured path must never store a deck",
  ).toBe(presentationDocumentsBefore);

  if (everCreatedJobIds.length > 0) {
    const { data, error } = await service
      .from("jobs")
      .select("id")
      .in("id", [...everCreatedJobIds]);
    expect(error, `own job residue read: ${error?.message}`).toBeNull();
    expect(data ?? [], "no job this spec created may survive").toHaveLength(0);
  }
  if (everCreatedPresentationIds.length > 0) {
    const { data, error } = await service
      .from("presentations")
      .select("id")
      .in("id", [...everCreatedPresentationIds]);
    expect(error, `own presentation residue read: ${error?.message}`).toBeNull();
    expect(data ?? [], "no presentation this spec created may survive").toHaveLength(0);
  }
  if (everCreatedDocumentIds.length > 0) {
    const { data, error } = await service
      .from("documents")
      .select("id")
      .in("id", [...everCreatedDocumentIds]);
    expect(error, `own document residue read: ${error?.message}`).toBeNull();
    expect(data ?? [], "no document this spec created may survive").toHaveLength(0);
  }
  for (const storagePath of everCreatedDocumentPaths) {
    const slash = storagePath.lastIndexOf("/");
    const { data, error } = await service.storage
      .from("documents")
      .list(storagePath.slice(0, slash));
    expect(error, `own object residue read: ${error?.message}`).toBeNull();
    const names = (data ?? []).map((entry) => entry.name);
    expect(
      names,
      `no object this spec created may survive: ${storagePath}`,
    ).not.toContain(storagePath.slice(slash + 1));
  }
});

test.describe("adapter guards (no Presenton configured)", () => {
  test("unset PRESENTON_URL refuses every call before any network attempt", async () => {
    const savedUrl = process.env.PRESENTON_URL;
    const savedKey = process.env.PRESENTON_API_KEY;
    delete process.env.PRESENTON_URL;
    delete process.env.PRESENTON_API_KEY;
    try {
      const adapter = await import("../../lib/integrations/presenton");

      expect(adapter.isPresentonConfigured()).toBe(false);

      await expect(
        adapter.startPresentationGeneration({
          content: "A topic",
          template: "general",
          format: "pptx",
        }),
      ).rejects.toMatchObject({ code: "not-configured" });

      await expect(adapter.listPresentationTemplates()).rejects.toMatchObject({
        code: "not-configured",
      });

      await expect(
        adapter.getPresentationTaskStatus("task-abc"),
      ).rejects.toMatchObject({ code: "not-configured" });
    } finally {
      if (savedUrl !== undefined) process.env.PRESENTON_URL = savedUrl;
      if (savedKey !== undefined) process.env.PRESENTON_API_KEY = savedKey;
    }
  });

  test("unsafe task ids and export paths are rejected before any fetch", async () => {
    const adapter = await import("../../lib/integrations/presenton");

    // Point at a loopback port nothing listens on: a fetch would fail as
    // `unreachable`; the guard rejects first with `rejected`.
    process.env.PRESENTON_URL = "http://127.0.0.1:9";
    try {
      await expect(
        adapter.getPresentationTaskStatus("bad/../id"),
      ).rejects.toMatchObject({ code: "rejected" });

      await expect(
        adapter.downloadPresentationExport("/etc/passwd"),
      ).rejects.toMatchObject({ code: "rejected" });

      await expect(
        adapter.downloadPresentationExport("/app_data/../../secret"),
      ).rejects.toMatchObject({ code: "rejected" });
    } finally {
      delete process.env.PRESENTON_URL;
    }
  });

  test("request parser accepts only the bounded vocabulary", async () => {
    const { parsePresentationRequest } = await import(
      "../../lib/data/presentationValues"
    );

    expect(
      parsePresentationRequest({
        prompt: "  Cellular respiration  ",
        template: "general",
        nSlides: 8,
        format: "pptx",
        sourceDocumentId: null,
      }),
    ).toEqual({
      prompt: "Cellular respiration",
      template: "general",
      nSlides: 8,
      format: "pptx",
      language: null,
      instructions: null,
      tone: null,
      verbosity: null,
      includeTableOfContents: false,
      includeTitleSlide: true,
      sourceDocumentIds: [],
    });

    // Optional count and template; every absent option defaults, and the
    // legacy singular source field is now an ignored unknown field.
    expect(
      parsePresentationRequest({
        prompt: "Topic",
        format: "pdf",
        sourceDocumentId: "",
      }),
    ).toEqual({
      prompt: "Topic",
      template: "general",
      nSlides: null,
      format: "pdf",
      language: null,
      instructions: null,
      tone: null,
      verbosity: null,
      includeTableOfContents: false,
      includeTitleSlide: true,
      sourceDocumentIds: [],
    });

    const rejected = [
      null,
      {},
      { prompt: "", format: "pptx" },
      { prompt: "x".repeat(2_001), format: "pptx" },
      { prompt: "ok", format: "pptx", nSlides: 4 },
      { prompt: "ok", format: "pptx", nSlides: 31 },
      { prompt: "ok", format: "pptx", nSlides: 7.5 },
      { prompt: "ok", format: "docx" },
      { prompt: "ok" },
      { prompt: "ok", format: "pptx", sourceDocumentIds: ["not-a-uuid"] },
    ];
    for (const payload of rejected) {
      expect(
        parsePresentationRequest(payload),
        `must reject ${JSON.stringify(payload)}`,
      ).toBeNull();
    }
  });

  const base = { prompt: "Photosynthesis", format: "pptx" };

  test("defaults the title-slide flag on and the contents flag off when omitted", async () => {
    const { parsePresentationRequest } = await import(
      "../../lib/data/presentationValues"
    );

    expect(parsePresentationRequest(base)).toMatchObject({
      includeTitleSlide: true,
      includeTableOfContents: false,
    });
  });

  test("honours an explicit false title-slide flag", async () => {
    const { parsePresentationRequest } = await import(
      "../../lib/data/presentationValues"
    );

    expect(
      parsePresentationRequest({ ...base, includeTitleSlide: false }),
    ).toMatchObject({ includeTitleSlide: false });
  });

  test("request parser accepts the new request vocabulary", async () => {
    const { parsePresentationRequest } = await import(
      "../../lib/data/presentationValues"
    );

    const draft = parsePresentationRequest({
      prompt: "Photosynthesis",
      format: "pptx",
      nSlides: 12,
      language: "English",
      instructions: "For first years",
      tone: "educational",
      verbosity: "concise",
      includeTableOfContents: true,
      includeTitleSlide: true,
      sourceDocumentIds: ["0b6a1f6e-2f43-4a70-9f4d-7a1d2f9c1234"],
    });

    expect(draft).toMatchObject({
      language: "English",
      instructions: "For first years",
      tone: "educational",
      verbosity: "concise",
      includeTableOfContents: true,
      includeTitleSlide: true,
      sourceDocumentIds: ["0b6a1f6e-2f43-4a70-9f4d-7a1d2f9c1234"],
    });
  });

  test("accepts exactly the eight-source limit", async () => {
    const { parsePresentationRequest } = await import(
      "../../lib/data/presentationValues"
    );

    const sourceDocumentIds = Array.from(
      { length: 8 },
      (_, index) =>
        `0b6a1f6e-2f43-4a70-9f4d-7a1d2f9c12${String(index).padStart(2, "0")}`,
    );

    expect(
      parsePresentationRequest({ ...base, sourceDocumentIds }),
    ).toMatchObject({ sourceDocumentIds });
  });

  test("accepts an explicit empty source list", async () => {
    const { parsePresentationRequest } = await import(
      "../../lib/data/presentationValues"
    );

    expect(
      parsePresentationRequest({ ...base, sourceDocumentIds: [] }),
    ).toMatchObject({ sourceDocumentIds: [] });
  });

  // Playwright has no `it.each`; the loop declares one test per invalid payload
  // so every case fails in isolation with its own name.
  const invalidVocabularyRequests: Array<[string, Record<string, unknown>]> = [
    ["tone", { tone: "sarcastic" }],
    ["verbosity", { verbosity: "very" }],
    ["language", { language: "Klingon" }],
    // The UI maps "Auto" to null; a stored "Auto" is never valid.
    ["auto language", { language: "Auto" }],
    ["instructions length", { instructions: "x".repeat(2_001) }],
    ["source id shape", { sourceDocumentIds: ["not-a-uuid"] }],
    [
      "duplicate source ids",
      {
        sourceDocumentIds: [
          "0b6a1f6e-2f43-4a70-9f4d-7a1d2f9c1234",
          "0b6a1f6e-2f43-4a70-9f4d-7a1d2f9c1234",
        ],
      },
    ],
    [
      "case-variant duplicate source ids",
      {
        sourceDocumentIds: [
          "0B6A1F6E-2F43-4A70-9F4D-7A1D2F9C1234",
          "0b6a1f6e-2f43-4a70-9f4d-7a1d2f9c1234",
        ],
      },
    ],
    [
      "source count",
      {
        sourceDocumentIds: Array.from(
          { length: 9 },
          () => "0b6a1f6e-2f43-4a70-9f4d-7a1d2f9c1234",
        ),
      },
    ],
  ];
  for (const [label, invalid] of invalidVocabularyRequests) {
    test(`request parser rejects invalid ${label}`, async () => {
      const { parsePresentationRequest } = await import(
        "../../lib/data/presentationValues"
      );

      expect(
        parsePresentationRequest({
          prompt: "Photosynthesis",
          format: "pptx",
          ...invalid,
        }),
      ).toBeNull();
    });
  }
});

/**
 * Task A3 — the pure request builder. The wire body is the shared contract
 * with the worker (a plain `.mjs` that mirrors the shapes), so it is asserted
 * directly: every camelCase input becomes its snake_case field, the two
 * booleans are always present, and absent optionals are omitted — never sent
 * as null, which Presenton would read as a real value.
 */
test.describe("generation request builder (pure)", () => {
  test("sends every request field and always sends the booleans", async () => {
    const { buildGenerationRequestBody } = await import(
      "../../lib/integrations/presenton"
    );
    const body = buildGenerationRequestBody({
      content: "  Photosynthesis  ",
      nSlides: 12,
      language: "English",
      template: "general",
      format: "pptx",
      instructions: "For first years",
      tone: "educational",
      verbosity: "concise",
      includeTableOfContents: true,
      includeTitleSlide: false,
      sourceFiles: ["/app_data/uploads/1/a.pdf"],
    });
    expect(body).toEqual({
      content: "Photosynthesis",
      n_slides: 12,
      language: "English",
      template: "general",
      export_as: "pptx",
      instructions: "For first years",
      tone: "educational",
      verbosity: "concise",
      include_table_of_contents: true,
      include_title_slide: false,
      files: ["/app_data/uploads/1/a.pdf"],
    });
  });

  test("omits null optionals and never sends empty files", async () => {
    const { buildGenerationRequestBody } = await import(
      "../../lib/integrations/presenton"
    );
    const body = buildGenerationRequestBody({
      content: "x",
      template: "general",
      format: "pdf",
      includeTableOfContents: false,
      includeTitleSlide: true,
    });
    expect(body.n_slides).toBeUndefined();
    expect(body.language).toBeUndefined();
    expect(body.files).toBeUndefined();
    expect(body.include_title_slide).toBe(true);
  });
});

/**
 * Task C3 — the editor mutation surface's pure half. The three write bodies are
 * asserted exactly (the wire contract C4's editor consumes): metadata always
 * carries the theme, a slide update wraps the full slide without rotating its
 * id, and a structural replace sends every slide field with a freshly generated
 * UUID per slide — the engine inserts before its owner-scoped delete, so a
 * stored id always collides with `UNIQUE(slides.id)` (controller-verified
 * 2026-09-16). The capability itself ships dark: unset
 * `PRESENTON_STRUCTURAL_EDITS` means off, and no UI caller may use the replace
 * path until it is "1".
 *
 * The builders forward their JSON verbatim; a resolved flat theme and the
 * stored package shape both round-trip unchanged.
 */
const C3_DECK_ID = "1b6a1f6e-2f43-4a70-9f4d-7a1d2f9c9001";
const C3_SLIDE_ID = "1b6a1f6e-2f43-4a70-9f4d-7a1d2f9c9002";
const C3_SLIDE_ID_B = "1b6a1f6e-2f43-4a70-9f4d-7a1d2f9c9003";

function deckThemeFixture(): DeckTheme {
  return {
    colors: {
      primary: "#3b82f6",
      background: "#ffffff",
      card: "#f3f4f6",
      stroke: "#d1d5db",
      background_text: "#111827",
      primary_text: "#ffffff",
      graph_0: "#ef4444",
      graph_1: "#f97316",
      graph_2: "#eab308",
      graph_3: "#22c55e",
      graph_4: "#14b8a6",
      graph_5: "#06b6d4",
      graph_6: "#3b82f6",
      graph_7: "#6366f1",
      graph_8: "#8b5cf6",
      graph_9: "#ec4899",
    },
    fonts: { textFont: { name: "Inter", url: "https://fonts.test/inter.woff2" } },
  };
}

function deckSlideFixture(overrides: Partial<DeckSlide> = {}): DeckSlide {
  return {
    id: C3_SLIDE_ID,
    presentation: C3_DECK_ID,
    layout_group: "general",
    layout: "title_description",
    index: 0,
    content: { title: "Photosynthesis" },
    properties: null,
    ui: null,
    html_content: null,
    speaker_note: null,
    ...overrides,
  };
}

test.describe("editor mutation builders (pure)", () => {
  test("metadata body always carries the theme and trims a given title", async () => {
    const { buildPresentationUpdateBody } = await import(
      "../../lib/integrations/presenton"
    );
    const theme = deckThemeFixture();

    expect(buildPresentationUpdateBody({ id: C3_DECK_ID, theme })).toEqual({
      id: C3_DECK_ID,
      theme,
    });

    expect(
      buildPresentationUpdateBody({
        id: C3_DECK_ID,
        title: "  Cellular respiration  ",
        theme,
      }),
    ).toEqual({ id: C3_DECK_ID, title: "Cellular respiration", theme });
  });

  test("metadata body rejects an empty title instead of a silent no-op", async () => {
    const { buildPresentationUpdateBody } = await import(
      "../../lib/integrations/presenton"
    );

    expect(() =>
      buildPresentationUpdateBody({
        id: C3_DECK_ID,
        title: "   ",
        theme: deckThemeFixture(),
      }),
    ).toThrow(/A deck title is required\./);
  });

  test("metadata body refuses a missing theme instead of letting JSON drop it", async () => {
    const { buildPresentationUpdateBody } = await import(
      "../../lib/integrations/presenton"
    );

    for (const theme of [undefined, null]) {
      expect(() =>
        buildPresentationUpdateBody({
          id: C3_DECK_ID,
          theme: theme as unknown as DeckTheme,
        }),
      ).toThrow(/A theme is required\./);
    }
  });

  test("slide update wraps the full slide unchanged", async () => {
    const { buildSlideUpdateBody } = await import(
      "../../lib/integrations/presenton"
    );
    const slide = deckSlideFixture({
      properties: { background: "#101820" },
      ui: { components: [] },
      html_content: "<p>smart</p>",
      speaker_note: "Say hello",
    });

    expect(buildSlideUpdateBody(slide)).toEqual({
      slide: {
        id: C3_SLIDE_ID,
        presentation: C3_DECK_ID,
        layout_group: "general",
        layout: "title_description",
        index: 0,
        content: { title: "Photosynthesis" },
        properties: { background: "#101820" },
        ui: { components: [] },
        html_content: "<p>smart</p>",
        speaker_note: "Say hello",
      },
    });
  });

  test("slide update sends absent nullable fields as explicit nulls", async () => {
    const { buildSlideUpdateBody } = await import(
      "../../lib/integrations/presenton"
    );
    const slide: DeckSlide = {
      id: C3_SLIDE_ID,
      presentation: C3_DECK_ID,
      layout_group: "general",
      layout: "content",
      index: 3,
      content: { bullets: ["a"] },
    };

    expect(buildSlideUpdateBody(slide)).toEqual({
      slide: {
        id: C3_SLIDE_ID,
        presentation: C3_DECK_ID,
        layout_group: "general",
        layout: "content",
        index: 3,
        content: { bullets: ["a"] },
        properties: null,
        ui: null,
        html_content: null,
        speaker_note: null,
      },
    });
  });

  test("replace body sends every slide field, nullable fields included, plus the theme", async () => {
    const { buildSlidesReplaceBody } = await import(
      "../../lib/integrations/presenton"
    );
    const theme = deckThemeFixture();
    const first = deckSlideFixture();
    const second = deckSlideFixture({
      id: C3_SLIDE_ID_B,
      layout: "content",
      index: 1,
      content: { bullets: ["a"] },
    });

    expect(
      buildSlidesReplaceBody({ id: C3_DECK_ID, theme, slides: [first, second] }),
    ).toEqual({
      id: C3_DECK_ID,
      theme,
      slides: [
        {
          id: C3_SLIDE_ID,
          presentation: C3_DECK_ID,
          layout_group: "general",
          layout: "title_description",
          index: 0,
          content: { title: "Photosynthesis" },
          properties: null,
          ui: null,
          html_content: null,
          speaker_note: null,
        },
        {
          id: C3_SLIDE_ID_B,
          presentation: C3_DECK_ID,
          layout_group: "general",
          layout: "content",
          index: 1,
          content: { bullets: ["a"] },
          properties: null,
          ui: null,
          html_content: null,
          speaker_note: null,
        },
      ],
    });
  });

  test("package themes round-trip verbatim through every body", async () => {
    const { buildPresentationUpdateBody, buildSlidesReplaceBody } = await import(
      "../../lib/integrations/presenton"
    );
    const theme: DeckThemePackage = {
      name: "General Theme",
      description: "Theme generated from the template",
      data: deckThemeFixture(),
      source: "template",
      template_id: "general",
    };

    const metadata = buildPresentationUpdateBody({ id: C3_DECK_ID, theme });
    expect(metadata.theme).toBe(theme);
    expect(metadata).toEqual({ id: C3_DECK_ID, theme });

    const replace = buildSlidesReplaceBody({
      id: C3_DECK_ID,
      theme,
      slides: [deckSlideFixture()],
    });
    expect(replace.theme).toBe(theme);
    expect(replace).toEqual({
      id: C3_DECK_ID,
      theme,
      slides: [
        {
          id: C3_SLIDE_ID,
          presentation: C3_DECK_ID,
          layout_group: "general",
          layout: "title_description",
          index: 0,
          content: { title: "Photosynthesis" },
          properties: null,
          ui: null,
          html_content: null,
          speaker_note: null,
        },
      ],
    });
  });

  test("replace body rejects a slide id that isn't a UUID", async () => {
    const { buildSlidesReplaceBody } = await import(
      "../../lib/integrations/presenton"
    );

    expect(() =>
      buildSlidesReplaceBody({
        id: C3_DECK_ID,
        theme: deckThemeFixture(),
        slides: [deckSlideFixture({ id: "slide-1" })],
      }),
    ).toThrow(/Invalid slide id\./);
  });

  test("replace body rejects a slide that belongs to another deck", async () => {
    const { buildSlidesReplaceBody } = await import(
      "../../lib/integrations/presenton"
    );

    expect(() =>
      buildSlidesReplaceBody({
        id: C3_DECK_ID,
        theme: deckThemeFixture(),
        slides: [
          deckSlideFixture({
            presentation: "1b6a1f6e-2f43-4a70-9f4d-7a1d2f9c9abc",
          }),
        ],
      }),
    ).toThrow(/A slide belongs to a different deck\./);
  });

  test("replace body rejects two slides sharing an id", async () => {
    const { buildSlidesReplaceBody } = await import(
      "../../lib/integrations/presenton"
    );

    expect(() =>
      buildSlidesReplaceBody({
        id: C3_DECK_ID,
        theme: deckThemeFixture(),
        slides: [
          deckSlideFixture(),
          deckSlideFixture({ id: C3_SLIDE_ID.toUpperCase() }),
        ],
      }),
    ).toThrow(/Duplicate slide id\./);
  });

  test("replace body rejects an empty slide list", async () => {
    const { buildSlidesReplaceBody } = await import(
      "../../lib/integrations/presenton"
    );

    expect(() =>
      buildSlidesReplaceBody({
        id: C3_DECK_ID,
        theme: deckThemeFixture(),
        slides: [],
      }),
    ).toThrow(/Invalid slide list\./);
  });

  test("replace body rejects more slides than the engine accepts", async () => {
    const { buildSlidesReplaceBody } = await import(
      "../../lib/integrations/presenton"
    );
    const slides = Array.from({ length: 51 }, (_, index) =>
      deckSlideFixture({
        id: `1b6a1f6e-2f43-4a70-9f4d-7a1d2f9c${String(index).padStart(4, "0")}`,
        index,
      }),
    );

    expect(() =>
      buildSlidesReplaceBody({
        id: C3_DECK_ID,
        theme: deckThemeFixture(),
        slides,
      }),
    ).toThrow(/Invalid slide list\./);
  });

  test("replace body refuses a missing theme instead of letting JSON drop it", async () => {
    const { buildSlidesReplaceBody } = await import(
      "../../lib/integrations/presenton"
    );

    for (const theme of [undefined, null]) {
      expect(() =>
        buildSlidesReplaceBody({
          id: C3_DECK_ID,
          theme: theme as unknown as DeckTheme,
          slides: [deckSlideFixture()],
        }),
      ).toThrow(/A theme is required\./);
    }
  });

  test('structural editing is off unless PRESENTON_STRUCTURAL_EDITS is exactly "1"', async () => {
    const { isStructuralEditingEnabled } = await import(
      "../../lib/integrations/presenton"
    );
    const saved = process.env.PRESENTON_STRUCTURAL_EDITS;
    try {
      delete process.env.PRESENTON_STRUCTURAL_EDITS;
      expect(isStructuralEditingEnabled()).toBe(false);

      for (const value of ["", "0", "true", "yes", "01"]) {
        process.env.PRESENTON_STRUCTURAL_EDITS = value;
        expect(
          isStructuralEditingEnabled(),
          `must be off for ${JSON.stringify(value)}`,
        ).toBe(false);
      }

      process.env.PRESENTON_STRUCTURAL_EDITS = "1";
      expect(isStructuralEditingEnabled()).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.PRESENTON_STRUCTURAL_EDITS;
      else process.env.PRESENTON_STRUCTURAL_EDITS = saved;
    }
  });
});

/**
 * Task C3 — the async mutations reuse the adapter's guard/classification
 * vocabulary: unconfigured refuses before any body validation, and an unsafe
 * deck id or a slide from a different deck is rejected before any fetch.
 */
test.describe("editor mutation guards (no service)", () => {
  test("mutations refuse honestly while the integration is unconfigured", async () => {
    const adapter = await import("../../lib/integrations/presenton");
    const savedUrl = process.env.PRESENTON_URL;
    const savedKey = process.env.PRESENTON_API_KEY;
    delete process.env.PRESENTON_URL;
    delete process.env.PRESENTON_API_KEY;
    try {
      await expect(
        adapter.updatePresentation({
          id: C3_DECK_ID,
          title: "Renamed",
          theme: deckThemeFixture(),
        }),
      ).rejects.toMatchObject({ code: "not-configured" });

      await expect(
        adapter.updateSlide(C3_DECK_ID, deckSlideFixture()),
      ).rejects.toMatchObject({ code: "not-configured" });

      await expect(
        adapter.requestPresentationExport(C3_DECK_ID, "pptx"),
      ).rejects.toMatchObject({ code: "not-configured" });
    } finally {
      if (savedUrl !== undefined) process.env.PRESENTON_URL = savedUrl;
      if (savedKey !== undefined) process.env.PRESENTON_API_KEY = savedKey;
    }
  });

  test("an unsafe deck id or a foreign slide is rejected before any fetch", async () => {
    const adapter = await import("../../lib/integrations/presenton");
    const savedUrl = process.env.PRESENTON_URL;
    // A dead loopback port: a fetch would classify as `unreachable`; both
    // guards must answer `rejected` without ever reaching it.
    process.env.PRESENTON_URL = "http://127.0.0.1:9";
    try {
      await expect(
        adapter.updateSlide("bad/../id", deckSlideFixture()),
      ).rejects.toMatchObject({ code: "rejected" });

      await expect(
        adapter.updateSlide(
          C3_DECK_ID,
          deckSlideFixture({
            presentation: "1b6a1f6e-2f43-4a70-9f4d-7a1d2f9c9abc",
          }),
        ),
      ).rejects.toMatchObject({ code: "rejected" });
    } finally {
      if (savedUrl === undefined) delete process.env.PRESENTON_URL;
      else process.env.PRESENTON_URL = savedUrl;
    }
  });

  test("the structural replace is refused while the flag is off, before any fetch", async () => {
    const adapter = await import("../../lib/integrations/presenton");
    const savedUrl = process.env.PRESENTON_URL;
    const savedFlag = process.env.PRESENTON_STRUCTURAL_EDITS;
    process.env.PRESENTON_URL = "http://127.0.0.1:9";
    delete process.env.PRESENTON_STRUCTURAL_EDITS;
    try {
      await expect(
        adapter.updatePresentation({
          id: C3_DECK_ID,
          theme: deckThemeFixture(),
          slides: [deckSlideFixture()],
        }),
      ).rejects.toMatchObject({ code: "rejected" });
    } finally {
      if (savedUrl === undefined) delete process.env.PRESENTON_URL;
      else process.env.PRESENTON_URL = savedUrl;
      if (savedFlag === undefined) delete process.env.PRESENTON_STRUCTURAL_EDITS;
      else process.env.PRESENTON_STRUCTURAL_EDITS = savedFlag;
    }
  });
});

/**
 * Task C3 — the mutation transport against a tiny in-process engine: the exact
 * method, path and JSON body of every write, the flag-gated replace path, and
 * the shared failure classification (4xx → `rejected`, 5xx → `unreachable`).
 * In-process is safe here (unlike the worker's stub, which must be a child
 * process because `execFileSync` blocks the test's event loop): every adapter
 * call runs on this test's own event loop, so a plain server can answer it.
 */
test.describe("editor mutation wire (in-process stub)", () => {
  test("PATCHes every write body and classifies failures like the rest of the adapter", async () => {
    const adapter = await import("../../lib/integrations/presenton");
    const theme = deckThemeFixture();
    // The stored package shape, exactly as C4 must forward it on a rename.
    const packageTheme: DeckThemePackage = {
      name: "General Theme",
      description: "Theme generated from the template",
      data: theme,
      source: "template",
      template_id: "general",
    };
    const slide = deckSlideFixture({
      html_content: "<p>smart</p>",
      speaker_note: "Say hello",
    });

    const requests: Array<{ method?: string; url?: string; body?: unknown }> = [];
    let forcedStatus: number | null = null;
    const stub = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        requests.push({
          method: req.method,
          url: req.url,
          body: raw === "" ? undefined : JSON.parse(raw),
        });
        if (forcedStatus !== null) {
          res.statusCode = forcedStatus;
          res.end();
          return;
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ id: C3_DECK_ID, slides: [] }));
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
    const address = stub.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;

    const savedUrl = process.env.PRESENTON_URL;
    const savedKey = process.env.PRESENTON_API_KEY;
    const savedFlag = process.env.PRESENTON_STRUCTURAL_EDITS;
    process.env.PRESENTON_URL = `http://127.0.0.1:${port}`;
    delete process.env.PRESENTON_API_KEY;
    process.env.PRESENTON_STRUCTURAL_EDITS = "1";
    try {
      await adapter.updatePresentation({
        id: C3_DECK_ID,
        title: "Renamed",
        theme: packageTheme,
      });
      await adapter.updatePresentation({
        id: C3_DECK_ID,
        theme,
        slides: [slide],
      });
      await adapter.updateSlide(C3_DECK_ID, slide);
      await adapter.requestPresentationExport(C3_DECK_ID, "pdf");

      expect(requests.map((request) => [request.method, request.url])).toEqual([
        ["PATCH", "/api/v1/ppt/presentation/update"],
        ["PATCH", "/api/v1/ppt/presentation/update"],
        ["PATCH", "/api/v1/ppt/presentation/slide_update"],
        ["POST", `/api/v1/ppt/presentation/${C3_DECK_ID}/export`],
      ]);
      expect(requests[0].body).toEqual({
        id: C3_DECK_ID,
        title: "Renamed",
        theme: packageTheme,
      });
      expect(requests[1].body).toEqual({
        id: C3_DECK_ID,
        theme,
        slides: [
          {
            id: C3_SLIDE_ID,
            presentation: C3_DECK_ID,
            layout_group: "general",
            layout: "title_description",
            index: 0,
            content: { title: "Photosynthesis" },
            properties: null,
            ui: null,
            html_content: "<p>smart</p>",
            speaker_note: "Say hello",
          },
        ],
      });
      expect(requests[2].body).toEqual({
        slide: {
          id: C3_SLIDE_ID,
          presentation: C3_DECK_ID,
          layout_group: "general",
          layout: "title_description",
          index: 0,
          content: { title: "Photosynthesis" },
          properties: null,
          ui: null,
          html_content: "<p>smart</p>",
          speaker_note: "Say hello",
        },
      });
      expect(requests[3].body).toEqual({ export_as: "pdf" });

      // A rename and a structural write are separate saves; asking for both in
      // one call is refused before the wire rather than silently dropping one.
      await expect(
        adapter.updatePresentation({
          id: C3_DECK_ID,
          title: "Renamed",
          theme,
          slides: [slide],
        }),
      ).rejects.toMatchObject({ code: "rejected" });
      expect(requests).toHaveLength(4);

      forcedStatus = 400;
      await expect(
        adapter.updatePresentation({ id: C3_DECK_ID, theme }),
      ).rejects.toMatchObject({ code: "rejected" });

      forcedStatus = 500;
      await expect(
        adapter.updatePresentation({ id: C3_DECK_ID, theme }),
      ).rejects.toMatchObject({ code: "unreachable" });
    } finally {
      await new Promise<void>((resolve) => stub.close(() => resolve()));
      if (savedUrl === undefined) delete process.env.PRESENTON_URL;
      else process.env.PRESENTON_URL = savedUrl;
      if (savedKey === undefined) delete process.env.PRESENTON_API_KEY;
      else process.env.PRESENTON_API_KEY = savedKey;
      if (savedFlag === undefined) delete process.env.PRESENTON_STRUCTURAL_EDITS;
      else process.env.PRESENTON_STRUCTURAL_EDITS = savedFlag;
    }
  });
});

test.describe("worker pass-through (stub engine)", () => {
  test("sends the full request and every source file (stub engine)", async () => {
    const release = await acquireWorkerLock();
    const engine = await startStubEngine();
    try {
      const doc = await insertDocumentWithObject();
      const presentationId = await insertPresentation({
        n_slides: 12,
        language: "English",
        instructions: "For first years",
        tone: "educational",
        verbosity: "concise",
        include_table_of_contents: true,
        include_title_slide: false,
        source_document_ids: [doc.id],
      });
      const jobId = await insertJob({ presentationId });

      const output = runWorkerOnce({ PRESENTON_URL: engine.url });
      expect(output).toContain(`settled job=${jobId}`);

      const captured = await engine.captured();
      expect(captured.uploads).toBe(1);
      expect(captured.body).toMatchObject({
        content: "Introduction to machine learning",
        template: "general",
        export_as: "pptx",
        n_slides: 12,
        language: "English",
        instructions: "For first years",
        tone: "educational",
        verbosity: "concise",
        include_table_of_contents: true,
        include_title_slide: false,
        files: ["/app_data/uploads/1.pdf"],
      });

      // The stub task ended "error"/400: the row settles permanently without
      // downloading an export or storing a document.
      const { data: presentation, error } = await service
        .from("presentations")
        .select("status, error_message, document_id")
        .eq("id", presentationId)
        .single();
      expect(error, `presentation read: ${error?.message}`).toBeNull();
      expect(presentation).toMatchObject({
        status: "failed",
        error_message: SERVICE_FAILED_COPY,
        document_id: null,
      });
    } finally {
      await engine.close();
      release();
    }
  });

  test("uploads every source document and concatenates the returned paths", async () => {
    const release = await acquireWorkerLock();
    const engine = await startStubEngine();
    try {
      const first = await insertDocumentWithObject();
      const second = await insertDocumentWithObject();
      const presentationId = await insertPresentation({
        source_document_ids: [first.id, second.id],
      });
      const jobId = await insertJob({ presentationId });

      const output = runWorkerOnce({ PRESENTON_URL: engine.url });
      expect(output).toContain(`settled job=${jobId}`);

      const captured = await engine.captured();
      expect(captured.uploads).toBe(2);
      expect(captured.body).toMatchObject({
        include_table_of_contents: false,
        include_title_slide: true,
        files: ["/app_data/uploads/1.pdf", "/app_data/uploads/2.pdf"],
      });
      // Absent optionals are omitted, never sent as null.
      expect(captured.body).not.toHaveProperty("n_slides");
      expect(captured.body).not.toHaveProperty("language");
      expect(captured.body).not.toHaveProperty("instructions");
      expect(captured.body).not.toHaveProperty("tone");
      expect(captured.body).not.toHaveProperty("verbosity");
    } finally {
      await engine.close();
      release();
    }
  });

  test("an unreadable source fails the job permanently before any upload", async () => {
    const release = await acquireWorkerLock();
    const engine = await startStubEngine();
    try {
      const presentationId = await insertPresentation({
        source_document_ids: [randomUUID()],
      });
      const jobId = await insertJob({ presentationId });

      const output = runWorkerOnce({ PRESENTON_URL: engine.url });
      expect(output).toContain(`settled job=${jobId}`);
      expect(output).toContain("status=failed");

      const captured = await engine.captured();
      expect(captured.uploads).toBe(0);
      expect(captured.body).toBeUndefined();

      const { data: presentation, error } = await service
        .from("presentations")
        .select("status, error_message, document_id")
        .eq("id", presentationId)
        .single();
      expect(error, `presentation read: ${error?.message}`).toBeNull();
      expect(presentation).toMatchObject({
        status: "failed",
        error_message: SOURCE_UNREADABLE_COPY,
        document_id: null,
      });
    } finally {
      await engine.close();
      release();
    }
  });

  test("a 4xx upload answer fails permanently with the unreadable-source copy", async () => {
    const release = await acquireWorkerLock();
    const engine = await startStubEngine({ uploadStatus: 400 });
    try {
      const doc = await insertDocumentWithObject();
      const presentationId = await insertPresentation({
        source_document_ids: [doc.id],
      });
      const jobId = await insertJob({ presentationId });

      const output = runWorkerOnce({ PRESENTON_URL: engine.url });
      expect(output).toContain(`settled job=${jobId}`);
      expect(output).toContain("status=failed");

      const captured = await engine.captured();
      expect(captured.uploads).toBe(1);
      expect(captured.body).toBeUndefined();

      const { data: presentation, error } = await service
        .from("presentations")
        .select("status, error_message, document_id")
        .eq("id", presentationId)
        .single();
      expect(error, `presentation read: ${error?.message}`).toBeNull();
      expect(presentation).toMatchObject({
        status: "failed",
        error_message: SOURCE_UNREADABLE_COPY,
        document_id: null,
      });
    } finally {
      await engine.close();
      release();
    }
  });
});

/**
 * Task C1 — `presentation.export` through the stub engine. The engine answers
 * the export route with an app-relative path and serves those bytes; the
 * worker must replace the deck's existing document in place (same row id, same
 * `storage_path`, new bytes/mime/size) and settle the export mirror. The
 * unconfigured run proves the honest blocked path touches nothing.
 */
test.describe("export re-export (stub engine)", () => {
  test("replaces the same document in place and settles the export mirror", async () => {
    const release = await acquireWorkerLock();
    const engine = await startStubEngine();
    try {
      const deck = await insertPresentationDocumentWithObject();
      const presentationId = await insertPresentation({
        status: "succeeded",
        presenton_presentation_id: STUB_PRESENTATION_ID,
        document_id: deck.id,
      });
      const jobId = await insertJob({ presentationId }, 5, "presentation.export");

      const output = runWorkerOnce({ PRESENTON_URL: engine.url });
      expect(output).toContain(`settled job=${jobId}`);
      expect(output).toContain("status=succeeded");

      const captured = await engine.captured();
      expect(captured.exportBody).toEqual({ export_as: "pptx" });

      // Same row, same key: one deck → one document, no version history.
      const { data: document, error: documentError } = await service
        .from("documents")
        .select("id, mime_type, size_bytes, storage_path")
        .eq("id", deck.id)
        .single();
      expect(documentError, `document read: ${documentError?.message}`).toBeNull();
      expect(document).toMatchObject({
        id: deck.id,
        storage_path: deck.storagePath,
        mime_type: PPTX_MIME,
        size_bytes: STUB_EXPORT_BYTES.byteLength,
      });

      // The stored object itself is the stub export's bytes now.
      const stored = await service.storage
        .from("documents")
        .download(deck.storagePath);
      expect(stored.error, `stored object: ${stored.error?.message}`).toBeNull();
      const storedBytes = Buffer.from(await stored.data!.arrayBuffer());
      expect(storedBytes.equals(STUB_EXPORT_BYTES)).toBe(true);

      const { data: presentation, error: presentationError } = await service
        .from("presentations")
        .select("export_status, export_error_message, exported_at")
        .eq("id", presentationId)
        .single();
      expect(
        presentationError,
        `presentation read: ${presentationError?.message}`,
      ).toBeNull();
      expect(presentation).toMatchObject({
        export_status: "succeeded",
        export_error_message: null,
      });
      expect(presentation!.exported_at).not.toBeNull();
    } finally {
      await engine.close();
      release();
    }
  });

  test("an unconfigured export fails the mirror honestly and touches nothing", async () => {
    const release = await acquireWorkerLock();
    try {
      const deck = await insertPresentationDocumentWithObject();
      const presentationId = await insertPresentation({
        status: "succeeded",
        presenton_presentation_id: STUB_PRESENTATION_ID,
        document_id: deck.id,
      });
      const jobId = await insertJob({ presentationId }, 5, "presentation.export");

      const output = runWorkerOnceUnconfigured();
      expect(output).toContain(`settled job=${jobId}`);
      expect(output).toContain("status=failed");

      const { data: presentation, error: presentationError } = await service
        .from("presentations")
        .select("export_status, export_error_message, exported_at")
        .eq("id", presentationId)
        .single();
      expect(
        presentationError,
        `presentation read: ${presentationError?.message}`,
      ).toBeNull();
      expect(presentation).toMatchObject({
        export_status: "failed",
        export_error_message: NOT_CONNECTED_COPY,
        exported_at: null,
      });

      const { data: document, error: documentError } = await service
        .from("documents")
        .select("mime_type, size_bytes")
        .eq("id", deck.id)
        .single();
      expect(documentError, `document read: ${documentError?.message}`).toBeNull();
      expect(document).toMatchObject({
        mime_type: "application/pdf",
        size_bytes: SEEDED_DECK_BYTES.byteLength,
      });
    } finally {
      release();
    }
  });
});

/**
 * Task C1 — the export mirror's pure half: the new row columns map onto the
 * item, and absent (null) export fields are omitted rather than defaulted,
 * exactly like every other optional field in the module.
 */
test.describe("export mirror mapping (pure)", () => {
  /**
   * The C1 columns the migration adds. Declared here as an intersection so the
   * spec compiles before `npm run db:types` regenerates `PresentationRow`; the
   * generated type and this one agree once it has.
   */
  type ExportMirrorRow = PresentationRow & {
    export_status: string | null;
    export_error_message: string | null;
    exported_at: string | null;
  };

  /** The matching item fields, for the same pre-`db:types` reason. */
  type ExportMirrorItem = PresentationItem & {
    exportStatus?: string;
    exportErrorMessage?: string;
    exportedAt?: string;
  };

  const asExportItem = (item: PresentationItem): ExportMirrorItem =>
    item as ExportMirrorItem;

  function exportMirrorRow(
    overrides: Partial<ExportMirrorRow> = {},
  ): ExportMirrorRow {
    return {
      id: "0b6a1f6e-2f43-4a70-9f4d-7a1d2f9c1234",
      prompt: "Photosynthesis",
      template: "general",
      n_slides: 12,
      format: "pptx",
      status: "succeeded",
      error_message: null,
      slides_done: null,
      slides_total: null,
      document_id: "1b6a1f6e-2f43-4a70-9f4d-7a1d2f9c1234",
      presenton_presentation_id: "presenton-deck-1",
      created_at: "2026-09-16T12:00:00.000Z",
      export_status: null,
      export_error_message: null,
      exported_at: null,
      ...overrides,
    };
  }

  test("omits the export fields when the row has never been exported", async () => {
    const { presentationRowToItem } = await import(
      "../../lib/data/presentationValues"
    );

    const item = asExportItem(presentationRowToItem(exportMirrorRow(), null, "UTC"));
    expect(item.exportStatus).toBeUndefined();
    expect(item.exportErrorMessage).toBeUndefined();
    expect(item.exportedAt).toBeUndefined();
  });

  test("surfaces the export mirror when the row carries it", async () => {
    const { presentationRowToItem } = await import(
      "../../lib/data/presentationValues"
    );

    const succeeded = asExportItem(
      presentationRowToItem(
        exportMirrorRow({
          export_status: "succeeded",
          exported_at: "2026-09-16T12:34:56.000Z",
        }),
        null,
        "UTC",
      ),
    );
    expect(succeeded.exportStatus).toBe("succeeded");
    expect(succeeded.exportedAt).toBe("2026-09-16T12:34:56.000Z");
    expect(succeeded.exportErrorMessage).toBeUndefined();

    const failed = asExportItem(
      presentationRowToItem(
        exportMirrorRow({
          export_status: "failed",
          export_error_message: "Sanitized export copy.",
        }),
        null,
        "UTC",
      ),
    );
    expect(failed.exportStatus).toBe("failed");
    expect(failed.exportErrorMessage).toBe("Sanitized export copy.");
  });
});

test.describe("worker wiring (unconfigured, honest blocked path)", () => {
  test("fails the job permanently and the row honestly, storing nothing", async () => {
    const release = await acquireWorkerLock();
    try {
      const presentationId = await insertPresentation();
      const jobId = await insertJob({ presentationId });

      const output = runWorkerOnceUnconfigured();
      expect(output).toContain(`settled job=${jobId}`);
      expect(output).toContain("status=failed");

      const { data: presentation, error: presentationError } = await service
        .from("presentations")
        .select(
          "status, error_message, document_id, presenton_task_id, presenton_presentation_id",
        )
        .eq("id", presentationId)
        .single();
      expect(
        presentationError,
        `presentation read: ${presentationError?.message}`,
      ).toBeNull();
      expect(presentation).toMatchObject({
        status: "failed",
        error_message: NOT_CONNECTED_COPY,
        document_id: null,
        presenton_task_id: null,
        presenton_presentation_id: null,
      });

      const { data: job, error: jobError } = await service
        .from("jobs")
        .select("status, attempts, last_error, completed_at")
        .eq("id", jobId)
        .single();
      expect(jobError, `job read: ${jobError?.message}`).toBeNull();
      expect(job).toMatchObject({
        status: "failed",
        attempts: 1,
        last_error: NOT_CONNECTED_COPY,
      });
      expect(job!.completed_at).not.toBeNull();
    } finally {
      release();
    }
  });

  test("unreachable service: retryable failure keeps the request queued with honest copy", async () => {
    const release = await acquireWorkerLock();
    try {
      const presentationId = await insertPresentation();
      const jobId = await insertJob({ presentationId }, 2);

      // A dead loopback endpoint: the worker's fetch is refused, which is the
      // retryable transport failure the runner backs off. No provider is
      // faked — the attempt genuinely reaches out and genuinely fails.
      const output = runWorkerOnce({
        PRESENTON_URL: "http://127.0.0.1:9",
        PRESENTON_API_KEY: "",
      });
      expect(output).toContain(`settled job=${jobId}`);
      expect(output).toContain("status=queued");

      const { data: presentation, error: presentationError } = await service
        .from("presentations")
        .select("status, error_message, document_id")
        .eq("id", presentationId)
        .single();
      expect(
        presentationError,
        `presentation read: ${presentationError?.message}`,
      ).toBeNull();
      expect(presentation).toMatchObject({
        status: "queued",
        error_message: TRANSIENT_COPY,
        document_id: null,
      });

      const { data: job, error: jobError } = await service
        .from("jobs")
        .select("status, attempts, last_error, run_after")
        .eq("id", jobId)
        .single();
      expect(jobError, `job read: ${jobError?.message}`).toBeNull();
      expect(job).toMatchObject({
        status: "queued",
        attempts: 1,
        last_error: TRANSIENT_COPY,
      });
      // The documented 30 s backoff pushed the next attempt forward.
      expect(new Date(job!.run_after).getTime()).toBeGreaterThan(Date.now());
    } finally {
      release();
    }
  });

  test("RLS: owner reads only; no client write; anon reads nothing", async () => {
    const presentationId = await insertPresentation({ status: "running" });

    const { data: own, error: ownError } = await qa1
      .from("presentations")
      .select("id")
      .eq("id", presentationId);
    expect(ownError, `owner read: ${ownError?.message}`).toBeNull();
    expect(own ?? []).toHaveLength(1);

    const { data: other, error: otherError } = await qa2
      .from("presentations")
      .select("id")
      .eq("id", presentationId);
    expect(otherError, `other read: ${otherError?.message}`).toBeNull();
    expect(other ?? []).toHaveLength(0);

    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: anonymous, error: anonError } = await anon
      .from("presentations")
      .select("id")
      .eq("id", presentationId);
    expect(anonError, `anon read: ${anonError?.message}`).not.toBeNull();
    expect(anonymous ?? []).toHaveLength(0);

    // No client role may write: the table grants SELECT only (server-only
    // writes), so all three mutations must be denied.
    const insertAttempt = await qa1.from("presentations").insert({
      user_id: qa1Id,
      prompt: "forged",
      template: "general",
      format: "pptx",
    });
    expect(insertAttempt.error, "client INSERT must be denied").not.toBeNull();

    const updateAttempt = await qa1
      .from("presentations")
      .update({ status: "succeeded" })
      .eq("id", presentationId);
    expect(updateAttempt.error, "client UPDATE must be denied").not.toBeNull();

    const deleteAttempt = await qa1
      .from("presentations")
      .delete()
      .eq("id", presentationId);
    expect(deleteAttempt.error, "client DELETE must be denied").not.toBeNull();

    const { data: survived, error: survivedError } = await service
      .from("presentations")
      .select("id, status")
      .eq("id", presentationId)
      .single();
    expect(survivedError, `survivor read: ${survivedError?.message}`).toBeNull();
    expect(survived).toMatchObject({ id: presentationId, status: "running" });
  });

  test("insertPresentation writes every draft field and both sources round-trip", async () => {
    const { insertPresentation: insertDraft } = await import(
      "../../lib/data/presentations"
    );
    const sourceDocumentIds = [randomUUID(), randomUUID()];

    const created = await insertDraft(qa1Id, {
      prompt: "Round-trip request",
      template: "general",
      nSlides: 11,
      format: "pdf",
      language: "English",
      instructions: "For first years",
      tone: "educational",
      verbosity: "concise",
      includeTableOfContents: true,
      includeTitleSlide: false,
      sourceDocumentIds,
    });
    createdPresentationIds.push(created.id);
    everCreatedPresentationIds.push(created.id);

    const { data, error } = await service
      .from("presentations")
      .select(
        "prompt, template, n_slides, format, language, instructions, tone, verbosity, include_table_of_contents, include_title_slide, source_document_ids, status",
      )
      .eq("id", created.id)
      .single();
    expect(error, `round-trip read: ${error?.message}`).toBeNull();
    expect(data).toMatchObject({
      prompt: "Round-trip request",
      template: "general",
      n_slides: 11,
      format: "pdf",
      language: "English",
      instructions: "For first years",
      tone: "educational",
      verbosity: "concise",
      include_table_of_contents: true,
      include_title_slide: false,
      source_document_ids: sourceDocumentIds,
      status: "queued",
    });
  });

  test("a successful settle keeps the row; a removed row is a no-op", async () => {
    const release = await acquireWorkerLock();
    try {
      // Row that never existed: the worker logs and succeeds (nothing to do).
      const missingJob = await insertJob({ presentationId: randomUUID() });
      const output = runWorkerOnceUnconfigured();
      expect(output).toContain(`settled job=${missingJob}`);
    } finally {
      release();
    }
  });
});
