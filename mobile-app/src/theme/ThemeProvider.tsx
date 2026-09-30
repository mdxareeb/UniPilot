import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";

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
 * pre-paint `class="dark"` — and a light system preference renders light.
 * There is no per-screen theme and no second token set.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const scheme: ColorScheme = systemScheme === "light" ? "light" : "dark";

  const value = useMemo<Theme>(
    () => ({
      scheme,
      isDark: scheme === "dark",
      colors: palettes[scheme],
      spacing,
      radii,
      elevation,
      layout,
      type: typeScale,
      fontFamily,
    }),
    [scheme],
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
