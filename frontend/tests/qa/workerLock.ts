/**
 * A cross-process lock for the specs that share QA1's integration state.
 *
 * `claim_jobs` is global and QA1's integration rows are shared: two spec files
 * driving `worker/run.mjs` (or seeding/asserting absolute QA1 counts, or
 * reading `/integrations`, which triggers the connected-overview push
 * backfill) at the same time claim each other's jobs and race each other's
 * residue checks. The full suite sequences the worker-driving projects
 * through `dependencies`, but a targeted `--no-deps` run selects them together
 * and Playwright parallelizes files — so each spec holds this lock for the
 * window it needs and the shared worker/QA1 state stays single-writer even
 * then. In the full suite the lock is never contended.
 *
 * Existence-based (`.playwright/whatsapp-worker.lock`) with a stale-mtime
 * steal so a crashed run cannot deadlock the next one. Not a test file:
 * `testMatch` never selects this module.
 */
import {
  closeSync,
  mkdirSync,
  openSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const LOCK_DIR = path.join(process.cwd(), ".playwright");
const LOCK_FILE = path.join(LOCK_DIR, "whatsapp-worker.lock");
/** Longer than any healthy holder (both files together run well under a minute). */
const STALE_MS = 240_000;

/** Resolve a release function, or throw when the wait exceeds `timeoutMs`. */
export async function acquireWorkerLock(
  timeoutMs = 300_000,
): Promise<() => void> {
  mkdirSync(LOCK_DIR, { recursive: true });
  const startedAt = Date.now();

  for (;;) {
    try {
      const fd = openSync(LOCK_FILE, "wx");
      writeFileSync(fd, `${process.pid}\n`);
      closeSync(fd);

      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          unlinkSync(LOCK_FILE);
        } catch {
          // Already gone (a stale steal); nothing to release.
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

      try {
        if (Date.now() - statSync(LOCK_FILE).mtimeMs > STALE_MS) {
          unlinkSync(LOCK_FILE);
          continue;
        }
      } catch {
        // The holder released between open and stat; retry immediately.
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          "Timed out waiting for the WhatsApp worker lock; another worker-driving spec did not finish.",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}
