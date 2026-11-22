import { createHash } from "node:crypto";
import type { WAMessage } from "@whiskeysockets/baileys";

/** FAKE WhatsApp messages shaped like Baileys' `WAMessage`. */

export const GROUP = "120363000000000001@g.us";
export const OTHER_GROUP = "120363000000000002@g.us";
const T0 = Date.UTC(2026, 10, 18, 10, 0, 5) / 1000; // 2026-11-18 10:00:05Z

export function sha256Bytes(data: Uint8Array | string): Buffer {
  return createHash("sha256").update(data).digest();
}

export function textMessage(
  text: string,
  overrides: {
    id?: string;
    jid?: string;
    pushName?: string | null;
    ts?: number | null | { toNumber(): number };
    extended?: boolean;
  } = {},
): WAMessage {
  const message =
    overrides.extended === true
      ? { extendedTextMessage: { text } }
      : { conversation: text };
  return {
    key: { remoteJid: overrides.jid ?? GROUP, id: overrides.id ?? "MSG-1", fromMe: false },
    pushName: overrides.pushName === undefined ? "Prof Rao" : (overrides.pushName ?? undefined),
    messageTimestamp: (overrides.ts === undefined ? T0 : overrides.ts) as never,
    message,
  } as unknown as WAMessage;
}

export function documentMessage(
  fileName: string,
  mimetype: string,
  bytes: Uint8Array,
  overrides: { id?: string; jid?: string; caption?: string; reportSha?: boolean; length?: number } = {},
): WAMessage {
  return {
    key: { remoteJid: overrides.jid ?? GROUP, id: overrides.id ?? "DOC-1", fromMe: false },
    pushName: "Prof Rao",
    messageTimestamp: T0,
    message: {
      documentMessage: {
        fileName,
        mimetype,
        caption: overrides.caption,
        fileLength: overrides.length ?? bytes.byteLength,
        fileSha256: overrides.reportSha === false ? undefined : sha256Bytes(bytes),
      },
    },
  } as unknown as WAMessage;
}

export function imageMessage(
  bytes: Uint8Array,
  overrides: { id?: string; mimetype?: string; caption?: string } = {},
): WAMessage {
  return {
    key: { remoteJid: GROUP, id: overrides.id ?? "IMG-1", fromMe: false },
    pushName: "Prof Rao",
    messageTimestamp: T0,
    message: {
      imageMessage: {
        mimetype: overrides.mimetype ?? "image/jpeg",
        caption: overrides.caption,
        fileLength: bytes.byteLength,
        fileSha256: sha256Bytes(bytes),
      },
    },
  } as unknown as WAMessage;
}

export const PDF_BYTES = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
export const DOCX_BYTES = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("word/document.xml")]);
export const PPTX_BYTES = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("ppt/slides/slide1.xml")]);
export const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("JFIF-image")]);
export const PDF_MIME = "application/pdf";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
