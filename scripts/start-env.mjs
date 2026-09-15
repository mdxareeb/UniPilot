#!/usr/bin/env node
/**
 * The one-command local environment.
 *
 *     npm run dev            # from the repo root (Windows host, PowerShell)
 *
 * Brings up, in order and idempotently: WSL + the Docker daemon (inside the
 * distro), the Presenton container (ghcr image, port 5001, DISABLE_AUTH,
 * app_data volume, restart policy), the local Supabase stack (`supabase
 * start`), the background worker (`backend/worker/run.mjs`), then Next's dev
 * server in the foreground. Every infrastructure step probes first and only
 * *warns* on failure: if Docker/Presenton/Supabase cannot start, the app still
 * runs and `/tools/presentation` keeps its existing blocked state. Only the
 * Next server's exit ends the run.
 *
 * Configuration, never hardcoded per machine:
 *   - `UNIPILOT_WSL_DISTRO`  — WSL2 distro (default `kali-linux`)
 *   - `PRESENTON_URL`        — where Presenton is probed (env, then
 *                              `frontend/.env.development.local`, then
 *                              `http://localhost:5001`)
 *   - `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` — probed the same way
 *     (fallback `http://127.0.0.1:54937`, the port chosen in QA_SESSION.md to
 *     dodge Windows' winnat-reserved ranges)
 *
 * The Supabase CLI prints API keys on stdout — this runner captures and never
 * echoes it, and it never reads or prints any key value itself.
 *
 * Ctrl+C: the worker and Next share the console, so the console delivers the
 * interrupt to them directly; this process additionally signals both and
 * force-kills whatever survives a 5s grace period.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseEnvFile, resolveSetting } from "./lib/env.mjs";
import { buildPresentonRunArgs, toWslPath, wslExecArgs } from "./lib/wsl.mjs";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const BACKEND_DIR = path.join(ROOT, "backend");
const WORKER_ENTRY = path.join(BACKEND_DIR, "worker", "run.mjs");
const FRONTEND_ENV_FILE = path.join(ROOT, "frontend", ".env.development.local");
const PRESENTON_APP_DATA = path.join(ROOT, "presenton-main", "app_data");
const PRESENTON_ENV_FILE = path.join(ROOT, "presenton-main", ".env");
const PRESENTON_IMAGE = "ghcr.io/presenton/presenton:latest";
const DEFAULT_SUPABASE_URL = "http://127.0.0.1:54937";
const DEFAULT_PRESENTON_URL = "http://localhost:5001";
const APP_PORT = 3000;
const DOCKER_BOOT_MS = 30_000;
const HTTP_PROBE_TIMEOUT_MS = 2_500;

const log = (message) => console.log(`[env] ${message}`);
const warn = (message) => console.warn(`[env] ${message}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fileEnv = existsSync(FRONTEND_ENV_FILE)
  ? parseEnvFile(readFileSync(FRONTEND_ENV_FILE, "utf8"))
  : {};
const distro = resolveSetting("UNIPILOT_WSL_DISTRO", {
  processEnv: process.env,
  fileEnv,
  fallback: "kali-linux",
});
const supabaseUrl = resolveSetting("NEXT_PUBLIC_SUPABASE_URL", {
  processEnv: process.env,
  fileEnv,
  fallback: resolveSetting("SUPABASE_URL", {
    processEnv: process.env,
    fileEnv,
    fallback: DEFAULT_SUPABASE_URL,
  }),
});
const presentonUrl = resolveSetting("PRESENTON_URL", {
  processEnv: process.env,
  fileEnv,
  fallback: DEFAULT_PRESENTON_URL,
});
const PRESENTON_UI_DIR = path.join(ROOT, "presenton-ui");
const presentonUiPort = resolveSetting("PRESENTON_UI_PORT", {
  processEnv: process.env,
  fileEnv,
  fallback: "5002",
});

let workerChild = null;
let nextChild = null;
let uiChild = null;
let shuttingDown = false;

/** Run one command inside the distro as root (the docker socket is root-only). */
function runWsl(command, { cwd = ROOT, timeout = 120_000 } = {}) {
  return spawnSync("wsl.exe", wslExecArgs({ distro, command }), {
    cwd,
    encoding: "utf8",
    timeout,
    windowsHide: true,
  });
}

function dockerVersion() {
  const result = runWsl(["docker", "info", "--format", "{{.ServerVersion}}"]);
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim() || "unknown";
}

