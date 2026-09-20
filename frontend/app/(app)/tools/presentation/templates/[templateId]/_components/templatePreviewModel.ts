/**
 * Task E2 — the template preview's pure model.
 *
 * A template layout is a list of components, the same shape a deck slide's
 * `ui` carries; the native read-only preview therefore renders it through the
 * existing `DeckStage` by building a one-slide-per-layout synthetic deck (the
 * viewer's own wire shape, spec §6.1) and pointing the stage's asset resolver
 * at the session-gated template-asset route. `hydrateSlide` clones each layout
 * with empty content, so every element keeps the template's own defaults —
 * the truthful read-only rendering of "what this layout looks like".
 *
 * Pure and exported so the deck construction is provable without a browser.
 */
import { hydrateSlide } from "@/lib/presentation/hydrateSlide";
import type {
  DeckTheme,
  PresentationDeck,
  TemplateLayout,
} from "@/lib/presentation/types";

export type TemplatePreviewDeckInput = {
  templateId: string;
  /** The template's name, used as the synthetic deck's title. */
  name: string;
  layouts: TemplateLayout[];
  /** The stored or derived theme; null renders the stage's honest defaults. */
  theme: DeckTheme | null;
  /** The template's `{family: url}` map. */
  fonts: Record<string, string>;
};

/** The synthetic deck id the stage uses internally (never sent to the engine). */
export function templatePreviewDeckId(templateId: string): string {
  return `template-preview-${templateId}`;
}

/**
 * The layouts a preview can render: entries with a real component list.
 * `layouts` arrives from the engine unvalidated (like every service payload),
 * and `hydrateSlide` maps over `layout.components`, so a malformed entry must
 * be dropped here instead of throwing during render (review fix, E2). The
 * picker, the count and the synthetic deck all read this one list, so they
 * cannot disagree about what exists.
 */
export function renderableTemplateLayouts(layouts: unknown): TemplateLayout[] {
  if (!Array.isArray(layouts)) return [];
  return layouts.filter(
    (layout): layout is TemplateLayout =>
      typeof layout === "object" &&
      layout !== null &&
      Array.isArray((layout as TemplateLayout).components),
  );
}

/**
 * One synthetic v2-standard deck with one slide per layout, in template
 * order. Null when the template carries no renderable layouts — the caller
 * renders its honest "no layouts" state instead of an empty stage.
 */
export function buildTemplatePreviewDeck(
  input: TemplatePreviewDeckInput,
): PresentationDeck | null {
  const layouts = renderableTemplateLayouts(input.layouts);
  if (layouts.length === 0) return null;

  const deckId = templatePreviewDeckId(input.templateId);
  return {
    id: deckId,
    version: "v2-standard",
    content: "",
    n_slides: layouts.length,
    language: "auto",
    title: input.name,
    created_at: "",
    updated_at: "",
    tone: null,
    verbosity: null,
    slides: layouts.map((layout, index) => ({
      id: `template-layout-${index}`,
      presentation: deckId,
      layout_group: input.templateId,
      layout: layout.id,
      index,
      content: {},
      ui: hydrateSlide({ layout, content: {} }),
    })),
    fonts: input.fonts,
    theme: input.theme,
    generation_mode: "standard",
    type: "standard",
  };
}
