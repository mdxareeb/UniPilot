/**
 * Presenton environment readers (Task 31.x) — server-only.
 *
 * Kept in its own module so the adapter and the Server Actions ask the same
 * three questions the same way, and so the "unset is the honest default"
 * posture is one observable fact: {@link isPresentonConfigured} is false until
 * `PRESENTON_URL` names a real service. Values are trimmed; an empty string is
 * treated exactly like unset.
 *
 * `PRESENTON_API_KEY` is optional (a Presenton instance with authentication
 * disabled needs none). It is read for request headers only — never returned
 * to callers, never logged. `PRESENTON_PUBLIC_URL` is the browser-reachable
 * origin used by the Phase-2 editor iframe; it falls back to `PRESENTON_URL`.
 *
 * `PRESENTON_UI_URL` (Task 31.x fork) names the re-themed fork of Presenton's
 * frontend. When set AND reachable, the edit wrapper prefers it; when unset or
 * unreachable, `resolveEditorUrl` degrades to the engine's own editor — the
 * link is never dead.
 */
export function presentonBaseUrl(): string | null {
  return readEnv("PRESENTON_URL");
}

export function presentonApiKey(): string | null {
  return readEnv("PRESENTON_API_KEY");
}

export function presentonPublicUrl(): string | null {
  return readEnv("PRESENTON_PUBLIC_URL");
}

export function presentonUiUrl(): string | null {
  return readEnv("PRESENTON_UI_URL");
}

export function isPresentonConfigured(): boolean {
  return presentonBaseUrl() !== null;
}

function readEnv(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
