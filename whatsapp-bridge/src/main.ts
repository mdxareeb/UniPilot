import { loadConfig } from "./config.ts";
import { discoverGroups } from "./groups/discovery.ts";
import { MessageIngestor } from "./ingest/ingestor.ts";
import { MediaCapture } from "./media/capture.ts";
import { makeDownloader } from "./media/download.ts";
import { createLogger, safeError } from "./log.ts";
import { SessionManager } from "./session/manager.ts";
import { createBaileysSocket } from "./socket/factory.ts";
import { SupabaseSessionStore } from "./store/supabaseStore.ts";
import pino from "pino";

/**
 * Entry point: `npm run bridge` (loads backend/.env). A long-lived process
 * that links WhatsApp accounts and listens, read-only, to the groups each user
 * has switched on. Local-only for now; see whatsapp-bridge/README.md.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  // Baileys is chatty and can embed JIDs in its debug output: keep it at warn.
  const baileysLogger = pino({ level: "warn", base: { service: "baileys" } });

  const store = new SupabaseSessionStore({
    url: config.supabaseUrl,
    serviceRoleKey: config.serviceRoleKey,
    integrationsKey: config.integrationsKey,
  });

  const ingestor = new MessageIngestor({
    store,
    logger,
    media: new MediaCapture({
      store,
      logger,
      download: makeDownloader(baileysLogger),
    }),
  });

  const manager = new SessionManager({
    store,
    logger,
    pollIntervalMs: config.pollIntervalMs,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    runner: {
      logger,
      openSocket: (state) => createBaileysSocket(state, baileysLogger),
      hooks: {
        // Record the account's groups (all OFF) as soon as the link opens.
        onOpen: async (userId, sock) => {
          await discoverGroups(userId, sock, store, logger);
        },
        // Recent history delivered at link time and live messages share one
        // path: only groups the owner switched on are ever stored.
        onHistory: (userId, messages) => ingestor.safeHandle(userId, messages, "history"),
        onUpsert: (userId, messages) => ingestor.safeHandle(userId, messages, "live"),
      },
    },
  });

  manager.start();
  logger.info("whatsapp-bridge started");

  // Captured message text is an input to extraction, not an archive: delete
  // anything older than 30 days at startup and every six hours after. A failure
  // is logged and retried next time; it never affects a live link.
  const purge = async () => {
    try {
      const removed = await store.purgeExpiredMessages();
      if (removed > 0) logger.info({ removed }, "expired messages purged");
    } catch (error) {
      logger.warn(safeError(error), "message purge failed");
    }
  };
  void purge();
  const purgeTimer = setInterval(() => void purge(), 6 * 60 * 60 * 1000);
  purgeTimer.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down (links are kept)");
    await manager.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  // Config errors name the missing variables and nothing else.
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error && name === "ConfigError" ? error.message : "";
  console.error(`whatsapp-bridge failed to start: ${name}${message ? ` - ${message}` : ""}`);
  process.exit(1);
});
