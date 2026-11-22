/**
 * Bridge configuration, read from the process environment only.
 *
 * The bridge is a separate server process (like the job worker) and shares the
 * server-side secrets in `backend/.env` (`npm run bridge` loads it with
 * `--env-file`). It never reads `frontend/.env`, and it never prints a value:
 * a missing variable is reported by NAME only.
 */

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

export interface BridgeConfig {
  /** Supabase project URL (the backend alias of the public URL; not a secret). */
  supabaseUrl: string;
  /** Service-role key. Server-only; never logged. */
  serviceRoleKey: string;
  /** pgcrypto key for the session-store RPCs. Server-only; never logged. */
  integrationsKey: string;
  /** How often the bridge reads `whatsapp_sessions.desired_state`. */
  pollIntervalMs: number;
  /** How often a managed session's `bridge_heartbeat_at` is bumped. */
  heartbeatIntervalMs: number;
  /** pino level for the bridge's own logs (Baileys is kept at `warn`). */
  logLevel: string;
}

type Env = Record<string, string | undefined>;

function positiveInt(env: Env, name: string, fallback: number, min: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new ConfigError(`${name} must be an integer >= ${min}.`);
  }
  return value;
}

export function loadConfig(env: Env = process.env): BridgeConfig {
  const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const integrationsKey = env.UNIPILOT_INTEGRATIONS_KEY;

  const missing: string[] = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!integrationsKey) missing.push("UNIPILOT_INTEGRATIONS_KEY");
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        "Set them in backend/.env (see backend/.env.example).",
    );
  }

  return {
    supabaseUrl: supabaseUrl as string,
    serviceRoleKey: serviceRoleKey as string,
    integrationsKey: integrationsKey as string,
    pollIntervalMs: positiveInt(env, "WHATSAPP_BRIDGE_POLL_MS", 3000, 500),
    heartbeatIntervalMs: positiveInt(env, "WHATSAPP_BRIDGE_HEARTBEAT_MS", 10000, 1000),
    logLevel: env.WHATSAPP_BRIDGE_LOG_LEVEL?.trim() || "info",
  };
}
