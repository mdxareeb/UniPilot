/**
 * tests/qa/documents-processing.spec.ts — Task 24.x's document-processing
 * proof.
 *
 * The real worker (`backend/worker/run.mjs`, handler `document.process`) is
 * driven exactly as an operator runs it: the spec uploads/enqueues documents
 * through the real hand-off (the UI's finalize path for the happy case,
 * service-seeded rows otherwise), runs the worker with `--once`, and asserts
 * what landed in `documents`/`document_chunks`:
 *
 * - a real 2-page PDF uploaded through the UI goes indexing → indexed with
 *   one ordered text unit per page and the page count;
 * - a DOCX becomes one text unit (DOCX has no layout pages);
 * - a missing object retries with the 29.1 backoff and dead-letters, with the
 *   sanitized transient/terminal copy on the document;
 * - a corrupt PDF and an image fail permanently with their sanitized copy
 *   (the image path is the honest 24.5/24.6 block — no fake OCR text);
 * - the 24.13 page limit rejects an over-limit PDF before any chunks;
 * - chunks are isolated by the owning document's RLS;
 * - the step-0 ACL audit holds: `anon`/`authenticated` cannot execute the
 *   trigger functions or `complete_onboarding` as `anon`, and the revoked
 *   server-only writes cannot be exercised by a session;
 * - the 24.14 benchmark harness measures real fixtures (and reports honestly
 *   when there are none).
 *
 * Own Playwright project (`qa-documents-processing`, after `qa-documents-ui`).
 * Every row/object/job this spec creates is tracked and torn down; local-only;
 * hosted is never contacted.
 */
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { zipSync, strToU8 } from "fflate";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";
const qa2Password = process.env.UNIPILOT_QA2_PASSWORD ?? "";

const QA1 = "qa.unipilot@unipilot.test";
const QA2 = "qa2.unipilot@unipilot.test";

const BUCKET = "documents";
const PREFIX = "UI 24x";

/** Mirrors `DOCUMENT_MAX_PAGES` in backend/worker/documentProcessing.mjs. */
const MAX_PAGES = 200;

const REPO_ROOT = path.resolve(process.cwd(), "..");

let qa1Id = "";
let qa2Id = "";
let service: SupabaseClient;
let qa1: SupabaseClient;
let qa2: SupabaseClient;

const createdDocumentIds: string[] = [];
const createdJobIds: string[] = [];

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

function runWorkerOnce(): string {
  return execFileSync(
    "node",
    ["worker/run.mjs", "--once", "--worker-id=spec-processing"],
    {
      cwd: path.join(REPO_ROOT, "backend"),
      env: process.env,
      encoding: "utf8",
      timeout: 60_000,
    },
  );
}

function runBenchmark(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      "node",
      ["worker/benchmark.mjs", ...args],
      {
        cwd: path.join(REPO_ROOT, "backend"),
        env: process.env,
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

async function buildPdf(pages: string[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = pdf.addPage([612, 792]);
    page.drawText(text, { x: 72, y: 700, size: 16, font });
  }
  return Buffer.from(await pdf.save());
}

function buildDocx(text: string): Buffer {
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      ),
      "_rels/.rels": strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      ),
      "word/document.xml": strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
      ),
    }),
  );
}

/**
 * The finalize hand-off without the UI: object + row + job, the state the
 * 23.x finalize action leaves behind (status indexing, queued processing).
 */
