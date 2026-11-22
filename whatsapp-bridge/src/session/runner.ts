import { DisconnectReason, type WAMessage } from "@whiskeysockets/baileys";
import type { AuthenticationState } from "@whiskeysockets/baileys";
import type { Logger } from "pino";
import { useDbAuthState } from "../auth/dbAuthState.ts";
import { safeError } from "../log.ts";
import { sanitizePhone } from "../pairing/phone.ts";
import {
  makeReadOnlySocket,
  type RawSocketLike,
  type ReadOnlySocket,
} from "../socket/readOnly.ts";
import type { LinkMethod, SessionStatus, SessionStore } from "../store/types.ts";

/** Hooks the ingestion layers (groups, messages) attach to a running session. */
export interface RunnerHooks {
  /** The link just became (or became again) fully connected. */
  onOpen?(userId: string, sock: ReadOnlySocket): Promise<void> | void;
  /** `messaging-history.set`: recent history delivered at link time. */
  onHistory?(userId: string, messages: WAMessage[]): Promise<void> | void;
  /** `messages.upsert`: live incoming messages. */
  onUpsert?(userId: string, messages: WAMessage[], type: string): Promise<void> | void;
}

export interface RunnerDeps {
  store: SessionStore;
  /** Builds the raw socket (the real one in production, a fake in tests). */
  openSocket(state: AuthenticationState): RawSocketLike;
  logger: Logger;
  hooks?: RunnerHooks;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Reconnect delay for the nth consecutive failure (1-based). */
  backoffMs?: (attempt: number) => number;
  /** Consecutive failed reconnects before the session is given up. */
  maxReconnectAttempts?: number;
}

export const QR_TTL_SECONDS = 60;
/** How long the pairing code is shown. WhatsApp's own code is short-lived. */
export const PAIRING_CODE_TTL_SECONDS = 120;

/** Sanitized, user-facing copy stored in `whatsapp_sessions.last_error`. */
export const SESSION_MESSAGES = {
  loggedOut: "WhatsApp unlinked this device. Link it again to continue.",
  qrExpired: "The QR code expired before it was scanned. Request a new one.",
  codeExpired: "The pairing code expired before it was used. Request a new one.",
  noNumber: "No phone number was provided. Enter your number to get a pairing code.",
  pairingFailed: "WhatsApp did not accept that number. Check it and try again.",
  replaced: "This WhatsApp link was opened somewhere else. Link it again to continue.",
  rejected: "WhatsApp refused the connection. Link the device again.",
  lost: "Lost the connection to WhatsApp. Link it again to continue.",
} as const;

interface ConnectionUpdate {
  connection?: "open" | "connecting" | "close";
  qr?: string;
  lastDisconnect?: { error?: unknown } | undefined;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const defaultBackoff = (attempt: number) => Math.min(1000 * 2 ** (attempt - 1), 60_000);

function statusCodeOf(update: ConnectionUpdate): number | undefined {
  const error = update.lastDisconnect?.error as
    | { output?: { statusCode?: number } }
    | undefined;
  return error?.output?.statusCode;
}

/**
 * One linked WhatsApp session: owns the socket, keeps it alive, publishes the
 * QR and the status, and tears everything down on disconnect.
 */
export class SessionRunner {
  readonly userId: string;
  private readonly deps: RunnerDeps;
  private readonly log: Logger;
  private sock: ReadOnlySocket | undefined;
  private generation = 0;
  private stopping = false;
  private finished = false;
  private attempt = 0;
  private lastStatus: SessionStatus = "disconnected";
  private readonly linkMethod: LinkMethod;
  /** Whether the stored credentials already belong to a linked account. */
  private registered = false;
  /** One pairing code per socket: asking again would invalidate the first. */
  private codeRequested = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(userId: string, deps: RunnerDeps, options: { linkMethod?: LinkMethod } = {}) {
    this.userId = userId;
    this.linkMethod = options.linkMethod ?? "qr";
    this.deps = deps;
    this.log = deps.logger.child({ user: userId.slice(0, 8) });
  }

