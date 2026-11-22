import * as SecureStore from "expo-secure-store";

/** The three theme modes; the palette itself is never user-configurable. */
export const THEME_MODES = ["system", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

const KEY = "unipilot.theme-mode";

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
