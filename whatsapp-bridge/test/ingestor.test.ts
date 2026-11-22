import assert from "node:assert/strict";
import { describe, it } from "node:test";
import pino from "pino";
import { MessageIngestor } from "../src/ingest/ingestor.ts";
import { MediaCapture, MEDIA_ERRORS, MAX_FILE_BYTES } from "../src/media/capture.ts";
import {
  documentMessage,
  GROUP,
  imageMessage,
  JPEG_BYTES,
  OTHER_GROUP,
  PDF_BYTES,
  PDF_MIME,
  PPTX_BYTES,
  PPTX_MIME,
  sha256Bytes,
  textMessage,
} from "./helpers/messages.ts";
import { MemoryStore } from "./helpers/memoryStore.ts";

const USER = "11111111-1111-1111-1111-111111111111";
const silent = pino({ level: "silent" });

function setup(opts: { activeGroups?: string[]; download?: () => Promise<Uint8Array> } = {}) {
  const store = new MemoryStore();
  for (const jid of opts.activeGroups ?? [GROUP]) {
    store.groups.set(`${USER}|${jid}`, { jid, name: jid, active: true });
  }
  const downloads: string[] = [];
  const media = new MediaCapture({
    store,
    logger: silent,
    download: opts.download ?? (async () => PDF_BYTES),
    newId: (() => {
      let n = 0;
      return () => `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
    })(),
  });
  const ingestor = new MessageIngestor({ store, logger: silent, media, activeTtlMs: 0 });
  return { store, ingestor, downloads };
}

describe("MessageIngestor: which messages are stored", () => {
  it("stores a message from an active group", async () => {
    const { store, ingestor } = setup();
    const summary = await ingestor.handle(USER, [textMessage("Assignment 3 due Friday")], "live");
    assert.equal(summary.ingested, 1);
    assert.equal(store.rawMessages[0]!.rawText, "Assignment 3 due Friday");
    assert.equal(store.rawMessages[0]!.mediaType, "none");
  });

  it("ignores groups the owner has not switched on", async () => {
    const { store, ingestor } = setup({ activeGroups: [GROUP] });
    const summary = await ingestor.handle(
      USER,
      [textMessage("Dinner at 8?", { jid: OTHER_GROUP, id: "X1" })],
      "live",
    );
    assert.equal(summary.ingested, 0);
    assert.equal(summary.skippedInactive, 1);
    assert.equal(store.rawMessages.length, 0);
    assert.equal(store.ingestCalls, 0, "nothing was even sent to the database");
  });

  it("ignores DMs, reactions and trivial chatter", async () => {
    const { store, ingestor } = setup();
    const summary = await ingestor.handle(
      USER,
      [
        textMessage("hello there", { jid: "1555@s.whatsapp.net", id: "D1" }),
        textMessage("ok", { id: "T1" }),
        textMessage("👍", { id: "T2" }),
        { ...textMessage("x", { id: "R1" }), message: { reactionMessage: { text: "👍" } } } as never,
      ],
      "live",
    );
    assert.equal(summary.ingested, 0);
    assert.equal(summary.skippedUnparsed, 2);
    assert.equal(summary.skippedTrivial, 2);
    assert.equal(store.rawMessages.length, 0);
  });

  it("ingests history and live events through the same path", async () => {
    const { store, ingestor } = setup();
    await ingestor.handle(USER, [textMessage("Quiz on Monday", { id: "H1" })], "history");
    await ingestor.handle(USER, [textMessage("Lab report due Tuesday", { id: "L1" })], "live");
    assert.deepEqual(store.rawMessages.map((m) => m.whatsappMsgId), ["H1", "L1"]);
  });

  it("history for an inactive group is dropped, so toggling on never back-fills it", async () => {
    const { store, ingestor } = setup({ activeGroups: [] });
    const summary = await ingestor.handle(
      USER,
      [textMessage("Midterm on 3 Dec", { id: "OLD" })],
      "history",
    );
    assert.equal(summary.skippedInactive, 1);
    assert.equal(store.rawMessages.length, 0);
  });
});

describe("MessageIngestor: idempotency", () => {
  it("a replayed or redelivered message creates nothing new", async () => {
    const { store, ingestor } = setup();
    const batch = [textMessage("Assignment 3 due Friday", { id: "A1" })];
    assert.equal((await ingestor.handle(USER, batch, "history")).ingested, 1);
    assert.equal((await ingestor.handle(USER, batch, "live")).ingested, 0);
    assert.equal((await ingestor.handle(USER, batch, "history")).ingested, 0);
    assert.equal(store.rawMessages.length, 1);
  });

  it("the same message twice in one batch is sent once", async () => {
    const { store, ingestor } = setup();
    const m = textMessage("Assignment 3 due Friday", { id: "A1" });
    const summary = await ingestor.handle(USER, [m, m], "live");
    assert.equal(summary.ingested, 1);
    assert.equal(store.rawMessages.length, 1);
  });

  it("identical text from the same sender in the same minute is one message", async () => {
    const { store, ingestor } = setup();
    await ingestor.handle(
      USER,
      [
        textMessage("Bring your ID cards", { id: "A1" }),
        textMessage("bring your id cards", { id: "A2" }),
      ],
      "live",
    );
    assert.equal(store.rawMessages.length, 1);
  });

  it("does not drop distinct messages that merely share a minute", async () => {
    const { store, ingestor } = setup();
    await ingestor.handle(
      USER,
      [textMessage("Quiz on Monday", { id: "A1" }), textMessage("Lab on Tuesday", { id: "A2" })],
      "live",
    );
    assert.equal(store.rawMessages.length, 2);
  });
});

describe("MessageIngestor: robustness", () => {
  it("splits large histories into bounded database calls", async () => {
    const store = new MemoryStore();
    store.groups.set(`${USER}|${GROUP}`, { jid: GROUP, name: "g", active: true });
    const ingestor = new MessageIngestor({ store, logger: silent, activeTtlMs: 0, batchSize: 50 });
    const messages = Array.from({ length: 120 }, (_, i) =>
      textMessage(`Reminder number ${i} about the course`, { id: `M${i}`, ts: 1_795_000_000 + i * 60 }),
    );
    const summary = await ingestor.handle(USER, messages, "history");
    assert.equal(summary.ingested, 120);
    assert.equal(store.ingestCalls, 3);
  });

  it("caches the active-group list briefly and picks up a toggle after the TTL", async () => {
    const store = new MemoryStore();
    let now = 0;
    const ingestor = new MessageIngestor({
      store,
      logger: silent,
      activeTtlMs: 5_000,
      now: () => now,
    });
    const m = (id: string) => textMessage("Assignment due Friday", { id, ts: 1_795_000_000 + Number(id) * 60 });

    assert.equal((await ingestor.handle(USER, [m("1")], "live")).skippedInactive, 1);
    store.groups.set(`${USER}|${GROUP}`, { jid: GROUP, name: "g", active: true });
    now = 1_000;
    assert.equal((await ingestor.handle(USER, [m("2")], "live")).skippedInactive, 1, "still cached");
    now = 6_000;
    assert.equal((await ingestor.handle(USER, [m("3")], "live")).ingested, 1, "refreshed after the TTL");
  });

  it("safeHandle swallows a database failure instead of breaking the socket loop", async () => {
    const { store, ingestor } = setup();
    store.failIngest = true;
    await assert.doesNotReject(ingestor.safeHandle(USER, [textMessage("Quiz on Monday")], "live"));
  });

  it("a failed batch for one user does not block the next", async () => {
    const { store, ingestor } = setup();
    store.failIngest = true;
    await assert.rejects(ingestor.handle(USER, [textMessage("Quiz on Monday", { id: "F1" })], "live"));
    store.failIngest = false;
    assert.equal((await ingestor.handle(USER, [textMessage("Lab on Tuesday", { id: "F2" })], "live")).ingested, 1);
  });
});

describe("MediaCapture", () => {
  it("stores a PDF once: object, document row, extraction queued", async () => {
    const { store, ingestor } = setup();
    const summary = await ingestor.handle(
      USER,
      [documentMessage("Notes Week 3.pdf", PDF_MIME, PDF_BYTES, { caption: "Read this" })],
      "live",
    );
    assert.deepEqual(summary.media, { stored: 1, duplicate: 0, failed: 0 });
    assert.equal(store.documents.length, 1);
    const doc = store.documents[0]!;
    assert.equal(doc.name, "Notes Week 3.pdf");
    assert.equal(doc.fileSha256, sha256Bytes(PDF_BYTES).toString("hex"));
    assert.equal(doc.mimeType, PDF_MIME);
    assert.match(doc.storagePath, new RegExp(`^${USER}/${doc.documentId}/Notes-Week-3\\.pdf$`));
    assert.ok(store.objects.has(doc.storagePath));
    assert.deepEqual(store.extractionQueue, [store.rawMessages[0]!.messageId]);
  });

  it("the same file sent again (new message, new sender) is stored once", async () => {
    const { store, ingestor } = setup();
    await ingestor.handle(USER, [documentMessage("a.pdf", PDF_MIME, PDF_BYTES, { id: "D1" })], "live");
    const again = await ingestor.handle(
      USER,
      [{ ...documentMessage("copy of a.pdf", PDF_MIME, PDF_BYTES, { id: "D2" }), pushName: "Someone Else" } as never],
      "live",
    );
    assert.deepEqual(again.media, { stored: 0, duplicate: 1, failed: 0 });
    assert.equal(store.documents.length, 1);
    assert.equal(store.objects.size, 1);
    assert.equal(store.extractionQueue.length, 1, "no second extraction for a duplicate file");
  });

  it("does not even download a file it already has", async () => {
    let downloads = 0;
    const { store, ingestor } = setup({
      download: async () => {
        downloads += 1;
        return PDF_BYTES;
      },
    });
    await ingestor.handle(USER, [documentMessage("a.pdf", PDF_MIME, PDF_BYTES, { id: "D1" })], "live");
    await ingestor.handle(USER, [documentMessage("a.pdf", PDF_MIME, PDF_BYTES, { id: "D2" })], "live");
    assert.equal(downloads, 1);
    assert.equal(store.documents.length, 1);
  });

  it("captures pptx and images, and keeps unrelated files apart", async () => {
    const files = new Map<string, Uint8Array>([
      ["P1", PPTX_BYTES],
      ["I1", JPEG_BYTES],
    ]);
    const { store, ingestor } = setup({ download: async () => PPTX_BYTES });
    const pptx = documentMessage("Lecture 2.pptx", PPTX_MIME, files.get("P1")!, { id: "P1" });
    const summary = await ingestor.handle(USER, [pptx], "live");
    assert.equal(summary.media.stored, 1);
    assert.equal(store.documents[0]!.mimeType, PPTX_MIME);

    const image = setup({ download: async () => JPEG_BYTES });
    const imgSummary = await image.ingestor.handle(USER, [imageMessage(JPEG_BYTES)], "live");
    assert.equal(imgSummary.media.stored, 1);
    assert.match(image.store.documents[0]!.name, /^whatsapp-image-[0-9a-f]{8}\.jpg$/);
  });

  it("rejects an oversize file before downloading it", async () => {
    let downloads = 0;
    const { store, ingestor } = setup({
      download: async () => {
        downloads += 1;
        return PDF_BYTES;
      },
    });
    const huge = documentMessage("big.pdf", PDF_MIME, PDF_BYTES, { length: MAX_FILE_BYTES + 1 });
    const summary = await ingestor.handle(USER, [huge], "live");
    assert.equal(summary.media.failed, 1);
    assert.equal(downloads, 0);
    assert.equal(store.documents.length, 0);
    assert.deepEqual(store.outcomes.get(store.rawMessages[0]!.messageId), {
      status: "failed",
      error: MEDIA_ERRORS.tooLarge,
    });
  });

  it("rejects bytes that do not match the declared type", async () => {
    const { store, ingestor } = setup({ download: async () => Buffer.from("MZ not a pdf") });
    const summary = await ingestor.handle(
      USER,
      [documentMessage("fake.pdf", PDF_MIME, PDF_BYTES)],
      "live",
    );
    assert.equal(summary.media.failed, 1);
    assert.equal(store.documents.length, 0);
    assert.equal(store.outcomes.get(store.rawMessages[0]!.messageId)?.error, MEDIA_ERRORS.wrongType);
  });

  it("an expired download fails that message only, with a sanitized reason", async () => {
    const { store, ingestor } = setup({
      download: async () => {
        throw new Error("https://mmg.whatsapp.net/secret-url?token=abc 410");
      },
    });
    const summary = await ingestor.handle(
      USER,
      [documentMessage("a.pdf", PDF_MIME, PDF_BYTES), textMessage("Quiz on Monday", { id: "T1" })],
      "live",
    );
    assert.equal(summary.ingested, 2);
    assert.equal(summary.media.failed, 1);
    const reason = store.outcomes.get(store.rawMessages[0]!.messageId)?.error ?? "";
    assert.equal(reason, MEDIA_ERRORS.unavailable);
    assert.doesNotMatch(reason, /whatsapp\.net|token/);
  });

  it("removes the uploaded object when the document insert loses a race", async () => {
    const { store, ingestor } = setup();
    store.insertDocument = async () => "duplicate";
    const summary = await ingestor.handle(USER, [documentMessage("a.pdf", PDF_MIME, PDF_BYTES)], "live");
    assert.equal(summary.media.duplicate, 1);
    assert.equal(store.objects.size, 0, "no orphaned object");
    assert.equal(store.extractionQueue.length, 0);
  });

  it("a storage outage fails the message without crashing ingestion", async () => {
    const { store, ingestor } = setup();
    store.failUpload = true;
    const summary = await ingestor.handle(USER, [documentMessage("a.pdf", PDF_MIME, PDF_BYTES)], "live");
    assert.equal(summary.media.failed, 1);
    assert.equal(store.outcomes.get(store.rawMessages[0]!.messageId)?.error, MEDIA_ERRORS.saveFailed);
  });
});
