import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WAMessage } from "@whiskeysockets/baileys";
import {
  computeFingerprint,
  floorToMinute,
  normalizeText,
} from "../src/ingest/fingerprint.ts";
import { isTrivialText, MAX_TEXT_LENGTH, parseGroupMessage } from "../src/ingest/parse.ts";
import {
  DOCX_BYTES,
  DOCX_MIME,
  documentMessage,
  GROUP,
  imageMessage,
  JPEG_BYTES,
  PDF_BYTES,
  PDF_MIME,
  PPTX_BYTES,
  PPTX_MIME,
  sha256Bytes,
  textMessage,
} from "./helpers/messages.ts";

describe("fingerprint", () => {
  const base = {
    userId: "u1",
    groupJid: GROUP,
    senderName: "Prof Rao",
    sentAt: new Date("2026-11-18T10:00:05Z"),
    textOrFileSha256: "Assignment 3 due Friday",
  };

  it("is a 64-char sha256 hex", () => {
    assert.match(computeFingerprint(base), /^[0-9a-f]{64}$/);
  });

  it("is stable for the same message and floors to the minute", () => {
    const a = computeFingerprint(base);
    assert.equal(computeFingerprint({ ...base }), a);
    assert.equal(computeFingerprint({ ...base, sentAt: new Date("2026-11-18T10:00:59.999Z") }), a);
    assert.notEqual(computeFingerprint({ ...base, sentAt: new Date("2026-11-18T10:01:00Z") }), a);
  });

  it("ignores cosmetic differences in the text", () => {
    const a = computeFingerprint(base);
    assert.equal(
      computeFingerprint({ ...base, textOrFileSha256: "  ASSIGNMENT   3 due\nFriday " }),
      a,
    );
  });

  it("separates users, groups, senders and content", () => {
    const a = computeFingerprint(base);
    assert.notEqual(computeFingerprint({ ...base, userId: "u2" }), a);
    assert.notEqual(computeFingerprint({ ...base, groupJid: "other@g.us" }), a);
    assert.notEqual(computeFingerprint({ ...base, senderName: "Someone Else" }), a);
    assert.notEqual(computeFingerprint({ ...base, textOrFileSha256: "Assignment 4" }), a);
  });

  it("does not let adjacent fields blur together", () => {
    const a = computeFingerprint({ ...base, groupJid: "a@g.us", senderName: "bc" });
    const b = computeFingerprint({ ...base, groupJid: "a@g.usb", senderName: "c" });
    assert.notEqual(a, b);
  });

  it("uses a file hash verbatim (case-insensitive hex) instead of normalising it as text", () => {
    const sha = "AB".repeat(32);
    const a = computeFingerprint({ ...base, textOrFileSha256: sha, isFileHash: true });
    const b = computeFingerprint({ ...base, textOrFileSha256: sha.toLowerCase(), isFileHash: true });
    assert.equal(a, b);
  });

  it("normalizeText / floorToMinute", () => {
    assert.equal(normalizeText("  Ａｂｃ \t Def "), "abc def");
    assert.equal(floorToMinute(new Date("2026-11-18T10:00:59Z")), Date.parse("2026-11-18T10:00:00Z"));
  });
});

