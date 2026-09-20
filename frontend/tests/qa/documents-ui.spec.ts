/**
 * tests/qa/documents-ui.spec.ts — Task 23.x's real upload pipeline in the
 * browser.
 *
 * Runs authenticated as QA1 (the qa-documents-ui project's storage state)
 * with `qa-auth-setup`, `qa-onboarding` and `qa-documents-data` as
 * dependencies, so the QA identities are settled and no other
 * document-mutating spec runs concurrently.
 *
 * The flows are the real UI: a browser-selected file travels reserve → direct
 * Storage upload with real progress → server-side finalize; a fake PDF is
 * rejected by magic-byte sniffing with its row and object cleaned up; rename
 * keeps the storage path and delete removes object + row (+ chunks). A guest
 * click opens the shared sign-in prompt. Task F2 adds the provenance flow: a
 * seeded `source='presentation'` document + its `presentations` row must badge
 * and offer "Open deck" (reaching the viewer), while an upload control row
 * gets neither. Cleanup is prefix-scoped plus a full storage sweep of both QA
 * prefixes (presentation rows are tracked by id), so the spec is repeatable
 * and leaves no residue.
 *
 * Local-only by construction; hosted is never contacted.
 */
import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { sanitizeStorageName } from "../../lib/data/documentValues";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";
const qa2Password = process.env.UNIPILOT_QA2_PASSWORD ?? "";

const QA1 = "qa.unipilot@unipilot.test";
const QA2 = "qa2.unipilot@unipilot.test";

const BUCKET = "documents";

/** Every row this spec creates carries this prefix, so teardown is exact. */
const PREFIX = "UI 23x";

/**
 * Task F2 provenance fixtures: the generated-deck document is swept by the
 * same `${PREFIX}%` row/storage cleanup as uploads, but its presentation row
 * has no name prefix to match, so it is tracked by id.
 */
const seededPresentationIds: string[] = [];

let qa1Id = "";
let qa2Id = "";
let service: SupabaseClient;

/** A valid minimal PDF; `padding` makes a file big enough to show progress. */
function pdfPayload(name: string, padding = 64) {
  return {
    name,
    mimeType: "application/pdf",
    buffer: Buffer.concat([
      Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"),
      Buffer.alloc(padding, 0x20),
    ]),
  };
}

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

/**
 * Row + object + storage sweep for our prefix, on both QA users, plus the
 * processing jobs the 24.2 hand-off enqueued for those uploads (they carry a
 * document id, not our title prefix, so they are swept by owner).
 */
async function cleanup() {
  if (seededPresentationIds.length > 0) {
    // The deck rows first (their `document_id` FK would otherwise SET NULL
    // and leave them behind after the document sweep below).
    await service
      .from("presentations")
      .delete()
      .in("id", seededPresentationIds);
    seededPresentationIds.length = 0;
  }
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
    await service.from("jobs").delete().eq("user_id", userId);
    await sweepStorage(userId);
  }
}

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

