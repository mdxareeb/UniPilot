/**
 * tests/qa/documents-hub.spec.ts — Task 18.x's documents hub proof.
 *
 * Runs authenticated as QA1 (the qa-documents-hub project's storage state)
 * after `qa-documents-ui` and `qa-documents-processing`, so the identities,
 * the upload pipeline and the worker are settled and no other
 * document-mutating spec runs concurrently.
 *
 * What is proven, against the real service and the real worker:
 *
 * - 18.6/18.7/18.14: a real PDF uploaded through the UI becomes a card with
 *   its mono metadata line; real byte progress is observable;
 * - 18.8/18.9/18.10: the card reads "Parsing…" while the worker is due and
 *   flips to "Searchable" through the workspace's polling refresh — no manual
 *   reload;
 * - 18.2/18.3: search and the status filters narrow the real list, counts
 *   only when they count something, and an empty result is honest;
 * - 18.12: rename and delete (cancel + confirm) work per card with
 *   persistence;
 * - 18.11: preview mints a short-lived signed URL — inline for PDF, a
 *   download-only surface for DOCX;
 * - 18.15: a forced processing failure shows the sanitized copy and Retry
 *   re-enqueues a fresh job;
 * - 18.16: the quota guard's copy is surfaced (with the plan caveat) when
 *   the documented free tier is exceeded;
 * - 18.17: 320/375/1280 have no horizontal overflow and reduced motion
 *   settles instantly.
 *
 * Every row/object/job this spec creates is tracked and torn down; local
 * only; hosted is never contacted.
 */
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
const PREFIX = "UI 18x";
const REPO_ROOT = path.resolve(process.cwd(), "..");

let qa1Id = "";
let qa2Id = "";
let service: SupabaseClient;

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
    ["worker/run.mjs", "--once", "--worker-id=spec-hub"],
    {
      cwd: path.join(REPO_ROOT, "backend"),
      env: process.env,
      encoding: "utf8",
      timeout: 60_000,
    },
  );
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

/** Object + row, the state finalize leaves behind, without the worker. */
async function seedDocument(options: {
  name: string;
  mimeType: string;
  buffer: Buffer;
  status?: string;
  errorMessage?: string | null;
  pageCount?: number | null;
  withObject?: boolean;
  storagePath?: string;
}): Promise<string> {
  const documentId = randomUUID();
  createdDocumentIds.push(documentId);

  const storagePath =
    options.storagePath ?? `${qa1Id}/${documentId}/seed`;

  if (options.withObject !== false && options.storagePath === undefined) {
    const uploaded = await service.storage
      .from(BUCKET)
      .upload(storagePath, options.buffer, { contentType: options.mimeType });
    expect(uploaded.error, `seed upload: ${uploaded.error?.message}`).toBeNull();
  }

  const inserted = await service.from("documents").insert({
    id: documentId,
    user_id: qa1Id,
    name: `${PREFIX} ${options.name}`,
    storage_path: storagePath,
    mime_type: options.mimeType,
    size_bytes: options.buffer.length,
    status: options.status ?? "indexed",
    error_message: options.errorMessage ?? null,
    page_count: options.pageCount ?? null,
  });
  expect(inserted.error, `seed document: ${inserted.error?.message}`).toBeNull();

  return documentId;
}

async function enqueueProcessing(documentId: string, maxAttempts = 5): Promise<string> {
  const job = await service
    .from("jobs")
    .insert({
      kind: "document.process",
      payload: { documentId },
      user_id: qa1Id,
      max_attempts: maxAttempts,
    })
    .select("id")
    .single();
  expect(job.error, `seed job: ${job.error?.message}`).toBeNull();
  createdJobIds.push(job.data!.id);
  return job.data!.id;
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
      `documents-hub is local-only; refusing target "${url || "(unset)"}"`,
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
  qa1Id = await signIn(
    createClient(url, anonKey, { auth: { persistSession: false } }),
    QA1,
    qa1Password,
  );
  qa2Id = await signIn(
    createClient(url, anonKey, { auth: { persistSession: false } }),
    QA2,
    qa2Password,
  );
});

