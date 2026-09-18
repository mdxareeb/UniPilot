/**
 * The deck editor's theme picker choices (Task C4 review fix, spec §5.4:
 * "template theme + custom themes").
 *
 * Pure so the picker's contract is testable without a browser: the stored deck
 * theme, the template's own theme, and every custom theme the engine serves
 * (spec §7.3 `GET /themes/all`). Values are addressed symbolically
 * (`deck`/`template`/`custom:<id>`), and `themeForChoice` returns the **exact
 * object reference** the option carries — a custom entry is forwarded to the
 * engine verbatim, never flattened or rebuilt.
 */
import { resolveDeckTheme } from "@/lib/presentation/elements";
import type { DeckTheme, DeckThemePackage } from "@/lib/presentation/types";

export type ThemeChoiceEntry = {
  id: string;
  name: string | null;
  /** The engine's entry as served; sent back untouched when chosen. */
  theme: unknown;
};

export type ThemeChoice = {
  /** `deck`, `template`, or `custom:<id>` — stable across re-renders. */
  value: string;
  label: string;
};

export type ThemeChoiceInput = {
  storedTheme: DeckTheme | DeckThemePackage | null;
  templateTheme: DeckTheme | null;
  templateName: string | null;
  customThemes: ThemeChoiceEntry[];
};

function identicalThemes(a: unknown, b: unknown): boolean {
  const resolvedA = resolveDeckTheme(
    a as DeckTheme | DeckThemePackage | null | undefined,
  );
  const resolvedB = resolveDeckTheme(
    b as DeckTheme | DeckThemePackage | null | undefined,
  );
  if (resolvedA === null || resolvedB === null) return a === b;
  return JSON.stringify(resolvedA) === JSON.stringify(resolvedB);
}

/** The picker's options, in the order they render. */
export function buildThemeChoices(input: ThemeChoiceInput): ThemeChoice[] {
  const choices: ThemeChoice[] = [];
  if (input.storedTheme !== null && input.storedTheme !== undefined) {
    choices.push({ value: "deck", label: "Deck theme (stored)" });
  }
  if (input.templateTheme !== null) {
    const identical =
      input.storedTheme !== null &&
      input.storedTheme !== undefined &&
      identicalThemes(input.storedTheme, input.templateTheme);
    if (!identical) {
      choices.push({
        value: "template",
        label:
          input.templateName !== null
            ? `Template theme (${input.templateName})`
            : "Template theme",
      });
    }
  }
  input.customThemes.forEach((entry, index) => {
    choices.push({
      value: `custom:${entry.id}`,
      label: entry.name ?? `Custom theme ${index + 1}`,
    });
  });
  return choices;
}

/** The exact theme value one choice carries, or null when it resolves nowhere. */
export function themeForChoice(
  value: string,
  input: ThemeChoiceInput,
): DeckTheme | DeckThemePackage | null {
  if (value === "deck") return input.storedTheme;
  if (value === "template") return input.templateTheme;
  if (value.startsWith("custom:")) {
    const id = value.slice("custom:".length);
    const entry = input.customThemes.find((candidate) => candidate.id === id);
    return (entry?.theme as DeckTheme | DeckThemePackage | undefined) ?? null;
  }
  return null;
}

/** Which picker value the currently applied theme object corresponds to. */
export function themeChoiceValue(
  theme: unknown,
  input: ThemeChoiceInput,
): string {
  if (input.templateTheme !== null && theme === input.templateTheme) {
    return "template";
  }
  const custom = input.customThemes.find((entry) => entry.theme === theme);
  if (custom !== undefined) return `custom:${custom.id}`;
  return "deck";
}