test.beforeAll(async () => {
  if (!LOCAL_TARGET.test(url)) {
    throw new Error(
      `documents-ui is local-only; refusing target "${url || "(unset)"}"`,
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
  await cleanup();
});

test.describe("documents UI (23.x)", () => {
  test("upload: real progress → verified record → object, at 375 and 1280", async ({
    page,
  }) => {
    test.slow();
    const errors = trackConsoleErrors(page);
    const name = `${PREFIX} lecture-notes.pdf`;

    await page.goto("/documents");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    await page.setInputFiles(
      'input[type="file"]',
      pdfPayload(name, 8 * 1024 * 1024),
    );

    // 23.7: the XHR pipeline reports real progress while the bytes move.
    await page
      .locator('[role="progressbar"]')
      .waitFor({ state: "attached", timeout: 15_000 });

    const row = page
      .locator("[data-document-id]")
      .filter({ hasText: name })
      .first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(name);
    // 24.2: finalize enqueues processing and the document is honestly
    // "Parsing…" until the worker settles it (18.8's copy).
    await expect(row).toContainText("Parsing…");

    // The record and the object are both real, and the DB size matches the
    // object Storage actually holds.
    const id = await row.getAttribute("data-document-id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    const { data: stored, error } = await service
      .from("documents")
      .select("id, name, storage_path, size_bytes, status")
      .eq("id", id)
      .maybeSingle();
    expect(error, `row read: ${error?.message}`).toBeNull();
    expect(stored).not.toBeNull();
    expect(stored!.name).toBe(name);
    expect(stored!.status).toBe("indexing");
    expect(stored!.storage_path).toBe(
      `${qa1Id}/${id}/${sanitizeStorageName(name)}`,
    );

    const info = await service.storage
      .from(BUCKET)
      .info(stored!.storage_path!);
    expect(info.error, `object info: ${info.error?.message}`).toBeNull();
    expect(info.data!.size).toBe(stored!.size_bytes);

    // 23.13's responsive half at the narrow width, mid-lifecycle.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(overflow).toBe(true);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("finalize rejects a fake PDF: sanitized copy, row and object cleaned up", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    const name = `${PREFIX} fake.pdf`;

    await page.goto("/documents");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    await page.setInputFiles('input[type="file"]', {
      name,
      mimeType: "application/pdf",
      buffer: Buffer.from("this is definitely not a pdf file"),
    });

    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "That file isn't supported" }),
    ).toBeVisible({ timeout: 30_000 });

    // Nothing survives: no row, no object, no card for this name.
    const { data: rows } = await service
      .from("documents")
      .select("id")
      .eq("user_id", qa1Id)
      .like("name", `${PREFIX}%`);
    expect(rows ?? []).toHaveLength(0);
    await expect(
      page.locator("[data-document-id]").filter({ hasText: name }),
    ).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("rename keeps the storage path; delete removes object, row and chunks", async ({
    page,
  }) => {
    test.slow();
    const errors = trackConsoleErrors(page);
    const name = `${PREFIX} syllabus.pdf`;
    const renamed = `${PREFIX} syllabus v2.pdf`;

    await page.goto("/documents");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    await page.setInputFiles('input[type="file"]', pdfPayload(name, 2048));
    const uploadedCard = page
      .locator("[data-document-id]")
      .filter({ hasText: name });
    await expect(uploadedCard).toBeVisible({ timeout: 30_000 });
    const id = await uploadedCard.getAttribute("data-document-id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);

    const before = await service
      .from("documents")
      .select("storage_path")
      .eq("id", id)
      .maybeSingle();
    const storagePath = before.data!.storage_path!;

    // A chunk exists for the delete to cascade.
    const { error: chunkError } = await service
      .from("document_chunks")
      .insert({ document_id: id, chunk_index: 0, content: "page one" });
    expect(chunkError, `chunk seed: ${chunkError?.message}`).toBeNull();

    // Rename: display name only.
    await page
      .getByRole("button", { name: `Rename ${name}`, exact: true })
      .click();
    await page.getByLabel(/Document name/).fill(renamed);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.locator("[data-document-id]").first(),
    ).toContainText(renamed);

    // Rename is optimistic in the hub: the card changes first, the row
    // settles a moment later, so poll for the persisted name.
    await expect
      .poll(
        async () => {
          const { data } = await service
            .from("documents")
            .select("name")
            .eq("id", id)
            .maybeSingle();
          return data?.name ?? null;
        },
        { timeout: 10_000 },
      )
      .toBe(renamed);

    const afterRename = await service
      .from("documents")
      .select("name, storage_path")
      .eq("id", id)
      .maybeSingle();
    expect(afterRename.data!.storage_path).toBe(storagePath);

    // Delete: confirmation first, then object + row (+ cascaded chunks).
    await page
      .getByRole("button", { name: `Delete ${renamed}`, exact: true })
      .click();
    const confirm = page.getByRole("dialog", { name: "Delete this document?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Delete document" }).click();
    await expect(confirm).not.toBeVisible();

    await expect(page.getByText("Document deleted.")).toBeVisible();
    await expect(page.locator("[data-document-id]")).toHaveCount(0);

    const gone = await service
      .from("documents")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    expect(gone.data).toBeNull();

    const chunks = await service
      .from("document_chunks")
      .select("id")
      .eq("document_id", id);
    expect(chunks.data ?? []).toHaveLength(0);

    const object = await service.storage.from(BUCKET).info(storagePath);
    expect(object.error, "object must be gone").not.toBeNull();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  /* Task F2 (spec §9) — /documents provenance. The generated-deck row pair is
     seeded exactly as the worker writes it (`documents.source =
     'presentation'` plus the `presentations` row pointing at it through
     `document_id`); the control row is an ordinary upload. The badge and
     "Open deck" must appear only for the deck, and Open deck must reach the
     viewer. */
  test("provenance: a generated deck badges and opens its viewer; uploads do not", async ({
    page,
  }) => {
    test.slow();
    const errors = trackConsoleErrors(page);
    const deckName = `${PREFIX} seminar-recap.pptx`;
    const uploadName = `${PREFIX} provenance-control.pdf`;
    const deckDocumentId = randomUUID();
    const uploadDocumentId = randomUUID();
    const presentationId = randomUUID();
    seededPresentationIds.push(presentationId);

    const { error: rowsError } = await service.from("documents").insert([
      {
        id: deckDocumentId,
        user_id: qa1Id,
        name: deckName,
        mime_type:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        size_bytes: 4096,
        storage_path: null,
        status: "uploaded",
        source: "presentation",
      },
      {
        id: uploadDocumentId,
        user_id: qa1Id,
        name: uploadName,
        mime_type: "application/pdf",
        size_bytes: 1024,
        storage_path: null,
        status: "uploaded",
        source: "upload",
      },
    ]);
    expect(rowsError, `fixture rows: ${rowsError?.message}`).toBeNull();

    const { error: deckError } = await service.from("presentations").insert({
      id: presentationId,
      user_id: qa1Id,
      prompt: `${PREFIX} provenance fixture`,
      template: "general",
      format: "pptx",
      status: "succeeded",
      document_id: deckDocumentId,
    });
    expect(deckError, `fixture deck: ${deckError?.message}`).toBeNull();

    await page.goto("/documents");
    await page.waitForLoadState("networkidle");

    const deckCard = page.locator(`[data-document-id="${deckDocumentId}"]`);
    const uploadCard = page.locator(`[data-document-id="${uploadDocumentId}"]`);
    await expect(deckCard).toBeVisible({ timeout: 30_000 });
    await expect(uploadCard).toBeVisible({ timeout: 30_000 });

    // Provenance badge: the presentation row only.
    const badge = deckCard.locator('[data-document-source="presentation"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText("Presentation");
    await expect(
      uploadCard.locator('[data-document-source="presentation"]'),
    ).toHaveCount(0);

    // Open deck: only where the server map has an entry, pointing at the
    // owner's presentation.
    const openDeck = deckCard.locator('[data-document-action="open-deck"] a');
    await expect(openDeck).toHaveAttribute(
      "href",
      `/tools/presentation/${presentationId}`,
    );
    await expect(
      uploadCard.locator('[data-document-action="open-deck"]'),
    ).toHaveCount(0);

    // It reaches the viewer, which owns the honest not-ready panel (the
    // fixture stores no engine id).
    await openDeck.click();
    await page.waitForURL(`**/tools/presentation/${presentationId}`, {
      timeout: 30_000,
    });
    await expect(
      page.locator("[data-viewer-not-ready]:visible").first(),
    ).toBeVisible({ timeout: 30_000 });

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("guest: the upload control opens the shared sign-in prompt", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    const errors = trackConsoleErrors(page);

    await page.goto("/documents");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText("Sign in to upload and keep your documents in one place."),
    ).toBeVisible();

    await page.getByRole("button", { name: "Upload document" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText(
      "Sign in to upload documents.",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
    await context.close();
  });
});