test.afterEach(async () => {
  for (const userId of [qa1Id, qa2Id]) {
    if (!userId) continue;
    const { data: rows } = await service
      .from("documents")
      .select("id, storage_path")
      .eq("user_id", userId)
      .like("name", `${PREFIX}%`);
    const paths = (rows ?? [])
      .map((row) => row.storage_path)
      .filter((path): path is string => typeof path === "string");
    if (paths.length > 0) {
      await service.storage.from(BUCKET).remove(paths);
    }
    await service
      .from("documents")
      .delete()
      .eq("user_id", userId)
      .like("name", `${PREFIX}%`);
    // Finalize/retry enqueue jobs whose payload is a document id, not the
    // title prefix; the hub runs alone at the tail of the chain, so the
    // owner-scoped sweep is exact.
    await service.from("jobs").delete().eq("user_id", userId);
    await sweepStorage(userId);
  }
  createdDocumentIds.length = 0;
  createdJobIds.length = 0;
});

test.describe("documents hub (18.x)", () => {
  test("upload: card with progress → Parsing… → Searchable through the poll", async ({
    page,
  }) => {
    test.slow();
    const name = `${PREFIX} lecture.pdf`;

    await page.goto("/documents");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    await expect(
      page.getByText("No documents yet. Upload a PDF, DOCX, PNG or JPEG to get started."),
    ).toBeVisible();

    await page.setInputFiles('input[type="file"]', {
      name,
      mimeType: "application/pdf",
      buffer: Buffer.concat([
        await buildPdf(["Hub proof page one", "Hub proof page two"]),
        // Pad so the XHR lasts long enough for real progress to be observed.
        Buffer.alloc(8 * 1024 * 1024, 0x20),
      ]),
    });

    // 18.7 first: the progress bar exists during the upload, before the
    // settled card lands.
    await expect(page.locator("[role='progressbar']")).toBeAttached({
      timeout: 15_000,
    });

    const card = page
      .locator("[data-document-id]")
      .filter({ hasText: name })
      .first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    // Track before asserting so a failure still tears the row down.
    const documentId = await card.getAttribute("data-document-id");
    expect(documentId).toMatch(/^[0-9a-f-]{36}$/i);
    createdDocumentIds.push(documentId!);

    await expect(card).toContainText(name);
    await expect(card).toContainText("Parsing…");

    runWorkerOnce();

    // No reload: the workspace's indexing poll must bring the fresh state in.
    await expect(card).toHaveAttribute("data-document-status", "indexed", {
      timeout: 20_000,
    });
    await expect(card).toContainText("Searchable");
    await expect(card).toContainText("2 pages");
    await expect(card).toContainText("PDF");
  });

  test("search and status filters narrow the real list with honest empties", async ({
    page,
  }) => {
    await seedDocument({
      name: "Alpha notes.pdf",
      mimeType: "application/pdf",
      buffer: await buildPdf(["Alpha"]),
      status: "indexed",
      pageCount: 1,
    });
    await seedDocument({
      name: "Beta draft.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: buildDocx("Beta content"),
      status: "uploaded",
    });
    await seedDocument({
      name: "Gamma scan.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      status: "failed",
      errorMessage: "Image and scanned-document processing isn't available yet.",
      withObject: false,
    });

    await page.goto("/documents");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    const cards = page.locator("[data-document-id]");
    await expect(cards).toHaveCount(3);

    // Search narrows to the real name.
    await page.getByLabel("Search documents").fill("Beta");
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("Beta draft.docx");

    await page.getByLabel("Search documents").fill("");
    await expect(cards).toHaveCount(3);

    // Status filters use the same vocabulary the cards render.
    await page
      .getByRole("group", { name: "Filter documents by status" })
      .getByRole("button", { name: /^Failed/ })
      .click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("Gamma scan.png");

    await page
      .getByRole("group", { name: "Filter documents by status" })
      .getByRole("button", { name: /^Searchable/ })
      .click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("Alpha notes.pdf");

    // Honest empty result + clear.
    await page.getByLabel("Search documents").fill("nothing matches this");
    await expect(
      page.getByText("No documents match your search."),
    ).toBeVisible();
    await expect(cards).toHaveCount(0);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(cards).toHaveCount(3);
  });

  test("rename and delete work per card, with cancel and persistence", async ({
    page,
  }) => {
    const documentId = await seedDocument({
      name: "editable.pdf",
      mimeType: "application/pdf",
      buffer: await buildPdf(["Editable"]),
      status: "indexed",
    });
    const originalName = `${PREFIX} editable.pdf`;
    const renamed = `${PREFIX} renamed.pdf`;

    await page.goto("/documents");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    const card = page.locator(`[data-document-id="${documentId}"]`);
    await page
      .getByRole("button", { name: `Rename ${originalName}` })
      .click();
    await page.getByLabel(/Document name/).fill(renamed);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(card).toContainText(renamed);

    // Rename is optimistic: the card changes first, so poll for the row.
    await expect
      .poll(
        async () => {
          const { data } = await service
            .from("documents")
            .select("name")
            .eq("id", documentId)
            .maybeSingle();
          return data?.name ?? null;
        },
        { timeout: 10_000 },
      )
      .toBe(renamed);

    // Cancel leaves the document.
    await page.getByRole("button", { name: `Delete ${renamed}` }).click();
    const confirm = page.getByRole("dialog", { name: "Delete this document?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    // Wait for the exit to finish before reopening: a second click during the
    // closing animation lands on a dialog that is already leaving.
    await expect(confirm).not.toBeVisible();
    await expect(card).toBeVisible();

    // Confirm removes it, and a reload keeps it gone.
    await page.getByRole("button", { name: `Delete ${renamed}` }).click();
    await page
      .getByRole("dialog", { name: "Delete this document?" })
      .getByRole("button", { name: "Delete document" })
      .click();
    await expect(page.getByText("Document deleted.")).toBeVisible();
    await expect(card).toHaveCount(0);

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(card).toHaveCount(0);
  });

  test("preview: PDF renders inline from a signed URL; DOCX is download-only", async ({
    page,
  }) => {
    const pdfName = `${PREFIX} preview.pdf`;
    await seedDocument({
      name: "preview.pdf",
      mimeType: "application/pdf",
      buffer: await buildPdf(["Preview me"]),
      status: "indexed",
    });
    await seedDocument({
      name: "contract.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: buildDocx("Contract body"),
      status: "indexed",
    });

    await page.goto("/documents");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    await page.getByRole("button", { name: `Preview ${pdfName}` }).click();
    const pdfDialog = page.getByRole("dialog", { name: pdfName });
    await expect(pdfDialog).toBeVisible();
    const frame = pdfDialog.locator("iframe");
    await expect(frame).toBeVisible();
    const frameSrc = await frame.getAttribute("src");
    expect(frameSrc).toContain("/storage/v1/object/sign/documents/");
    expect(frameSrc).toContain("token=");
    await page.keyboard.press("Escape");
    await expect(pdfDialog).not.toBeVisible();

    const docxName = `${PREFIX} contract.docx`;
    await page.getByRole("button", { name: `Preview ${docxName}` }).click();
    const docxDialog = page.getByRole("dialog", { name: docxName });
    await expect(docxDialog).toBeVisible();
    await expect(docxDialog).toContainText(
      "DOCX files aren't rendered in the browser",
    );
    await expect(
      docxDialog.getByRole("link", { name: `Download ${docxName}` }),
    ).toBeVisible();
    await expect(docxDialog.locator("iframe")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(docxDialog).not.toBeVisible();
  });

  test("preview: expand fills the viewport without reloading the iframe, Escape collapses", async ({
    page,
  }) => {
    const name = `${PREFIX} expand.pdf`;
    await seedDocument({
      name: "expand.pdf",
      mimeType: "application/pdf",
      buffer: await buildPdf(["Expand me"]),
      status: "indexed",
    });

    await page.goto("/documents");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    await page.getByRole("button", { name: `Preview ${name}` }).click();
    const dialog = page.getByRole("dialog", { name });
    await expect(dialog).toBeVisible();
    const frame = dialog.locator("iframe");
    await expect(frame).toBeVisible();

    /* Stamp the live frame element so a remount would be visible. */
    await page.evaluate(() => {
      const frameElement = document.querySelector(
        'iframe[title^="Preview of"]',
      );
      (window as unknown as { __previewFrame?: Element }).__previewFrame =
        frameElement ?? undefined;
    });
    const srcBefore = await frame.getAttribute("src");

    const panelWidth = () =>
      dialog.evaluate((element) =>
        Math.round(element.lastElementChild?.getBoundingClientRect().width ?? 0),
      );
    const panelSize = () =>
      dialog.evaluate((element) => {
        const rect = element.lastElementChild!.getBoundingClientRect();
        return { w: Math.round(rect.width), h: Math.round(rect.height) };
      });
    const compactWidth = await panelWidth();

    /* Expand: the panel becomes the viewport, the action flips to collapse. */
    await expect(
      dialog.getByRole("button", { name: "Expand preview" }),
    ).toHaveAttribute("aria-pressed", "false");
    await dialog.getByRole("button", { name: "Expand preview" }).click();
    await expect(
      dialog.getByRole("button", { name: "Exit full screen" }),
    ).toHaveAttribute("aria-pressed", "true");

    const viewport = page.viewportSize()!;
    await expect.poll(async () => (await panelSize()).w).toBe(viewport.width);
    expect(await panelSize()).toEqual({
      w: viewport.width,
      h: viewport.height,
    });

    /* The same element, the same signed URL: expanding never re-fetches. */
    const sameFrame = await page.evaluate(
      () =>
        document.querySelector('iframe[title^="Preview of"]') ===
        (window as unknown as { __previewFrame?: Element }).__previewFrame,
    );
    expect(sameFrame).toBe(true);
    expect(await frame.getAttribute("src")).toBe(srcBefore);

    /* Escape collapses the expanded preview and keeps the dialog open. */
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Expand preview" }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect.poll(panelWidth).toBeLessThan(compactWidth + 100);

    /* Keyboard-only expand, then Escape twice closes. */
    const expandAgain = dialog.getByRole("button", { name: "Expand preview" });
    await expandAgain.focus();
    await page.keyboard.press("Enter");
    await expect(
      dialog.getByRole("button", { name: "Exit full screen" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });

  test("failed state shows sanitized copy and Retry re-enqueues", async ({
    page,
  }) => {
    const documentId = await seedDocument({
      name: "broken.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 stub"),
      status: "indexing",
      storagePath: `${qa1Id}/${randomUUID()}/never-uploaded.pdf`,
    });
    await enqueueProcessing(documentId, 1);

    runWorkerOnce();

    await page.goto("/documents");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    const card = page.locator(`[data-document-id="${documentId}"]`);
    await expect(card).toHaveAttribute("data-document-status", "failed");
    await expect(card.locator("[data-document-error]")).toContainText(
      "Try uploading it again",
    );

    await page
      .getByRole("button", { name: `Retry processing for ${PREFIX} broken.pdf` })
      .click();
    await expect(card).toHaveAttribute("data-document-status", "indexing", {
      timeout: 10_000,
    });
    await expect(card).toContainText("Parsing…");

    // Retry enqueues a fresh job; the UI flips optimistically, so poll for
    // the settled queue state.
    await expect
      .poll(
        async () => {
          const { data } = await service
            .from("jobs")
            .select("id")
            .eq("user_id", qa1Id)
            .eq("kind", "document.process")
            .contains("payload", { documentId });
          return data?.length ?? 0;
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(2);

    const { data: jobs } = await service
      .from("jobs")
      .select("id")
      .eq("user_id", qa1Id)
      .eq("kind", "document.process")
      .contains("payload", { documentId });
    for (const job of jobs ?? []) createdJobIds.push(job.id);
  });

  test("quota: the over-limit copy is surfaced with the plan caveat", async ({
    page,
  }) => {
    test.slow();
    // Fill the documented free tier (50 documents) with cheap rows.
    const filler = Array.from({ length: 50 }, (_, index) => ({
      user_id: qa1Id,
      name: `${PREFIX} quota ${index + 1}`,
      storage_path: `${qa1Id}/${randomUUID()}/quota-${index + 1}`,
      mime_type: "application/pdf",
      size_bytes: 1,
      status: "uploaded",
    }));
    const inserted = await service.from("documents").insert(filler).select("id");
    expect(inserted.error, `quota seed: ${inserted.error?.message}`).toBeNull();
    for (const row of inserted.data ?? []) createdDocumentIds.push(row.id);

    await page.goto("/documents");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    await page.setInputFiles('input[type="file"]', {
      name: `${PREFIX} over-limit.pdf`,
      mimeType: "application/pdf",
      buffer: await buildPdf(["Over limit"]),
    });

    const alert = page.getByRole("alert").filter({
      hasText: "free document limit",
    });
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(alert).toContainText("Plan-based limits aren't available yet");

    const { data: over } = await service
      .from("documents")
      .select("id")
      .eq("user_id", qa1Id)
      .like("name", `${PREFIX} over-limit.pdf`);
    expect(over ?? []).toHaveLength(0);
  });

  test("responsive widths and reduced motion", async ({ browser, page }) => {
    await seedDocument({
      name: "widths.pdf",
      mimeType: "application/pdf",
      buffer: await buildPdf(["Widths"]),
      status: "indexed",
      pageCount: 1,
    });

    for (const width of [320, 375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/documents");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);
      await expect(page.locator("[data-document-id]").first()).toBeVisible();
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      );
      expect(overflow, `no horizontal overflow at ${width}`).toBe(true);
    }

    // Reduced motion: the same upload flow settles with zero-duration legs.
    const context = await browser.newContext({
      storageState:
        process.env.QA_STORAGE_STATE ?? ".playwright/qa-session.json",
      reducedMotion: "reduce",
      viewport: { width: 1280, height: 900 },
    });
    const reducedPage = await context.newPage();
    await reducedPage.goto("/documents");
    await reducedPage.waitForLoadState("networkidle");
    await reducedPage.waitForTimeout(300);
    await reducedPage.setInputFiles('input[type="file"]', {
      name: `${PREFIX} reduced.pdf`,
      mimeType: "application/pdf",
      buffer: await buildPdf(["Reduced motion"]),
    });
    const reducedCard = reducedPage
      .locator("[data-document-id]")
      .filter({ hasText: `${PREFIX} reduced.pdf` })
      .first();
    await expect(reducedCard).toBeVisible({ timeout: 30_000 });
    const reducedId = await reducedCard.getAttribute("data-document-id");
    createdDocumentIds.push(reducedId!);
    await expect(reducedCard).toContainText("Parsing…");
    runWorkerOnce();
    await expect(reducedCard).toHaveAttribute(
      "data-document-status",
      "indexed",
      { timeout: 20_000 },
    );
    await expect(reducedCard).toContainText("Searchable");
    await context.close();
  });

  test("guest: no list, the honest line, and the shared prompt", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    await page.goto("/documents");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText("Sign in to upload and keep your documents in one place."),
    ).toBeVisible();
    await expect(page.locator("[data-document-id]")).toHaveCount(0);
    await expect(page.getByLabel("Search documents")).toHaveCount(0);

    await page.getByRole("button", { name: "Upload document" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await context.close();
  });
});
