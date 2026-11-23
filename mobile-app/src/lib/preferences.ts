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
