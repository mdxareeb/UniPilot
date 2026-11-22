import type { Logger } from "pino";
import { safeError } from "../log.ts";
import type { LinkMethod, SessionStore } from "../store/types.ts";
import { SessionRunner, type RunnerDeps } from "./runner.ts";

export interface ManagerDeps {
  store: SessionStore;
  /** Everything a runner needs except the store (shared across runners). */
  runner: Omit<RunnerDeps, "store">;
  logger: Logger;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  now?: () => number;
}

/**
 * Reconciles `whatsapp_sessions.desired_state` with the sockets this process
 * holds. The web app writes the desired state; this loop makes it true. It
 * polls because Realtime is disabled in the local stack.
 *
 * - desired `connected`, no runner  → start one (QR, or silent reconnect when
 *   credentials are stored);
 * - desired `disconnected`, a runner → stop it and log the device out;
 * - desired `disconnected`, no runner, but the row still says linked → settle
 *   the row (a previous process died mid-session);
 * - every managed session gets a heartbeat, so the UI can tell "bridge not
 *   running" from "not linked".
 */
export class SessionManager {
  private readonly deps: ManagerDeps;
  private readonly runners = new Map<string, SessionRunner>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;
  private lastHeartbeat = 0;
  private closed = false;

  constructor(deps: ManagerDeps) {
    this.deps = deps;
  }

  get managedUserIds(): string[] {
    return [...this.runners.keys()];
  }

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.deps.pollIntervalMs);
  }

  /** Bridge shutdown: keep every link, just stop the sockets. */
  async stop(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    await Promise.all(
      [...this.runners.values()].map((runner) =>
        runner.stop({ logout: false }).catch((error) =>
          this.deps.logger.error(safeError(error), "runner stop failed"),
        ),
      ),
    );
    this.runners.clear();
  }

  /** One reconciliation pass. Exposed for tests; overlapping calls are skipped. */
  async tick(): Promise<void> {
    if (this.ticking || this.closed) return;
    this.ticking = true;
    try {
      const { store, logger } = this.deps;
      const rows = await store.listSessions();
      const byUser = new Map(rows.map((row) => [row.userId, row]));

      // Drop runners that gave up on their own (logged out, QR expired, …).
      for (const [userId, runner] of this.runners) {
        if (runner.isFinished) this.runners.delete(userId);
      }

      let startedAny = false;
      for (const row of rows) {
        const runner = this.runners.get(row.userId);
        if (row.desiredState === "connected") {
          if (!runner) {
            await this.startRunner(row.userId, row.linkMethod);
            startedAny = true;
          }
        } else if (runner) {
          await this.stopRunner(row.userId, runner);
        } else if (row.status !== "disconnected") {
          await store.clearQr(row.userId);
          await store.clearPairing(row.userId);
          await store.updateSession(row.userId, {
            status: "disconnected",
            connectedAt: null,
          });
        }
      }

      // A row deleted under a live runner (account removed): let it go.
      for (const [userId, runner] of this.runners) {
        if (!byUser.has(userId)) await this.stopRunner(userId, runner, false);
      }

      // A newly managed session is stamped at once, so the UI never sees a
      // live link with a stale heartbeat while waiting for the next interval.
      const now = (this.deps.now ?? Date.now)();
      const managed = this.managedUserIds;
      if (
        managed.length > 0 &&
        (startedAny || now - this.lastHeartbeat >= this.deps.heartbeatIntervalMs)
      ) {
        this.lastHeartbeat = now;
        await store.heartbeat(managed);
      }
    } catch (error) {
      this.deps.logger.error(safeError(error), "reconcile pass failed");
    } finally {
      this.ticking = false;
    }
  }

  private async startRunner(userId: string, linkMethod: LinkMethod): Promise<void> {
    const runner = new SessionRunner(
      userId,
      { ...this.deps.runner, store: this.deps.store },
      { linkMethod },
    );
    this.runners.set(userId, runner);
    try {
      await runner.start();
    } catch (error) {
      this.runners.delete(userId);
      this.deps.logger.error(safeError(error), "failed to start a session");
      await this.deps.store.updateSession(userId, {
        status: "disconnected",
        lastError: "The bridge could not start this link. Try again.",
      });
    }
  }

  private async stopRunner(
    userId: string,
    runner: SessionRunner,
    logout = true,
  ): Promise<void> {
    this.runners.delete(userId);
    try {
      await runner.stop({ logout });
    } catch (error) {
      this.deps.logger.error(safeError(error), "failed to stop a session");
    }
  }
}