  /** True once the runner has stopped itself or been stopped; drop it then. */
  get isFinished(): boolean {
    return this.finished;
  }

  async start(): Promise<void> {
    await this.connect();
  }

  /**
   * `logout: true` is the user's "disconnect": unlink the device and forget
   * every secret. `logout: false` is a bridge shutdown: keep the link.
   */
  async stop(options: { logout: boolean }): Promise<void> {
    if (this.finished) return;
    this.stopping = true;
    this.generation += 1;
    const sock = this.sock;
    this.sock = undefined;
    if (options.logout) {
      if (sock) {
        try {
          await sock.logout();
        } catch (error) {
          // Not connected (or already unlinked): the local forget below is
          // what matters.
          this.log.warn(safeError(error), "logout did not complete");
        }
      }
      await this.deps.store.clearSession(this.userId);
      await this.deps.store.updateSession(this.userId, {
        status: "disconnected",
        connectedAt: null,
        lastError: null,
      });
      this.lastStatus = "disconnected";
    } else if (sock) {
      try {
        sock.end(undefined);
      } catch {
        /* already closed */
      }
    }
    this.finished = true;
  }

  private async connect(): Promise<void> {
    const generation = ++this.generation;
    const { state, saveCreds } = await useDbAuthState(this.userId, this.deps.store);
    if (this.stopping || generation !== this.generation) return;
    this.registered = state.creds.registered === true;
    this.codeRequested = false;

    const sock = makeReadOnlySocket(this.deps.openSocket(state));
    this.sock = sock;

    sock.ev.on("creds.update", () => {
      saveCreds().catch((error) =>
        this.log.error(safeError(error), "failed to persist credentials"),
      );
    });

    sock.ev.on("connection.update", (update: ConnectionUpdate) => {
      if (generation !== this.generation) return;
      // Serialise updates: a `qr` and the `open` that follows must not race.
      this.chain = this.chain
        .then(() => this.onConnection(update, generation))
        .catch((error) => this.log.error(safeError(error), "connection update failed"));
    });

    const hooks = this.deps.hooks;
    if (hooks?.onHistory) {
      sock.ev.on("messaging-history.set", (data: { messages?: WAMessage[] }) => {
        if (generation !== this.generation) return;
        Promise.resolve(hooks.onHistory?.(this.userId, data.messages ?? [])).catch(
          (error) => this.log.error(safeError(error), "history hook failed"),
        );
      });
    }
    if (hooks?.onUpsert) {
      sock.ev.on(
        "messages.upsert",
        (data: { messages?: WAMessage[]; type?: string }) => {
          if (generation !== this.generation) return;
          Promise.resolve(
            hooks.onUpsert?.(this.userId, data.messages ?? [], data.type ?? "notify"),
          ).catch((error) => this.log.error(safeError(error), "upsert hook failed"));
        },
      );
    }
  }

  private async onConnection(update: ConnectionUpdate, generation: number): Promise<void> {
    if (generation !== this.generation || this.stopping) return;
    const { store } = this.deps;
    const now = (this.deps.now ?? (() => new Date()))();

    if (update.qr) {
      if (this.linkMethod === "pairing_code") {
        // The mobile flow: a QR shown on the phone cannot be scanned by the same
        // phone, so ask WhatsApp for a pairing code instead and never publish
        // the QR. The first `qr` event is the signal the socket is ready to pair.
        await this.publishPairingCode();
      } else {
        await store.setQr(this.userId, update.qr, QR_TTL_SECONDS);
        await store.updateSession(this.userId, { status: "qr_ready", lastError: null });
        this.lastStatus = "qr_ready";
        this.log.info("QR ready");
      }
    }

    if (update.connection === "open") {
      this.attempt = 0;
      await store.clearQr(this.userId);
      // Linked: the number and the code have done their job. Forget them now.
      await store.clearPairing(this.userId);
      await store.updateSession(this.userId, {
        status: "connected",
        connectedAt: now,
        lastError: null,
      });
      this.lastStatus = "connected";
      this.log.info("connected");
      const hook = this.deps.hooks?.onOpen;
      if (hook && this.sock) {
        try {
          await hook(this.userId, this.sock);
        } catch (error) {
          this.log.error(safeError(error), "open hook failed");
        }
      }
      return;
    }

    if (update.connection === "close") {
      await this.onClose(statusCodeOf(update));
    }
  }

