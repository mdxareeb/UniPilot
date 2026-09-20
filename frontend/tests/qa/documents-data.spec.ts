/**
 * tests/qa/documents-data.spec.ts — Tasks 23.1–23.13's data/storage proof.
 *
 * Two halves, matching the two halves of the service:
 *
 * 1. The pure module the service and the client pipeline are built on —
 *    `lib/data/documentValues.ts` (MIME/size/name validation, path building,
 *    magic-byte sniffing, size formatting, row → display mapping).
 *
 * 2. The private bucket's access control with two REAL users (QA1/QA2),
 *    driven through the Storage API with each user's own session — the same
 *    path the browser pipeline takes. Own upload/download/list/remove work;
 *    cross-user reads, writes and deletes are denied; `anon` is denied; the
 *    bucket's MIME and size constraints reject junk without leaving objects;
 *    a document row delete cascades its chunks.
 *
 * Local-only by construction (the guard below refuses any non-loopback
 * target); hosted is never contacted.
 */
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  documentRowToItem,
  formatDocumentSize,
  magicBytesMatch,
  parseDocumentName,
  parseDocumentUpload,
  pathBelongsToUser,
  sanitizeStorageName,
  storagePathFor,
} from "../../lib/data/documentValues";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";
const qa2Password = process.env.UNIPILOT_QA2_PASSWORD ?? "";

const QA1 = "qa.unipilot@unipilot.test";
const QA2 = "qa2.unipilot@unipilot.test";

const BUCKET = "documents";

/** A real, minimal PDF — the header bytes are what finalize sniffs. */
function pdfBytes(extraBytes = 64): Buffer {
  return Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"),
    Buffer.alloc(extraBytes, 0x20),
  ]);
}

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

