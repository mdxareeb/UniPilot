/**
 * tests/qa/mobile-file-tools.spec.ts — Phase 4's Bearer tool boundary.
 *
 * Local-only, real stack:
 * - reserve/finalize with a real Storage upload and a real `document.process`
 *   job, plus the missing-object discard path and subject ownership;
 * - OCR multipart bounds and the 503 mapping through the injectable handler
 *   (no live Gemini call);
 * - convert DOCX/PPTX/TXT boundary (TXT here) returning a real `%PDF-` body;
 * - 401 / 403 / 400 / 404 / 413 across the routes.
 */
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { authenticateBearer } from "../../lib/auth/apiAuth";
import {
  POST as ocrPost,
  createOcrPost,
} from "../../app/api/mobile/tools/ocr/route";
import { createConvertPost } from "../../app/api/mobile/tools/convert/route";
import { createPdfProbePost } from "../../app/api/mobile/tools/pdf-probe/route";
import type {
  runDocumentOcr,
  runTransientOcr,
} from "../../lib/tools/documentOcr";
import {
  ConvertError,
  type convertDocument,
} from "../../lib/tools/documentConvert";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";
const qa2Password = process.env.UNIPILOT_QA2_PASSWORD ?? "";

const QA1 = "qa.unipilot@unipilot.test";
const QA2 = "qa2.unipilot@unipilot.test";
const PREFIX = "UI FT 4x";
const BUCKET = "documents";

let qa1Id = "";
let qa2Id = "";
let qa1Token = "";
let qa2Token = "";
let service: SupabaseClient;
let qa1: SupabaseClient;
let qa2: SupabaseClient;

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function signIn(
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<{ id: string; token: string }> {
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  expect(error, `sign-in failed for ${email}: ${error?.message}`).toBeNull();
  return { id: data.user!.id, token: data.session!.access_token };
}

async function tinyPdf(text = "A searchable text-layer PDF."): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  page.drawText(text, { x: 48, y: 780, size: 12, font });
  return Buffer.from(await pdf.save());
}

async function cleanup(): Promise<void> {
  for (const userId of [qa1Id, qa2Id]) {
    if (!userId) continue;
    const { data: documents } = await service
      .from("documents")
      .select("id, storage_path")
      .eq("user_id", userId)
      .like("name", `${PREFIX}%`);
    const paths = (documents ?? [])
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
    await service
      .from("usage_events")
      .delete()
      .eq("user_id", userId)
      .in("kind", ["ocr_page", "ocr_tokens"]);
    await service
      .from("subjects")
      .delete()
      .eq("user_id", userId)
      .like("name", `${PREFIX}%`);
  }
}