async function ensureDocker() {
  log(`checking WSL (${distro}) and Docker...`);
  let version = dockerVersion();
  if (version) {
    log(`docker: up (${version})`);
    return true;
  }

  if (runWsl(["true"]).error) {
    warn("wsl.exe could not start the distro — skipping Docker, Presenton and Supabase");
    return false;
  }

  log("docker: not responding — starting the daemon...");
  runWsl(["bash", "-lc", "systemctl start docker 2>/dev/null || service docker start"]);
  const deadline = Date.now() + DOCKER_BOOT_MS;
  while (Date.now() < deadline) {
    await sleep(1_000);
    version = dockerVersion();
    if (version) {
      log(`docker: up (${version})`);
      return true;
    }
  }

  warn("docker: did not come up within 30s — skipping Presenton and Supabase");
  return false;
}

async function ensurePresenton() {
  const inspect = runWsl(["docker", "inspect", "-f", "{{.State.Status}}", "presenton"]);
  if (inspect.status === 0) {
    const state = inspect.stdout.trim();
    if (state === "running") {
      log("presenton: already running");
    } else {
      log(`presenton: container is ${state} — starting it`);
      const started = runWsl(["docker", "start", "presenton"]);
      if (started.status !== 0) {
        warn(`presenton: docker start failed (exit ${started.status}) — continuing without it`);
        return false;
      }
    }
  } else {
    log("presenton: container missing — creating it from the ghcr image");
    runWsl(["mkdir", "-p", toWslPath(PRESENTON_APP_DATA)]);
    const created = runWsl([
      "docker",
      ...buildPresentonRunArgs({
        image: PRESENTON_IMAGE,
        appDataDir: toWslPath(PRESENTON_APP_DATA),
        envFile: existsSync(PRESENTON_ENV_FILE) ? toWslPath(PRESENTON_ENV_FILE) : null,
      }),
    ]);
    if (created.status !== 0) {
      warn(`presenton: docker run failed (exit ${created.status}) — continuing without it`);
      return false;
    }
  }

  const status = await waitForHttp(`${presentonUrl}/`);
  if (status === null) {
    warn(`presenton: not answering at ${presentonUrl} yet — continuing; the tool reports honestly`);
    return false;
  }
  log(`presenton: reachable at ${presentonUrl}`);
  return true;
}

/**
 * Optional (Task 31.x fork): start the re-themed Presenton UI when its checkout
 * is present. Warn-only by design — a missing checkout, a failed start or a
 * crashed child never fails the dev environment; the tool page's edit wrapper
 * keeps its engine-editor fallback (`resolveEditorUrl` in the adapter).
 */
async function ensurePresentonUi() {
  if (!existsSync(path.join(PRESENTON_UI_DIR, "package.json"))) {
    log("presenton-ui: fork not present — skipping the themed editor");
    return false;
  }

  const uiUrl = `http://localhost:${presentonUiPort}`;
  if (await portOpen(Number(presentonUiPort))) {
    log(`presenton-ui: already serving on :${presentonUiPort}`);
    return true;
  }

  log(`presenton-ui: starting the themed editor on :${presentonUiPort}...`);
  uiChild = spawn(process.execPath, [path.join(PRESENTON_UI_DIR, "scripts", "dev.mjs")], {
    cwd: PRESENTON_UI_DIR,
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(presentonUiPort),
      PRESENTON_ENGINE_URL: presentonUrl,
    },
  });
  uiChild.on("exit", (code) => {
    if (!shuttingDown) {
      warn(`presenton-ui exited (code ${code}) — the engine editor stays available`);
    }
  });

  const status = await waitForHttp(uiUrl);
  if (status === null) {
    warn(`presenton-ui: not answering at ${uiUrl} yet — falling back to the engine editor`);
    return false;
  }
  log(`presenton-ui: reachable at ${uiUrl}`);
  return true;
}

async function ensureSupabase() {
  const status = runWsl(["supabase", "status"], { cwd: BACKEND_DIR });
  if (status.status === 0) {
    log("supabase: already running");
  } else {
    log("supabase: starting the local stack (first boot can take a minute)...");
    const started = runWsl(["supabase", "start"], { cwd: BACKEND_DIR, timeout: 600_000 });
    if (started.status !== 0) {
      const stderr = (started.stderr ?? "")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-4)
        .join("\n");
      warn(`supabase: start failed (exit ${started.status})${stderr ? `:\n${stderr}` : ""}`);
      return false;
    }
  }

  const health = await waitForHttp(`${supabaseUrl}/auth/v1/health`, {
    attempts: 12,
    delayMs: 2_500,
  });
  if (health === null) {
    warn(
      `supabase: ${supabaseUrl} is not answering — if config.toml's [api] port changed, ` +
        'run "supabase stop && supabase start" from backend/ to apply it; continuing',
    );
    return false;
  }
  log(`supabase: reachable at ${supabaseUrl} (http ${health})`);
  return true;
}