describe("parseGroupMessage", () => {
  it("parses a plain group text", () => {
    const parsed = parseGroupMessage(textMessage("Assignment 3 due Friday"))!;
    assert.equal(parsed.groupJid, GROUP);
    assert.equal(parsed.whatsappMsgId, "MSG-1");
    assert.equal(parsed.senderName, "Prof Rao");
    assert.equal(parsed.text, "Assignment 3 due Friday");
    assert.equal(parsed.media, null);
    assert.equal(parsed.sentAt.toISOString(), "2026-11-18T10:00:05.000Z");
  });

  it("parses extended text and Long-like timestamps", () => {
    const parsed = parseGroupMessage(
      textMessage("see https://example.test", {
        extended: true,
        ts: { toNumber: () => 1_795_000_000 },
      }),
    )!;
    assert.equal(parsed.text, "see https://example.test");
    assert.equal(parsed.sentAt.getTime(), 1_795_000_000_000);
  });

  it("never stores a phone number or LID as a sender name", () => {
    const parsed = parseGroupMessage(textMessage("Quiz on Monday", { pushName: null }))!;
    assert.equal(parsed.senderName, "Unknown member");
  });

  it("rejects DMs, broadcasts and newsletters", () => {
    for (const jid of ["1555@s.whatsapp.net", "status@broadcast", "1@newsletter"]) {
      assert.equal(parseGroupMessage(textMessage("hello there", { jid })), null, jid);
    }
  });

  it("rejects messages with no id, no timestamp or no content", () => {
    assert.equal(parseGroupMessage({ ...textMessage("hello"), key: { remoteJid: GROUP } } as WAMessage), null);
    assert.equal(parseGroupMessage(textMessage("hello", { ts: null })), null);
    assert.equal(parseGroupMessage({ ...textMessage("hello"), message: null } as WAMessage), null);
  });

  it("rejects reactions, protocol messages and stickers", () => {
    for (const message of [
      { reactionMessage: { text: "👍" } },
      { protocolMessage: { type: 0 } },
      { stickerMessage: { mimetype: "image/webp" } },
      { videoMessage: { mimetype: "video/mp4", caption: "clip" } },
    ]) {
      assert.equal(parseGroupMessage({ ...textMessage("x"), message } as unknown as WAMessage), null);
    }
  });

  it("unwraps ephemeral and view-once wrappers", () => {
    const wrapped = {
      ...textMessage("x"),
      message: { ephemeralMessage: { message: { conversation: "Exam on 5 Dec" } } },
    } as unknown as WAMessage;
    assert.equal(parseGroupMessage(wrapped)!.text, "Exam on 5 Dec");
  });

  it("caps very long text", () => {
    const parsed = parseGroupMessage(textMessage("a".repeat(MAX_TEXT_LENGTH + 500)))!;
    assert.equal(parsed.text.length, MAX_TEXT_LENGTH);
  });

  it("recognises pdf, docx and pptx documents, with the reported sha-256", () => {
    const pdf = parseGroupMessage(documentMessage("Notes Week 3.pdf", PDF_MIME, PDF_BYTES))!;
    assert.equal(pdf.media!.type, "pdf");
    assert.equal(pdf.media!.fileName, "Notes Week 3.pdf");
    assert.equal(pdf.media!.reportedSha256, sha256Bytes(PDF_BYTES).toString("hex"));
    assert.equal(pdf.media!.size, PDF_BYTES.byteLength);

    assert.equal(parseGroupMessage(documentMessage("a.docx", DOCX_MIME, DOCX_BYTES))!.media!.type, "docx");
    assert.equal(parseGroupMessage(documentMessage("a.pptx", PPTX_MIME, PPTX_BYTES))!.media!.type, "pptx");
  });

  it("falls back to the extension for octet-stream documents only", () => {
    const octet = parseGroupMessage(documentMessage("slides.pptx", "application/octet-stream", PPTX_BYTES))!;
    assert.equal(octet.media!.type, "pptx");
    const unknown = parseGroupMessage(
      documentMessage("tool.exe", "application/octet-stream", PDF_BYTES, { caption: "run this" }),
    )!;
    assert.equal(unknown.media, null, "an unsupported file keeps its caption but is not media");
  });

  it("accepts jpeg/png images, not other image types", () => {
    assert.equal(parseGroupMessage(imageMessage(JPEG_BYTES))!.media!.type, "image");
    assert.equal(parseGroupMessage(imageMessage(JPEG_BYTES, { mimetype: "image/png" }))!.media!.type, "image");
    assert.equal(
      parseGroupMessage(imageMessage(JPEG_BYTES, { mimetype: "image/webp", caption: "look" }))!.media,
      null,
    );
  });

  it("keeps a document's caption as the message text", () => {
    const parsed = parseGroupMessage(
      documentMessage("a.pdf", PDF_MIME, PDF_BYTES, { caption: "Read before Monday" }),
    )!;
    assert.equal(parsed.text, "Read before Monday");
  });

  it("drops an unsupported attachment with no caption entirely", () => {
    assert.equal(parseGroupMessage(documentMessage("virus.exe", "application/x-msdownload", PDF_BYTES)), null);
  });
});

describe("isTrivialText", () => {
  it("drops obvious chatter", () => {
    for (const t of ["", "ok", "👍", "...", "!!!", "😂😂😂"]) assert.equal(isTrivialText(t, false), true, t);
  });

  it("keeps short real deadlines and anything with media", () => {
    for (const t of ["Quiz 2pm", "Exam 5/12", "lab 3", "no class tmrw"]) assert.equal(isTrivialText(t, false), false, t);
    assert.equal(isTrivialText("", true), false);
    assert.equal(isTrivialText("ok", true), false);
  });
});
