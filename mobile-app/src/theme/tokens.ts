/**
 * The native mirror of the UniPilot design tokens (plan §E).
 *
 * Source of truth: `frontend/app/globals.css` + `DESIGN.md`. Every value below
 * is copied from the web tokens; nothing here invents a colour, a family, a
 * radius or a duration. The web remains authoritative — see README.md.
 */

export type ColorScheme = "light" | "dark";

/** The semantic colour set; both palettes share these exact keys. */
export type ThemeColors = {
  background: string;
  foreground: string;
  primary: string;
  onPrimary: string;
  card: string;
  cardForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  /** `--surface-glass`: muted @ 60% light / 70% dark. */
  glass: string;
  glassStrong: string;
  glassSubtle: string;
  scrim: string;
  destructive: string;
  onDestructive: string;
  inverted: string;
  onInverted: string;
  invertedBorder: string;
  invertedNested: string;
  cta: string;
  ctaForeground: string;
  /** The backdrop motif dot colour (web `--motif-color`). */
  motif: string;
};

export const palettes: Record<ColorScheme, ThemeColors> = {
  light: {
    background: "#f4f4f5",
    foreground: "#1a1c1c",
    primary: "#000000",
    onPrimary: "#ffffff",
    card: "#ffffff",
    cardForeground: "#1a1c1c",
    muted: "#f3f3f4",
    mutedForeground: "#4c4546",
    border: "#e5e5e5",
    glass: "rgba(243, 243, 244, 0.6)",
    glassStrong: "rgba(243, 243, 244, 0.8)",
    glassSubtle: "rgba(243, 243, 244, 0.3)",
    scrim: "rgba(0, 0, 0, 0.4)",
    destructive: "#ba1a1a",
    onDestructive: "#ffffff",
    inverted: "#1a1c1c",
    onInverted: "#f0f1f1",
    invertedBorder: "#3a3a3a",
    invertedNested: "#2e2e2f",
    cta: "#1d1d21",
    ctaForeground: "#f0f1f1",
    motif: "#d4d4d4",
  },
  dark: {
    background: "#131316",
    foreground: "#f0f1f1",
    primary: "#ffffff",
    onPrimary: "#131315",
    card: "#1d1d21",
    cardForeground: "#f0f1f1",
    muted: "#1b1b1f",
    mutedForeground: "#9e9899",
    border: "#2e2e33",
    glass: "rgba(27, 27, 31, 0.7)",
    glassStrong: "rgba(27, 27, 31, 0.88)",
    glassSubtle: "rgba(27, 27, 31, 0.4)",
    scrim: "rgba(0, 0, 0, 0.55)",
    destructive: "#e5484d",
    onDestructive: "#ffffff",
    inverted: "#f0f1f1",
    onInverted: "#131315",
    invertedBorder: "#d0d1d1",
    invertedNested: "#dcdedf",
    cta: "#1d1d21",
    ctaForeground: "#f0f1f1",
    motif: "#3c3c41",
  },
};

/** The 4px unit scale (DESIGN.md §Layout & Spacing). */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  giant: 48,
  colossal: 64,
} as const;

export const layout = {
  /** `margin-mobile` from the web's spacing tokens. */
  screenMargin: 20,
  maxContentWidth: 720,
  /** The motif pitch (web `--motif-spacing`). */
  motifSpacing: 32,
  /** The motif dot radius (web `--motif-scale`: 1px). */
  motifDotRadius: 0.75,
} as const;

/**
 * The five-step radius scale, at the mobile step (DESIGN.md §Task 3.13:
 * Frame 24 / Card 16 below 375px). A nested surface never carries a radius
 * equal to or larger than its parent's.
 */
export const radii = {
  frame: 24,
  card: 16,
  nested: 12,
  control: 8,
  pill: 9999,
} as const;

/** The four elevation recipes; one level per surface, never two. */
export const elevation = {
  flush: {},
  raised: { boxShadow: "0 4px 16px rgba(0, 0, 0, 0.06)" },
  floating: { boxShadow: "0 8px 32px rgba(0, 0, 0, 0.08)" },
  overlay: { boxShadow: "0 12px 40px rgba(0, 0, 0, 0.12)" },
} as const;

export type ElevationName = keyof typeof elevation;

/**
 * The three authorized families, one role each (DESIGN.md "closed font set").
 * The names are the registration keys `src/theme/fonts.ts` loads through
 * expo-font; a style uses the name as `fontFamily` and never sets
 * `fontWeight` (the weight lives in the instance).
 */
export const fontFamily = {
  headingMedium: "BricolageGrotesque_500Medium",
  headingSemiBold: "BricolageGrotesque_600SemiBold",
  headingBold: "BricolageGrotesque_700Bold",
  headingExtraBold: "BricolageGrotesque_800ExtraBold",
  bodyRegular: "Geist_400Regular",
  bodyMedium: "Geist_500Medium",
  bodySemiBold: "Geist_600SemiBold",
  bodyBold: "Geist_700Bold",
  monoRegular: "GeistMono_400Regular",
  monoMedium: "GeistMono_500Medium",
  monoSemiBold: "GeistMono_600SemiBold",
} as const;

export type TypeVariant = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  /** Points, converted from the web's em tracking (em × fontSize). */
  letterSpacing: number;
};

/**
 * The type scale (DESIGN.md §Typography). Roles keep their web sizes and
 * tracking; the family follows the closed-set rules: Bricolage for major
 * headings **and action labels**, Geist for body/fields/navigation, Geist
 * Mono for metadata.
 */
export const typeScale = {
  display: {
    fontFamily: fontFamily.headingBold,
    fontSize: 72,
    lineHeight: 79,
    letterSpacing: -2.88,
  },
  headlineLg: {
    fontFamily: fontFamily.headingBold,
    fontSize: 48,
    lineHeight: 58,
    letterSpacing: -1.44,
  },
  headlineLgMobile: {
    fontFamily: fontFamily.headingBold,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.64,
  },
  headlineMd: {
    fontFamily: fontFamily.headingSemiBold,
    fontSize: 24,
    lineHeight: 31,
    letterSpacing: -0.24,
  },
  bodyLg: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: 18,
    lineHeight: 29,
    letterSpacing: 0,
  },
  bodyMd: {
    fontFamily: fontFamily.bodyRegular,
    fontSize: 16,
    lineHeight: 26,
    letterSpacing: 0,
  },
  /** Action labels — Bricolage per the Task 3.14 amendment. */
  label: {
    fontFamily: fontFamily.headingMedium,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0,
  },
  /** Content-like interactive text (a row title that reads as content). */
  labelBody: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0,
  },
  /** Metadata / technical labels — Geist Mono, caps. */
  caps: {
    fontFamily: fontFamily.monoSemiBold,
    fontSize: 12,
    lineHeight: 12,
    letterSpacing: 1.2,
  },
  mono: {
    fontFamily: fontFamily.monoRegular,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0,
  },
} as const satisfies Record<string, TypeVariant>;

export type TypeVariantName = keyof typeof typeScale;
