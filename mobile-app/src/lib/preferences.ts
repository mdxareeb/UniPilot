import * as SecureStore from "expo-secure-store";

/** The three theme modes; the palette itself is never user-configurable. */
export const THEME_MODES = ["system", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

const KEY = "unipilot.theme-mode";
/** The Ask AI opening scope: always all materials, or resume the last scope. */
export const AI_SCOPE_MODES = ["all", "last"] as const;
export type AiScopeMode = (typeof AI_SCOPE_MODES)[number];

export const AI_SCOPE_LABELS: Record<AiScopeMode, string> = {
  all: "All materials",
  last: "Remember last used",
};

const AI_SCOPE_KEY = "unipilot.ai-scope-mode";
const AI_LAST_SCOPE_KEY = "unipilot.ai-last-scope";

/**
 * The last concrete Ask AI scope, stored only so the `last` opening mode can
 * resume it. Subject/document names are never stored — ids are resolved
 * against the owner's current rows on the next launch, so a deleted course
 * falls back to All Materials instead of showing a stale label.
 */
export type StoredAiScope =
  | { kind: "subject"; id: string }
  | { kind: "document"; id: string };

export function isStoredAiScope(value: unknown): value is StoredAiScope {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { kind?: unknown; id?: unknown };
  if (record.kind !== "subject" && record.kind !== "document") return false;
  return typeof record.id === "string" && record.id.trim() !== "";
}

export function storedAiScopeFrom(value: unknown): StoredAiScope | null {
  return isStoredAiScope(value) ? value : null;
}

/** The saved concrete scope, or `null` when absent/unreadable/junk. */
export async function loadAiLastScope(): Promise<StoredAiScope | null> {
  try {
    const stored = await SecureStore.getItemAsync(AI_LAST_SCOPE_KEY);
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    return storedAiScopeFrom(parsed);
  } catch {
    return null;
  }
}

/** Persist the concrete scope; `null` clears it (All Materials). */
export async function saveAiLastScope(
  scope: StoredAiScope | null,
): Promise<void> {
  try {
    if (scope === null) {
      await SecureStore.deleteItemAsync(AI_LAST_SCOPE_KEY);
      return;
    }
    await SecureStore.setItemAsync(AI_LAST_SCOPE_KEY, JSON.stringify(scope));
  } catch {
    /* the current session still uses the scope; it just won't survive a restart */
  }
}


export function isAiScopeMode(value: unknown): value is AiScopeMode {
  return (
    typeof value === "string" && (AI_SCOPE_MODES as readonly string[]).includes(value)
  );
}

/** A stored preference, or `all` when absent/unreadable. */
export async function loadAiScopeMode(): Promise<AiScopeMode> {
  try {
    const stored = await SecureStore.getItemAsync(AI_SCOPE_KEY);
    return isAiScopeMode(stored) ? stored : "all";
  } catch {
    return "all";
  }
}

/** Persist the preference; a storage failure keeps the in-memory choice. */
export async function saveAiScopeMode(mode: AiScopeMode): Promise<void> {
  try {
    await SecureStore.setItemAsync(AI_SCOPE_KEY, mode);
  } catch {
    /* the session still uses the chosen scope; it just won't survive a restart */
  }
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return (
    typeof value === "string" && (THEME_MODES as readonly string[]).includes(value)
  );
}

/** A stored preference, or `system` when absent/unreadable. */
export async function loadThemeMode(): Promise<ThemeMode> {
  try {
    const stored = await SecureStore.getItemAsync(KEY);
    return isThemeMode(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

/** Persist the preference; a storage failure keeps the in-memory choice. */
export async function saveThemeMode(mode: ThemeMode): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, mode);
  } catch {
    /* the session still uses the chosen mode; it just won't survive a restart */
  }
}

/** The effective palette; `system` follows the OS, the others override it. */
export function resolveThemeScheme(
  mode: ThemeMode,
  systemScheme: string | null | undefined,
): "light" | "dark" {
  if (mode === "system") return systemScheme === "light" ? "light" : "dark";
  return mode;
}