async function seedDocument(options: {
  userId: string;
  name: string;
  mimeType: string;
  buffer: Buffer;
  storagePath?: string;
  maxAttempts?: number;
}): Promise<{ documentId: string; jobId: string }> {
  const documentId = randomUUID();
  createdDocumentIds.push(documentId);

  const storagePath =
    options.storagePath ?? `${options.userId}/${documentId}/seed`;

  if (options.storagePath === undefined) {
    const uploaded = await service.storage
      .from(BUCKET)
      .upload(storagePath, options.buffer, { contentType: options.mimeType });
    expect(uploaded.error, `seed upload: ${uploaded.error?.message}`).toBeNull();
  }

  const inserted = await service.from("documents").insert({
    id: documentId,
    user_id: options.userId,
    name: `${PREFIX} ${options.name}`,
    storage_path: storagePath,
    mime_type: options.mimeType,
    size_bytes: options.buffer.length,
    status: "indexing",
  });
  expect(inserted.error, `seed document: ${inserted.error?.message}`).toBeNull();

  const job = await service
    .from("jobs")
    .insert({
      kind: "document.process",
      payload: { documentId },
      user_id: options.userId,
      max_attempts: options.maxAttempts ?? 5,
    })
    .select("id")
    .single();
  expect(job.error, `seed job: ${job.error?.message}`).toBeNull();
  createdJobIds.push(job.data!.id);

  return { documentId, jobId: job.data!.id };
}

async function documentRow(documentId: string) {
  const { data, error } = await service
    .from("documents")
    .select("status, page_count, error_message")
    .eq("id", documentId)
    .maybeSingle();
  expect(error, `document read: ${error?.message}`).toBeNull();
  return data;
}

async function jobRow(jobId: string) {
  const { data, error } = await service
    .from("jobs")
    .select("status, attempts, run_after")
    .eq("id", jobId)
    .maybeSingle();
  expect(error, `job read: ${error?.message}`).toBeNull();
  return data;
}

async function chunkRows(documentId: string) {
  const { data, error } = await service
    .from("document_chunks")
    .select("chunk_index, content")
    .eq("document_id", documentId)
    .order("chunk_index", { ascending: true });
  expect(error, `chunk read: ${error?.message}`).toBeNull();
  return data ?? [];
}

async function sweepStorage(userId: string): Promise<void> {
  const { data: folders } = await service.storage
    .from(BUCKET)
    .list(userId, { limit: 1000 });
  for (const folder of folders ?? []) {
    const { data: files } = await service.storage
      .from(BUCKET)
      .list(`${userId}/${folder.name}`, { limit: 1000 });
    const paths = (files ?? [])
      .filter((file) => file.name !== ".emptyFolderPlaceholder")
      .map((file) => `${userId}/${folder.name}/${file.name}`);
    if (paths.length > 0) {
      await service.storage.from(BUCKET).remove(paths);
    }
  }
}