/** Best-effort: a worker already spawned by another terminal/run. */
function findExistingWorker() {
  if (process.platform !== "win32") return null;
  const script = [
    "$p = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" |",
    "Where-Object { $_.CommandLine -like '*worker\\run.mjs*' -or $_.CommandLine -like '*worker/run.mjs*' } |",
    "Select-Object -First 1 -ExpandProperty ProcessId;",
    "if ($p) { $p }",
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  const pid = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(pid) ? pid : null;
}

function httpStatus(url) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    try {
      const request = http.get(url, { timeout: HTTP_PROBE_TIMEOUT_MS }, (response) => {
        response.resume();
        finish(response.statusCode ?? 0);
      });
      request.on("timeout", () => {
        request.destroy();
        finish(null);
      });
      request.on("error", () => finish(null));
    } catch {
      finish(null);
    }
  });
}

async function waitForHttp(url, { attempts = 10, delayMs = 1_500 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await httpStatus(url);
    if (status !== null) return status;
    if (attempt < attempts - 1) await sleep(delayMs);
  }
  return null;
}

function portOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1_000);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

function forceKill(child) {
  if (!child || child.exitCode !== null || typeof child.pid !== "number") return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    try {
      process.kill(child.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("shutting down (worker + next dev + presenton-ui)...");

  // In a terminal, Ctrl+C reaches the worker and Next directly through the
  // console, and their SIGINT handlers stop them gracefully. On Windows
  // child.kill("SIGINT") is an abrupt TerminateProcess, so wait briefly for
  // the console signal first; the forced kill is only a backstop.
  const firstKillMs = process.platform === "win32" ? 1_500 : 0;
  setTimeout(() => {
    for (const child of [workerChild, nextChild, uiChild]) {
      if (child && child.exitCode === null) {
        try {
          child.kill("SIGINT");
        } catch {
          // Fall through to the forced kill below.
        }
      }
    }
  }, firstKillMs).unref();

  setTimeout(() => {
    forceKill(workerChild);
    forceKill(nextChild);
    forceKill(uiChild);
  }, 5_000).unref();
  setTimeout(() => process.exit(exitCode), 8_000).unref();
  process.exitCode = exitCode;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  if (process.platform !== "win32") {
    warn("this runner targets the Windows host; run it from PowerShell, not from inside WSL");
  }

  const dockerUp = await ensureDocker();
  if (dockerUp) {
    await ensurePresenton();
    await ensureSupabase();
    await ensurePresentonUi();
  } else {
    warn("continuing without Presenton and Supabase — the app runs and blocked states stay honest");
  }

  const existingWorker = findExistingWorker();
  if (existingWorker !== null) {
    log(`worker: already running (pid ${existingWorker})`);
  } else {
    workerChild = spawn(process.execPath, [`--env-file=${FRONTEND_ENV_FILE}`, WORKER_ENTRY], {
      cwd: BACKEND_DIR,
      stdio: "inherit",
      windowsHide: true,
    });
    workerChild.on("exit", (code) => {
      if (!shuttingDown) warn(`worker exited (code ${code}) — queued jobs will wait for a restart`);
    });
    log("worker: started");
  }

  if (await portOpen(APP_PORT)) {
    log(`next dev: already serving on :${APP_PORT}`);
  } else {
    // Resolve `next` the way the frontend workspace does (npm hoists it to the
    // repo root) and run the binary directly: spawning through npm.cmd adds a
    // cmd.exe batch layer that prompts "Terminate batch job (Y/N)?" on Ctrl+C
    // and swallows signals before they reach the dev server.
    const frontendDir = path.join(ROOT, "frontend");
    const frontendRequire = createRequire(path.join(frontendDir, "package.json"));
    nextChild = spawn(process.execPath, [frontendRequire.resolve("next/dist/bin/next"), "dev"], {
      cwd: frontendDir,
      stdio: "inherit",
      windowsHide: true,
    });
    nextChild.on("exit", (code) => {
      if (!shuttingDown) {
        log(`next dev exited (code ${code})`);
        shutdown(code ?? 0);
      }
    });
  }

  log(`ready — app http://localhost:${APP_PORT}  presenton ${presentonUrl}  supabase ${supabaseUrl}`);

  if (!workerChild && !nextChild) {
    log("everything already up; nothing to supervise");
    return;
  }
  await new Promise(() => {});
}

main().catch((error) => {
  warn(`environment runner crashed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
  shutdown(1);
});