test.beforeAll(async () => {
  if (!LOCAL_TARGET.test(url)) {
    throw new Error(
      `mobile-file-tools is local-only; refusing target "${url || "(unset)"}"`,
    );
  }
  if (!anonKey || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY (frontend/.env)",
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
  const first = await signIn(qa1, QA1, qa1Password);
  qa1Id = first.id;
  qa1Token = first.token;
  const second = await signIn(qa2, QA2, qa2Password);
  qa2Id = second.id;
  qa2Token = second.token;
});

test.afterEach(async () => {
  await cleanup();
});

test.describe("mobile file tools access", () => {
  test("all five routes require a Bearer token and onboarding", async ({
    request,
  }) => {
    const documentId = randomUUID();
    const cases = [
      request.post("/api/mobile/documents/reserve", {
        data: { name: "x.pdf", mimeType: "application/pdf", sizeBytes: 10 },
      }),
      request.post(`/api/mobile/documents/${documentId}/finalize`, {
        data: { mode: "process" },
      }),
      request.post("/api/mobile/tools/ocr", {
        data: { documentId },
      }),
      request.post("/api/mobile/tools/convert"),
      request.post("/api/mobile/tools/pdf-probe"),
    ];
    for (const response of await Promise.all(cases)) {
      expect(response.status()).toBe(401);
      expect(response.headers()["cache-control"]).toBe("no-store");
    }

    const preOnboarding = await request.post("/api/mobile/documents/reserve", {
      headers: bearer(qa2Token),
      data: { name: "x.pdf", mimeType: "application/pdf", sizeBytes: 10 },
    });
    expect(preOnboarding.status()).toBe(403);

    const preOnboardingConvert = await request.post(
      "/api/mobile/tools/convert",
      { headers: bearer(qa2Token) },
    );
    expect(preOnboardingConvert.status()).toBe(403);
  });
});

test.describe("reserve and finalize", () => {
  test("rejects malformed reservations and oversized declared sizes", async ({
    request,
  }) => {
    const badMime = await request.post("/api/mobile/documents/reserve", {
      headers: bearer(qa1Token),
      data: { name: "notes.pdf", mimeType: "image/gif", sizeBytes: 100 },
    });
    expect(badMime.status()).toBe(400);

    const badName = await request.post("/api/mobile/documents/reserve", {
      headers: bearer(qa1Token),
      data: { name: "   ", mimeType: "application/pdf", sizeBytes: 100 },
    });
    expect(badName.status()).toBe(400);

    const oversized = await request.post("/api/mobile/documents/reserve", {
      headers: bearer(qa1Token),
      data: {
        name: "big.pdf",
        mimeType: "application/pdf",
        sizeBytes: 26 * 1024 * 1024,
      },
    });
    expect(oversized.status()).toBe(413);
  });

  test("reserves, uploads, finalizes a real PDF and queues the worker", async ({
    request,
  }) => {
    const subject = await service
      .from("subjects")
      .insert({ user_id: qa1Id, name: `${PREFIX} subject` })
      .select("id")
      .single();
    expect(subject.error, subject.error?.message).toBeNull();

    const bytes = await tinyPdf();
    const name = `${PREFIX} uploaded.pdf`;
    const reserve = await request.post("/api/mobile/documents/reserve", {
      headers: bearer(qa1Token),
      data: {
        name,
        mimeType: "application/pdf",
        sizeBytes: bytes.length,
        subjectId: subject.data!.id,
      },
    });
    expect(reserve.status()).toBe(201);
    const { documentId, uploadPath } = (await reserve.json()) as {
      documentId: string;
      uploadPath: string;
    };
    expect(uploadPath.startsWith(`${qa1Id}/${documentId}/`)).toBe(true);

    const upload = await qa1.storage
      .from(BUCKET)
      .upload(uploadPath, bytes, { contentType: "application/pdf" });
    expect(upload.error, upload.error?.message).toBeNull();

    const finalize = await request.post(
      `/api/mobile/documents/${documentId}/finalize`,
      { headers: bearer(qa1Token), data: { mode: "process" } },
    );
    expect(finalize.status()).toBe(200);
    await expect(finalize.json()).resolves.toEqual({ status: "indexing" });

    const row = await service
      .from("documents")
      .select("status, storage_path, subject_id, size_bytes")
      .eq("id", documentId)
      .single();
    expect(row.error, row.error?.message).toBeNull();
    expect(row.data!.status).toBe("indexing");
    expect(row.data!.subject_id).toBe(subject.data!.id);
    expect(row.data!.size_bytes).toBe(bytes.length);

    const job = await service
      .from("jobs")
      .select("payload")
      .eq("user_id", qa1Id)
      .eq("kind", "document.process");
    expect(job.error, job.error?.message).toBeNull();
    expect((job.data ?? []).map((row) => row.payload)).toEqual([
      { documentId },
    ]);
  });

  test("a missing object is rejected and the reservation is discarded", async ({
    request,
  }) => {
    const bytes = await tinyPdf();
    const reserve = await request.post("/api/mobile/documents/reserve", {
      headers: bearer(qa1Token),
      data: {
        name: `${PREFIX} no-upload.pdf`,
        mimeType: "application/pdf",
        sizeBytes: bytes.length,
      },
    });
    expect(reserve.status()).toBe(201);
    const { documentId } = (await reserve.json()) as { documentId: string };

    const finalize = await request.post(
      `/api/mobile/documents/${documentId}/finalize`,
      { headers: bearer(qa1Token), data: { mode: "process" } },
    );
    expect(finalize.status()).toBe(400);

    const row = await service
      .from("documents")
      .select("id")
      .eq("id", documentId)
      .maybeSingle();
    expect(row.error, row.error?.message).toBeNull();
    expect(row.data).toBeNull();
  });

  test("a foreign subject is not reservable", async ({ request }) => {
    const foreign = await service
      .from("subjects")
      .insert({ user_id: qa2Id, name: `${PREFIX} foreign subject` })
      .select("id")
      .single();
    expect(foreign.error, foreign.error?.message).toBeNull();

    const response = await request.post("/api/mobile/documents/reserve", {
      headers: bearer(qa1Token),
      data: {
        name: `${PREFIX} scoped.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 100,
        subjectId: foreign.data!.id,
      },
    });
    expect(response.status()).toBe(404);
  });

  test("finalize can hand an image PDF to the OCR path", async ({ request }) => {
    const bytes = await tinyPdf();
    const reserve = await request.post("/api/mobile/documents/reserve", {
      headers: bearer(qa1Token),
      data: {
        name: `${PREFIX} ocr.pdf`,
        mimeType: "application/pdf",
        sizeBytes: bytes.length,
      },
    });
    expect(reserve.status()).toBe(201);
    const { documentId, uploadPath } = (await reserve.json()) as {
      documentId: string;
      uploadPath: string;
    };
    await qa1.storage
      .from(BUCKET)
      .upload(uploadPath, bytes, { contentType: "application/pdf" });

    const finalize = await request.post(
      `/api/mobile/documents/${documentId}/finalize`,
      { headers: bearer(qa1Token), data: { mode: "ocr" } },
    );
    expect(finalize.status()).toBe(200);
    await expect(finalize.json()).resolves.toEqual({ status: "ocr_required" });

    const job = await service
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", qa1Id)
      .eq("kind", "document.process");
    expect(job.count).toBe(0);
  });
});

test.describe("convert", () => {
  test("renders a TXT file to a real PDF", async ({ request }) => {
    const response = await request.post("/api/mobile/tools/convert", {
      headers: bearer(qa1Token),
      multipart: {
        file: {
          name: "Week 3 notes.txt",
          mimeType: "text/plain",
          buffer: Buffer.from(
            "Recursion\n\nA function that calls itself.\n\nBase cases stop it.",
          ),
        },
      },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/pdf");
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["x-unipilot-filename"]).toBe("Week-3-notes.pdf");
    const body = await response.body();
    expect(body.subarray(0, 5).toString("utf8")).toBe("%PDF-");
  });

  test("renders a minimal DOCX and PPTX to PDF", async ({ request }) => {
    const docx = zipSync({
      "[Content_Types].xml": strToU8(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      "_rels/.rels": strToU8(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      "word/document.xml": strToU8(
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX conversion proof.</w:t></w:r></w:p></w:body></w:document>',
      ),
    });
    const pptx = zipSync({
      "ppt/slides/slide1.xml": strToU8(
        '<?xml version="1.0"?><p:sld><p:cSld><p:spTree><a:p><a:r><a:t>PPTX conversion proof.</a:t></a:r></a:p></p:spTree></p:cSld></p:sld>',
      ),
    });

    for (const file of [
      {
        name: "proof.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: Buffer.from(docx),
      },
      {
        name: "proof.pptx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        buffer: Buffer.from(pptx),
      },
    ]) {
      const response = await request.post("/api/mobile/tools/convert", {
        headers: bearer(qa1Token),
        multipart: { file },
      });
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("application/pdf");
      const body = await response.body();
      expect(body.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    }
  });

  test("converts a text-layered PDF to TXT, Markdown and DOCX", async ({
    request,
  }) => {
    const pdf = await tinyPdf("A searchable text-layer PDF.");
    const cases = [
      {
        target: "txt",
        type: "text/plain",
        filename: "proof.txt",
      },
      {
        target: "md",
        type: "text/markdown",
        filename: "proof.md",
      },
      {
        target: "docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename: "proof.docx",
      },
    ] as const;

    for (const item of cases) {
      const response = await request.post("/api/mobile/tools/convert", {
        headers: bearer(qa1Token),
        multipart: {
          targetFormat: item.target,
          file: {
            name: "proof.pdf",
            mimeType: "application/pdf",
            buffer: pdf,
          },
        },
      });
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain(item.type);
      expect(response.headers()["x-unipilot-filename"]).toBe(item.filename);
      const body = await response.body();
      if (item.target === "docx") {
        expect(body.subarray(0, 2).toString("utf8")).toBe("PK");
        const entries = unzipSync(new Uint8Array(body));
        expect(entries["word/document.xml"]).toBeDefined();
        expect(strFromU8(entries["word/document.xml"])).toContain(
          "searchable text-layer PDF",
        );
      } else {
        const text = body.toString("utf8");
        expect(text).toContain("searchable text-layer PDF");
        if (item.target === "md") expect(text).toContain("## Page 1");
      }
    }
  });

  test("converts text/data inputs to Markdown and DOCX", async ({ request }) => {
    const markdown = await request.post("/api/mobile/tools/convert", {
      headers: bearer(qa1Token),
      multipart: {
        targetFormat: "md",
        file: {
          name: "notes.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Monitors use condition variables."),
        },
      },
    });
    expect(markdown.status()).toBe(200);
    expect(markdown.headers()["content-type"]).toContain("text/markdown");
    expect(await markdown.text()).toContain("condition variables");

    const docx = await request.post("/api/mobile/tools/convert", {
      headers: bearer(qa1Token),
      multipart: {
        targetFormat: "docx",
        file: {
          name: "notes.md",
          mimeType: "text/markdown",
          buffer: Buffer.from("# Notes\n\nMonitors use condition variables."),
        },
      },
    });
    expect(docx.status()).toBe(200);
    const docxBody = await docx.body();
    expect(docxBody.subarray(0, 2).toString("utf8")).toBe("PK");
    expect(
      strFromU8(unzipSync(new Uint8Array(docxBody))["word/document.xml"]),
    ).toContain("Monitors use condition variables");

    for (const file of [
      {
        name: "rows.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("name,date\nMidterm,2026-12-12"),
      },
      {
        name: "data.json",
        mimeType: "application/json",
        buffer: Buffer.from('{"exam":"2026-12-20"}'),
      },
    ]) {
      const pdf = await request.post("/api/mobile/tools/convert", {
        headers: bearer(qa1Token),
        multipart: { file },
      });
      expect(pdf.status()).toBe(200);
      const body = await pdf.body();
      expect(body.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    }
  });

  test("rejects an unsupported target, unsupported input and empty text", async ({
    request,
  }) => {
    const unsupportedTarget = await request.post("/api/mobile/tools/convert", {
      headers: bearer(qa1Token),
      multipart: {
        targetFormat: "xlsx",
        file: {
          name: "notes.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("hello"),
        },
      },
    });
    expect(unsupportedTarget.status()).toBe(415);

    const unsupportedInput = await request.post("/api/mobile/tools/convert", {
      headers: bearer(qa1Token),
      multipart: {
        file: {
          name: "photo.png",
          mimeType: "image/png",
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        },
      },
    });
    expect(unsupportedInput.status()).toBe(415);

    const empty = await request.post("/api/mobile/tools/convert", {
      headers: bearer(qa1Token),
      multipart: {
        file: {
          name: "empty.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("   \n\n"),
        },
      },
    });
    expect(empty.status()).toBe(400);
  });

  test("maps provider and ledger failures to 502/503/429", async () => {
    const form = () => {
      const data = new FormData();
      data.append(
        "file",
        new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "scan.pdf", {
          type: "application/pdf",
        }),
      );
      data.append("targetFormat", "txt");
      return data;
    };
    const invoke = async (convert: typeof convertDocument) =>
      createConvertPost({ authenticate: authenticateBearer, convert })(
        new Request("http://localhost/api/mobile/tools/convert", {
          method: "POST",
          headers: bearer(qa1Token),
          body: form(),
        }),
      );

    const unavailable = await invoke(async () => {
      throw new ConvertError("provider_unavailable", "The AI OCR service is temporarily unavailable.");
    });
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("cache-control")).toBe("no-store");
    await expect(unavailable.json()).resolves.toMatchObject({
      retryable: true,
    });

    const rejected = await invoke(async () => {
      throw new ConvertError("provider_rejected", "The AI OCR service rejected the request.");
    });
    expect(rejected.status).toBe(502);

    const limited = await invoke(async () => {
      throw new ConvertError("rate_limited", "OCR limit reached.", 60);
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });

  test("rejects an oversized payload", async ({ request }) => {
    const oversized = await request.post("/api/mobile/tools/convert", {
      headers: bearer(qa1Token),
      multipart: {
        file: {
          name: "huge.txt",
          mimeType: "text/plain",
          buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0x41),
        },
      },
    });
    expect(oversized.status()).toBe(413);
  });
});

test.describe("pdf probe", () => {
  test("reports a text layer and a scan honestly", async ({ request }) => {
    const text = await request.post("/api/mobile/tools/pdf-probe", {
      headers: bearer(qa1Token),
      multipart: {
        file: {
          name: "text-layer.pdf",
          mimeType: "application/pdf",
          buffer: await tinyPdf(),
        },
      },
    });
    expect(text.status()).toBe(200);
    await expect(text.json()).resolves.toMatchObject({
      hasText: true,
      pageCount: 1,
    });

    const blankPdf = await PDFDocument.create();
    blankPdf.addPage([595, 842]);
    const blank = await request.post("/api/mobile/tools/pdf-probe", {
      headers: bearer(qa1Token),
      multipart: {
        file: {
          name: "scan.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from(await blankPdf.save()),
        },
      },
    });
    expect(blank.status()).toBe(200);
    const body = (await blank.json()) as { hasText: boolean; characters: number };
    expect(body.hasText).toBe(false);
    expect(body.characters).toBe(0);
  });

  test("rejects a non-PDF and enforces the 10 MB bound", async ({ request }) => {
    const wrong = await request.post("/api/mobile/tools/pdf-probe", {
      headers: bearer(qa1Token),
      multipart: {
        file: {
          name: "notes.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("not a pdf"),
        },
      },
    });
    expect(wrong.status()).toBe(415);

    const oversized = await request.post("/api/mobile/tools/pdf-probe", {
      headers: bearer(qa1Token),
      multipart: {
        file: {
          name: "huge.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0x25),
        },
      },
    });
    expect(oversized.status()).toBe(413);
  });

  test("an unreadable PDF is a sanitized 400", async () => {
    const post = createPdfProbePost({
      authenticate: authenticateBearer,
      extract: async () => {
        throw new Error("pdfjs exploded");
      },
    });
    const response = await post(
      new Request("http://localhost/api/mobile/tools/pdf-probe", {
        method: "POST",
        headers: bearer(qa1Token),
        body: (() => {
          const form = new FormData();
          form.append(
            "file",
            new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "bad.pdf", {
              type: "application/pdf",
            }),
          );
          return form;
        })(),
      }),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("readable text"),
    });
  });
});

test.describe("ocr", () => {
  async function seedOcrDocument(
    userId: string,
    status = "indexing",
  ): Promise<string> {
    const { data, error } = await service
      .from("documents")
      .insert({
        user_id: userId,
        name: `${PREFIX} ocr-${randomUUID()}.pdf`,
        mime_type: "application/pdf",
        size_bytes: 100,
        storage_path: null,
        status,
      })
      .select("id")
      .single();
    expect(error, error?.message).toBeNull();
    return data!.id;
  }

  function imageForm(documentId: string, pages = 1): FormData {
    const form = new FormData();
    form.append("documentId", documentId);
    for (let index = 0; index < pages; index += 1) {
      form.append(
        "pages",
        new File(
          [new Uint8Array([0xff, 0xd8, 0xff, 0xd9])],
          `page-${index + 1}.jpg`,
          { type: "image/jpeg" },
        ),
      );
    }
    return form;
  }

  test("rejects a bad id and too many pages", async ({ request }) => {
    const bad = await request.post("/api/mobile/tools/ocr", {
      headers: bearer(qa1Token),
      data: { documentId: "not-an-id" },
    });
    expect(bad.status()).toBe(400);

    const documentId = await seedOcrDocument(qa1Id);
    const tooMany = await ocrPost(
      new Request("http://localhost/api/mobile/tools/ocr", {
        method: "POST",
        headers: bearer(qa1Token),
        body: imageForm(documentId, 21),
      }),
    );
    expect(tooMany.status).toBe(413);
  });

  test("a foreign document is a 404 before any provider call", async () => {
    const foreignId = await seedOcrDocument(qa2Id);
    const response = await ocrPost(
      new Request("http://localhost/api/mobile/tools/ocr", {
        method: "POST",
        headers: bearer(qa1Token),
        body: imageForm(foreignId),
      }),
    );
    expect(response.status).toBe(404);
  });

  test("provider failure maps to 503 with sanitized copy", async () => {
    const documentId = await seedOcrDocument(qa1Id);
    const runOcr: typeof runDocumentOcr = async () => ({
      status: "provider_error",
      error: "The AI OCR service is temporarily unavailable.",
      retryable: true,
    });
    const post = createOcrPost({
      authenticate: authenticateBearer,
      runOcr,
    });
    const response = await post(
      new Request("http://localhost/api/mobile/tools/ocr", {
        method: "POST",
        headers: bearer(qa1Token),
        body: imageForm(documentId),
      }),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as {
      error: string;
      retryable: boolean;
    };
    expect(body.error).toContain("temporarily unavailable");
    expect(body.retryable).toBe(true);
  });

  test("unconfigured OCR is an honest 200", async () => {
    const documentId = await seedOcrDocument(qa1Id);
    const runOcr: typeof runDocumentOcr = async () => ({
      status: "ok",
      configured: false,
      pages: 0,
      characters: 0,
      tokens: 0,
      alreadyIndexed: false,
      error: "The AI OCR service isn't configured on this server.",
    });
    const post = createOcrPost({ authenticate: authenticateBearer, runOcr });
    const response = await post(
      new Request("http://localhost/api/mobile/tools/ocr", {
        method: "POST",
        headers: bearer(qa1Token),
        body: imageForm(documentId),
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      configured: false,
      status: "saved_not_searchable",
    });
  });

  function transientForm(
    options: { type?: string; bytes?: Uint8Array } = {},
  ): FormData {
    const form = new FormData();
    const bytes = options.bytes ?? new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    form.append(
      "image",
      new File([bytes as unknown as BlobPart], "preview.jpg", {
        type: options.type ?? "image/jpeg",
      }),
    );
    return form;
  }

  test("transient preview returns text without a document row", async () => {
    let received: { page: number; mimeType: string } | null = null;
    const transient: typeof runTransientOcr = async ({ input }) => {
      received = {
        page: input.images[0]?.page ?? 0,
        mimeType: input.images[0]?.mimeType ?? "",
      };
      return {
        status: "ok",
        configured: true,
        text: "Week 9\nNormalisation",
        charCount: 19,
        pages: 1,
        tokens: 42,
      };
    };
    const post = createOcrPost({
      authenticate: authenticateBearer,
      runOcr: async () => {
        throw new Error("indexed OCR must not run for a preview");
      },
      runTransientOcr: transient,
    });
    const response = await post(
      new Request("http://localhost/api/mobile/tools/ocr", {
        method: "POST",
        headers: bearer(qa1Token),
        body: transientForm(),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      configured: true,
      text: "Week 9\nNormalisation",
      charCount: 19,
      pages: 1,
    });
    expect(received).toEqual({ page: 1, mimeType: "image/jpeg" });
  });

  test("transient preview rejects a missing or non-image payload", async () => {
    const post = createOcrPost({
      authenticate: authenticateBearer,
      runOcr: async () => {
        throw new Error("unreachable");
      },
      runTransientOcr: async () => {
        throw new Error("unreachable");
      },
    });
    const missing = await post(
      new Request("http://localhost/api/mobile/tools/ocr", {
        method: "POST",
        headers: bearer(qa1Token),
        body: new FormData(),
      }),
    );
    expect(missing.status).toBe(400);

    const wrongType = await post(
      new Request("http://localhost/api/mobile/tools/ocr", {
        method: "POST",
        headers: bearer(qa1Token),
        body: transientForm({ type: "application/pdf" }),
      }),
    );
    expect(wrongType.status).toBe(400);
  });

  test("transient preview enforces the per-image size bound", async () => {
    const post = createOcrPost({
      authenticate: authenticateBearer,
      runOcr: async () => {
        throw new Error("unreachable");
      },
      runTransientOcr: async () => {
        throw new Error("unreachable");
      },
    });
    const response = await post(
      new Request("http://localhost/api/mobile/tools/ocr", {
        method: "POST",
        headers: bearer(qa1Token),
        body: transientForm({
          bytes: new Uint8Array(4 * 1024 * 1024 + 1),
        }),
      }),
    );
    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("transient preview maps unconfigured, 429 and 503 honestly", async () => {
    const invoke = async (transient: typeof runTransientOcr) => {
      const post = createOcrPost({
        authenticate: authenticateBearer,
        runOcr: async () => {
          throw new Error("unreachable");
        },
        runTransientOcr: transient,
      });
      return post(
        new Request("http://localhost/api/mobile/tools/ocr", {
          method: "POST",
          headers: bearer(qa1Token),
          body: transientForm(),
        }),
      );
    };

    const unconfigured = await invoke(async () => ({
      status: "ok",
      configured: false,
      text: "",
      charCount: 0,
      error: "The AI OCR service isn't configured on this server.",
    }));
    expect(unconfigured.status).toBe(200);
    await expect(unconfigured.json()).resolves.toMatchObject({
      configured: false,
      text: "",
      charCount: 0,
    });

    const limited = await invoke(async () => ({
      status: "limited",
      error: "You've reached the OCR limit for now. Try again in a minute.",
      retryAfterSeconds: 60,
    }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");

    const unavailable = await invoke(async () => ({
      status: "provider_error",
      error: "The AI OCR service is temporarily unavailable.",
      retryable: true,
    }));
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toMatchObject({
      retryable: true,
    });

    const rejected = await invoke(async () => ({
      status: "provider_error",
      error: "The AI OCR service rejected the request.",
      retryable: false,
    }));
    expect(rejected.status).toBe(502);
  });
});