/** Every object under the caller's prefix, removed with the service role. */
async function sweepStorage(userId: string): Promise<void> {
  const { data: folders, error } = await service.storage
    .from(BUCKET)
    .list(userId, { limit: 1000 });
  expect(error, `storage sweep list: ${error?.message}`).toBeNull();

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

async function objectsUnder(userId: string): Promise<string[]> {
  const { data: folders } = await service.storage
    .from(BUCKET)
    .list(userId, { limit: 1000 });
  const names: string[] = [];
  for (const folder of folders ?? []) {
    const { data: files } = await service.storage
      .from(BUCKET)
      .list(`${userId}/${folder.name}`, { limit: 1000 });
    for (const file of files ?? []) {
      if (file.name !== ".emptyFolderPlaceholder") {
        names.push(`${folder.name}/${file.name}`);
      }
    }
  }
  return names;
}

test.describe("documents data (23.x)", () => {
  test.beforeAll(async () => {
    if (!LOCAL_TARGET.test(url)) {
      throw new Error(
        `documents-data is local-only; refusing target "${url || "(unset)"}"`,
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
    await sweepStorage(qa1Id);
    await sweepStorage(qa2Id);
  });

  test("pure validation: types, sizes, names, paths, magic bytes, mapping", () => {
    /* ---- 23.4/23.5 reservation parsing -------------------------------- */
    expect(
      parseDocumentUpload({
        name: "  Lecture notes.pdf  ",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      }),
    ).toEqual({
      name: "Lecture notes.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });
    expect(
      parseDocumentUpload({
        name: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: 10,
      }),
    ).toBeNull();
    expect(
      parseDocumentUpload({
        name: "",
        mimeType: "application/pdf",
        sizeBytes: 10,
      }),
    ).toBeNull();
    expect(
      parseDocumentUpload({
        name: "big.pdf",
        mimeType: "application/pdf",
        sizeBytes: 25 * 1024 * 1024 + 1,
      }),
    ).toBeNull();
    expect(
      parseDocumentUpload({
        name: "empty.pdf",
        mimeType: "application/pdf",
        sizeBytes: 0,
      }),
    ).toBeNull();
    expect(parseDocumentName("   ")).toBeNull();
    expect(parseDocumentName("  Stats syllabus.pdf ")).toBe("Stats syllabus.pdf");

    /* ---- path convention + sanitization -------------------------------- */
    expect(sanitizeStorageName("My Notes (final)!!.pdf")).toBe(
      "My-Notes-final.pdf",
    );
    expect(sanitizeStorageName("****")).toBe("file");
    expect(sanitizeStorageName("no-extension")).toBe("no-extension");
    const path = storagePathFor("user-1", "doc-1", "My Notes (final)!!.pdf");
    expect(path).toBe("user-1/doc-1/My-Notes-final.pdf");
    expect(pathBelongsToUser(path, "user-1")).toBe(true);
    expect(pathBelongsToUser(path, "user-2")).toBe(false);

    /* ---- magic bytes --------------------------------------------------- */
    expect(magicBytesMatch(pdfBytes(), "application/pdf")).toBe(true);
    expect(
      magicBytesMatch(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        "image/png",
      ),
    ).toBe(true);
    expect(
      magicBytesMatch(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"),
    ).toBe(true);
    expect(
      magicBytesMatch(Buffer.from([0x50, 0x4b, 0x03, 0x04]), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBe(true);
    expect(
      magicBytesMatch(Buffer.from("not a pdf"), "application/pdf"),
    ).toBe(false);
    expect(
      magicBytesMatch(Buffer.from("%PD"), "application/pdf"),
    ).toBe(false);

    /* ---- display mapping ----------------------------------------------- */
    expect(formatDocumentSize(824)).toBe("824 B");
    expect(formatDocumentSize(12 * 1024 + 400)).toBe("12.4 KB");
    expect(formatDocumentSize(2.4 * 1024 * 1024)).toBe("2.4 MB");
    expect(
      documentRowToItem(
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Stats syllabus.pdf",
          storage_path: "user-1/doc-1/Stats-syllabus.pdf",
          mime_type: "application/pdf",
          size_bytes: 2048,
          page_count: null,
          status: "uploaded",
          error_message: null,
          created_at: "2026-09-12T09:00:00.000Z",
          source: "upload",
        },
        "UTC",
      ),
    ).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Stats syllabus.pdf",
      storagePath: "user-1/doc-1/Stats-syllabus.pdf",
      mimeType: "application/pdf",
      mimeLabel: "PDF",
      sizeBytes: 2048,
      sizeLabel: "2.0 KB",
      statusValue: "uploaded",
      statusLabel: "Uploaded",
      createdLabel: "Sat, Sep 12",
      source: "upload",
    });

    /* ---- provenance mapping (Task F2, 31.x) ----------------------------- */
    const deckRow = {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Seminar recap.pptx",
      storage_path: null,
      mime_type:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      size_bytes: null,
      page_count: null,
      status: "uploaded",
      error_message: null,
      created_at: "2026-09-12T09:00:00.000Z",
      source: "presentation",
    };
    expect(documentRowToItem(deckRow, "UTC").source).toBe("presentation");
    // An unknown stored value is omitted, never guessed into a badge.
    expect(
      documentRowToItem({ ...deckRow, source: "imported" }, "UTC").source,
    ).toBeUndefined();
  });

  test("private bucket: own access works, cross-user and anon are denied", async () => {
    test.setTimeout(120_000);

    const docId = randomUUID();
    const path = `${qa1Id}/${docId}/notes.pdf`;

    // QA1 uploads into their own folder.
    const uploaded = await qa1.storage
      .from(BUCKET)
      .upload(path, pdfBytes(), { contentType: "application/pdf" });
    expect(uploaded.error, `own upload: ${uploaded.error?.message}`).toBeNull();

    // QA1 can read and list it.
    const ownDownload = await qa1.storage.from(BUCKET).download(path);
    expect(ownDownload.error).toBeNull();
    const bytes = new Uint8Array(await ownDownload.data!.arrayBuffer());
    expect(bytes[0]).toBe(0x25);
    expect(bytes[1]).toBe(0x50);

    const ownList = await qa1.storage.from(BUCKET).list(`${qa1Id}/${docId}`);
    expect(ownList.error).toBeNull();
    expect((ownList.data ?? []).map((entry) => entry.name)).toContain(
      "notes.pdf",
    );

    // QA2 cannot read the object, list QA1's folder, or write into it.
    const foreignDownload = await qa2.storage.from(BUCKET).download(path);
    expect(foreignDownload.error, "cross-user read must fail").not.toBeNull();

    const foreignList = await qa2.storage.from(BUCKET).list(`${qa1Id}/${docId}`);
    expect(foreignList.data ?? []).toHaveLength(0);

    const foreignUpload = await qa2.storage
      .from(BUCKET)
      .upload(`${qa1Id}/${randomUUID()}/intrude.pdf`, pdfBytes(), {
        contentType: "application/pdf",
      });
    expect(foreignUpload.error, "cross-user write must fail").not.toBeNull();

    // QA2's delete touches zero rows of QA1's.
    const foreignRemove = await qa2.storage.from(BUCKET).remove([path]);
    expect(foreignRemove.data ?? []).toHaveLength(0);
    const stillThere = await qa1.storage.from(BUCKET).download(path);
    expect(stillThere.error).toBeNull();

    // Anon (no session at all) is denied every verb.
    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const anonDownload = await anon.storage.from(BUCKET).download(path);
    expect(anonDownload.error, "anon read must fail").not.toBeNull();
    const anonUpload = await anon.storage
      .from(BUCKET)
      .upload(`${qa1Id}/${randomUUID()}/anon.pdf`, pdfBytes(), {
        contentType: "application/pdf",
      });
    expect(anonUpload.error, "anon write must fail").not.toBeNull();

    // QA1's own cleanup works.
    const removed = await qa1.storage.from(BUCKET).remove([path]);
    expect(removed.error).toBeNull();
    expect(await objectsUnder(qa1Id)).toHaveLength(0);
  });

  test("bucket constraints reject disallowed types and oversize files, leaving nothing", async () => {
    test.setTimeout(180_000);

    const docId = randomUUID();

    // A disallowed MIME type is rejected before it can land.
    const badType = await qa1.storage
      .from(BUCKET)
      .upload(`${qa1Id}/${docId}/notes.txt`, Buffer.from("hello"), {
        contentType: "text/plain",
      });
    expect(badType.error, "disallowed type must fail").not.toBeNull();

    // An oversize object is rejected by the bucket's 25 MiB cap.
    const oversize = Buffer.concat([
      pdfBytes(0),
      Buffer.alloc(26 * 1024 * 1024, 0x20),
    ]);
    const tooBig = await qa1.storage
      .from(BUCKET)
      .upload(`${qa1Id}/${docId}/huge.pdf`, oversize, {
        contentType: "application/pdf",
      });
    expect(tooBig.error, "oversize upload must fail").not.toBeNull();

    expect(await objectsUnder(qa1Id)).toHaveLength(0);
  });

  test("row cascade: deleting a QA1 document removes its chunks", async () => {
    const docId = randomUUID();
    const path = `${qa1Id}/${docId}/cascade.pdf`;

    const { error: insertError } = await service.from("documents").insert({
      id: docId,
      user_id: qa1Id,
      name: "UI 23x cascade.pdf",
      storage_path: path,
      mime_type: "application/pdf",
      size_bytes: pdfBytes().length,
      status: "uploaded",
    });
    expect(insertError, `seed document: ${insertError?.message}`).toBeNull();

    const uploaded = await qa1.storage
      .from(BUCKET)
      .upload(path, pdfBytes(), { contentType: "application/pdf" });
    expect(uploaded.error).toBeNull();

    const { error: chunkError } = await service
      .from("document_chunks")
      .insert({ document_id: docId, chunk_index: 0, content: "page one" });
    expect(chunkError, `seed chunk: ${chunkError?.message}`).toBeNull();

    // QA2 cannot delete QA1's row; QA1 can.
    const foreignDelete = await qa2
      .from("documents")
      .delete()
      .eq("id", docId)
      .select("id");
    expect(foreignDelete.data ?? []).toHaveLength(0);

    const ownDelete = await qa1
      .from("documents")
      .delete()
      .eq("id", docId)
      .select("id");
    expect(ownDelete.error).toBeNull();
    expect(ownDelete.data ?? []).toHaveLength(1);

    const chunks = await service
      .from("document_chunks")
      .select("id")
      .eq("document_id", docId);
    expect(chunks.data ?? []).toHaveLength(0);

    await qa1.storage.from(BUCKET).remove([path]);
  });
});
