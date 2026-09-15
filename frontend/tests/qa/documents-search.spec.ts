/**
 * tests/qa/documents-search.spec.ts — Task 25.x's retrieval proof.
 *
 * The real pipeline and the real SQL function, no mocks:
 *
 * - a real PDF is processed (24.x page units) and re-indexed (25.1's
 *   chunking) twice — the second run produces the identical chunk set
 *   (idempotency) and the document's status is untouched;
 * - chunks carry their source page (25.9), and `search_document_chunks`
 *   returns keyword hits with document name + page + a `[[ ]]`-marked snippet
 *   (25.7), narrowing correctly by document and page filters;
 * - a no-match query is honestly empty; QA2's session sees none of QA1's
 *   chunks (RLS through the parent, security-invoker function);
 * - the GlobalSearch panel renders the real hit, cites the page, states the
 *   keyword-only boundary (25.6 blocked), shows the honest no-match state and
 *   opens the document's 18.11 preview on click;
 * - the 25.11 harness measures real fixtures and reports honestly with none.
 *
 * Own Playwright project (`qa-documents-search`, after the hub and before the
 * jobs runner). Rows/objects/jobs are swept by prefix after each test.
 * Local-only; hosted is never contacted.
 */
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";
const qa2Password = process.env.UNIPILOT_QA2_PASSWORD ?? "";

const QA1 = "qa.unipilot@unipilot.test";
const QA2 = "qa2.unipilot@unipilot.test";

const BUCKET = "documents";
const PREFIX = "UI 25x";
const REPO_ROOT = path.resolve(process.cwd(), "..");
const UNIQUE_TERM = "quantumfluxcapacitor";

/** The columns the assertions read from the RPC's returned rows. */
type SearchRow = {
  document_id: string;
  document_name: string;
  page: number | null;
  match_kind: string;
  snippet: string;
};

let qa1Id = "";
let qa2Id = "";
let service: SupabaseClient;
let qa1: SupabaseClient;
let qa2: SupabaseClient;

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

function worker(args: string[] = ["--once", "--worker-id=spec-search"]): string {
  return execFileSync("node", ["worker/run.mjs", ...args], {
    cwd: path.join(REPO_ROOT, "backend"),
    env: process.env,
    encoding: "utf8",
    timeout: 60_000,
  });
}

function searchBenchmark(args: string[]): {
  status: number;
  stdout: string;
  stderr: string;
} {
  try {
    const stdout = execFileSync(
      "node",
      ["worker/searchBenchmark.mjs", ...args],
      {
        cwd: path.join(REPO_ROOT, "backend"),
        env: process.env,
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
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
    // Wrap long text into short lines so pdfjs extracts every word.
    const words = text.split(" ");
    const lines = [];
    let line = "";
    for (const word of words) {
      if ((line + " " + word).trim().length > 80) {
        lines.push(line.trim());
        line = word;
      } else {
        line = `${line} ${word}`;
      }
    }
    if (line.trim() !== "") lines.push(line.trim());
    lines.forEach((content, index) => {
      page.drawText(content, { x: 60, y: 720 - index * 18, size: 11, font });
    });
  }
  return Buffer.from(await pdf.save());
}

/** Object + row + processing + reindex, all through the real worker. */
async function seedIndexedDocument(options: {
  name: string;
  pages: string[];
  userId?: string;
}): Promise<string> {
  const userId = options.userId ?? qa1Id;
  const documentId = randomUUID();
  const storagePath = `${userId}/${documentId}/seed.pdf`;
  const bytes = await buildPdf(options.pages);

  const uploaded = await service.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: "application/pdf" });
  expect(uploaded.error, `seed upload: ${uploaded.error?.message}`).toBeNull();

  const inserted = await service.from("documents").insert({
    id: documentId,
    user_id: userId,
    name: `${PREFIX} ${options.name}`,
    storage_path: storagePath,
    mime_type: "application/pdf",
    size_bytes: bytes.length,
    status: "indexing",
  });
  expect(inserted.error, `seed document: ${inserted.error?.message}`).toBeNull();

  const processJob = await service.from("jobs").insert({
    kind: "document.process",
    payload: { documentId },
    user_id: userId,
  });
  expect(processJob.error, `seed process job: ${processJob.error?.message}`).toBeNull();
  worker();

  const reindexJob = await service.from("jobs").insert({
    kind: "document.reindex",
    payload: { documentId },
    user_id: userId,
  });
  expect(reindexJob.error, `seed reindex job: ${reindexJob.error?.message}`).toBeNull();
  worker();

  return documentId;
}

