import makeWASocket, {
  Browsers,
  makeCacheableSignalKeyStore,
  type AuthenticationState,
} from "@whiskeysockets/baileys";
import type { Logger } from "pino";
import type { RawSocketLike } from "./readOnly.ts";

/**
 * Builds the raw Baileys socket. This is the ONLY module that touches
 * `makeWASocket`; everything else receives the read-only wrapper.
 *
 * Settings that matter for a passive listener:
 * - `markOnlineOnConnect: false`: never announce presence;
 * - `syncFullHistory: false`: ask only for the recent-history window WhatsApp
 *   offers at link time, not the whole archive;
 * - `generateHighQualityLinkPreview: false`: no outbound link fetching;
 * - `getMessage` returns undefined: the bridge never sends, so there is no
 *   outbound message to re-encrypt for a retry.
 */
export function createBaileysSocket(
  state: AuthenticationState,
  logger: Logger,
): RawSocketLike {
  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    browser: Browsers.macOS("Desktop"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    getMessage: async () => undefined,
  });
  return sock as unknown as RawSocketLike;
}