  /** Ask WhatsApp for the pairing code for the stored number, once per socket. */
  private async publishPairingCode(): Promise<void> {
    if (this.codeRequested || this.registered) return;
    this.codeRequested = true;
    const { store } = this.deps;

    const phone = sanitizePhone(await store.getPairingPhone(this.userId));
    if (!phone.ok) {
      await this.giveUp(SESSION_MESSAGES.noNumber);
      return;
    }
    const sock = this.sock;
    if (!sock) return;

    let code: string;
    try {
      code = await sock.requestPairingCode(phone.digits);
    } catch (error) {
      this.log.warn(safeError(error), "pairing code request failed");
      await this.giveUp(SESSION_MESSAGES.pairingFailed);
      return;
    }
    await store.setPairingCode(this.userId, code, PAIRING_CODE_TTL_SECONDS);
    await store.updateSession(this.userId, { status: "code_ready", lastError: null });
    this.lastStatus = "code_ready";
    this.log.info("pairing code ready");
  }

  private async onClose(code: number | undefined): Promise<void> {
    if (this.stopping) return;
    this.log.info({ code }, "connection closed");

    if (code === DisconnectReason.loggedOut) {
      // The phone unlinked this device: the stored session is worthless.
      await this.deps.store.clearSession(this.userId);
      await this.giveUp(SESSION_MESSAGES.loggedOut);
      return;
    }

    if (code === DisconnectReason.restartRequired) {
      // Expected right after a QR scan: reopen with the freshly saved creds.
      // The scan happened, so a later timeout is a lost connection, not an
      // unscanned QR.
      this.lastStatus = "disconnected";
      await this.reconnect(0);
      return;
    }

    if (code === DisconnectReason.connectionReplaced) {
      await this.giveUp(SESSION_MESSAGES.replaced);
      return;
    }

    if (code === DisconnectReason.forbidden || code === DisconnectReason.multideviceMismatch) {
      await this.giveUp(SESSION_MESSAGES.rejected);
      return;
    }

    if (this.lastStatus === "qr_ready" || this.lastStatus === "code_ready") {
      // Nobody scanned / entered the code: stop instead of looping forever.
      await this.giveUp(
        this.lastStatus === "code_ready"
          ? SESSION_MESSAGES.codeExpired
          : SESSION_MESSAGES.qrExpired,
      );
      return;
    }

    this.attempt += 1;
    const max = this.deps.maxReconnectAttempts ?? 8;
    if (this.attempt > max) {
      await this.giveUp(SESSION_MESSAGES.lost);
      return;
    }
    await this.reconnect((this.deps.backoffMs ?? defaultBackoff)(this.attempt));
  }

  private async reconnect(delayMs: number): Promise<void> {
    const old = this.sock;
    this.sock = undefined;
    this.generation += 1; // detaches the old socket's listeners
    if (old) {
      try {
        old.end(undefined);
      } catch {
        /* already closed */
      }
    }
    if (delayMs > 0) await (this.deps.sleep ?? defaultSleep)(delayMs);
    if (this.stopping) return;
    await this.connect();
  }

  /** Stop for good and tell the user why. The creds are kept unless cleared. */
  private async giveUp(message: string): Promise<void> {
    this.stopping = true;
    this.generation += 1;
    const sock = this.sock;
    this.sock = undefined;
    if (sock) {
      try {
        sock.end(undefined);
      } catch {
        /* already closed */
      }
    }
    await this.deps.store.clearQr(this.userId);
    await this.deps.store.clearPairing(this.userId);
    await this.deps.store.updateSession(this.userId, {
      status: "disconnected",
      desiredState: "disconnected",
      connectedAt: null,
      lastError: message,
    });
    this.lastStatus = "disconnected";
    this.finished = true;
    this.log.warn("session stopped");
  }
}