async function chunkSet(documentId: string) {
  const { data, error } = await service
    .from("document_chunks")
    .select("chunk_index, page, content")
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
      `documents-search is local-only; refusing target "${url || "(unset)"}"`,
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
  for (const userId of [qa1Id, qa2Id]) {
    if (!userId) continue;
    const { data: rows } = await service
      .from("documents")
      .select("id, storage_path")
      .eq("user_id", userId)
      .like("name", `${PREFIX}%`);
    const paths = (rows ?? [])
      .map((row) => row.storage_path)
      .filter((value): value is string => typeof value === "string");
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
});

test.describe("document search (25.x)", () => {
  test("re-index is idempotent, chunks keep pages, status is untouched", async () => {
    test.slow();
    const longPage =
      "Entropy is a measure of disorder in a thermodynamic system. " +
      "It explains why heat flows from hot to cold and why engines cannot " +
      "be perfectly efficient. This paragraph is deliberately long enough " +
      "to force the chunker past one window so the second chunk also has " +
      "to carry the source page. Statistical mechanics defines entropy as " +
      "a count of microstates, while classical thermodynamics defines its " +
      "change through reversible heat over temperature. Both definitions " +
      "agree, and both are exercised by the retrieval tests that follow. " +
      "Additional filler sentences keep the window boundary inside real " +
      "text rather than at the very end of the page content string.";
    const documentId = await seedIndexedDocument({
      name: "chunking.pdf",
      pages: [longPage, `The unique marker is ${UNIQUE_TERM}.`],
    });

    const first = await chunkSet(documentId);
    expect(first.length).toBeGreaterThanOrEqual(2);
    expect(first[0].page).toBe(1);
    expect(first[first.length - 1].page).toBe(2);
    // Deterministic chunk indexes 0..n-1, no gaps.
    expect(first.map((chunk) => chunk.chunk_index)).toEqual(
      first.map((_, index) => index),
    );

    // Second re-index run: identical (chunk_index, page, content) set.
    const secondJob = await service
      .from("jobs")
      .insert({
        kind: "document.reindex",
        payload: { documentId },
        user_id: qa1Id,
      })
      .select("id")
      .single();
    expect(secondJob.error).toBeNull();
    const output = worker();
    expect(output).toContain("rechunked");
    expect(output).toContain("embeddings_skipped");
    expect(await chunkSet(documentId)).toEqual(first);

    const { data: document } = await service
      .from("documents")
      .select("status")
      .eq("id", documentId)
      .maybeSingle();
    expect(document!.status).toBe("indexed");
  });

  test("keyword search: refs, snippets, filters, honest empty, RLS", async () => {
    test.slow();
    const documentId = await seedIndexedDocument({
      name: "entropy-notes.pdf",
      pages: [
        "Entropy and enthalpy in closed thermodynamic systems.",
        `A unique marker word is ${UNIQUE_TERM} on this page.`,
      ],
    });

    // 25.7/25.9 — a real keyword hit with a snippet and the source page.
    const hits = await service.rpc("search_document_chunks", {
      p_query: "entropy",
      p_limit: 5,
    });
    expect(hits.error).toBeNull();
    const hit = ((hits.data ?? []) as SearchRow[]).find(
      (row) => row.document_id === documentId,
    );
    expect(hit, "the seeded document must be found").toBeTruthy();
    expect(hit!.document_name).toBe(`${PREFIX} entropy-notes.pdf`);
    expect(hit!.page).toBe(1);
    expect(hit!.match_kind).toBe("keyword");
    expect(hit!.snippet).toContain("[[Entropy]]");

    // Filters narrow by owner document and page.
    const byDocument = await service.rpc("search_document_chunks", {
      p_query: UNIQUE_TERM,
      p_document_id: documentId,
      p_page: 2,
    });
    expect((byDocument.data ?? []).length).toBeGreaterThanOrEqual(1);
    const wrongPage = await service.rpc("search_document_chunks", {
      p_query: UNIQUE_TERM,
      p_document_id: documentId,
      p_page: 1,
    });
    expect(wrongPage.data ?? []).toHaveLength(0);

    // Honest empty for a no-match query.
    const empty = await service.rpc("search_document_chunks", {
      p_query: "zzzznothingmatchesthiszzzz",
    });
    expect(empty.data ?? []).toHaveLength(0);

    // RLS: QA2's own session sees none of QA1's chunks.
    const foreign = await qa2.rpc("search_document_chunks", {
      p_query: "entropy",
      p_limit: 20,
    });
    expect(foreign.error).toBeNull();
    expect(
      ((foreign.data ?? []) as SearchRow[]).filter(
        (row) => row.document_id === documentId,
      ),
    ).toHaveLength(0);

    // And QA1's session does see it (the function is security invoker).
    const own = await qa1.rpc("search_document_chunks", {
      p_query: "entropy",
      p_limit: 20,
    });
    expect(own.error).toBeNull();
    expect(
      ((own.data ?? []) as SearchRow[]).filter(
        (row) => row.document_id === documentId,
      ),
    ).toHaveLength(1);
  });

  test("the search panel renders real hits, cites the page and opens the preview", async ({
    page,
  }) => {
    test.slow();
    const documentId = await seedIndexedDocument({
      name: "search-ui.pdf",
      pages: [`The unique marker word is ${UNIQUE_TERM} for the panel test.`],
    });

    await page.goto("/documents");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    await page
      .getByRole("button", { name: "Search", exact: true })
      .click();
    const panel = page.getByRole("dialog", { name: "Search" });
    await expect(panel).toBeVisible();
    const searchInput = panel.getByRole("searchbox", {
      name: "Search",
      exact: true,
    });

    await searchInput.fill(UNIQUE_TERM);
    const result = page.locator("[data-search-result]").first();
    await expect(result).toBeVisible({ timeout: 15_000 });
    await expect(result).toContainText(`${PREFIX} search-ui.pdf`);
    await expect(result).toContainText("Page 1");
    await expect(page.locator('[data-search-mode="keyword"]')).toContainText(
      "Semantic search isn't available yet",
    );

    // A no-match query is honest.
    await searchInput.fill("zzzznothingmatchesthiszzzz");
    await expect(
      panel.getByText(/No matches for/),
    ).toBeVisible({ timeout: 15_000 });

    // The real hit opens the document's preview (18.11) via ?preview=<id>.
    await searchInput.fill(UNIQUE_TERM);
    await expect(result).toBeVisible({ timeout: 15_000 });
    await expect(result).toHaveAttribute(
      "data-document-id",
      documentId,
    );
    await result.click();
    await expect(page).toHaveURL(new RegExp(`preview=${documentId}`));
    await expect(
      page.getByRole("dialog", { name: `${PREFIX} search-ui.pdf` }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: `${PREFIX} search-ui.pdf` }),
    ).not.toBeVisible();
  });

  test("the 25.11 harness measures real fixtures and reports honestly", async () => {
    test.slow();
    await seedIndexedDocument({
      name: "benchmark.pdf",
      pages: [`The unique marker word is ${UNIQUE_TERM}.`],
    });

    const emptyDir = mkdtempSync(path.join(tmpdir(), "unipilot-search-empty-"));
    try {
      const empty = searchBenchmark([`--dir=${emptyDir}`]);
      expect(empty.status).not.toBe(0);
      expect(empty.stderr).toContain("No fixtures found");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }

    const dir = mkdtempSync(path.join(tmpdir(), "unipilot-search-"));
    try {
      writeFileSync(
        path.join(dir, "proof.json"),
        JSON.stringify({
          query: UNIQUE_TERM,
          expected: [
            { documentName: `${PREFIX} benchmark.pdf`, page: 1 },
          ],
        }),
      );
      const result = searchBenchmark([`--dir=${dir}`, "--k=5"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("meanRecall=1.0000");
      expect(result.stdout).toContain("rr=1.0000");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
