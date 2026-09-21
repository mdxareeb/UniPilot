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
 *
 * `PRESENTON_MODEL` and `PRESENTON_MODEL_OPTIONS` (the generate redesign's T1)
 * are the operator's model declaration for the presentation service: the
 * engine's model is one deployment-global setting (`GET/PUT
 * /api/v1/admin/provider-settings`), so `PRESENTON_MODEL` is the display
 * default shown when that read is denied, and a non-empty
 * `PRESENTON_MODEL_OPTIONS` is the opt-in for the deployment-global switch.
 * They carry model ids the operator wrote, never provider keys, and they are
 * server-only like every reader here: never `NEXT_PUBLIC_*`, never forwarded
 * to a client beyond the sanitized adapter result.
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

/**
 * The model id this deployment's engine is configured with, when the operator
 * declares one (`PRESENTON_MODEL`). Display-only: the adapter shows it labelled
 * as configured on the service when the engine's own settings read is denied,
 * and prefers the engine's report whenever that read answers. Server-only.
 */
export function presentonModel(): string | null {
  return readEnv("PRESENTON_MODEL");
}

/**
 * The model ids the operator declares available for switching
 * (`PRESENTON_MODEL_OPTIONS`, comma-separated). Its presence is the opt-in for
 * the deployment-global switch: absent or empty means the chooser stays
 * read-only and `applyPresentationModel` refuses every value (`not-declared`).
 * Trimmed; empty entries dropped; duplicates removed preserving the declared
 * order. Server-only.
 */
export function presentonModelOptions(): string[] {
  const raw = readEnv("PRESENTON_MODEL_OPTIONS");
  if (raw === null) return [];
  const options: string[] = [];
  for (const entry of raw.split(",")) {
    const value = entry.trim();
    if (value === "" || options.includes(value)) continue;
    options.push(value);
  }
  return options;
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
