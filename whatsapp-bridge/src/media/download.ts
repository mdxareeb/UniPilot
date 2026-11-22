import { downloadMediaMessage, type WAMessage } from "@whiskeysockets/baileys";
import type { Logger } from "pino";
import { MediaUnavailableError, type Downloader } from "./capture.ts";

/**
 * The production downloader. WhatsApp can ask the sender's phone to re-upload an
 * attachment whose URL has expired; that is an outbound request, so the bridge
 * refuses it: an expired file is reported as unavailable and never requested
 * again. This is what keeps media capture as passive as the rest of the bridge.
 */
export function makeDownloader(logger: Logger): Downloader {
  return async (raw: WAMessage) => {
    const bytes = await downloadMediaMessage(
      raw,
      "buffer",
      {},
      {
        logger,
        reuploadRequest: async () => {
          throw new MediaUnavailableError("expired; re-upload is never requested");
        },
      },
    );
    return bytes as Uint8Array;
  };
}
