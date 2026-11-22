import { createHash, randomUUID } from "node:crypto";
import type { WAMessage } from "@whiskeysockets/baileys";
import type { Logger } from "pino";
import { safeError } from "../log.ts";
import type { MediaKind, ParsedMedia } from "../ingest/parse.ts";
import type { IngestedRow, SessionStore } from "../store/types.ts";

/** The `documents` bucket's own limit (25 MiB); enforced here before and after download. */
export const MAX_FILE_BYTES = 26_214_400;

/** Sanitized, user-facing reasons stored in `raw_messages.error`. */
export const MEDIA_ERRORS = {
  tooLarge: "The file is larger than the 25 MB limit.",
  unavailable: "The file could not be downloaded; WhatsApp may have expired it.",
  wrongType: "The file's contents did not match its type.",
  saveFailed: "The file could not be saved.",
} as const;

export class MediaUnavailableError extends Error {
  override readonly name = "MediaUnavailableError";
}

/** Downloads the decrypted bytes of an attachment. Injected so tests need no network. */
export type Downloader = (raw: WAMessage) => Promise<Uint8Array>;

export type CaptureOutcome = "stored" | "duplicate" | "failed";

const EXTENSION: Record<MediaKind, string> = {
  pdf: "pdf",
  docx: "docx",
  pptx: "pptx",
  image: "jpg",
};

/** Magic-byte check: the declared type must match what actually arrived. */
export function matchesMagic(kind: MediaKind, bytes: Uint8Array, mimetype?: string): boolean {
  const startsWith = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  switch (kind) {
    case "pdf": {
      const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
      return head.includes("%PDF-");
    }
    case "docx":
    case "pptx":
      return startsWith(0x50, 0x4b, 0x03, 0x04); // a ZIP container
    case "image":
      return mimetype === "image/png"
        ? startsWith(0x89, 0x50, 0x4e, 0x47)
        : startsWith(0xff, 0xd8, 0xff);
  }
}

/** The name shown in the app: the sender's file name, cleaned, or a neutral one. */
export function displayName(fileName: string | null, kind: MediaKind, sha256: string): string {
  const base = (fileName ?? "")
    .split(/[\\/]/)
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 150);
  if (base) return base;
  return `whatsapp-${kind}-${sha256.slice(0, 8)}.${EXTENSION[kind]}`;
}

/** The object-key segment: ASCII, no separators, bounded. */
export function storageName(name: string, kind: MediaKind, sha256: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+/, "")
    .slice(0, 100);
  return cleaned || `file-${sha256.slice(0, 8)}.${EXTENSION[kind]}`;
}

interface CaptureDeps {
  store: SessionStore;
  download: Downloader;
  logger: Logger;
  newId?: () => string;
}

/**
 * Captures one attachment the moment its message is ingested, before WhatsApp's
 * media URL can expire.
 *
 * Order matters for cost and safety: oversize and already-stored files are
 * rejected BEFORE the download (using the size and SHA-256 WhatsApp reports),
 * the real bytes are then re-hashed and type-checked, the object is uploaded
 * under the owner's folder, the `documents` row is inserted, and only then is
 * extraction queued. Every failure leaves a sanitized reason on the message
 * and never throws into the ingestion loop.
 */
export class MediaCapture {
  private readonly deps: CaptureDeps;

  constructor(deps: CaptureDeps) {
    this.deps = deps;
  }

  async capture(
    userId: string,
    row: IngestedRow,
    media: ParsedMedia,
    raw: WAMessage,
  ): Promise<CaptureOutcome> {
    const { store, logger } = this.deps;
    const fail = async (reason: string): Promise<CaptureOutcome> => {
      await store.setMessageStatus(userId, row.messageId, "failed", reason).catch((error) =>
        logger.error(safeError(error), "could not record a media failure"),
      );
      return "failed";
    };

    try {
      if (media.size !== null && media.size > MAX_FILE_BYTES) {
        return await fail(MEDIA_ERRORS.tooLarge);
      }

      // Already stored (a forward, a re-send, a replay under a new message id)?
      if (media.reportedSha256) {
        const existing = await store.findDocumentByHash(userId, media.reportedSha256);
        if (existing) {
          await store.setMessageStatus(userId, row.messageId, "processed");
          return "duplicate";
        }
      }

      let bytes: Uint8Array;
      try {
        bytes = await this.deps.download(raw);
      } catch (error) {
        logger.warn(safeError(error), "media download failed");
        return await fail(MEDIA_ERRORS.unavailable);
      }

      if (bytes.byteLength > MAX_FILE_BYTES) return await fail(MEDIA_ERRORS.tooLarge);
      if (!matchesMagic(media.type, bytes, media.mimetype)) {
        return await fail(MEDIA_ERRORS.wrongType);
      }

      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const existing = await store.findDocumentByHash(userId, sha256);
      if (existing) {
        await store.setMessageStatus(userId, row.messageId, "processed");
        return "duplicate";
      }

      const documentId = (this.deps.newId ?? randomUUID)();
      const name = displayName(media.fileName, media.type, sha256);
      const storagePath = `${userId}/${documentId}/${storageName(name, media.type, sha256)}`;

      await store.uploadDocumentObject(storagePath, bytes, media.mimetype);
      const inserted = await store.insertDocument(userId, {
        documentId,
        name,
        storagePath,
        mimeType: media.mimetype,
        sizeBytes: bytes.byteLength,
        fileSha256: sha256,
        sourceMessageId: row.messageId,
      });

      if (inserted === "duplicate") {
        // Lost a race with another capture of the same bytes: keep one copy.
        await store.removeDocumentObject(storagePath).catch(() => undefined);
        await store.setMessageStatus(userId, row.messageId, "processed");
        return "duplicate";
      }

      await store.enqueueExtraction(userId, row.messageId);
      return "stored";
    } catch (error) {
      logger.error(safeError(error), "media capture failed");
      return await fail(MEDIA_ERRORS.saveFailed);
    }
  }
}
