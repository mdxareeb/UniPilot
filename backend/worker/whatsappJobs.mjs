/**
 * Task 46.13 — the WhatsApp job handlers (spec §7).
 *
 * The Node worker spawns the Python service per job: JSON payload on stdin,
 * one JSON result line on stdout, service-role env inherited by the child.
 * The handler owns the mode-aware timeout, a touch_job lease heartbeat while
 * the child runs, terminal cleanup of the export object, and the mapping from
 * the child's exit to the 29.1 retry contract.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startJobHeartbeat } from "./heartbeat.mjs";

// Re-exported for the existing importers (the whatsapp job spec); the shared
// implementation now lives in heartbeat.mjs so every long handler uses one.
export { startJobHeartbeat };

const WHATSAPP_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../whatsapp",
);
const HEARTBEAT_MS = 60_000;
const EXPORT_BUCKET = "whatsapp-exports";

function envInt(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envFloat(name, fallback) {
  const value = Number.parseFloat(process.env[name] ?? "");
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function liveSyncTimeoutMs() {
  const seconds = Math.floor(
    120 +
      envInt("LIVE_MAX_MESSAGES", 2000) * envFloat("LIVE_SCROLL_WAIT", 0.9) +
      envInt("LIVE_STALE_ROUNDS", 7) * 15,
  );
  return Math.max(10 * 60_000, seconds * 1000);
}

function timeoutFor(action, mode) {
  if (action === "connect") return (envInt("LIVE_QR_TIMEOUT", 180) + 60) * 1000;
  if (action === "push") return 120_000;
  if (action === "disconnect") return 60_000;
  if (mode === "live") return liveSyncTimeoutMs();
  return envInt("WHATSAPP_SYNC_TIMEOUT", 300) * 1000;
}

function parseResultLine(stdout) {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim() !== "");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {
      // not the JSON line; keep scanning
    }
  }
  return null;
}

/**
 * @param {string} action
 * @param {object} payload
 * @param {object} ctx
 * @param {{ timeoutMs?: number, heartbeatMs?: number }} [options]
 */
export function spawnWhatsApp(
  action,
  payload,
  ctx,
  { timeoutMs = timeoutFor(action), heartbeatMs } = {},
) {
  return new Promise((resolve, reject) => {
    const python = process.env.WHATSAPP_PYTHON ?? "python";
    let stdout = "";
    let stderr = "";
    let settled = false;
    let stopHeartbeat = null;
    let timer = null;

    const child = spawn(python, ["-m", "wa_service", action], {
      cwd: WHATSAPP_DIR,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const clearTimers = () => {
      if (stopHeartbeat) stopHeartbeat();
      if (timer) clearTimeout(timer);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(error);
    };

    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        const failure = new Error(
          "Python service unavailable on this worker host: install Python and " +
            "whatsapp/requirements*.txt (see whatsapp/README.md)",
        );
        failure.retryable = false;
        fail(failure);
        return;
      }
      fail(error);
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    stopHeartbeat = startJobHeartbeat(ctx, heartbeatMs ?? HEARTBEAT_MS);

    timer = setTimeout(() => {
      child.kill();
      const failure = new Error(`whatsapp ${action} timed out after ${Math.round(timeoutMs / 1000)}s`);
      failure.retryable = true;
      fail(failure);
    }, timeoutMs);

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimers();
      const result = parseResultLine(stdout);
      if (code === 0 && result && result.ok !== false) {
        resolve(result ?? { ok: true });
        return;
      }
      const message =
        (result && typeof result.error === "string" && result.error) ||
        `whatsapp ${action} exited with code ${code}`;
      const failure = new Error(message);
      failure.retryable = result ? result.retryable !== false : true;
      reject(failure);
    });
  });
}

async function loadRun(ctx, runId) {
  const { data, error } = await ctx.client
    .from("integration_runs")
    .select("id, user_id, mode, storage_path, status")
    .eq("id", runId)
    .maybeSingle();
  if (error || !data) {
    const failure = new Error("whatsapp.sync: run not found");
    failure.retryable = false;
    throw failure;
  }
  return data;
}

async function cleanupExportObject(ctx, run) {
  if (!run?.storage_path) return;
  try {
    await ctx.client.storage.from(EXPORT_BUCKET).remove([run.storage_path]);
  } catch {
    // Best-effort privacy cleanup; the run already settled.
  }
}

export async function whatsappSync(payload, ctx) {
  const run = await loadRun(ctx, payload.runId);
  try {
    await spawnWhatsApp("sync", payload, ctx, {
      timeoutMs: timeoutFor("sync", run.mode),
    });
  } catch (error) {
    const terminal =
      error.retryable === false || ctx.attempt >= ctx.maxAttempts;
    if (terminal) await cleanupExportObject(ctx, run);
    throw error;
  }
  await cleanupExportObject(ctx, run);
}

export async function whatsappConnect(payload, ctx) {
  await spawnWhatsApp("connect", payload, ctx, {
    timeoutMs: timeoutFor("connect"),
  });
}

export async function whatsappPush(payload, ctx) {
  await spawnWhatsApp("push", payload, ctx, { timeoutMs: timeoutFor("push") });
}

export async function whatsappDisconnect(payload, ctx) {
  await spawnWhatsApp("disconnect", payload, ctx, {
    timeoutMs: timeoutFor("disconnect"),
  });
}