test.beforeAll(async () => {
  if (!LOCAL_TARGET.test(url)) {
    throw new Error(
      `documents-processing is local-only; refusing target "${url || "(unset)"}"`,
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
  qa1 = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  qa2 = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  qa1Id = await signIn(qa1, QA1, qa1Password);
  qa2Id = await signIn(qa2, QA2, qa2Password);
});

test.afterEach(async () => {
  if (createdDocumentIds.length > 0) {
    await service.from("documents").delete().in("id", createdDocumentIds);
    createdDocumentIds.length = 0;
  }
  if (createdJobIds.length > 0) {
    await service.from("jobs").delete().in("id", createdJobIds);
    createdJobIds.length = 0;
  }
  if (qa1Id) await sweepStorage(qa1Id);
  if (qa2Id) await sweepStorage(qa2Id);
});

test.describe("document processing (24.x)", () => {
  test("real PDF upload: UI finalize → indexing → worker → indexed chunks", async ({
    page,
  }) => {
    test.slow();
    const name = `${PREFIX} lecture.pdf`;

    await page.goto("/documents");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    const pdf = await buildPdf([
      "Alpha page content for extraction",
      "Beta page content for extraction",
    ]);
    await page.setInputFiles('input[type="file"]', {
      name,
      mimeType: "application/pdf",
      buffer: pdf,
    });

    const row = page.locator("[data-document-id]").first();
    await expect(row).toBeVisible({ timeout: 30_000 });

    // Track the row before asserting on it, so a failed assertion still tears
    // the document (and its object) down in afterEach.
    const documentId = await row.getAttribute("data-document-id");
    expect(documentId).toMatch(/^[0-9a-f-]{36}$/i);
    createdDocumentIds.push(documentId!);

    // The finalize hand-off enqueued the job and flipped the status.
    await expect(row).toContainText("Indexing");

    const { data: job } = await service
      .from("jobs")
      .select("id, kind, status, payload")
      .eq("user_id", qa1Id)
      .eq("kind", "document.process")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(job, "finalize must enqueue document.process").not.toBeNull();
    expect(job!.payload).toMatchObject({ documentId });
    createdJobIds.push(job!.id);

    const output = runWorkerOnce();
    expect(output).toContain(`indexed document=${documentId}`);
    expect(output).toContain("pages=2");

    const settled = await documentRow(documentId!);
    expect(settled).toMatchObject({
      status: "indexed",
      page_count: 2,
      error_message: null,
    });

    const chunks = await chunkRows(documentId!);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toContain("Alpha page content");
    expect(chunks[1].content).toContain("Beta page content");

    // The surface reflects the settled state on the next server render.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("[data-document-id]").first()).toContainText(
      "Indexed",
    );
    await expect(page.locator("[data-document-id]").first()).toContainText(
      "2 pages",
    );
  });

  test("DOCX becomes one ordered text unit and no page count", async () => {
    const { documentId } = await seedDocument({
      userId: qa1Id,
      name: "handout.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: buildDocx("UniPilot DOCX extraction proof"),
    });

    runWorkerOnce();

    expect(await documentRow(documentId)).toMatchObject({
      status: "indexed",
      page_count: null,
      error_message: null,
    });
    const chunks = await chunkRows(documentId);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("UniPilot DOCX extraction proof");
  });

  test("a missing object retries with backoff, then dead-letters", async () => {
    const { documentId, jobId } = await seedDocument({
      userId: qa1Id,
      name: "missing.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 fake"),
      storagePath: `${qa1Id}/${randomUUID()}/never-uploaded.pdf`,
      maxAttempts: 2,
    });

    runWorkerOnce();

    const retrying = await documentRow(documentId);
    expect(retrying!.status).toBe("failed");
    expect(retrying!.error_message).toContain("We'll try again shortly");
    const job = await jobRow(jobId);
    expect(job!.status).toBe("queued");
    expect(job!.attempts).toBe(1);
    expect(Date.parse(job!.run_after)).toBeGreaterThan(Date.now());

    await service
      .from("jobs")
      .update({ run_after: new Date().toISOString() })
      .eq("id", jobId);
    runWorkerOnce();

    const terminal = await documentRow(documentId);
    expect(terminal!.status).toBe("failed");
    expect(terminal!.error_message).toContain("Try uploading it again");
    expect((await jobRow(jobId))!.status).toBe("dead_letter");
  });

  test("a corrupt PDF fails permanently with sanitized copy", async () => {
    const { documentId, jobId } = await seedDocument({
      userId: qa1Id,
      name: "corrupt.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("this is not really a pdf"),
    });

    runWorkerOnce();

    const row = await documentRow(documentId);
    expect(row!.status).toBe("failed");
    expect(row!.error_message).toContain("couldn't be read");
    expect((await jobRow(jobId))!.status).toBe("failed");
    expect(await chunkRows(documentId)).toHaveLength(0);
  });

  test("images fail with the honest OCR-unavailable copy (24.5/24.6)", async () => {
    const { documentId, jobId } = await seedDocument({
      userId: qa1Id,
      name: "scan.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });

    runWorkerOnce();

    const row = await documentRow(documentId);
    expect(row!.status).toBe("failed");
    expect(row!.error_message).toContain("isn't available yet");
    expect((await jobRow(jobId))!.status).toBe("failed");
    expect(await chunkRows(documentId)).toHaveLength(0);
  });

  test("the page limit rejects an over-limit PDF before any chunks", async () => {
    test.slow();
    const pages = Array.from(
      { length: MAX_PAGES + 1 },
      (_, index) => `Page number ${index + 1}`,
    );
    const { documentId, jobId } = await seedDocument({
      userId: qa1Id,
      name: "too-many-pages.pdf",
      mimeType: "application/pdf",
      buffer: await buildPdf(pages),
    });

    runWorkerOnce();

    const row = await documentRow(documentId);
    expect(row!.status).toBe("failed");
    expect(row!.error_message).toContain(`more than ${MAX_PAGES} pages`);
    expect((await jobRow(jobId))!.status).toBe("failed");
    expect(await chunkRows(documentId)).toHaveLength(0);
  });

  test("chunks are isolated by the owning document (RLS through the parent)", async () => {
    const { documentId } = await seedDocument({
      userId: qa1Id,
      name: "isolated.pdf",
      mimeType: "application/pdf",
      buffer: await buildPdf(["Isolation proof page"]),
    });
    runWorkerOnce();

    // Settle first, so a chunk failure reports as a processing failure.
    expect((await documentRow(documentId))!.status).toBe("indexed");

    const own = await qa1
      .from("document_chunks")
      .select("id")
      .eq("document_id", documentId);
    expect(own.error).toBeNull();
    expect(own.data ?? []).toHaveLength(1);

    const foreign = await qa2
      .from("document_chunks")
      .select("id")
      .eq("document_id", documentId);
    expect(foreign.error).toBeNull();
    expect(foreign.data ?? []).toHaveLength(0);
  });

  test("step-0 ACL audit: server-only writes stay closed to sessions", async () => {
    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Note: the trigger functions (`handle_new_user`, `set_updated_at`,
    // `ensure_event_subject_owner`) are not exposed by PostgREST at all
    // (trigger-returning functions are excluded), so their revoked EXECUTE is
    // evidenced by the psql ACL audit recorded in DATABASE.md rather than an
    // RPC probe.

    // complete_onboarding: anon revoked, authenticated intentionally kept.
    const anonOnboarding = await anon.rpc("complete_onboarding", {
      p_first_name: "x",
      p_last_name: "x",
      p_institution: "x",
      p_course_program: "x",
      p_academic_year: 1,
      p_semester: 1,
      p_planning_style: "steady",
      p_reminder_lead: "1_day",
      p_subjects: [],
    });
    expect(anonOnboarding.error?.message ?? "").toMatch(/permission denied/i);

    // Server-only writes: revoked outright, so the session cannot even try.
    const ledger = await qa1
      .from("usage_events")
      .insert({ user_id: qa1Id, kind: "spec", quantity: 1 });
    expect(ledger.error?.message ?? "").toMatch(/permission denied/i);

    const subscription = await qa1
      .from("subscriptions")
      .insert({ user_id: qa1Id, plan: "free", status: "active" });
    expect(subscription.error?.message ?? "").toMatch(/permission denied/i);

    const notification = await qa1
      .from("notifications")
      .insert({ user_id: qa1Id, kind: "system", title: "spec" });
    expect(notification.error?.message ?? "").toMatch(/permission denied/i);

    const profileDelete = await qa1.from("profiles").delete().eq("id", qa1Id);
    expect(profileDelete.error?.message ?? "").toMatch(/permission denied/i);

    const toolRunDelete = await qa1
      .from("tool_runs")
      .delete()
      .eq("user_id", qa1Id);
    expect(toolRunDelete.error?.message ?? "").toMatch(/permission denied/i);
  });

  test("the benchmark harness measures real fixtures and reports honestly", async () => {
    // No fixtures → honest failure, never a fabricated score.
    const emptyDir = mkdtempSync(path.join(tmpdir(), "unipilot-bench-empty-"));
    try {
      const empty = runBenchmark([`--dir=${emptyDir}`]);
      expect(empty.status).not.toBe(0);
      expect(empty.stderr).toContain("No fixtures found");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }

    // One real pair → the measured score, computed from the actual extract.
    const dir = mkdtempSync(path.join(tmpdir(), "unipilot-bench-"));
    try {
      writeFileSync(
        path.join(dir, "proof.pdf"),
        await buildPdf(["Benchmark proof sentence"]),
      );
      writeFileSync(
        path.join(dir, "proof.expected.txt"),
        "Benchmark proof sentence",
      );
      const result = runBenchmark([`--dir=${dir}`, "--min=0.9"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("proof.pdf: 1.0000 ok");
      expect(result.stdout).toContain("pairs=1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
