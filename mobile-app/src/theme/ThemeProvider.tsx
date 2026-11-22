import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";

import {
  loadThemeMode,
  resolveThemeScheme,
  saveThemeMode,
  type ThemeMode,
} from "@/lib/preferences";
import {
  elevation,
  fontFamily,
  layout,
  palettes,
  radii,
  spacing,
  typeScale,
  type ColorScheme,
  type ThemeColors,
  type TypeVariant,
} from "./tokens";

export type Theme = {
  scheme: ColorScheme;
  /** The user's preference; `system` follows the OS. */
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
  colors: ThemeColors;
  spacing: typeof spacing;
  radii: typeof radii;
  elevation: typeof elevation;
  layout: typeof layout;
  type: typeof typeScale;
  fontFamily: typeof fontFamily;
};

const ThemeContext = createContext<Theme | null>(null);

/**
 * The one theme provider. Dark is the default — mirroring the web's
 * pre-paint `class="dark"` — a light system preference renders light, and an
 * explicit System/Light/Dark choice is persisted per device. There is no
 * per-screen theme and no second token set.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    let active = true;
    void loadThemeMode().then((stored) => {
      if (active) setModeState(stored);
    });
    return () => {
      active = false;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void saveThemeMode(next);
  }, []);

  const scheme: ColorScheme = resolveThemeScheme(mode, systemScheme);

  const value = useMemo<Theme>(
    () => ({
      scheme,
      mode,
      setMode,
      isDark: scheme === "dark",
      colors: palettes[scheme],
      spacing,
      radii,
      elevation,
      layout,
      type: typeScale,
      fontFamily,
    }),
    [mode, scheme, setMode],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error("useTheme must be used inside ThemeProvider.");
  }
  return theme;
}

export type { TypeVariant };
