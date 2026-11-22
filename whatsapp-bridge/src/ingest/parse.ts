import { normalizeMessageContent, type WAMessage } from "@whiskeysockets/baileys";
import { isGroupJid } from "../groups/discovery.ts";

export type MediaKind = "pdf" | "pptx" | "docx" | "image";

export interface ParsedMedia {
  type: MediaKind;
  mimetype: string;
  fileName: string | null;
  /** Declared size in bytes, when WhatsApp reports one. */
  size: number | null;
  /**
   * The attachment's SHA-256 (hex) as WhatsApp reports it for the decrypted
   * file. It lets the bridge fingerprint and de-duplicate a file BEFORE
   * downloading it; the real hash is re-computed from the bytes afterwards.
   */
  reportedSha256: string | null;
}

export interface ParsedMessage {
  whatsappMsgId: string;
  groupJid: string;
  /** Display name only; a phone number or LID is never stored as a name. */
  senderName: string;
  sentAt: Date;
  text: string;
  media: ParsedMedia | null;
}

/** Longest message text kept; WhatsApp's own limit is far higher. */
export const MAX_TEXT_LENGTH = 8_000;

const MIME_BY_KIND: Record<string, MediaKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

const EXTENSION_KIND: Record<string, MediaKind> = {
  pdf: "pdf",
  docx: "docx",
  pptx: "pptx",
};

/** Image types the `documents` bucket accepts. */
const IMAGE_MIMES = new Set(["image/jpeg", "image/png"]);

function toSeconds(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && "toNumber" in value) {
    const n = (value as { toNumber(): number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function hexOf(value: unknown): string | null {
  if (!value) return null;
  const bytes =
    value instanceof Uint8Array
      ? value
      : Array.isArray(value)
        ? Uint8Array.from(value as number[])
        : null;
  if (!bytes || bytes.length !== 32) return null;
  return Buffer.from(bytes).toString("hex");
}

function extensionOf(fileName: string | null | undefined): string | null {
  if (!fileName) return null;
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? null : fileName.slice(dot + 1).toLowerCase();
}

function documentKind(
  mimetype: string | null | undefined,
  fileName: string | null | undefined,
): MediaKind | null {
  const byMime = mimetype ? MIME_BY_KIND[mimetype.toLowerCase()] : undefined;
  if (byMime) return byMime;
  // Some clients send documents as application/octet-stream; trust the name.
  if (!mimetype || mimetype.toLowerCase() === "application/octet-stream") {
    const ext = extensionOf(fileName);
    if (ext && EXTENSION_KIND[ext]) return EXTENSION_KIND[ext];
  }
  return null;
}

/**
 * Reduce a Baileys message to what the pipeline needs, or `null` when it is not
 * a capturable group message (a DM, a reaction, a protocol/system message, a
 * video, a sticker, or one with no timestamp).
 *
 * Only a display name is kept for the sender (`pushName`): phone numbers and
 * LIDs identify people outside the group and are never persisted.
 */
export function parseGroupMessage(msg: WAMessage): ParsedMessage | null {
  const groupJid = msg.key?.remoteJid;
  const id = msg.key?.id;
  if (!isGroupJid(groupJid) || !id) return null;

  const seconds = toSeconds(msg.messageTimestamp);
  if (seconds === null || seconds <= 0) return null;

  const content = normalizeMessageContent(msg.message ?? undefined);
  if (!content) return null;

  let text = "";
  let media: ParsedMedia | null = null;

  if (typeof content.conversation === "string") {
    text = content.conversation;
  } else if (content.extendedTextMessage?.text) {
    text = content.extendedTextMessage.text;
  } else if (content.documentMessage) {
    const doc = content.documentMessage;
    text = doc.caption ?? "";
    const kind = documentKind(doc.mimetype, doc.fileName);
    if (kind) {
      media = {
        type: kind,
        mimetype: doc.mimetype ?? "application/octet-stream",
        fileName: doc.fileName ?? null,
        size: toSeconds(doc.fileLength),
        reportedSha256: hexOf(doc.fileSha256),
      };
    }
  } else if (content.imageMessage) {
    const img = content.imageMessage;
    text = img.caption ?? "";
    if (img.mimetype && IMAGE_MIMES.has(img.mimetype.toLowerCase())) {
      media = {
        type: "image",
        mimetype: img.mimetype.toLowerCase(),
        fileName: null,
        size: toSeconds(img.fileLength),
        reportedSha256: hexOf(img.fileSha256),
      };
    }
  } else {
    // reactions, protocol messages, stickers, video, audio, polls, ...
    return null;
  }

  text = text.trim().slice(0, MAX_TEXT_LENGTH);
  if (!text && !media) return null;

  return {
    whatsappMsgId: id,
    groupJid,
    senderName: (msg.pushName ?? "").trim().slice(0, 100) || "Unknown member",
    sentAt: new Date(seconds * 1000),
    text,
    media,
  };
}

/**
 * Cheap first-stage chatter filter: nothing a student would act on has fewer
 * than three characters or no letter/digit at all (emoji-only, "...", "ok").
 * Deliberately generous: real short deadlines ("Quiz 2pm") must survive, so
 * everything else is left to the model.
 */
export function isTrivialText(text: string, hasMedia: boolean): boolean {
  if (hasMedia) return false;
  const t = text.trim();
  if (t.length < 3) return true;
  return !/[\p{L}\p{N}]/u.test(t);
}
