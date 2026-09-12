#!/usr/bin/env node
/**
 * Task 29.1 — the UniPilot background worker.
 *
 * Packaging decision (recorded in TASK.md 29.1): a plain Node ESM entry point
 * under `backend/worker/`, run from the backend package —
 *
 *     npm run worker -w backend            # continuous loop (local stack env)
 *     npm run worker:once -w backend       # claim one batch, process, exit
 *
 * or directly with any environment:
 *
 *     node backend/worker/run.mjs [--once] [--worker-id=NAME] [--limit=N]
 *
 * No build step and no new workspace: the file imports the same
 * `@supabase/supabase-js` the app uses (declared in `backend/package.json`),
 * and production supplies `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
 * through the platform's secret store. The service-role key is read once,
 * used only in the Supabase client, and never printed — logs carry the job
 * id, kind, attempt and status only.
 *
 * Lifecycle: claim (`claim_jobs`, atomic, with stale-lock reclaim) → dispatch
 * by `kind` through `handlers.mjs` → settle (`finish_job`: succeeded, or a
 * retry with backoff, or `failed`/`dead_letter`). Empty claims sleep with a
 * small idle backoff. SIGINT/SIGTERM stop claiming after the current batch;
 * `--once` runs exactly one claim→process cycle and exits (0 ok, 1 when the
 * claim itself failed), which is what the committed spec drives.
 */
import process from "node:process";
import { hostname } from "node:os";
import { createClient } from "@supabase/supabase-js";
import { handlers } from "./handlers.mjs";

const DEFAULT_LIMIT = 5;
const DEFAULT_IDLE_MS = 2_000;
const CLAIM_ERROR_BACKOFF_MS = 5_000;

function parseArgs(argv) {
  const options = {
    once: false,
    limit: DEFAULT_LIMIT,
    idleMs: DEFAULT_IDLE_MS,
    workerId: `worker-${hostname()}-${process.pid}`,
  };

  for (const arg of argv) {
    if (arg === "--once") options.once = true;
    else if (arg.startsWith("--limit=")) {
      const parsed = Number.parseInt(arg.slice("--limit=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0) options.limit = parsed;
    } else if (arg.startsWith("--idle-ms=")) {
      const parsed = Number.parseInt(arg.slice("--idle-ms=".length), 10);
      if (Number.isFinite(parsed) && parsed >= 0) options.idleMs = parsed;
    } else if (arg.startsWith("--worker-id=")) {
      const value = arg.slice("--worker-id=".length).trim();
      if (value !== "") options.workerId = value;
    }
  }

  return options;
}

function readEnvironment() {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (url === "" || serviceKey === "") {
    throw new Error(
      "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
        "Locally: `npm run worker -w backend` loads frontend/.env.development.local.",
    );
  }

  return { url, serviceKey };
}

function timestamp() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function claimBatch(client, workerId, limit) {
  const { data, error } = await client.rpc("claim_jobs", {
    p_worker_id: workerId,
    p_limit: limit,
  });
  return { jobs: data ?? [], error };
}

async function settle(client, workerId, job, error) {
  const retryable = error === null ? true : error.retryable !== false;
  const { data, error: finishError } = await client.rpc("finish_job", {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_error: error === null ? null : String(error.message ?? error),
    p_retryable: retryable,
  });

  if (finishError) {
    // The claim lease was reclaimed by another worker, or the database is
    // unreachable: either way this worker no longer owns the outcome.
    console.error(
      `${timestamp()} finish_failed job=${job.id} reason=${finishError.message}`,
    );
    return;
  }

  console.log(
    `${timestamp()} settled job=${job.id} kind=${job.kind} status=${data.status} attempts=${data.attempts}`,
  );
}

async function runJob(client, workerId, job) {
  const handler = handlers[job.kind];
  let failure = null;

  if (typeof handler !== "function") {
    failure = new Error(`no handler registered for kind "${job.kind}"`);
  } else {
    try {
      await handler(job.payload ?? {}, {
        jobId: job.id,
        userId: job.user_id,
        attempt: job.attempts,
        maxAttempts: job.max_attempts,
        workerId,
        // The service-role client the handler may use for its own reads and
        // writes (the document handler reads storage and settles the row).
        client,
        log: (message) =>
          console.log(`${timestamp()} job=${job.id} ${message}`),
      });
    } catch (caught) {
      failure = caught instanceof Error ? caught : new Error(String(caught));
    }
  }

  await settle(client, workerId, job, failure);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { url, serviceKey } = readEnvironment();
  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let keepRunning = true;
  const stop = () => {
    console.log(`${timestamp()} worker=${options.workerId} stopping gracefully`);
    keepRunning = false;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  console.log(
    `${timestamp()} worker=${options.workerId} started once=${options.once} limit=${options.limit}`,
  );

  while (keepRunning) {
    const { jobs, error } = await claimBatch(client, options.workerId, options.limit);

    if (error) {
      console.error(`${timestamp()} claim_failed reason=${error.message}`);
      if (options.once) {
        process.exitCode = 1;
        break;
      }
      await sleep(CLAIM_ERROR_BACKOFF_MS);
      continue;
    }

    if (jobs.length === 0) {
      if (options.once) break;
      await sleep(options.idleMs);
      continue;
    }

    for (const job of jobs) {
      if (!keepRunning) break;
      await runJob(client, options.workerId, job);
    }

    if (options.once) break;
  }
}

main().catch((error) => {
  console.error(`${timestamp()} worker_crashed reason=${error.message}`);
  process.exitCode = 1;
});
