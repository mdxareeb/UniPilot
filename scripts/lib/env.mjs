/**
 * Tiny `.env` reader for the dev-environment orchestrator.
 *
 * The orchestrator only needs a couple of *non-secret* values (the Supabase and
 * Presenton URLs) out of `frontend/.env.development.local`, which Node's own
 * `--env-file` already feeds to the worker. Kept dependency-free and narrow so
 * nothing here can accidentally log or forward a key.
 */

/** Parse `KEY=value` lines; comments/blanks dropped, quotes stripped, last wins. */
export function parseEnvFile(text) {
  const parsed = {};

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ")
      ? line.slice("export ".length).trim()
      : line;
    const equals = withoutExport.indexOf("=");
    if (equals <= 0) continue;

    const key = withoutExport.slice(0, equals).trim();
    let value = withoutExport.slice(equals + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

/** Process env wins, then the file, then the fallback; blanks count as unset. */
export function resolveSetting(name, { processEnv = {}, fileEnv = {}, fallback } = {}) {
  for (const candidate of [processEnv[name], fileEnv[name], fallback]) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
  }
  return undefined;
}
