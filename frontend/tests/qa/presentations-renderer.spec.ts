/**
 * tests/qa/presentations-renderer.spec.ts — Task B1's pure-helper proof.
 *
 * The native viewer's foundation is data-only: wire types mirroring Presenton's
 * response models, the asset-path scan the owner-gated proxy (B2) uses for its
 * membership check, element frame math and the infographic/run vocabulary the
 * stage renderer (B3/B5) consumes. None of it touches the engine, the network
 * or a browser, so this project proves those contracts directly; the live
 * viewer (rail, present mode, asset proxy) is B4's `qa-presentation-ui`.
 *
 * Fixtures mirror shapes verified against the running engine (2026-09-16):
 * a generated verdant deck (`GET /api/v1/ppt/presentation/{id}`) and the
 * verdant template (`GET /api/v1/ppt/template/{id}`). The deck theme is the
 * `{name, description, data: {colors, fonts}, source, template_id}` package
 * the generation pipeline stores (`template_theme_for_presentation`).
 */
import { test, expect } from "@playwright/test";
import {
  applyBoundedMove,
  applyElementMove,
  applyElementResize,
  canFrameResize,
  canGroupSelection,
  canUngroupSelection,
  commandForArrowKey,
  elementGeometry,
  groupSelection,
  isEditableTarget,
  normalizeRotation,
  pointerAngle,
  reorderSelection,
  resizeFrame,
  rotationFromGesture,
  selectionFrames,
  stageDelta,
  supportsResize,
  ungroupSelection,
  unionFrame,
  Z_ORDER_SHORTCUTS,
} from "../../lib/presentation/editorOps";
import {
  chartConfig,
  collectAssetPaths,
  collectTemplateAssetPaths,
  componentFrame,
  deckAssetUrl,
  deckFontEntries,
  deckFontKind,
  elementBox,
  elementFrame,
  flexFrameSize,
  flowChildSize,
  gaugeArcPath,
  gridColumnTemplate,
  gridRowTemplate,
  infographicBaseColor,
  infographicHighlightColor,
  infographicMetrics,
  infographicPalette,
  infographicRenderer,
  infographicTextColor,
  isTextRun,
  mergeRunFont,
  resolveDeckFontFamily,
  resolveDeckTheme,
  tableCellBaseFont,
  tableCellFrameFont,
  vectorGeometry,
} from "../../lib/presentation/elements";
import { hydrateSlide } from "../../lib/presentation/hydrateSlide";
import {
  applyRunFont,
  fontAtOffset,
  isLatexRun,
  mergeAdjacentRuns,
  rangeSupportsRunFormatting,
  runsPlainText,
  runsSignature,
  splitRunsAt,
  toggleRunFont,
} from "../../lib/presentation/textRuns";
import {
  applyImageBorderRadius,
  applyImageCrop,
  applyImageFit,
  applyImageFlip,
  applyImageOpacity,
  applyImageSource,
  clampImageCropScale,
  clampImageFocus,
  IMAGE_CROP_SCALE_MAX,
  IMAGE_CROP_SCALE_MIN,
  IMAGE_FOCUS_MAX,
  IMAGE_FOCUS_MIN,
} from "../../lib/presentation/imageOps";
import {
  isPresentonPlaceholderImage,
  normalizePresentonIcon,
  normalizePresentonImage,
  normalizePresentonImageSearch,
} from "../../lib/integrations/presenton";
import {
  classifyImageSource,
  filterScopedImages,
  isEnginePublicImageSource,
  isExternalImageSource,
  isImageInScope,
} from "../../lib/presentation/imageScope";
import {
  applyIconColor,
  applyIconSource,
  DEFAULT_ICON_WEIGHT,
  ICON_WEIGHTS,
  iconWeightFromPath,
  isSvgIconSource,
  normalizeIconColor,
  normalizeIconPath,
  normalizeIconWeight,
  recolorSvg,
  recoloredIconDataUri,
  sanitizeSvgMarkup,
  svgDataUri,
} from "../../lib/presentation/icons";
import type {
  ChartElement,
  ChartType,
  DeckSlide,
  DeckTheme,
  DeckThemeColors,
  DeckThemePackage,
  FlexElement,
  Font,
  GridElement,
  ImageElement,
  InfographicElement,
  LatexTextRun,
  PresentationDeck,
  PresentationTemplate,
  SlideComponent,
  SlideElement,
  TableCell,
  TableElement,
  TemplateLayout,
  TextElement,
  TextListElement,
  TextRun,
  TextRunValue,
  VectorElement,
} from "../../lib/presentation/types";

const POPPINS_URL = "/vendor/fonts/sans_serif/poppins/Poppins-Regular.ttf";
const GOOGLE_DM_SANS =
  "https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,700;1,400&display=swap";

/** The exact sixteen-role palette every template theme carries. */
function themeColors(): DeckThemeColors {
  return {
    primary: "#285F20",
    background: "#FFFFFF",
    card: "#D5E0D0",
    stroke: "#BCCAB7",
    background_text: "#03362D",
    primary_text: "#FFFFFF",
    graph_0: "#285F20",
    graph_1: "#174F45",
    graph_2: "#03362D",
    graph_3: "#B4CFA2",
    graph_4: "#B8CBAA",
    graph_5: "#72936A",
    graph_6: "#2D856A",
    graph_7: "#203F5F",
    graph_8: "#4B2D85",
    graph_9: "#5F2055",
  };
}

/**
 * One deck whose asset strings appear in a known order: slide `content`, then
 * the hydrated `ui` tree (with duplicates, nested children and non-asset
 * strings), then the `fonts` map and the theme package's font URL.
 */
function assetDeck(): PresentationDeck {
  return {
    id: "dad03d51-5149-4d70-b0e0-6a1e0f5a0a01",
    version: "v2-standard",
    content: "Photosynthesis: the light-dependent reactions and the Calvin cycle.",
    n_slides: 1,
    language: "English",
    title: "Plant Photosynthesis",
    created_at: "2026-09-16T00:00:00Z",
    updated_at: "2026-09-16T00:00:00Z",
    tone: "default",
    verbosity: "standard",
    slides: [
      {
        id: "6c9c2f4e-8f2a-4f5d-9f0e-2b1a7c3d4e50",
        presentation: "dad03d51-5149-4d70-b0e0-6a1e0f5a0a01",
        layout_group: "verdant",
        layout: "corner_ribbons_with_centered_title_and_footer_metadata_3547",
        index: 0,
        content: {
          title: "Plant Photosynthesis",
          hero_image: "/app_data/images/photosynthesis-cover.png",
        },
        html_content: null,
        speaker_note: "Welcome.",
        properties: null,
        ui: {
          id: "corner_ribbons_with_centered_title_and_footer_metadata_3547",
          description:
            "Centered title over opposing corner ribbons with footer metadata.",
          components: [
            {
              id: "opposing_corner_ribbons",
              description: "Decorative corner ribbons.",
              position: { x: -56.38, y: -109.29 },
              elements: [
                {
                  type: "image",
                  position: { x: 721.49, y: 601.69 },
                  size: { width: 614.89, height: 327.59 },
                  data: "/app_data/images/photosynthesis-cover.png",
                  fit: "cover",
                  focus_y: 100,
                  clip_path:
                    "path('M 0 0 L 614.89 0 L 614.89 327.59 L 0 327.59 L 0 0 Z')",
                  decorative: true,
                  name: "bottom_right_corner_ribbon",
                  is_icon: false,
                },
                {
                  type: "image",
                  data: "https://images.example.com/stock-photo.png",
                  decorative: false,
                  name: "stock_photo",
                  is_icon: false,
                },
                {
                  type: "image",
                  data: "/app_data/templates/verdant/static/Freeform_2-4821b2b63f0e.png",
                  decorative: true,
                  name: "top_left_corner_ribbon",
                  is_icon: false,
                },
                {
                  type: "image",
                  data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
                  decorative: false,
                  name: "inline_placeholder",
                  is_icon: false,
                },
                {
                  type: "image",
                  data: "/static/icons/lightbulb.svg",
                  decorative: false,
                  name: "concept_icon",
                  is_icon: true,
                },
                {
                  type: "flex",
                  position: { x: 0, y: 0 },
                  size: { width: 400, height: 120 },
                  direction: "column",
                  align_items: "center",
                  gap: 3.32,
                  name: "nested_caption_stack",
                  children: [
                    {
                      type: "text",
                      position: { x: 0, y: 0 },
                      size: { width: 400, height: 90 },
                      runs: [{ text: "Nested caption" }],
                      name: "nested_caption",
                    },
                    {
                      type: "image",
                      position: { x: 0, y: 90 },
                      size: { width: 200, height: 30 },
                      data: "/app_data/images/nested-diagram.png",
                      decorative: false,
                      name: "nested_diagram",
                      is_icon: false,
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
    fonts: {
      Poppins: POPPINS_URL,
      "DM Sans": GOOGLE_DM_SANS,
      Tinos: "/app_data/templates/verdant/static/Tinos.ttf",
    },
    theme: {
      name: "Verdant Theme",
      description: "Refined, organic layouts.",
      data: {
        colors: themeColors(),
        fonts: {
          textFont: { name: "DM Sans", url: GOOGLE_DM_SANS },
        },
      },
      source: "template",
      template_id: "verdant",
    },
    generation_mode: "standard",
    type: "standard",
    community_design_ids: null,
  };
}

/** A complete deck whose strings carry no `/app_data/`, `/static/`, `/vendor/` path. */
function plainDeck(): PresentationDeck {
  return {
    id: "7f0e1d2c-3b4a-5968-7788-99aabbccddee",
    version: null,
    content: "A deck with no engine assets.",
    n_slides: 1,
    language: "English",
    title: null,
    created_at: "2026-09-16T00:00:00Z",
    updated_at: "2026-09-16T00:00:00Z",
    tone: null,
    verbosity: null,
    slides: [
      {
        id: "2b3c4d5e-6f70-4819-9a0b-1c2d3e4f5061",
        presentation: "7f0e1d2c-3b4a-5968-7788-99aabbccddee",
        layout_group: "blank",
        layout: "__blank_slide__",
        index: 0,
        content: { title: "No assets here" },
        html_content: null,
        speaker_note: null,
        properties: null,
        ui: {
          id: "__blank_slide__",
          description: "Blank slide.",
          components: [
            {
              id: "title_block",
              description: "Title only.",
              position: { x: 0, y: 0 },
              elements: [
                {
                  type: "text",
                  position: { x: 0, y: 0 },
                  size: { width: 800, height: 90 },
                  runs: [{ text: "No assets here" }],
                  name: "title",
                },
              ],
            },
          ],
        },
      },
    ],
    fonts: { "DM Sans": GOOGLE_DM_SANS },
    theme: null,
    generation_mode: "standard",
    type: "standard",
    community_design_ids: null,
  };
}

function verdantTemplate(): PresentationTemplate {
  return {
    id: "verdant",
    name: "Verdant",
    description: "Refined, organic layouts with expressive serif typography.",
    layout_count: 1,
    thumbnail: "/app_data/templates/verdant/static/thumbnail.png",
    preview_url:
      "http://localhost:5001/template-preview?templateV2Id=verdant",
    is_default: true,
    created_at: "2026-09-16T00:00:00Z",
    updated_at: "2026-09-16T00:00:00Z",
    merged_components: {
      components: [
        {
          id: "background_canvas",
          description: "Full slide canvas.",
          variants: [
            {
              id: "background_canvas",
              description: "Full slide canvas.",
              position: { x: 0, y: 0 },
              elements: [
                {
                  type: "image",
                  data: "/app_data/templates/verdant/static/merged-shape.png",
                  decorative: true,
                  name: "canvas_texture",
                  is_icon: false,
                },
              ],
            },
          ],
        },
      ],
    },
    layouts: {
      layouts: [
        {
          id: "corner_ribbons_with_centered_title_and_footer_metadata_3547",
          description: "Corner ribbons with a centered title.",
          components: [
            {
              id: "centered_title_block",
              description: "Centered title stack.",
              position: { x: 15.52, y: 235.5 },
              elements: [
                {
                  type: "image",
                  data: "/app_data/templates/verdant/static/layout-image.png",
                  decorative: false,
                  name: "layout_image",
                  is_icon: false,
                },
              ],
            },
          ],
        },
      ],
    },
    theme: {
      colors: themeColors(),
      fonts: { textFont: { name: "Poppins", url: POPPINS_URL } },
    },
    fonts: {
      Tinos: "/app_data/templates/verdant/static/Tinos.ttf",
      "DM Sans": GOOGLE_DM_SANS,
      Poppins: POPPINS_URL,
    },
  };
}

test.describe("collectAssetPaths (deck)", () => {
  test("collects ui/content/theme/fonts asset strings once, in first-seen order", () => {
    expect(collectAssetPaths(assetDeck())).toEqual([
      "/app_data/images/photosynthesis-cover.png",
      "/app_data/templates/verdant/static/Freeform_2-4821b2b63f0e.png",
      "/static/icons/lightbulb.svg",
      "/app_data/images/nested-diagram.png",
      POPPINS_URL,
      "/app_data/templates/verdant/static/Tinos.ttf",
    ]);
  });

  test("returns nothing when the deck references no engine asset", () => {
    expect(collectAssetPaths(plainDeck())).toEqual([]);
  });
});

test.describe("collectTemplateAssetPaths", () => {
  test("collects thumbnail, layout, merged-component and font assets once", () => {
    expect(collectTemplateAssetPaths(verdantTemplate())).toEqual([
      "/app_data/templates/verdant/static/thumbnail.png",
      "/app_data/templates/verdant/static/merged-shape.png",
      "/app_data/templates/verdant/static/layout-image.png",
      POPPINS_URL,
      "/app_data/templates/verdant/static/Tinos.ttf",
    ]);
  });
});

const CENTERED_TITLE_BLOCK: SlideComponent = {
  id: "centered_title_block",
  description: "Centered title stack.",
  position: { x: 15.52, y: 235.5 },
  elements: [],
};

const FOOTER_ROW: SlideComponent = {
  id: "footer_metadata_row",
  description: "Footer metadata row.",
  position: { x: 43.33, y: 655.88 },
  elements: [],
};

test.describe("elementFrame", () => {
  test("adds the component origin to the element position, keeping the element size", () => {
    const title: SlideElement = {
      type: "text",
      position: { x: 0, y: 0 },
      size: { width: 1242.7449374490159, height: 201.4 },
      runs: [{ text: "Plant Photosynthesis" }],
      name: "title",
    };
    expect(elementFrame(title, CENTERED_TITLE_BLOCK)).toEqual({
      x: 15.52,
      y: 235.5,
      width: 1242.7449374490159,
      height: 201.4,
    });

    const footer: SlideElement = {
      type: "text",
      position: { x: 12.5, y: -4 },
      size: { width: 200, height: 20.78 },
      runs: [{ text: "Footer" }],
      name: "footer_left_label",
    };
    expect(elementFrame(footer, FOOTER_ROW)).toEqual({
      x: 55.83,
      y: 651.88,
      width: 200,
      height: 20.78,
    });
  });

  test("treats absent geometry as zero (vectors carry points, not frames)", () => {
    const vector: SlideElement = {
      type: "vector",
      shape: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 1280, y: 0 },
        { x: 1280, y: 720 },
      ],
      closed: true,
      fill: { color: "#F4F4F4" },
    };
    expect(elementFrame(vector, CENTERED_TITLE_BLOCK)).toEqual({
      x: 15.52,
      y: 235.5,
      width: 0,
      height: 0,
    });

    const sizeless: SlideElement = {
      type: "text",
      position: { x: 10, y: 20 },
      runs: [{ text: "No size yet" }],
      name: "sizeless",
    };
    expect(elementFrame(sizeless, FOOTER_ROW)).toEqual({
      x: 53.33,
      y: 675.88,
      width: 0,
      height: 0,
    });
  });
});

test.describe("infographicRenderer", () => {
  test("returns each of the three natively rendered types", () => {
    expect(infographicRenderer("gauge")).toBe("gauge");
    expect(infographicRenderer("progress_bar")).toBe("progress_bar");
    expect(infographicRenderer("vertical_funnel")).toBe("vertical_funnel");
  });

  test("returns null for every other type (the honest placeholder path)", () => {
    for (const type of [
      "mind_map",
      "gantt",
      "timeline",
      "conversion_funnel",
      "text",
      "",
      "GAUGE",
    ]) {
      expect(infographicRenderer(type), `must not render ${type}`).toBeNull();
    }
  });
});

test.describe("isTextRun", () => {
  test("accepts run-shaped objects", () => {
    expect(isTextRun({ text: "" })).toBe(true);
    expect(isTextRun({ text: "Plant Photosynthesis" })).toBe(true);
    expect(
      isTextRun({ text: "Plant", font: { size: 124.44, family: "Tinos Bold" } }),
    ).toBe(true);
  });

  test("rejects LaTeX runs, plain strings and malformed values", () => {
    const run: TextRun = { text: "Plant" };
    expect(isTextRun(run)).toBe(true);
    for (const value of [
      { type: "latex", latex: "x^2" },
      { latex: "x^2" },
      { text: 42 },
      { text: null },
      "Plant",
      null,
      undefined,
      7,
      [],
    ]) {
      expect(isTextRun(value), `must reject ${JSON.stringify(value)}`).toBe(
        false,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Task D2 — rich text run editing (spec §5.4 "Inline text", §6.4)
//
// The pure half of the inline run editor: selection offsets address the
// concatenated run text (a LaTeX run contributes its raw source), a font
// patch splits runs at both selection boundaries and applies only to the
// selected range, and runs whose styles end up identical merge back. LaTeX
// runs have no native formatter: they stay byte-for-byte and a boundary that
// falls inside one snaps to its edge. The live editor + toolbar are proved in
// `qa-presentation-ui`.
// ---------------------------------------------------------------------------

test.describe("text run editing", () => {
  test("splits runs at both selection boundaries", () => {
    const runs: TextRun[] = [
      { text: "Alpha Beta", font: { size: 24, color: "#111827" } },
      { text: " Gamma", font: { size: 24 } },
    ];

    // Boundaries (start of text, between runs, end of text) split nothing.
    expect(splitRunsAt(runs, 0)).toBe(runs);
    expect(splitRunsAt(runs, 10)).toBe(runs);
    expect(splitRunsAt(runs, 16)).toBe(runs);

    expect(splitRunsAt(runs, 6)).toEqual([
      { text: "Alpha ", font: { size: 24, color: "#111827" } },
      { text: "Beta", font: { size: 24, color: "#111827" } },
      { text: " Gamma", font: { size: 24 } },
    ]);
    // The source structure was not mutated.
    expect(runs).toHaveLength(2);
  });

  test("applies a font patch to the selected range and preserves unselected runs byte-for-byte", () => {
    const runs: TextRun[] = [
      { text: "Alpha Beta", font: { size: 24, color: "#111827" } },
      { text: " Gamma", font: { size: 24 } },
    ];

    const next = applyRunFont(runs, { start: 6, end: 10 }, { bold: true });

    expect(next).toEqual([
      { text: "Alpha ", font: { size: 24, color: "#111827" } },
      { text: "Beta", font: { size: 24, color: "#111827", bold: true } },
      { text: " Gamma", font: { size: 24 } },
    ]);
    expect(runs[0]).toEqual({
      text: "Alpha Beta",
      font: { size: 24, color: "#111827" },
    });
  });

  test("returns the same array when a patch changes nothing", () => {
    const runs: TextRun[] = [{ text: "Bold", font: { bold: true } }];
    expect(applyRunFont(runs, { start: 0, end: 4 }, { bold: true })).toBe(runs);
    expect(applyRunFont(runs, { start: 2, end: 2 }, { italic: true })).toBe(runs);
    expect(applyRunFont([], { start: 0, end: 4 }, { bold: true })).toEqual([]);
  });

  test("merges identical adjacent runs after a patch", () => {
    const runs: TextRun[] = [
      { text: "ab", font: { bold: true } },
      { text: "cd", font: { bold: true } },
    ];
    const merged = mergeAdjacentRuns(runs);
    expect(merged).toEqual([{ text: "abcd", font: { bold: true } }]);
    expect(merged).not.toBe(runs);

    // Patching a range that spans both runs leaves them merged.
    expect(applyRunFont(runs, { start: 0, end: 4 }, { italic: true })).toEqual([
      { text: "abcd", font: { bold: true, italic: true } },
    ]);
    // No change: the pre-existing structure is returned untouched.
    expect(applyRunFont(runs, { start: 0, end: 4 }, { bold: true })).toBe(runs);
  });

  test("never merges across the selection boundary into an unselected run", () => {
    const runs: TextRun[] = [
      { text: "Bold", font: { bold: true } },
      { text: " plain" },
    ];
    const next = applyRunFont(runs, { start: 4, end: 10 }, { bold: true });
    expect(next).toEqual([
      { text: "Bold", font: { bold: true } },
      { text: " plain", font: { bold: true } },
    ]);
  });

  test("keeps LaTeX runs byte-for-byte inside the range and snaps boundaries inside them", () => {
    const latex: LatexTextRun = {
      type: "latex",
      latex: "x^2",
      font: { size: 12 },
    };
    const runs: TextRunValue[] = [
      { text: "Area " },
      latex,
      { text: " end" },
    ];

    // "Area " is 0..5, the LaTeX run 5..8, " end" 8..12.
    const next = applyRunFont(runs, { start: 6, end: 12 }, { color: "#FF0000" });
    expect(next).toEqual([
      { text: "Area " },
      latex,
      { text: " end", font: { color: "#FF0000" } },
    ]);
    // Byte-for-byte: the LaTeX run object is the same reference.
    expect(next[1]).toBe(latex);

    // A LaTeX interior boundary cannot split the run.
    expect(splitRunsAt(runs, 6)).toBe(runs);
    // A range covering only the LaTeX run is not formattable; text ranges are.
    expect(rangeSupportsRunFormatting(runs, { start: 5, end: 8 })).toBe(false);
    expect(rangeSupportsRunFormatting(runs, { start: 6, end: 7 })).toBe(false);
    expect(rangeSupportsRunFormatting(runs, { start: 5, end: 9 })).toBe(true);
    expect(rangeSupportsRunFormatting(runs, { start: 0, end: 5 })).toBe(true);
    expect(rangeSupportsRunFormatting(runs, { start: 8, end: 8 })).toBe(false);
    expect(rangeSupportsRunFormatting([], { start: 0, end: 1 })).toBe(false);
  });

  test("toggleRunFont flips the effective value at the selection start", () => {
    const runs: TextRun[] = [
      { text: "Bold", font: { bold: true } },
      { text: " plain" },
    ];
    const base: Font = { size: 24 };

    expect(toggleRunFont(runs, { start: 0, end: 4 }, base, "bold")).toEqual([
      { text: "Bold", font: { bold: false } },
      { text: " plain" },
    ]);
    expect(toggleRunFont(runs, { start: 4, end: 10 }, base, "bold")).toEqual([
      { text: "Bold", font: { bold: true } },
      { text: " plain", font: { bold: true } },
    ]);
    // The base font's value is the toggle's starting point.
    expect(toggleRunFont(runs, { start: 4, end: 10 }, { bold: true }, "bold")).toEqual([
      { text: "Bold", font: { bold: true } },
      { text: " plain", font: { bold: false } },
    ]);
  });

  test("fontAtOffset merges the base font under the run's own font", () => {
    const runs: TextRunValue[] = [
      { text: "ab", font: { color: "#FF0000" } },
      { type: "latex", latex: "x", font: { italic: true } },
    ];
    expect(fontAtOffset(runs, { size: 24 }, 0)).toEqual({
      size: 24,
      color: "#FF0000",
    });
    expect(fontAtOffset(runs, { size: 24 }, 1)).toEqual({
      size: 24,
      color: "#FF0000",
    });
    // A boundary reads the run that starts there; past the end reads the last.
    expect(fontAtOffset(runs, { size: 24 }, 2)).toEqual({
      size: 24,
      italic: true,
    });
    expect(fontAtOffset(runs, { size: 24 }, 99)).toEqual({
      size: 24,
      italic: true,
    });
    expect(fontAtOffset([], { size: 24 }, 0)).toEqual({ size: 24 });
    expect(fontAtOffset([], null, 0)).toEqual({});
  });

  test("runsPlainText joins text runs and LaTeX source in order", () => {
    expect(
      runsPlainText([
        { text: "Area " },
        { type: "latex", latex: "x^2" },
        { text: " end" },
      ]),
    ).toBe("Area x^2 end");
    expect(runsPlainText(undefined)).toBe("");
    expect(runsPlainText([{ text: "" }])).toBe("");
  });

  test("preserves unknown run fields through a split and a patch", () => {
    const runs = [
      { text: "hi there", font: { size: 10 }, max_length: 40 },
    ] as unknown as TextRun[];
    const next = applyRunFont(runs, { start: 0, end: 2 }, { bold: true }) as Array<
      Record<string, unknown>
    >;
    expect(next).toEqual([
      { text: "hi", font: { size: 10, bold: true }, max_length: 40 },
      { text: " there", font: { size: 10 }, max_length: 40 },
    ]);
  });

  test("removes a font property when the patch value is null", () => {
    const runs: TextRun[] = [{ text: "hi", font: { bold: true, size: 10 } }];
    expect(applyRunFont(runs, { start: 0, end: 2 }, { bold: null })).toEqual([
      { text: "hi", font: { size: 10 } },
    ]);
  });

  test("isLatexRun separates raw LaTeX runs from plain and malformed values", () => {
    const latex: LatexTextRun = { type: "latex", latex: "x^2" };
    expect(isLatexRun(latex)).toBe(true);
    expect(isLatexRun({ type: "latex", latex: "x^2", font: { size: 12 } })).toBe(
      true,
    );
    for (const value of [
      { text: "plain" },
      "plain",
      { type: "latex" },
      { type: "latex", latex: 7 },
      null,
      undefined,
      7,
    ]) {
      expect(isLatexRun(value), `must reject ${JSON.stringify(value)}`).toBe(
        false,
      );
    }
  });

  test("runsSignature is stable across equal structures and differs on changes", () => {
    const a: TextRunValue[] = [{ text: "a", font: { size: 10, bold: true } }];
    const b: TextRunValue[] = [{ text: "a", font: { bold: true, size: 10 } }];
    expect(runsSignature(a)).toBe(runsSignature(b));
    expect(runsSignature(a)).not.toBe(runsSignature([{ text: "a" }]));
  });
});

// ---------------------------------------------------------------------------
// Task B3 — stage geometry, theme resolution, asset URLs and deck fonts
//
// The renderer's pure half: the fork-calibrated box math it positions every
// element with (`presenton-ui/lib/template-v2-json-to-html.ts`), the theme
// resolver the stage applies as CSS variables, the asset-proxy URL builder and
// the deck-font classification/mapping used by `DeckFontFace`. The React tree
// itself has no component-test infra here; B4 and the controller verify it
// live (recorded in the B3 report).
// ---------------------------------------------------------------------------

/** The flat `DeckTheme` (templates) for resolver tests. */
function flatTheme(): DeckTheme {
  return {
    colors: themeColors(),
    fonts: { textFont: { name: "DM Sans", url: GOOGLE_DM_SANS } },
  };
}

/** The stored package shape (`template_theme_for_presentation`). */
function themePackage(): DeckThemePackage {
  return {
    name: "Verdant Theme",
    description: "Refined, organic layouts.",
    data: flatTheme(),
    source: "template",
    template_id: "verdant",
  };
}

test.describe("resolveDeckTheme", () => {
  test("returns the flat theme unchanged", () => {
    const theme = flatTheme();
    expect(resolveDeckTheme(theme)).toBe(theme);
  });

  test("resolves the stored package to its data", () => {
    const theme = themePackage();
    expect(resolveDeckTheme(theme)).toBe(theme.data);
  });

  test("returns null for null, undefined and malformed themes", () => {
    expect(resolveDeckTheme(null)).toBeNull();
    expect(resolveDeckTheme(undefined)).toBeNull();
    expect(
      resolveDeckTheme({ data: null } as unknown as DeckThemePackage),
    ).toBeNull();
    expect(
      resolveDeckTheme({} as unknown as PresentationDeck["theme"]),
    ).toBeNull();
    expect(
      resolveDeckTheme({ data: {} } as unknown as DeckThemePackage),
    ).toBeNull();
  });
});

function triangleVector(overrides: Partial<VectorElement> = {}): VectorElement {
  return {
    type: "vector",
    shape: "polygon",
    points: [
      { x: 100, y: 40 },
      { x: 300, y: 40 },
      { x: 200, y: 180 },
    ],
    closed: true,
    fill: { color: "#F4F4F4" },
    stroke: { color: "#101828", width: 4 },
    ...overrides,
  };
}

test.describe("vectorGeometry", () => {
  test("derives the polygon frame from its points (fork polygonBox)", () => {
    const geometry = vectorGeometry(triangleVector());
    expect(geometry.shape).toBe("polygon");
    expect(geometry.closed).toBe(true);
    expect(geometry.box).toEqual({ x: 100, y: 40, width: 200, height: 140 });
    expect(geometry.points).toHaveLength(3);
  });

  test("floors a degenerate box at the stroke width (fork max(delta, stroke, 1))", () => {
    const geometry = vectorGeometry(
      triangleVector({
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
        ],
        closed: false,
        stroke: { color: "#101828", width: 12 },
      }),
    );
    expect(geometry.box).toEqual({ x: 10, y: 10, width: 40, height: 12 });
  });

  test("defaults an empty point list to a 1×1 box at the origin", () => {
    expect(vectorGeometry(triangleVector({ points: [] })).box).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  test("drops non-finite points instead of poisoning the frame", () => {
    const geometry = vectorGeometry(
      triangleVector({
        points: [
          { x: 5, y: 5 },
          { x: Number.NaN, y: 5 },
          { x: 5, y: Number.POSITIVE_INFINITY },
        ],
      }),
    );
    expect(geometry.points).toEqual([{ x: 5, y: 5 }]);
  });

  test("derives an ellipse frame from the source points and always closes it", () => {
    const geometry = vectorGeometry(
      triangleVector({
        shape: "ellipse",
        points: [
          { x: 0, y: 0 },
          { x: 200, y: 120 },
        ],
        closed: null,
      }),
    );
    expect(geometry.shape).toBe("ellipse");
    expect(geometry.closed).toBe(true);
    expect(geometry.box).toEqual({ x: 0, y: 0, width: 200, height: 120 });
  });

  test("samples a smooth curve with the declared tension and segments", () => {
    const geometry = vectorGeometry(
      triangleVector({
        closed: false,
        curve: { type: "smooth", tension: 0.4, segments: 8 },
      }),
    );
    expect(geometry.points).toHaveLength(17);
  });

  test("leaves points straight when there is no smooth curve", () => {
    expect(
      vectorGeometry(triangleVector({ closed: false })).points,
    ).toHaveLength(3);
  });

  test("rounds closed corners when corner_radii is present", () => {
    const geometry = vectorGeometry(
      triangleVector({
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        corner_radii: [20, 20, 20, 20],
      }),
    );
    expect(geometry.points).toHaveLength(36);
    expect(geometry.box).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
});

function sizedText(
  x: number,
  y: number,
  width: number,
  height: number,
  name = "text",
): SlideElement {
  return {
    type: "text",
    position: { x, y },
    size: { width, height },
    runs: [{ text: name }],
    name,
  };
}

test.describe("elementBox / componentFrame / childrenBounds", () => {
  test("uses position and size when the wire carries them", () => {
    expect(elementBox(sizedText(10, 20, 100, 50))).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
  });

  test("defaults missing position to 0 and leaves size absent", () => {
    expect(elementBox({ type: "text", runs: [{ text: "x" }], name: "t" })).toEqual(
      { x: 0, y: 0 },
    );
  });

  test("derives a group frame from its children's right/bottom edges", () => {
    const group: SlideElement = {
      type: "group",
      name: "g",
      children: [
        sizedText(10, 20, 100, 50, "first"),
        { type: "image", data: "/app_data/x.png", position: { x: 0, y: 80 }, size: { width: 40, height: 30 }, name: "second" },
      ],
    };
    expect(elementBox(group)).toEqual({ x: 0, y: 0, width: 110, height: 110 });
  });

  test("falls back to 1×1 for an empty group", () => {
    expect(elementBox({ type: "group", name: "empty", children: [] })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  test("defaults a children-less group to 1×1 instead of throwing", () => {
    const group = { type: "group", name: "no-children" } as unknown as SlideElement;
    expect(elementBox(group)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    const malformed = {
      type: "group",
      name: "string-children",
      children: "",
    } as unknown as SlideElement;
    expect(elementBox(malformed)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  test("derives vector frames from points and ignores position/size", () => {
    const vector = triangleVector({
      position: { x: 999, y: 999 },
      size: { width: 10, height: 10 },
    });
    expect(elementBox(vector)).toEqual({
      x: 100,
      y: 40,
      width: 200,
      height: 140,
    });
  });

  test("componentFrame places the component and sizes it to its elements", () => {
    const component: SlideComponent = {
      ...CENTERED_TITLE_BLOCK,
      elements: [
        {
          type: "text",
          position: { x: 0, y: 0 },
          size: { width: 1242.7449374490159, height: 201.4 },
          runs: [{ text: "Plant Photosynthesis" }],
          name: "title",
        },
      ],
    };
    expect(componentFrame(component)).toEqual({
      x: 15.52,
      y: 235.5,
      width: 1242.7449374490159,
      height: 201.4,
    });
  });
});

test.describe("flowChildSize", () => {
  test("uses explicit size, group children bounds, vector points, or 1", () => {
    expect(flowChildSize(sizedText(0, 0, 100, 50))).toEqual({
      width: 100,
      height: 50,
    });
    expect(
      flowChildSize({
        type: "group",
        name: "g",
        children: [sizedText(10, 20, 290, 70, "inside")],
      }),
    ).toEqual({ width: 300, height: 90 });
    expect(
      flowChildSize(
        triangleVector({
          points: [
            { x: 0, y: 0 },
            { x: 80, y: 30 },
          ],
          closed: false,
          stroke: null,
        }),
      ),
    ).toEqual({ width: 80, height: 30 });
    expect(flowChildSize({ type: "text", runs: [{ text: "x" }], name: "t" })).toEqual(
      { width: 1, height: 1 },
    );
  });
});

const TABLE_BASE_FONT: Font = {
  family: "Arial",
  size: 18,
  color: "#111827",
  line_height: 1.15,
};

test.describe("table cell font precedence", () => {
  test("keeps the first run's font off later runs' base", () => {
    const cell: TableCell = {
      runs: [
        {
          text: "first",
          font: {
            color: "#FF0000",
            size: 40,
            bold: true,
            family: "Tinos",
            line_height: 2,
            letter_spacing: 3,
          },
        },
        { text: "second" },
      ],
    };
    const base = tableCellBaseFont(TABLE_BASE_FONT, cell, false);
    expect(base).toEqual(TABLE_BASE_FONT);
    const secondRun = mergeRunFont(base, null);
    expect(secondRun.color).toBe("#111827");
    expect(secondRun.size).toBe(18);
    expect(secondRun.family).toBe("Arial");
    expect(secondRun.bold).toBeUndefined();
    expect(secondRun.line_height).toBe(1.15);
    expect(secondRun.letter_spacing).toBeUndefined();
  });

  test("still merges the first run's font into the cell frame", () => {
    const cell: TableCell = {
      runs: [
        { text: "first", font: { color: "#FF0000", size: 40 } },
        { text: "second" },
      ],
    };
    const frame = tableCellFrameFont(
      tableCellBaseFont(TABLE_BASE_FONT, cell, false),
      cell,
    );
    expect(frame.color).toBe("#FF0000");
    expect(frame.size).toBe(40);
    expect(frame.family).toBe("Arial");
  });

  test("cell font wins over the table base, run font wins over both", () => {
    const cell: TableCell = {
      font: { color: "#03362D", size: 24 },
      runs: [{ text: "first", font: { size: 32 } }],
    };
    const base = tableCellBaseFont(TABLE_BASE_FONT, cell, false);
    expect(base.color).toBe("#03362D");
    expect(base.size).toBe(24);
    const frame = tableCellFrameFont(base, cell);
    expect(frame.size).toBe(32);
    expect(mergeRunFont(base, { color: "#00FF00" }).color).toBe("#00FF00");
  });

  test("header bolds the base unless the cell or first run declares bold", () => {
    const plain: TableCell = { runs: [{ text: "h" }] };
    expect(tableCellBaseFont(TABLE_BASE_FONT, plain, true).bold).toBe(true);
    expect(tableCellBaseFont(TABLE_BASE_FONT, plain, false).bold).toBeUndefined();

    const declared: TableCell = { runs: [{ text: "h", font: { bold: false } }] };
    const base = tableCellBaseFont(TABLE_BASE_FONT, declared, true);
    expect(base.bold).toBeUndefined();
    expect(tableCellFrameFont(base, declared).bold).toBe(false);

    const explicit: TableCell = { font: { bold: true }, runs: [{ text: "h" }] };
    const explicitBase = tableCellBaseFont(TABLE_BASE_FONT, explicit, true);
    expect(explicitBase.bold).toBe(true);
    expect(tableCellFrameFont(explicitBase, explicit).bold).toBe(true);
  });
});

function flexElement(overrides: Partial<FlexElement> = {}): FlexElement {
  return {
    type: "flex",
    direction: "row",
    children: [],
    name: "flex",
    ...overrides,
  };
}

test.describe("flexFrameSize", () => {
  test("expands a row to its children plus gaps when it has no declared size", () => {
    const element = flexElement({
      gap: 10,
      children: [sizedText(0, 0, 100, 20, "a"), sizedText(0, 0, 50, 20, "b")],
    });
    expect(flexFrameSize(element)).toEqual({ width: 160 });
  });

  test("keeps a declared size that already contains the content", () => {
    const element = flexElement({
      gap: 10,
      position: { x: 0, y: 0 },
      size: { width: 400, height: 100 },
      children: [sizedText(0, 0, 100, 20, "a"), sizedText(0, 0, 50, 20, "b")],
    });
    expect(flexFrameSize(element)).toEqual({ width: 400, height: 100 });
  });

  test("expands the cross axis when wrap forces a second line", () => {
    const element = flexElement({
      wrap: true,
      gap: 10,
      position: { x: 0, y: 0 },
      size: { width: 250, height: 0 },
      children: [
        sizedText(0, 0, 100, 30, "a"),
        sizedText(0, 0, 100, 30, "b"),
        sizedText(0, 0, 100, 30, "c"),
      ],
    });
    expect(flexFrameSize(element)).toEqual({ width: 250, height: 70 });
  });

  test("returns the declared size unchanged with no children", () => {
    expect(
      flexFrameSize(
        flexElement({
          position: { x: 0, y: 0 },
          size: { width: 120, height: 40 },
        }),
      ),
    ).toEqual({ width: 120, height: 40 });
  });
});

function gridElement(overrides: Partial<GridElement> = {}): GridElement {
  return {
    type: "grid",
    columns: 3,
    children: [],
    name: "grid",
    ...overrides,
  };
}

test.describe("grid templates", () => {
  test("uses equal fractions without an explicit width", () => {
    expect(gridColumnTemplate(gridElement())).toBe(
      "repeat(3,minmax(0,1fr))",
    );
  });

  test("splits an explicit width minus gaps into fixed columns", () => {
    const element = gridElement({
      gap: 20,
      position: { x: 0, y: 0 },
      size: { width: 1000, height: 300 },
    });
    expect(gridColumnTemplate(element)).toBe("repeat(3,320px)");
  });

  test("returns null until rows are declared", () => {
    expect(gridRowTemplate(gridElement())).toBeNull();
    expect(gridRowTemplate(gridElement({ rows: null }))).toBeNull();
  });

  test("spans at least the rendered rows", () => {
    const element = gridElement({
      columns: 2,
      rows: 2,
      children: [
        sizedText(0, 0, 10, 10, "a"),
        sizedText(0, 0, 10, 10, "b"),
        sizedText(0, 0, 10, 10, "c"),
        sizedText(0, 0, 10, 10, "d"),
        sizedText(0, 0, 10, 10, "e"),
      ],
    });
    expect(gridRowTemplate(element)).toBe("repeat(3,minmax(0,1fr))");
  });

  test("splits an explicit height minus gaps", () => {
    const element = gridElement({
      columns: 2,
      rows: 2,
      gap: 10,
      position: { x: 0, y: 0 },
      size: { width: 500, height: 200 },
      children: [
        sizedText(0, 0, 10, 10, "a"),
        sizedText(0, 0, 10, 10, "b"),
        sizedText(0, 0, 10, 10, "c"),
        sizedText(0, 0, 10, 10, "d"),
      ],
    });
    expect(gridRowTemplate(element)).toBe("repeat(2,95px)");
  });
});

test.describe("deckAssetUrl", () => {
  test("routes engine mount paths through the owner-gated asset proxy", () => {
    expect(deckAssetUrl("abc", "/app_data/images/a b.png")).toBe(
      "/api/presentation/abc/asset?src=%2Fapp_data%2Fimages%2Fa%20b.png",
    );
    expect(deckAssetUrl("abc", "/vendor/fonts/x/Poppins-Regular.ttf")).toBe(
      "/api/presentation/abc/asset?src=%2Fvendor%2Ffonts%2Fx%2FPoppins-Regular.ttf",
    );
  });

  test("passes absolute, protocol-relative and data URLs through", () => {
    for (const url of [
      "https://images.example.com/stock.png",
      "http://images.example.com/stock.png",
      "//images.example.com/stock.png",
      "data:image/png;base64,iVBORw0KGgo=",
    ]) {
      expect(deckAssetUrl("abc", url)).toBe(url);
    }
  });

  test("returns null for relative and empty sources", () => {
    for (const src of ["static/foo.png", "images/foo.png", "", "   "]) {
      expect(deckAssetUrl("abc", src), `must reject ${src}`).toBeNull();
    }
  });
});

test.describe("deckFontKind", () => {
  test("classifies Google Fonts stylesheet URLs as stylesheets", () => {
    expect(deckFontKind(GOOGLE_DM_SANS)).toBe("stylesheet");
    expect(
      deckFontKind(
        "https://fonts.googleapis.com/css2?family=Poppins:wght@400&display=swap",
      ),
    ).toBe("stylesheet");
    expect(
      deckFontKind("https://fonts.googleapis.com/css?family=Inter"),
    ).toBe("stylesheet");
  });

  test("classifies engine-relative and absolute font files as files", () => {
    expect(deckFontKind(POPPINS_URL)).toBe("file");
    expect(deckFontKind("/app_data/templates/verdant/static/Tinos.ttf")).toBe(
      "file",
    );
    expect(deckFontKind("/app_data/fonts/Inter/Inter.woff2")).toBe("file");
    expect(
      deckFontKind("https://fonts.gstatic.com/s/dmsans/v1/x.woff2"),
    ).toBe("file");
  });
});

test.describe("deckFontEntries / resolveDeckFontFamily", () => {
  function entries() {
    return deckFontEntries({
      "DM Sans": GOOGLE_DM_SANS,
      Tinos: "/app_data/templates/verdant/static/Tinos.ttf",
      Poppins: POPPINS_URL,
      Empty: "",
    });
  }

  test("namespaces file families, keeps stylesheet families and skips empty URLs", () => {
    const list = entries();
    expect(list).toHaveLength(3);
    const dmSans = list.find((entry) => entry.family === "DM Sans");
    expect(dmSans).toMatchObject({ kind: "stylesheet", cssFamily: "DM Sans" });
    const tinos = list.find((entry) => entry.family === "Tinos");
    expect(tinos).toMatchObject({
      kind: "file",
      url: "/app_data/templates/verdant/static/Tinos.ttf",
    });
    expect(tinos?.cssFamily).toMatch(/^updeck-\d+-tinos$/);
    expect(list.every((entry) => entry.cssFamily !== "Empty")).toBe(true);
  });

  test("maps an exact file family to its namespaced name", () => {
    const list = entries();
    const tinos = list.find((entry) => entry.family === "Tinos");
    expect(resolveDeckFontFamily("Tinos", list)).toBe(tinos?.cssFamily);
  });

  test("maps a weight-suffixed variant onto the base file family", () => {
    const list = entries();
    const tinos = list.find((entry) => entry.family === "Tinos");
    expect(resolveDeckFontFamily("Tinos Bold", list)).toBe(tinos?.cssFamily);
    expect(resolveDeckFontFamily("Tinos Italic", list)).toBe(tinos?.cssFamily);
    expect(resolveDeckFontFamily("DM Sans Bold", list)).toBe("DM Sans");
  });

  test("keeps stylesheet families at their declared name", () => {
    const list = entries();
    expect(resolveDeckFontFamily("DM Sans", list)).toBe("DM Sans");
  });

  test("returns the family unchanged when unmapped, and null when absent", () => {
    const list = entries();
    expect(resolveDeckFontFamily("Times New Roman", list)).toBe(
      "Times New Roman",
    );
    expect(resolveDeckFontFamily(null, list)).toBeNull();
    expect(resolveDeckFontFamily(undefined, list)).toBeNull();
    expect(resolveDeckFontFamily("", list)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Task B5 — Chart.js configuration (spec §6.6)
//
// `chartConfig` is the pure half of the Chart.js renderer: the wire chart
// model (`ChartElement`, verified against the bundled templates on
// 2026-09-16) mapped onto a Chart.js configuration object, calibrated against
// the fork's `chartConfig` in `presenton-ui/lib/template-v2-json-to-html.ts`.
// All eleven wire `chart_type` values map, including `radar`/`polar_area`
// (enum-only, absent from the templates). Because the config is a plain
// object, this spec inspects it structurally — the DOM-side wiring (canvas
// lifecycle, datalabels registration) is `ChartElement`'s job and is
// verified in the browser.
// ---------------------------------------------------------------------------

/** The subset of a Chart.js dataset this spec asserts on. */
type ChartJsDataset = {
  label?: string;
  data?: unknown;
  backgroundColor?: unknown;
  borderColor?: unknown;
  borderWidth?: number;
  borderRadius?: number;
  borderSkipped?: unknown;
  fill?: boolean;
  tension?: number;
  pointRadius?: number;
  pointHoverRadius?: number;
  maxBarThickness?: number;
};

type ChartJsScale = {
  type?: string;
  stacked?: boolean;
  display?: boolean;
  title?: { display?: boolean; text?: string };
  border?: { display?: boolean };
  grid?: { display?: boolean; color?: unknown };
  ticks?: { display?: boolean };
};

type ChartJsOptions = {
  indexAxis?: string;
  responsive?: boolean;
  maintainAspectRatio?: boolean;
  animation?: unknown;
  cutout?: string;
  color?: string;
  scales?: Record<string, ChartJsScale>;
  plugins?: {
    legend?: { display?: boolean; position?: string };
    title?: { display?: boolean; text?: string[] };
    tooltip?: { enabled?: boolean };
    datalabels?: {
      display?: boolean;
      color?: string;
      align?: unknown;
      anchor?: unknown;
      offset?: number;
      clamp?: boolean;
      clip?: boolean;
    };
  };
};

function chartDatasets(config: ReturnType<typeof chartConfig>): ChartJsDataset[] {
  return config.data.datasets as unknown as ChartJsDataset[];
}

function chartOptions(config: ReturnType<typeof chartConfig>): ChartJsOptions {
  return (config.options ?? {}) as unknown as ChartJsOptions;
}

function chartElement(overrides: Partial<ChartElement> = {}): ChartElement {
  return {
    type: "chart",
    chart_type: "bar",
    categories: ["Jan", "Feb", "Mar"],
    series: [{ name: "Series 1", values: [1, 2, 3] }],
    colors: ["#FF6B2A"],
    size: { width: 645, height: 329 },
    name: "primary_bar_chart",
    ...overrides,
  };
}

const WIRE_CHART_TYPES: Array<[ChartType, string]> = [
  ["bar", "bar"],
  ["line", "line"],
  ["pie", "pie"],
  ["donut", "doughnut"],
  ["horizontal_bar", "bar"],
  ["area", "line"],
  ["stacked_bar", "bar"],
  ["scatter", "scatter"],
  ["horizontal_stacked_bar", "bar"],
  ["radar", "radar"],
  ["polar_area", "polarArea"],
];

test.describe("chartConfig — type mapping", () => {
  test("maps every wire chart_type onto its Chart.js type", () => {
    for (const [chart_type, expected] of WIRE_CHART_TYPES) {
      const config = chartConfig(chartElement({ chart_type }), null);
      expect(config.type, `chart_type ${chart_type}`).toBe(expected);
    }
  });

  test("horizontal bars flip indexAxis instead of changing type", () => {
    expect(
      chartOptions(chartConfig(chartElement({ chart_type: "horizontal_bar" }), null))
        .indexAxis,
    ).toBe("y");
    expect(
      chartOptions(
        chartConfig(chartElement({ chart_type: "horizontal_stacked_bar" }), null),
      ).indexAxis,
    ).toBe("y");
    expect(
      chartOptions(chartConfig(chartElement({ chart_type: "bar" }), null)).indexAxis,
    ).toBe("x");
  });

  test("donut cuts out 58% of the pie and pie does not", () => {
    expect(
      chartOptions(chartConfig(chartElement({ chart_type: "donut" }), null)).cutout,
    ).toBe("58%");
    expect(
      chartOptions(chartConfig(chartElement({ chart_type: "pie" }), null)).cutout,
    ).toBe("0%");
  });

  test("stacked chart types stack both scales", () => {
    for (const chart_type of ["stacked_bar", "horizontal_stacked_bar"] as const) {
      const scales = chartOptions(chartConfig(chartElement({ chart_type }), null))
        .scales;
      expect(scales?.x?.stacked, `${chart_type} x`).toBe(true);
      expect(scales?.y?.stacked, `${chart_type} y`).toBe(true);
    }
    const plain = chartOptions(chartConfig(chartElement(), null)).scales;
    expect(plain?.x?.stacked).toBe(false);
    expect(plain?.y?.stacked).toBe(false);
  });

  test("pie-like charts carry no cartesian scales", () => {
    for (const chart_type of ["pie", "donut", "polar_area"] as const) {
      expect(
        chartOptions(chartConfig(chartElement({ chart_type }), null)).scales,
        `${chart_type} scales`,
      ).toBeUndefined();
    }
  });

  test("radar and scatter build their own scale shapes", () => {
    const radar = chartOptions(chartConfig(chartElement({ chart_type: "radar" }), null))
      .scales;
    expect(Object.keys(radar ?? {})).toEqual(["r"]);
    const scatter = chartOptions(
      chartConfig(chartElement({ chart_type: "scatter" }), null),
    ).scales;
    expect(scatter?.x?.type).toBe("linear");
    expect(scatter?.y?.type).toBe("linear");
  });

  test("keeps Chart.js animation off (content, not UI motion)", () => {
    const options = chartOptions(chartConfig(chartElement(), null));
    expect(options.animation).toBe(false);
    expect(options.responsive).toBe(false);
    expect(options.maintainAspectRatio).toBe(false);
    expect(options.plugins?.tooltip?.enabled).toBe(false);
  });
});

test.describe("chartConfig — series, categories and colors", () => {
  test("wires categories to labels and every series to a dataset", () => {
    const config = chartConfig(
      chartElement({
        series: [
          { name: "Desktop", values: [0, 2, 8] },
          { name: "Mobile", values: [0, 2, 15] },
        ],
        colors: ["#111111", "#FF914D"],
      }),
      null,
    );
    expect(config.data.labels).toEqual(["Jan", "Feb", "Mar"]);
    const datasets = chartDatasets(config);
    expect(datasets.map((dataset) => dataset.label)).toEqual(["Desktop", "Mobile"]);
    expect(datasets.map((dataset) => dataset.data)).toEqual([
      [0, 2, 8],
      [0, 2, 15],
    ]);
    expect(datasets.map((dataset) => dataset.borderColor)).toEqual([
      "#111111",
      "#FF914D",
    ]);
  });

  test("bar datasets keep the bar-specific styling from the fork", () => {
    const dataset = chartDatasets(chartConfig(chartElement(), null))[0];
    expect(dataset.borderWidth).toBe(0);
    expect(dataset.borderRadius).toBe(7);
    expect(dataset.maxBarThickness).toBe(62);
    expect(dataset.tension).toBe(0);
  });

  test("a single-series bar colors each category from the palette", () => {
    const dataset = chartDatasets(
      chartConfig(
        chartElement({
          categories: ["A", "B", "C"],
          series: [{ name: "Series 1", values: [1, 2, 3] }],
          colors: ["#E86C2A", "#C74C12", "#8E2F0D"],
        }),
        null,
      ),
    )[0];
    expect(dataset.backgroundColor).toEqual(["#E86C2A", "#C74C12", "#8E2F0D"]);
  });

  test("line and area datasets carry the fork's line styling", () => {
    const line = chartDatasets(
      chartConfig(chartElement({ chart_type: "line" }), null),
    )[0];
    expect(line.borderWidth).toBe(3);
    expect(line.tension).toBe(0.35);
    expect(line.pointRadius).toBe(3.5);
    expect(line.fill).toBe(false);

    const area = chartDatasets(
      chartConfig(chartElement({ chart_type: "area" }), null),
    )[0];
    expect(area.fill).toBe(true);
    expect(area.backgroundColor).toBe("rgba(255, 107, 42, 0.24)");
  });

  test("pie and donut use only the first series, one color per slice", () => {
    const config = chartConfig(
      chartElement({
        chart_type: "donut",
        series: [
          { name: "Percent", values: [55, 25, 20] },
          { name: "Ignored", values: [1, 1, 1] },
        ],
        colors: ["#E86C2A", "#C74C12", "#8E2F0D"],
      }),
      null,
    );
    const datasets = chartDatasets(config);
    expect(datasets).toHaveLength(1);
    expect(datasets[0].label).toBe("Percent");
    expect(datasets[0].data).toEqual([55, 25, 20]);
    expect(datasets[0].backgroundColor).toEqual([
      "#E86C2A",
      "#C74C12",
      "#8E2F0D",
    ]);
    expect(datasets[0].borderColor).toBe("#FFFFFF");
  });

  test("scatter pairs each value with its 1-based index", () => {
    const dataset = chartDatasets(
      chartConfig(
        chartElement({
          chart_type: "scatter",
          series: [{ name: "Values", values: [3, 8, 13] }],
        }),
        null,
      ),
    )[0];
    expect(dataset.data).toEqual([
      { x: 1, y: 3 },
      { x: 2, y: 8 },
      { x: 3, y: 13 },
    ]);
  });

  test("pads missing category labels and values honestly", () => {
    const config = chartConfig(
      chartElement({
        categories: ["Jan"],
        series: [{ name: "S", values: [7, 9] }],
      }),
      null,
    );
    expect(config.data.labels).toEqual(["Jan", "Value 2"]);
    expect(chartDatasets(config)[0].data).toEqual([7, 9]);
  });
});

test.describe("chartConfig — theme palette fallback", () => {
  test("uses the theme's graph roles when the element carries no colors", () => {
    const config = chartConfig(
      chartElement({
        colors: null,
        series: [
          { name: "First", values: [1, 2, 3] },
          { name: "Second", values: [3, 2, 1] },
        ],
      }),
      { colors: themeColors() },
    );
    const datasets = chartDatasets(config);
    expect(datasets[0].borderColor).toBe("#285F20");
    expect(datasets[1].borderColor).toBe("#174F45");
  });

  test("a single-series bar spreads the theme graph roles across categories", () => {
    const dataset = chartDatasets(
      chartConfig(chartElement({ colors: [] }), { colors: themeColors() }),
    )[0];
    expect(dataset.backgroundColor).toEqual([
      "#285F20",
      "#174F45",
      "#03362D",
    ]);
  });

  test("falls back to the fork's default palette without element or theme colors", () => {
    for (const colors of [null, []]) {
      const config = chartConfig(
        chartElement({
          colors,
          series: [
            { name: "First", values: [1, 2, 3] },
            { name: "Second", values: [3, 2, 1] },
          ],
        }),
        null,
      );
      const datasets = chartDatasets(config);
      expect(datasets[0].borderColor).toBe("#7F22FE");
      expect(datasets[1].borderColor).toBe("#155DFC");
    }
  });

  test("ignores invalid color strings and falls through to the theme", () => {
    const config = chartConfig(
      chartElement({
        colors: ["not-a-color", "  ", "#GGGGGG"],
        series: [
          { name: "First", values: [1, 2, 3] },
          { name: "Second", values: [3, 2, 1] },
        ],
      }),
      { colors: themeColors() },
    );
    expect(chartDatasets(config)[0].borderColor).toBe("#285F20");
  });
});

test.describe("chartConfig — labels, axes and legend", () => {
  test("data labels are off unless the wire asks for them", () => {
    const options = chartOptions(chartConfig(chartElement(), null));
    expect(options.plugins?.datalabels?.display).toBe(false);
  });

  test("maps every data_labels position onto align/anchor", () => {
    const cases: Array<[NonNullable<ChartElement["data_labels"]>, string, string]> = [
      ["base", "end", "start"],
      ["mid", "center", "center"],
      ["top", "start", "end"],
      ["outside", "end", "end"],
    ];
    for (const [position, align, anchor] of cases) {
      const datalabels = chartOptions(
        chartConfig(chartElement({ data_labels: position }), null),
      ).plugins?.datalabels;
      expect(datalabels?.display, position).toBe(true);
      expect(datalabels?.align, position).toBe(align);
      expect(datalabels?.anchor, position).toBe(anchor);
      expect(datalabels?.offset, position).toBe(position === "outside" ? 6 : 2);
      expect(datalabels?.clamp).toBe(true);
      expect(datalabels?.clip).toBe(false);
    }
  });

  test("axis display, grid and titles follow the wire booleans", () => {
    const options = chartOptions(
      chartConfig(
        chartElement({
          x_axis: false,
          y_axis: true,
          x_axis_grid: false,
          y_axis_grid: true,
          x_axis_title: "Date",
          y_axis_title: "GtCO2",
          axis_color: "#98A2B3",
        }),
        null,
      ),
    );
    // The fork's grid mapping crosses the axes: a vertical chart's category
    // grid (x scale) follows `y_axis_grid`, the value grid follows
    // `x_axis_grid`. Display stays on while either a border or a grid shows.
    expect(options.scales?.x?.display).toBe(true);
    expect(options.scales?.x?.border?.display).toBe(false);
    expect(options.scales?.x?.ticks?.display).toBe(false);
    expect(options.scales?.x?.grid?.display).toBe(true);
    expect(options.scales?.x?.title?.display).toBe(false);
    expect(options.scales?.y?.display).toBe(true);
    expect(options.scales?.y?.border?.display).toBe(true);
    expect(options.scales?.y?.ticks?.display).toBe(true);
    expect(options.scales?.y?.grid?.display).toBe(false);
    expect(options.scales?.y?.title).toMatchObject({
      display: true,
      text: "GtCO2",
    });
  });

  test("the legend auto-shows for pie-like and multi-series charts", () => {
    const single = chartOptions(chartConfig(chartElement(), null));
    expect(single.plugins?.legend?.display).toBe(false);

    const multi = chartOptions(
      chartConfig(
        chartElement({
          series: [
            { name: "A", values: [1, 2, 3] },
            { name: "B", values: [3, 2, 1] },
          ],
        }),
        null,
      ),
    );
    expect(multi.plugins?.legend?.display).toBe(true);

    const pie = chartOptions(chartConfig(chartElement({ chart_type: "pie" }), null));
    expect(pie.plugins?.legend?.display).toBe(true);

    expect(
      chartOptions(chartConfig(chartElement({ chart_type: "pie", legend: false }), null))
        .plugins?.legend?.display,
    ).toBe(false);
  });

  test("a title becomes the chart title plugin configuration", () => {
    const options = chartOptions(
      chartConfig(chartElement({ title: "Heading Bar Graph" }), null),
    );
    expect(options.plugins?.title).toMatchObject({
      display: true,
      text: ["Heading Bar Graph"],
    });
    expect(chartOptions(chartConfig(chartElement(), null)).plugins?.title?.display).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Task B5 — infographic geometry and colors (spec §6.7)
//
// The three natively rendered infographic types (gauge, progress_bar,
// vertical_funnel) share the fork's metric semantics: min/max/value with
// sorted bounds, a clamped ratio and a two-decimal label. Colors resolve
// exactly like the fork's `infographicBaseColor` / `infographicHighlightColor`
// / `infographicPalette` helpers.
// ---------------------------------------------------------------------------

test.describe("infographicMetrics", () => {
  test("computes the ratio and the formatted value", () => {
    expect(infographicMetrics({ min_value: 0, max_value: 100, value: 84 })).toEqual(
      { ratio: 0.84, label: "84" },
    );
  });

  test("sorts swapped bounds and clamps the value into them", () => {
    expect(infographicMetrics({ min_value: 100, max_value: 0, value: 150 })).toEqual({
      ratio: 1,
      label: "100",
    });
    expect(infographicMetrics({ min_value: 100, max_value: 0, value: -10 })).toEqual({
      ratio: 0,
      label: "0",
    });
  });

  test("never divides by zero when min and max coincide", () => {
    expect(infographicMetrics({ min_value: 40, max_value: 40, value: 40 })).toEqual({
      ratio: 0,
      label: "40",
    });
  });

  test("rounds the label to two decimals", () => {
    const metrics = infographicMetrics({
      min_value: 0,
      max_value: 100,
      value: 33.333,
    });
    expect(metrics.label).toBe("33.33");
    expect(metrics.ratio).toBeCloseTo(1 / 3, 4);
  });
});

test.describe("gaugeArcPath", () => {
  test("draws the fork's semicircle geometry (center 60,60 radius 48)", () => {
    expect(gaugeArcPath(1)).toBe("M 12 60 A 48 48 0 0 1 108 60");
    expect(gaugeArcPath(0.5)).toBe("M 12 60 A 48 48 0 0 1 60 12");
    expect(gaugeArcPath(0)).toBe("M 12 60 A 48 48 0 0 1 12 60");
  });

  test("clamps ratios outside 0..1 into the arc", () => {
    expect(gaugeArcPath(2)).toBe(gaugeArcPath(1));
    expect(gaugeArcPath(-1)).toBe(gaugeArcPath(0));
  });
});

function gaugeElement(
  overrides: Partial<InfographicElement> = {},
): InfographicElement {
  return {
    type: "infographic",
    data: { type: "gauge", min_value: 0, max_value: 100, value: 78 },
    colors: ["#F1F2F5", "#03362D"],
    text_color: "#282D49",
    name: "card_chart",
    ...overrides,
  };
}

test.describe("infographic colors", () => {
  test("base color prefers colors[0] and falls back to the neutral default", () => {
    expect(infographicBaseColor(gaugeElement())).toBe("#F1F2F5");
    expect(infographicBaseColor(gaugeElement({ colors: [] }))).toBe("#E5E7EB");
  });

  test("highlight prefers colors[1] and falls back to the default accent", () => {
    expect(infographicHighlightColor(gaugeElement())).toBe("#03362D");
    expect(infographicHighlightColor(gaugeElement({ colors: ["#FFFFFF"] }))).toBe(
      "#7F22FE",
    );
    expect(infographicHighlightColor(gaugeElement({ colors: [] }))).toBe("#7F22FE");
  });

  test("palette drops the base color and falls back to the engine defaults", () => {
    expect(
      infographicPalette(
        gaugeElement({
          colors: ["#CFDAC9", "#285E1D", "#719269", "#A4B59F", "#A4B59F"],
        }),
      ),
    ).toEqual(["#285E1D", "#719269", "#A4B59F", "#A4B59F"]);
    expect(infographicPalette(gaugeElement({ colors: ["#FFFFFF"] }))).toEqual([
      "#2563EB",
      "#7C3AED",
      "#0EA5E9",
      "#10B981",
    ]);
  });

  test("text color prefers text_color over the caller's fallback", () => {
    expect(
      infographicTextColor(gaugeElement({ text_color: "#174B40" }), "#111111"),
    ).toBe("#174B40");
    expect(infographicTextColor(gaugeElement({ text_color: null }), "#111111")).toBe(
      "#111111",
    );
  });
});

// ---------------------------------------------------------------------------
// Task C2 — hydration module (`hydrateSlide`)
//
// The pure mechanic behind add-slide and per-slide layout changes: place an
// existing slide's `content` values into a template layout's elements by
// `name` where `decorative === false`, preserving component positions and
// decorative elements (spec §7.6). Semantics mirror the engine's documented
// merge (`_apply_template_content_to_ui` / `_apply_template_content_to_element`
// in `presenton-main/servers/fastapi/api/v1/ppt/endpoints/presentation.py`
// lines 560-694 and the per-type appliers at lines 839-1403) — the same
// component content keys, the same element-name candidates, the same per-type
// wire shapes. Cases the module does not map are recorded in the C2 report.
// The fork's `presenton-ui/lib/template-v2-json-to-html.ts` only *renders*
// `ui`; it carries no content-merge logic.
// ---------------------------------------------------------------------------

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Fixture (a): one flat text component, one decorative accent rule. */
function flatTextLayout(): TemplateLayout {
  return {
    id: "flat_text_layout",
    description: "Headline over a subtitle with one decorative accent rule.",
    components: [
      {
        id: "headline_block",
        description: "Headline and subtitle copy.",
        position: { x: 40, y: 60 },
        elements: [
          {
            type: "vector",
            shape: "polygon",
            fill: { color: "#9333EA", opacity: 1 },
            points: [
              { x: 0, y: 0 },
              { x: 200, y: 0 },
              { x: 200, y: 12 },
              { x: 0, y: 12 },
            ],
            closed: true,
          },
          {
            type: "text",
            position: { x: 0, y: 24 },
            size: { width: 900, height: 120 },
            font: { size: 56, family: "Poppins", color: "#111827", bold: true },
            alignment: { horizontal: "left", vertical: "top" },
            runs: [
              {
                text: "Placeholder headline",
                font: { size: 56, family: "Poppins", color: "#111827", bold: true },
              },
            ],
            decorative: false,
            name: "headline",
          },
          {
            type: "text",
            position: { x: 0, y: 160 },
            size: { width: 900, height: 80 },
            font: { size: 20, family: "Poppins", color: "#4B5563" },
            runs: [
              { text: "Placeholder subtitle", font: { size: 20, color: "#4B5563" } },
            ],
            decorative: false,
            name: "subtitle",
          },
        ],
      },
    ],
  };
}

function flatTextContent(): Record<string, unknown> {
  return {
    headline_block: {
      headline: "Native hydration ships",
      subtitle: { text: "Values land in the first run's style" },
      dropped_key: "unmapped content is dropped, like the engine",
    },
    orphan_component: { headline: "no component carries this key" },
  };
}

test.describe("hydrateSlide — flat text layout", () => {
  test("places content by element name, keeps the decorative vector and drops unmapped keys", () => {
    const layout = flatTextLayout();
    const content = flatTextContent();
    const layoutSnapshot = jsonClone(layout);
    const contentSnapshot = jsonClone(content);

    const ui = hydrateSlide({ layout, content });

    expect(ui).toEqual({
      id: "flat_text_layout",
      description: "Headline over a subtitle with one decorative accent rule.",
      components: [
        {
          id: "headline_block",
          description: "Headline and subtitle copy.",
          position: { x: 40, y: 60 },
          elements: [
            {
              type: "vector",
              shape: "polygon",
              fill: { color: "#9333EA", opacity: 1 },
              points: [
                { x: 0, y: 0 },
                { x: 200, y: 0 },
                { x: 200, y: 12 },
                { x: 0, y: 12 },
              ],
              closed: true,
            },
            {
              type: "text",
              position: { x: 0, y: 24 },
              size: { width: 900, height: 120 },
              font: { size: 56, family: "Poppins", color: "#111827", bold: true },
              alignment: { horizontal: "left", vertical: "top" },
              runs: [
                {
                  text: "Native hydration ships",
                  font: { size: 56, family: "Poppins", color: "#111827", bold: true },
                },
              ],
              decorative: false,
              name: "headline",
            },
            {
              type: "text",
              position: { x: 0, y: 160 },
              size: { width: 900, height: 80 },
              font: { size: 20, family: "Poppins", color: "#4B5563" },
              runs: [
                {
                  text: "Values land in the first run's style",
                  font: { size: 20, family: "Poppins", color: "#4B5563" },
                },
              ],
              decorative: false,
              name: "subtitle",
            },
          ],
        },
      ],
    });

    // Deep-clone contract: neither input is mutated and the hydrated tree
    // shares no object identity with the layout.
    expect(layout).toEqual(layoutSnapshot);
    expect(content).toEqual(contentSnapshot);
    expect(ui.components[0]).not.toBe(layout.components[0]);
    expect(ui.components[0].elements[0]).not.toBe(layout.components[0].elements[0]);
    expect(ui.components[0].elements[1]).not.toBe(layout.components[0].elements[1]);
    expect(ui.components[0].elements[2]).not.toBe(layout.components[0].elements[2]);
  });
});

/** Fixture (b): a container child and a group with a decorative icon. */
function groupLayout(): TemplateLayout {
  return {
    id: "group_layout",
    description: "A container body above a stat group.",
    components: [
      {
        id: "content_column",
        description: "Body copy above a stat card.",
        position: { x: 88, y: 120 },
        elements: [
          {
            type: "container",
            position: { x: 0, y: 0 },
            size: { width: 520, height: 140 },
            fill: { color: "#FFFFFF", opacity: 1 },
            border_radius: { tl: 16, tr: 16, bl: 16, br: 16 },
            child: {
              type: "text",
              position: { x: 24, y: 24 },
              size: { width: 472, height: 92 },
              font: { size: 18, family: "Inter", color: "#374151" },
              runs: [
                { text: "Body placeholder", font: { size: 18, color: "#374151" } },
              ],
              decorative: false,
              name: "body",
            },
          },
          {
            type: "group",
            name: "stat_card",
            children: [
              {
                type: "image",
                position: { x: 0, y: 0 },
                size: { width: 48, height: 48 },
                data: "/static/icons/chart.svg",
                decorative: true,
                name: "stat_icon",
                is_icon: true,
              },
              {
                type: "text",
                position: { x: 0, y: 64 },
                size: { width: 240, height: 60 },
                font: { size: 48, family: "Poppins", bold: true },
                runs: [{ text: "0%", font: { size: 48, bold: true } }],
                decorative: false,
                name: "stat_value",
              },
              {
                type: "text",
                position: { x: 0, y: 132 },
                size: { width: 240, height: 30 },
                runs: [{ text: "Placeholder label", font: { size: 14 } }],
                decorative: false,
                name: "stat_label",
              },
            ],
          },
        ],
      },
    ],
  };
}

test.describe("hydrateSlide — group/container layout", () => {
  test("recurses through container children and named groups, preserving geometry", () => {
    const layout = groupLayout();
    const ui = hydrateSlide({
      layout,
      content: {
        content_column: {
          body: "Hydrated body copy",
          stat_card: { stat_value: "42%", stat_label: "Completion" },
        },
      },
    });

    expect(ui).toEqual({
      id: "group_layout",
      description: "A container body above a stat group.",
      components: [
        {
          id: "content_column",
          description: "Body copy above a stat card.",
          position: { x: 88, y: 120 },
          elements: [
            {
              type: "container",
              position: { x: 0, y: 0 },
              size: { width: 520, height: 140 },
              fill: { color: "#FFFFFF", opacity: 1 },
              border_radius: { tl: 16, tr: 16, bl: 16, br: 16 },
              child: {
                type: "text",
                position: { x: 24, y: 24 },
                size: { width: 472, height: 92 },
                font: { size: 18, family: "Inter", color: "#374151" },
                runs: [
                  {
                    text: "Hydrated body copy",
                    font: { size: 18, family: "Inter", color: "#374151" },
                  },
                ],
                decorative: false,
                name: "body",
              },
            },
            {
              type: "group",
              name: "stat_card",
              children: [
                {
                  type: "image",
                  position: { x: 0, y: 0 },
                  size: { width: 48, height: 48 },
                  data: "/static/icons/chart.svg",
                  decorative: true,
                  name: "stat_icon",
                  is_icon: true,
                },
                {
                  type: "text",
                  position: { x: 0, y: 64 },
                  size: { width: 240, height: 60 },
                  font: { size: 48, family: "Poppins", bold: true },
                  runs: [
                    {
                      text: "42%",
                      font: { size: 48, family: "Poppins", bold: true },
                    },
                  ],
                  decorative: false,
                  name: "stat_value",
                },
                {
                  type: "text",
                  position: { x: 0, y: 132 },
                  size: { width: 240, height: 30 },
                  runs: [{ text: "Completion", font: { size: 14 } }],
                  decorative: false,
                  name: "stat_label",
                },
              ],
            },
          ],
        },
      ],
    });
  });
});

function cardText(placeholder: string): SlideElement {
  return {
    type: "text",
    position: { x: 0, y: 0 },
    size: { width: 240, height: 80 },
    font: { size: 48, bold: true },
    runs: [{ text: placeholder, font: { size: 48, bold: true } }],
    decorative: false,
    name: "value",
  };
}

test.describe("hydrateSlide — component content keys", () => {
  function duplicateComponentLayout(): TemplateLayout {
    return {
      id: "duplicate_components",
      description: "Two stat cards sharing a component id.",
      components: [
        {
          id: "metric_card",
          description: "First metric card.",
          position: { x: 0, y: 0 },
          elements: [cardText("0%")],
        },
        {
          id: "metric_card",
          description: "Second metric card.",
          position: { x: 300, y: 0 },
          elements: [cardText("0%")],
        },
      ],
    };
  }

  test("addresses duplicate component ids with the engine's zero-based suffix keys", () => {
    const ui = hydrateSlide({
      layout: duplicateComponentLayout(),
      content: {
        metric_card_0: { value: "42%" },
        metric_card_1: { value: "21%" },
      },
    });
    expect((ui.components[0].elements[0] as TextElement).runs).toEqual([
      { text: "42%", font: { size: 48, bold: true } },
    ]);
    expect((ui.components[1].elements[0] as TextElement).runs).toEqual([
      { text: "21%", font: { size: 48, bold: true } },
    ]);
  });

  test("falls back to the plain component id when no suffixed key exists", () => {
    const ui = hydrateSlide({
      layout: duplicateComponentLayout(),
      content: { metric_card: { value: "7%" } },
    });
    expect((ui.components[0].elements[0] as TextElement).runs).toEqual([
      { text: "7%", font: { size: 48, bold: true } },
    ]);
    expect((ui.components[1].elements[0] as TextElement).runs).toEqual([
      { text: "7%", font: { size: 48, bold: true } },
    ]);
  });
});

function hydrateElement(
  element: SlideElement,
  componentContent: Record<string, unknown>,
): SlideElement {
  const ui = hydrateSlide({
    layout: {
      id: "single_element_layout",
      description: "Single element layout.",
      components: [
        {
          id: "component",
          description: "One element.",
          position: { x: 12, y: 34 },
          elements: [element],
        },
      ],
    },
    content: { component: componentContent },
  });
  return ui.components[0].elements[0];
}

test.describe("hydrateSlide — element name matching", () => {
  test("matches numeric-suffixed and prefixed names through the engine's candidates", () => {
    const numbered = hydrateElement(
      {
        type: "text",
        position: { x: 0, y: 0 },
        runs: [{ text: "Placeholder", font: { size: 32 } }],
        decorative: false,
        name: "title_1",
      },
      { title: 2026 },
    );
    expect((numbered as TextElement).runs).toEqual([
      { text: "2026", font: { size: 32 } },
    ]);

    const prefixed = hydrateElement(
      {
        type: "text",
        position: { x: 0, y: 0 },
        runs: [{ text: "Placeholder" }],
        decorative: false,
        name: "block_heading_text",
      },
      { heading_text: "Stripped prefix" },
    );
    expect((prefixed as TextElement).runs).toEqual([
      { text: "Stripped prefix" },
    ]);
  });

  test("prefers the engine's occurrence-suffixed key for a repeated element name", () => {
    const ui = hydrateSlide({
      layout: {
        id: "repeated_names",
        description: "Two label elements with the same name.",
        components: [
          {
            id: "labels",
            description: "Labels.",
            position: { x: 0, y: 0 },
            elements: [
              {
                type: "text",
                position: { x: 0, y: 0 },
                runs: [{ text: "First placeholder" }],
                decorative: false,
                name: "label",
              },
              {
                type: "text",
                position: { x: 0, y: 40 },
                runs: [{ text: "Second placeholder" }],
                decorative: false,
                name: "label",
              },
            ],
          },
        ],
      },
      content: { labels: { label_2: "Second only" } },
    });
    expect((ui.components[0].elements[0] as TextElement).runs).toEqual([
      { text: "First placeholder" },
    ]);
    expect((ui.components[0].elements[1] as TextElement).runs).toEqual([
      { text: "Second only" },
    ]);
  });
});

test.describe("hydrateSlide — per-type value placement", () => {
  test("text-list items replace the template items, keeping each item's first-run style", () => {
    const bullets: SlideElement = {
      type: "text-list",
      position: { x: 0, y: 0 },
      size: { width: 600, height: 200 },
      font: { family: "Inter" },
      marker: "bullet",
      gap: 8,
      items: [
        [{ text: "Old one", font: { size: 16 } }],
        [{ text: "Old two", font: { size: 16, bold: true } }],
        [{ text: "Old three", font: { size: 16, italic: true } }],
      ],
      decorative: false,
      name: "bullets",
    };
    const hydrated = hydrateElement(bullets, {
      bullets: ["First bullet", "", "Third bullet"],
    }) as TextListElement;
    expect(hydrated.items).toEqual([
      [{ text: "First bullet", font: { family: "Inter", size: 16 } }],
      [
        {
          text: "Third bullet",
          font: { family: "Inter", size: 16, italic: true },
        },
      ],
    ]);
  });

  test("image values set data and prompt, normalizing fit to cover", () => {
    const image: SlideElement = {
      type: "image",
      position: { x: 0, y: 0 },
      size: { width: 512, height: 320 },
      data: "/static/images/replaceable_template_image.png",
      fit: "contain",
      decorative: false,
      name: "hero_image",
      is_icon: false,
    };
    expect(
      hydrateElement(image, {
        hero_image: {
          image_prompt: "Team dashboard",
          image_url: "/app_data/images/hero.png",
        },
      }),
    ).toEqual({
      ...image,
      data: "/app_data/images/hero.png",
      fit: "cover",
      prompt: "Team dashboard",
    });
  });

  test("icon values read the icon keys and keep the icon's own fit", () => {
    const icon: SlideElement = {
      type: "image",
      position: { x: 0, y: 0 },
      size: { width: 48, height: 48 },
      data: "/static/icons/old.svg",
      fit: "contain",
      decorative: false,
      name: "brand_icon",
      is_icon: true,
    };
    expect(
      hydrateElement(icon, {
        brand_icon: { icon_query: "leaf", icon_url: "/static/icons/leaf.svg" },
      }),
    ).toEqual({
      ...icon,
      data: "/static/icons/leaf.svg",
      prompt: "leaf",
    });
  });

  test("keeps fit for clipped images and SVG sources (engine fit normalization)", () => {
    const clipped: SlideElement = {
      type: "image",
      position: { x: 0, y: 0 },
      size: { width: 512, height: 320 },
      data: "/static/images/replaceable_template_image.png",
      fit: "contain",
      clip_path: "path('M 0 0 L 512 0 L 512 320 L 0 320 Z')",
      decorative: false,
      name: "clipped_image",
      is_icon: false,
    };
    expect(
      hydrateElement(clipped, {
        clipped_image: { image_url: "/app_data/images/hero.png" },
      }),
    ).toEqual({ ...clipped, data: "/app_data/images/hero.png" });
    expect(
      (
        hydrateElement(
          { ...(clipped as ImageElement), clip_path: null, name: "svg_image" },
          { svg_image: { image_url: "/static/icons/leaf.svg" } },
        ) as ImageElement
      ).fit,
    ).toBe("contain");
  });

  test("table values merge to the template cell count and keep cell styles", () => {
    const table: SlideElement = {
      type: "table",
      position: { x: 0, y: 0 },
      size: { width: 900, height: 200 },
      columns: [
        { font: { size: 14, bold: true }, runs: [{ text: "Old header" }] },
        { font: { size: 14 }, runs: [{ text: "Old header 2" }] },
      ],
      rows: [
        [
          { font: { size: 12 }, runs: [{ text: "Old 1" }] },
          { font: { size: 12 }, runs: [{ text: "Old 2" }] },
        ],
        [
          { runs: [{ text: "Old 3" }] },
          { runs: [{ text: "Old 4" }] },
        ],
      ],
      decorative: false,
      name: "metrics",
    };
    const hydrated = hydrateElement(table, {
      metrics: { columns: ["Region", "Sales"], rows: [["US", 12], ["EU", true]] },
    }) as TableElement;

    expect(hydrated.columns).toEqual([
      {
        font: { size: 14, bold: true },
        runs: [{ text: "Region", font: { size: 14, bold: true } }],
        color: { color: "#F8F4E9", opacity: 1 },
        stroke: { color: "#D8D3C4", opacity: 1, width: 1 },
      },
      {
        font: { size: 14 },
        runs: [{ text: "Sales", font: { size: 14 } }],
        color: { color: "#F8F4E9", opacity: 1 },
        stroke: { color: "#D8D3C4", opacity: 1, width: 1 },
      },
    ]);
    expect(hydrated.rows[0][0]).toEqual({
      font: { size: 12 },
      runs: [{ text: "US", font: { size: 12 } }],
      color: { color: "#F8F4E9", opacity: 1 },
      stroke: { color: "#D8D3C4", opacity: 1, width: 1 },
    });
    expect(hydrated.rows[0][1].runs).toEqual([
      { text: "12", font: { size: 12 } },
    ]);
    // The row's second cell had no template font: the engine injects its
    // generated-table font for it (parity, not a guess).
    expect(hydrated.rows[1][1]).toEqual({
      runs: [
        {
          text: "true",
          font: { family: "Sniglet", size: 12, color: "#082314" },
        },
      ],
      font: { family: "Sniglet", size: 12, color: "#082314" },
      color: { color: "#F8F4E9", opacity: 1 },
      stroke: { color: "#D8D3C4", opacity: 1, width: 1 },
    });
  });

  test("chart values map the camelCase vocabulary and drop legacy fields", () => {
    const chart = {
      type: "chart",
      position: { x: 0, y: 0 },
      size: { width: 645, height: 329 },
      chart_type: "bar",
      categories: ["Old"],
      series: [{ name: "Old", values: [1] }],
      colors: ["#111111"],
      data_labels: null,
      data_labels_color: "#475467",
      grid: { visible: true },
      decorative: false,
      name: "trend",
    } as SlideElement;
    const hydrated = hydrateElement(chart, {
      trend: {
        chart_type: "line",
        title: "Growth",
        categories: ["Q1", "Q2"],
        series: [{ name: "Revenue", values: [10, 20] }],
        colors: ["#285F20"],
        data_labels: true,
      },
    });
    expect(hydrated).toEqual({
      type: "chart",
      position: { x: 0, y: 0 },
      size: { width: 645, height: 329 },
      chart_type: "line",
      categories: ["Q1", "Q2"],
      series: [{ name: "Revenue", values: [10, 20] }],
      colors: ["#285F20"],
      data_labels: "top",
      decorative: false,
      name: "trend",
      title: "Growth",
    });

    // The legacy `grid`/`data_labels_color` fields go even when the value is
    // not a chart object.
    const untouched = hydrateElement(chart, { trend: "not a chart" }) as ChartElement;
    expect((untouched as unknown as Record<string, unknown>).grid).toBeUndefined();
    expect((untouched as unknown as Record<string, unknown>).data_labels_color).toBeUndefined();
  });

  test("infographic values merge data over the template type and replace colors", () => {
    const infographic: SlideElement = {
      type: "infographic",
      position: { x: 0, y: 0 },
      size: { width: 240, height: 240 },
      data: { type: "progress_bar", max_value: 100, min_value: 0, value: 0 },
      colors: ["#E5E7EB", "#285F20"],
      text_color: "#282D49",
      decorative: false,
      name: "completion",
    };
    const hydrated = hydrateElement(infographic, {
      completion: {
        data: { type: "gauge", value: 84 },
        colors: ["#F1F2F5", "#03362D", "#111827"],
      },
    }) as InfographicElement;
    expect(hydrated.data).toEqual({
      type: "progress_bar",
      max_value: 100,
      min_value: 0,
      value: 84,
    });
    expect(hydrated.colors).toEqual(["#F1F2F5", "#03362D", "#111827"]);
  });
});

/**
 * Engine-parity fixture: the real `general` template's
 * `title_description_image` layout, copied verbatim from
 * `presenton-main/templates/general/template.json` (2026-09-16). That path is
 * git-ignored at the repo root (`/presenton-main/`), so a fresh clone has no
 * file to read at test time — the JSON below is the inline fixture and the
 * parity claim is against this recorded copy.
 */
const GENERAL_TITLE_DESCRIPTION_IMAGE_LAYOUT: TemplateLayout = {
  id: "title_description_image",
  description:
    "A clean split presentation layout with a large rounded visual card on the left and stacked headline copy on the right.",
  components: [
    {
      id: "slide_background",
      description:
        "Full-canvas white background that provides a neutral base for the two-column content arrangement.",
      position: { x: 0, y: 0 },
      elements: [
        {
          type: "vector",
          shape: "polygon",
          fill: { color: "#FFFFFF", opacity: 1 },
          points: [
            { x: 0, y: 0 },
            { x: 1280, y: 0 },
            { x: 1280, y: 720 },
            { x: 0, y: 720 },
          ],
          closed: true,
        },
      ],
    },
    {
      id: "left_visual_card",
      description:
        "Large rounded image panel positioned on the left with subtle shadow treatment for visual emphasis.",
      position: { x: 88, y: 184 },
      elements: [
        {
          type: "vector",
          shape: "polygon",
          fill: { color: "#FFFFFF", opacity: 1 },
          shadow: {
            color: "#000000",
            blur: 15,
            opacity: 0.1,
            offset_x: 0,
            offset_y: 10,
          },
          points: [
            { x: 0, y: 0 },
            { x: 512, y: 0 },
            { x: 512, y: 320 },
            { x: 0, y: 320 },
          ],
          closed: true,
          corner_radii: [16, 16, 16, 16],
        },
        {
          type: "image",
          position: { x: 0, y: 0 },
          size: { width: 512, height: 320 },
          rotation: 0,
          data: "/static/images/replaceable_template_image.png",
          fit: "cover",
          border_radius: { tl: 16, tr: 16, bl: 16, br: 16 },
          decorative: false,
          name: "main_visual_image",
          is_icon: false,
        },
      ],
    },
    {
      id: "right_text_stack",
      description:
        "Right-side vertical content stack containing a prominent title, short accent rule, and supporting paragraph.",
      position: { x: 672, y: 199.47 },
      elements: [
        {
          type: "text",
          position: { x: 0, y: 0 },
          size: { width: 530, height: 118.79 },
          font: {
            size: 60,
            family: "Poppins",
            color: "#111827",
            bold: true,
            italic: false,
            line_height: 0.8,
          },
          alignment: { horizontal: "left", vertical: "top" },
          runs: [
            {
              text: "Product Overview",
              font: {
                size: 60,
                family: "Poppins",
                color: "#111827",
                bold: true,
                italic: false,
                line_height: 0.8,
              },
            },
          ],
          decorative: false,
          name: "primary_heading",
          max_length: 25,
          min_length: 8,
          rotation: 0,
        },
        {
          type: "vector",
          shape: "polygon",
          fill: { color: "#9333EA", opacity: 1 },
          points: [
            { x: 0, y: 144 },
            { x: 80, y: 144 },
            { x: 80, y: 148 },
            { x: 0, y: 148 },
          ],
          closed: true,
          rotation: 0,
        },
        {
          type: "text",
          position: { x: 0, y: 164.72 },
          size: { width: 530, height: 129.41 },
          font: {
            size: 18,
            family: "Poppins",
            color: "#4B5563",
            bold: false,
            italic: false,
            line_height: 1.24,
          },
          alignment: { horizontal: "left", vertical: "top" },
          runs: [
            {
              text: "Our product offers customizable dashboards for real-time reporting and data-driven decisions. It integrates with third-party tools to enhance operations and scales with business growth for improved efficiency.",
              font: {
                size: 18,
                family: "Poppins",
                color: "#4B5563",
                bold: false,
                italic: false,
                line_height: 1.24,
              },
            },
          ],
          decorative: false,
          name: "supporting_paragraph",
          max_length: 274,
          min_length: 105,
          rotation: 0,
        },
      ],
    },
  ],
};

test.describe("hydrateSlide — engine parity (general/title_description_image)", () => {
  test("hydrates the bundled layout and the result renders through the B3 helpers", () => {
    const layout = jsonClone(GENERAL_TITLE_DESCRIPTION_IMAGE_LAYOUT);
    const ui = hydrateSlide({
      layout,
      content: {
        slide_background: {},
        left_visual_card: {
          main_visual_image: {
            image_prompt: "Solar panels over a field",
            image_url: "/app_data/images/solar-adoption.png",
          },
        },
        right_text_stack: {
          primary_heading: "Solar Energy Adoption",
          supporting_paragraph:
            "Solar adoption is accelerating worldwide as costs fall and storage improves. This deck covers the drivers, the barriers and the outlook for the next decade.",
        },
      },
    });

    expect(ui.components.map((component) => component.id)).toEqual([
      "slide_background",
      "left_visual_card",
      "right_text_stack",
    ]);
    expect(ui.components.map((component) => component.position)).toEqual([
      { x: 0, y: 0 },
      { x: 88, y: 184 },
      { x: 672, y: 199.47 },
    ]);

    const heading = ui.components[2].elements[0] as TextElement;
    expect(heading.runs).toEqual([
      {
        text: "Solar Energy Adoption",
        font: {
          size: 60,
          family: "Poppins",
          color: "#111827",
          bold: true,
          italic: false,
          line_height: 0.8,
        },
      },
    ]);
    const paragraph = ui.components[2].elements[2] as TextElement;
    expect(paragraph.runs).toEqual([
      {
        text: "Solar adoption is accelerating worldwide as costs fall and storage improves. This deck covers the drivers, the barriers and the outlook for the next decade.",
        font: {
          size: 18,
          family: "Poppins",
          color: "#4B5563",
          bold: false,
          italic: false,
          line_height: 1.24,
        },
      },
    ]);

    const hero = ui.components[1].elements[1] as ImageElement;
    expect(hero.data).toBe("/app_data/images/solar-adoption.png");
    expect(hero.prompt).toBe("Solar panels over a field");
    expect(hero.fit).toBe("cover");

    // Decorative elements are byte-identical to their template defaults.
    expect(ui.components[0].elements[0]).toEqual(layout.components[0].elements[0]);
    expect(ui.components[1].elements[0]).toEqual(layout.components[1].elements[0]);
    expect(ui.components[2].elements[1]).toEqual(layout.components[2].elements[1]);

    // The hydrated ui walks cleanly through the existing renderer helpers.
    let elementCount = 0;
    for (const component of ui.components) {
      expect(componentFrame(component).width).toBeGreaterThan(0);
      for (const element of component.elements) {
        elementCount += 1;
        const box = elementBox(element);
        expect(box.width).toBeGreaterThanOrEqual(0);
        expect(box.height).toBeGreaterThanOrEqual(0);
        if (element.type === "vector") {
          expect(vectorGeometry(element).points.length).toBeGreaterThan(0);
        }
      }
    }
    expect(elementCount).toBe(6);
    expect(elementFrame(heading, ui.components[2])).toEqual({
      x: 672,
      y: 199.47,
      width: 530,
      height: 118.79,
    });
  });
});

// ---------------------------------------------------------------------------
// Task D1 — pure editor operations (drag / resize / rotate / z-order / group)
// ---------------------------------------------------------------------------

/**
 * One slide with a component holding a text, an image and a vector sibling —
 * the three shapes the D1 transform rules branch on (vector points vs
 * position/size).
 */
function editorSlide(): DeckSlide {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    presentation: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    layout_group: "general",
    layout: "editor_fixture",
    index: 0,
    content: {},
    html_content: null,
    speaker_note: null,
    properties: null,
    ui: {
      components: [
        {
          id: "body",
          description: "Body",
          position: { x: 100, y: 50 },
          elements: [
            {
              type: "text",
              name: "heading",
              position: { x: 10, y: 20 },
              size: { width: 400, height: 100 },
              runs: [{ text: "Heading" }],
            },
            {
              type: "image",
              name: "hero",
              position: { x: 20, y: 140 },
              size: { width: 200, height: 100 },
              data: "/app_data/images/hero.png",
            },
            {
              type: "vector",
              points: [
                { x: 30, y: 260 },
                { x: 230, y: 260 },
                { x: 230, y: 300 },
              ],
              closed: true,
              fill: { color: "#111111" },
            },
          ],
        },
      ],
    },
  };
}

test.describe("editor operations — coordinate units (D1)", () => {
  test("stageDelta divides pointer pixels by the live stage scale", () => {
    expect(stageDelta(100, -50, 0.5)).toEqual({ dx: 200, dy: -100 });
    expect(stageDelta(100, 50, 2)).toEqual({ dx: 50, dy: 25 });
    // An unmeasured/zero scale falls back to 1:1 instead of dividing by zero.
    expect(stageDelta(12, 8, null)).toEqual({ dx: 12, dy: 8 });
    expect(stageDelta(12, 8, 0)).toEqual({ dx: 12, dy: 8 });
  });

  test("elements resolve to their component-local geometry", () => {
    const slide = editorSlide();
    const heading = slide.ui?.components[0].elements[0];
    const hero = slide.ui?.components[0].elements[1];
    const rule = slide.ui?.components[0].elements[2];
    expect(heading && elementGeometry(heading)).toEqual({
      position: { x: 10, y: 20 },
      size: { width: 400, height: 100 },
    });
    expect(
      hero !== undefined && elementGeometry(hero).position,
    ).toEqual({ x: 20, y: 140 });
    // Vectors carry no position/size; their frame comes from points.
    expect(rule !== undefined && elementGeometry(rule)).toEqual({
      position: null,
      size: null,
    });
  });

  test("selectionFrames reports stage coordinates and the vector rule", () => {
    const slide = editorSlide();
    const frames = selectionFrames(slide, [
      "components:0/0",
      "components:0/2",
      "components:9/0",
    ]);
    expect(frames.map((entry) => entry.key)).toEqual([
      "components:0/0",
      "components:0/2",
    ]);
    expect(frames[0].frame).toEqual({ x: 110, y: 70, width: 400, height: 100 });
    // The vector's frame is its points' bounds plus the component origin.
    expect(frames[1].frame).toEqual({
      x: 130,
      y: 310,
      width: 200,
      height: 40,
    });
    expect(unionFrame([frames[0].frame, frames[1].frame])).toEqual({
      x: 110,
      y: 70,
      width: 400,
      height: 280,
    });
    expect(unionFrame([])).toBeNull();
  });
});

test.describe("editor operations — move and resize (D1)", () => {
  test("applyElementMove offsets position and translates vector points", () => {
    const slide = editorSlide();
    const heading = slide.ui!.components[0].elements[0];
    const rule = slide.ui!.components[0].elements[2];

    const moved = applyElementMove(heading, 12, -4);
    expect(moved.position).toEqual({ x: 22, y: 16 });
    expect(elementGeometry(moved)).toEqual({
      position: { x: 22, y: 16 },
      size: { width: 400, height: 100 },
    });
    // The original element is untouched (immutability).
    expect(heading.position).toEqual({ x: 10, y: 20 });

    const movedRule = applyElementMove(rule, 12, -4);
    expect(elementGeometry(movedRule)).toEqual({ position: null, size: null });
    expect(
      movedRule.type === "vector" ? movedRule.points : null,
    ).toEqual([
      { x: 42, y: 256 },
      { x: 242, y: 256 },
      { x: 242, y: 296 },
    ]);
    // The source points are untouched.
    expect(rule.type === "vector" ? rule.points[0] : null).toEqual({
      x: 30,
      y: 260,
    });
  });

  test("moving an element without a position anchors it at 0,0 first", () => {
    const slide = editorSlide();
    const image = slide.ui!.components[0].elements[1];
    const withoutPosition = { ...image };
    delete (withoutPosition as { position?: unknown }).position;
    expect(applyElementMove(withoutPosition, 5, 6).position).toEqual({
      x: 5,
      y: 6,
    });
  });

  test("applyBoundedMove clamps a fully-inside frame at the stage edges", () => {
    const slide = editorSlide();
    const component = slide.ui!.components[0];
    const heading = component.elements[0];

    // The regression this pins: a positive nudge used to clamp against the
    // frame's own origin (-frame.x), teleporting an element left instead.
    expect(applyBoundedMove(heading, component, 1, 0).position).toEqual({
      x: 11,
      y: 20,
    });
    // Stage frame starts at x=110; +900 crosses 1280 (110+900+400 > 1280),
    // so the move pins the frame's right edge at the canvas (local 780).
    expect(applyBoundedMove(heading, component, 900, 0).position).toEqual({
      x: 780,
      y: 20,
    });
    // Moving left pins the frame's left edge at 0 (local 10-110 = -100).
    expect(applyBoundedMove(heading, component, -500, 0).position).toEqual({
      x: -100,
      y: 20,
    });
    // Bottom edge: 70+900+100 > 720 → pin at 720 (local 570).
    expect(applyBoundedMove(heading, component, 0, 900).position).toEqual({
      x: 10,
      y: 570,
    });
  });

  test("applyBoundedMove keeps an already-bleeding frame's overflow", () => {
    const component: SlideComponent = {
      id: "bleed-holder",
      description: "",
      position: { x: 0, y: 0 },
      elements: [],
    };
    const bleeding: SlideElement = {
      type: "image",
      name: "bleed",
      position: { x: -60, y: 10 },
      size: { width: 300, height: 100 },
      data: "/app_data/images/bleed.png",
    };

    // Already outside the left edge: moving further out is allowed...
    expect(applyBoundedMove(bleeding, component, -40, 0).position).toEqual({
      x: -100,
      y: 10,
    });
    // ...while the respected right edge still clamps (1280-300 = 980).
    expect(applyBoundedMove(bleeding, component, 5000, 0).position).toEqual({
      x: 980,
      y: 10,
    });
  });

  test("canFrameResize requires a real box on the wire, rotation included", () => {
    const slide = editorSlide();
    const heading = slide.ui!.components[0].elements[0];
    const rule = slide.ui!.components[0].elements[2];
    expect(canFrameResize(heading)).toBe(true);
    // Vectors have no frame resize (their geometry is points)...
    expect(canFrameResize(rule)).toBe(false);
    // ...and an element with no explicit size has no box math to write.
    const unsized = { ...heading } as SlideElement;
    delete (unsized as { size?: unknown }).size;
    expect(canFrameResize(unsized)).toBe(false);

    /* Rotation no longer blocks the handles: the resize is composed in the
       element's local axes (D1b), so a rotated frame resizes like any other. */
    expect(canFrameResize({ ...heading, rotation: 90 } as SlideElement)).toBe(
      true,
    );
    expect(canFrameResize({ ...heading, rotation: -180 } as SlideElement)).toBe(
      true,
    );
    expect(canFrameResize({ ...heading, rotation: 360 } as SlideElement)).toBe(
      true,
    );
  });

  test("applyBoundedMove translates vector points within the stage bounds", () => {
    const slide = editorSlide();
    const component = slide.ui!.components[0];
    const rule = component.elements[2];
    // Points 30..230, stage frame 130..330 → +2000 pins the right edge at
    // 1280, i.e. +950 in component-local units.
    const moved = applyBoundedMove(rule, component, 2000, 0);
    expect(moved.type === "vector" ? moved.points : null).toEqual([
      { x: 980, y: 260 },
      { x: 1180, y: 260 },
      { x: 1180, y: 300 },
    ]);
  });

  test("resizeFrame anchors the opposite edge, floors at the minimum and locks ratio", () => {
    const frame = { x: 100, y: 100, width: 200, height: 100 };

    // Bottom-right: the origin stays, both dimensions grow.
    expect(resizeFrame({ handle: "se", frame, dx: 40, dy: 20 })).toEqual({
      x: 100,
      y: 100,
      width: 240,
      height: 120,
    });
    // Top-left: the origin moves with the pointer.
    expect(resizeFrame({ handle: "nw", frame, dx: 40, dy: 20 })).toEqual({
      x: 140,
      y: 120,
      width: 160,
      height: 80,
    });
    // Edge handles move one axis only.
    expect(resizeFrame({ handle: "e", frame, dx: 30, dy: 999 })).toEqual({
      x: 100,
      y: 100,
      width: 230,
      height: 100,
    });
    // A shrink past the 8px floor pins the far edge and never inverts.
    expect(resizeFrame({ handle: "w", frame, dx: 500, dy: 0 })).toEqual({
      x: 292,
      y: 100,
      width: 8,
      height: 100,
    });
    // Shift keeps the 2:1 ratio on a corner: dx=100, dy=0 → scale 1.5.
    expect(
      resizeFrame({ handle: "se", frame, dx: 100, dy: 0, keepAspectRatio: true }),
    ).toEqual({ x: 100, y: 100, width: 300, height: 150 });
    // Shift is ignored on edge handles (no second axis to lock).
    expect(
      resizeFrame({ handle: "e", frame, dx: 100, dy: 0, keepAspectRatio: true }),
    ).toEqual({ x: 100, y: 100, width: 300, height: 100 });
  });

  /** A frame corner after the renderer's center rotation (`transformCss`). */
  function rotatedCorner(
    frame: { x: number; y: number; width: number; height: number },
    rotation: number,
    corner: { x: -1 | 0 | 1; y: -1 | 0 | 1 },
  ): { x: number; y: number } {
    const radians = (rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const localX = (corner.x * frame.width) / 2;
    const localY = (corner.y * frame.height) / 2;
    return {
      x: frame.x + frame.width / 2 + cos * localX - sin * localY,
      y: frame.y + frame.height / 2 + sin * localX + cos * localY,
    };
  }

  /** Frame equality within float tolerance (rotation composes trig). */
  function expectFrameClose(
    actual: { x: number; y: number; width: number; height: number },
    expected: { x: number; y: number; width: number; height: number },
  ): void {
    expect(actual.width).toBeCloseTo(expected.width, 6);
    expect(actual.height).toBeCloseTo(expected.height, 6);
    expect(actual.x).toBeCloseTo(expected.x, 6);
    expect(actual.y).toBeCloseTo(expected.y, 6);
  }

  test("resizeFrame composes a 90° rotation into the element's local axes", () => {
    const frame = { x: 100, y: 100, width: 200, height: 100 };
    const anchorBefore = rotatedCorner(frame, 90, { x: -1, y: -1 });
    /* At 90° the local +x axis points down the stage: a +dy stage drag is a
       +width local drag. */
    const resized = resizeFrame({
      handle: "se",
      frame,
      dx: 0,
      dy: 40,
      rotation: 90,
    });
    expectFrameClose(resized, { x: 80, y: 120, width: 240, height: 100 });
    // The rendered nw corner (the se handle's anchor) is fixed.
    const anchorAfter = rotatedCorner(resized, 90, { x: -1, y: -1 });
    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 6);
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 6);

    // The wire write (`position` component-local, `size`) follows the frame.
    const slide = editorSlide();
    const component = slide.ui!.components[0];
    const heading = component.elements[0];
    const applied = applyElementResize(
      { ...heading, rotation: 90 } as SlideElement,
      component,
      resized,
    );
    expect(applied.size?.width).toBeCloseTo(240, 6);
    expect(applied.size?.height).toBeCloseTo(100, 6);
    expect(applied.position?.x).toBeCloseTo(-20, 6);
    expect(applied.position?.y).toBeCloseTo(70, 6);
  });

  test("resizeFrame normalizes −180° and keeps the rendered anchor fixed", () => {
    const frame = { x: 100, y: 100, width: 200, height: 100 };
    const anchorBefore = rotatedCorner(frame, 180, { x: -1, y: -1 });
    // At 180° the local delta is the negated stage delta: the drag shrinks.
    const resized = resizeFrame({
      handle: "se",
      frame,
      dx: 40,
      dy: 20,
      rotation: -180,
    });
    expectFrameClose(resized, { x: 140, y: 120, width: 160, height: 80 });
    const anchorAfter = rotatedCorner(resized, 180, { x: -1, y: -1 });
    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 6);
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 6);
  });

  test("resizeFrame composes a 45° rotation (anchor fixed, local size matches)", () => {
    const frame = { x: 100, y: 100, width: 200, height: 100 };
    const rotation = 45;
    const radians = (rotation * Math.PI) / 180;
    const dx = 30;
    const dy = 10;
    const localDx = dx * Math.cos(radians) + dy * Math.sin(radians);
    const localDy = -dx * Math.sin(radians) + dy * Math.cos(radians);
    const anchorBefore = rotatedCorner(frame, rotation, { x: 1, y: 1 });
    const resized = resizeFrame({ handle: "nw", frame, dx, dy, rotation });
    // The nw handle pulls in its local axes: each side shrinks locally.
    expect(resized.width).toBeCloseTo(200 - localDx, 6);
    expect(resized.height).toBeCloseTo(100 - localDy, 6);
    const anchorAfter = rotatedCorner(resized, rotation, { x: 1, y: 1 });
    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 6);
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 6);
  });

  test("resizeFrame keeps the min-size floor and Shift lock in local axes", () => {
    const frame = { x: 100, y: 100, width: 200, height: 100 };
    // At 90°, +dy is +width: Shift scales the local height with it.
    expectFrameClose(
      resizeFrame({
        handle: "se",
        frame,
        dx: 0,
        dy: 100,
        rotation: 90,
        keepAspectRatio: true,
      }),
      { x: 25, y: 125, width: 300, height: 150 },
    );
    // A local shrink past the floor pins the moving edge, never inverts.
    expectFrameClose(
      resizeFrame({ handle: "e", frame, dx: 500, dy: 0, rotation: 180 }),
      { x: 292, y: 100, width: 8, height: 100 },
    );
  });

  test("resizeFrame keeps the stage-axis behavior at 0° cycles", () => {
    const frame = { x: 100, y: 100, width: 200, height: 100 };
    const base = resizeFrame({ handle: "se", frame, dx: 40, dy: 20 });
    expect(base).toEqual({ x: 100, y: 100, width: 240, height: 120 });
    expect(
      resizeFrame({ handle: "se", frame, dx: 40, dy: 20, rotation: 0 }),
    ).toEqual(base);
    expect(
      resizeFrame({ handle: "se", frame, dx: 40, dy: 20, rotation: 360 }),
    ).toEqual(base);
    expect(
      resizeFrame({ handle: "se", frame, dx: 40, dy: 20, rotation: -360 }),
    ).toEqual(base);
  });

  test("applyElementResize writes the element's size and clears the component origin", () => {
    const slide = editorSlide();
    const component = slide.ui!.components[0];
    const heading = component.elements[0];
    const frame = { x: 130, y: 90, width: 360, height: 80 };
    const resized = applyElementResize(heading, component, frame);
    expect(resized.size).toEqual({ width: 360, height: 80 });
    expect(resized.position).toEqual({ x: 30, y: 40 });

    // Vectors are honestly not resizable (their geometry is points).
    const rule = component.elements[2];
    expect(supportsResize(rule)).toBe(false);
    expect(applyElementResize(rule, component, frame)).toBe(rule);

    // An element with no explicit size has no frame math to resize.
    const unsized = { ...heading } as SlideElement;
    delete (unsized as { size?: unknown }).size;
    expect(applyElementResize(unsized, component, frame)).toBe(unsized);
    expect(supportsResize(heading)).toBe(true);
  });
});

test.describe("editor operations — rotation (D1)", () => {
  test("pointerAngle measures around the frame center", () => {
    const frame = { x: 0, y: 0, width: 100, height: 100 };
    expect(pointerAngle(frame, { x: 50, y: -10 })).toBeCloseTo(-90, 5);
    expect(pointerAngle(frame, { x: 110, y: 50 })).toBeCloseTo(0, 5);
    expect(pointerAngle(frame, { x: 50, y: 110 })).toBeCloseTo(90, 5);
  });

  test("rotationFromGesture applies the pointer delta and normalizes", () => {
    const frame = { x: 0, y: 0, width: 100, height: 100 };
    // The handle starts above the center: -90°; dragging to the right of the
    // center (0°) rotates a quarter turn clockwise.
    expect(
      rotationFromGesture({
        startRotation: 0,
        baseAngle: -90,
        pointer: { x: 110, y: 50 },
        frame,
      }),
    ).toBeCloseTo(90, 5);
    // Counter-clockwise past zero wraps into [0, 360).
    expect(
      rotationFromGesture({
        startRotation: 350,
        baseAngle: -90,
        pointer: { x: 50, y: -10 },
        frame,
      }),
    ).toBe(350);
    // Shift snaps to 15° increments.
    expect(
      rotationFromGesture({
        startRotation: 0,
        baseAngle: -90,
        pointer: { x: 91, y: 41 },
        frame,
        snap: true,
      }),
    ).toBe(75);
    expect(normalizeRotation(-10)).toBe(350);
    expect(normalizeRotation(360)).toBe(0);
  });
});

test.describe("editor operations — z-order (D1)", () => {
  test("reorderSelection moves the element one slot or to an end", () => {
    const slide = editorSlide();
    const names = (
      result: { slide: DeckSlide } | null,
    ): Array<string | undefined> =>
      result?.slide.ui?.components[0].elements.map(
        (element) => (element as { name?: string }).name,
      ) ?? [];

    const forward = reorderSelection(slide, "components:0/0", "forward");
    expect(forward?.key).toBe("components:0/1");
    expect(names(forward)).toEqual(["hero", "heading", undefined]);

    const backward = reorderSelection(slide, "components:0/1", "backward");
    expect(backward?.key).toBe("components:0/0");
    expect(names(backward)).toEqual(["hero", "heading", undefined]);

    const toFront = reorderSelection(slide, "components:0/0", "to-front");
    expect(toFront?.key).toBe("components:0/2");
    expect(names(toFront)).toEqual(["hero", undefined, "heading"]);

    const toBack = reorderSelection(slide, "components:0/2", "to-back");
    expect(toBack?.key).toBe("components:0/0");
    expect(names(toBack)).toEqual([undefined, "heading", "hero"]);
  });

  test("reorderSelection answers null at the boundaries and for dead keys", () => {
    const slide = editorSlide();
    expect(reorderSelection(slide, "components:0/0", "backward")).toBeNull();
    expect(reorderSelection(slide, "components:0/2", "forward")).toBeNull();
    expect(reorderSelection(slide, "components:0/0", "to-front")).not.toBeNull();
    expect(reorderSelection(slide, "components:4/0", "forward")).toBeNull();
    expect(reorderSelection(slide, "nope:0", "forward")).toBeNull();
  });

  test("the rendered element order (and the original slide) is unchanged by a reorder", () => {
    const slide = editorSlide();
    reorderSelection(slide, "components:0/0", "to-front");
    expect(
      slide.ui?.components[0].elements.map((element) => element.type),
    ).toEqual(["text", "image", "vector"]);
  });
});

test.describe("editor operations — group and ungroup (D1)", () => {
  test("groupSelection wraps siblings in a wire group at the frontmost slot", () => {
    const slide = editorSlide();
    const result = groupSelection(slide, ["components:0/0", "components:0/1"]);
    expect(result).not.toBeNull();
    // Removing elements 0 and 1 leaves the vector at slot 0; the frontmost
    // selected slot (1) collapses onto it, so the group sits at slot 0.
    expect(result?.key).toBe("components:0/0");
    const elements = result?.slide.ui?.components[0].elements ?? [];
    expect(elements.map((element) => element.type)).toEqual([
      "group",
      "vector",
    ]);
    expect((elements[0] as { name?: string }).name).toBe("Group");
    const group = elements[0];
    if (group.type !== "group") throw new Error("expected a group");
    // Frame = the union of the selected frames, relative to the component.
    expect(group.position).toEqual({ x: 10, y: 20 });
    expect(group.size).toEqual({ width: 400, height: 220 });
    expect(
      group.children.map((child) => (child as { name?: string }).name),
    ).toEqual(["heading", "hero"]);
    expect(group.children[0].position).toEqual({ x: 0, y: 0 });
    expect(group.children[1].position).toEqual({ x: 10, y: 120 });

    // The group is selectable and the original slide is untouched.
    expect(canGroupSelection(result!.slide, ["components:0/0"])).toBe(false);
    expect(canUngroupSelection(result!.slide, ["components:0/0"])).toBe(true);
    expect(
      slide.ui?.components[0].elements.map((element) => element.type),
    ).toEqual(["text", "image", "vector"]);
  });

  test("a vector child keeps its rendered stage position (points go group-local)", () => {
    const slide = editorSlide();
    const component = slide.ui!.components[0];
    const before = selectionFrames(slide, [
      "components:0/1",
      "components:0/2",
    ]).map((entry) => entry.frame);

    const result = groupSelection(slide, ["components:0/1", "components:0/2"]);
    const group = result?.slide.ui?.components[0].elements.find(
      (element) => element.type === "group",
    );
    if (group === undefined || group.type !== "group") {
      throw new Error("expected a group");
    }
    const vector = group.children[1];
    expect(vector.type).toBe("vector");

    /* The group renders its children inside its own frame, so the vector's
       points must become group-local: group origin (component-local 20,140)
       plus the stored point = the original stage position (the old sign bug
       rendered it at origin + 2·local + p and corrupted it on ungroup). */
    const groupOrigin = {
      x: (component.position?.x ?? 0) + (group.position?.x ?? 0),
      y: (component.position?.y ?? 0) + (group.position?.y ?? 0),
    };
    const points = vector.type === "vector" ? vector.points : [];
    expect(points[0]).toMatchObject({ x: 10, y: 120 });
    expect(groupOrigin.x + points[0].x).toBe(before[1].x);
    expect(groupOrigin.y + points[0].y).toBe(before[1].y);

    // The group→ungroup round trip restores every rendered frame exactly.
    const ungrouped = ungroupSelection(result!.slide, result!.key);
    expect(ungrouped).not.toBeNull();
    expect(
      selectionFrames(ungrouped!.slide, ungrouped!.keys).map(
        (entry) => entry.frame,
      ),
    ).toEqual(before);
  });

  test("groupSelection refuses a single element and a cross-parent pair", () => {
    const slide = editorSlide();
    expect(groupSelection(slide, ["components:0/0"])).toBeNull();
    expect(
      groupSelection(slide, ["components:0/0", "elements:0"]),
    ).toBeNull();
    expect(
      canGroupSelection(slide, ["components:0/0", "components:0/0"]),
    ).toBe(false);
  });

  test("ungroupSelection splices children back with the group offset applied", () => {
    const slide = editorSlide();
    const grouped = groupSelection(slide, ["components:0/0", "components:0/1"]);
    const result = ungroupSelection(grouped!.slide, grouped!.key);
    expect(result?.keys).toEqual(["components:0/0", "components:0/1"]);
    const elements = result?.slide.ui?.components[0].elements ?? [];
    expect(elements.map((element) => element.type)).toEqual([
      "text",
      "image",
      "vector",
    ]);
    expect(elements[0].position).toEqual({ x: 10, y: 20 });
    expect(elements[1].position).toEqual({ x: 20, y: 140 });

    // The round trip is geometrically identical for element-level grouping.
    expect(
      selectionFrames(result!.slide, result!.keys).map((entry) => entry.frame),
    ).toEqual(
      selectionFrames(slide, ["components:0/0", "components:0/1"]).map(
        (entry) => entry.frame,
      ),
    );

    // A non-group selection cannot ungroup.
    expect(canUngroupSelection(result!.slide, ["components:0/0"])).toBe(false);
    expect(ungroupSelection(result!.slide, "components:0/0")).toBeNull();
  });
});

test.describe("editor operations — keyboard commands (D1)", () => {
  test("arrows nudge 1px and Shift+arrows 10px", () => {
    expect(commandForArrowKey("ArrowLeft", false)).toEqual({
      kind: "nudge",
      dx: -1,
      dy: 0,
    });
    expect(commandForArrowKey("ArrowRight", false)).toEqual({
      kind: "nudge",
      dx: 1,
      dy: 0,
    });
    expect(commandForArrowKey("ArrowUp", false)).toEqual({
      kind: "nudge",
      dx: 0,
      dy: -1,
    });
    expect(commandForArrowKey("ArrowDown", false)).toEqual({
      kind: "nudge",
      dx: 0,
      dy: 1,
    });
    expect(commandForArrowKey("ArrowLeft", true)).toEqual({
      kind: "nudge",
      dx: -10,
      dy: 0,
    });
    expect(commandForArrowKey("ArrowDown", true)).toEqual({
      kind: "nudge",
      dx: 0,
      dy: 10,
    });
    expect(commandForArrowKey("a", false)).toBeNull();
    expect(commandForArrowKey("Enter", true)).toBeNull();
  });

  test("the z-order chord table pins the fork's Alt+J/K mapping", () => {
    expect(Z_ORDER_SHORTCUTS["alt+j"]).toBe("backward");
    expect(Z_ORDER_SHORTCUTS["alt+k"]).toBe("forward");
    expect(Z_ORDER_SHORTCUTS["alt+shift+j"]).toBe("to-back");
    expect(Z_ORDER_SHORTCUTS["alt+shift+k"]).toBe("to-front");
  });

  test("isEditableTarget guards the keyboard commands from text fields", () => {
    expect(isEditableTarget(null)).toBe(false);
    const input = { tagName: "INPUT", isContentEditable: false };
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget({ tagName: "textarea" })).toBe(true);
    expect(isEditableTarget({ tagName: "SELECT" })).toBe(true);
    expect(
      isEditableTarget({ tagName: "DIV", isContentEditable: true }),
    ).toBe(true);
    expect(
      isEditableTarget({ tagName: "DIV", isContentEditable: false }),
    ).toBe(false);
    expect(isEditableTarget({ tagName: "BUTTON" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task D3 — image editing ops (pure)
// ---------------------------------------------------------------------------

/** One image element with every D3-controlled wire field declared. */
function imageElementFixture(
  overrides: Partial<ImageElement> = {},
): ImageElement {
  return {
    type: "image",
    name: "hero",
    position: { x: 40, y: 30 },
    size: { width: 400, height: 300 },
    data: "/app_data/images/old.png",
    fit: "contain",
    focus_x: 50,
    focus_y: 50,
    crop_scale: 1,
    border_radius: { tl: 0, tr: 0, bl: 0, br: 0 },
    flip_h: false,
    flip_v: false,
    opacity: 1,
    is_icon: false,
    ...overrides,
  };
}

test.describe("image element ops (D3)", () => {
  test("applyImageFit writes only the fit and returns the same element when it matches", () => {
    const element = imageElementFixture();
    expect(applyImageFit(element, "contain")).toBe(element);

    const cover = applyImageFit(element, "cover");
    expect(cover).not.toBe(element);
    expect(cover.fit).toBe("cover");
    expect(cover.data).toBe(element.data);
    expect(cover.focus_x).toBe(element.focus_x);
    expect(cover.crop_scale).toBe(element.crop_scale);
    expect(cover.border_radius).toEqual(element.border_radius);

    expect(applyImageFit(element, "fill").fit).toBe("fill");
  });

  test("applyImageCrop clamps focus into 0..100 and crop_scale into the renderer's 1..6", () => {
    expect(clampImageFocus(-20)).toBe(IMAGE_FOCUS_MIN);
    expect(clampImageFocus(140)).toBe(IMAGE_FOCUS_MAX);
    expect(clampImageFocus(33.5)).toBe(33.5);
    expect(clampImageFocus(Number.NaN)).toBe(50);
    expect(clampImageFocus(Number.POSITIVE_INFINITY)).toBe(IMAGE_FOCUS_MAX);
    expect(clampImageCropScale(0.2)).toBe(IMAGE_CROP_SCALE_MIN);
    expect(clampImageCropScale(9)).toBe(IMAGE_CROP_SCALE_MAX);
    expect(clampImageCropScale(Number.NaN)).toBe(1);
  });

  test("applyImageCrop writes the patched fields, clears with null and keeps untouched fields", () => {
    const element = imageElementFixture();
    expect(applyImageCrop(element, {})).toBe(element);

    const cropped = applyImageCrop(element, {
      focusX: 120,
      focusY: -5,
      cropScale: 3.5,
    });
    expect(cropped.focus_x).toBe(100);
    expect(cropped.focus_y).toBe(0);
    expect(cropped.crop_scale).toBe(3.5);
    expect(cropped.data).toBe(element.data);
    expect(cropped.fit).toBe(element.fit);

    const partial = applyImageCrop(element, { cropScale: 2 });
    expect(partial.focus_x).toBe(50);
    expect(partial.focus_y).toBe(50);
    expect(partial.crop_scale).toBe(2);

    const cleared = applyImageCrop(element, { focusX: null, focusY: null });
    expect(cleared.focus_x).toBeNull();
    expect(cleared.focus_y).toBeNull();
    expect(cleared.crop_scale).toBe(element.crop_scale);
  });

  test("applyImageFlip toggles by default and honours an explicit value", () => {
    const element = imageElementFixture();
    const flippedH = applyImageFlip(element, "h");
    expect(flippedH.flip_h).toBe(true);
    expect(flippedH.flip_v).toBe(false);
    expect(applyImageFlip(element, "h", false)).toBe(element);
    expect(applyImageFlip(flippedH, "h", false).flip_h).toBe(false);
    expect(applyImageFlip(flippedH, "v").flip_v).toBe(true);
    expect(applyImageFlip(element, "h", true)).not.toBe(element);
  });

  test("applyImageBorderRadius writes all four corners and floors negatives", () => {
    const element = imageElementFixture();
    expect(applyImageBorderRadius(element, -4).border_radius).toEqual({
      tl: 0,
      tr: 0,
      bl: 0,
      br: 0,
    });
    const rounded = applyImageBorderRadius(element, 12.5);
    expect(rounded.border_radius).toEqual({ tl: 12.5, tr: 12.5, bl: 12.5, br: 12.5 });
    expect(rounded.data).toBe(element.data);
  });

  test("applyImageOpacity clamps to 0..1", () => {
    const element = imageElementFixture();
    expect(applyImageOpacity(element, 0.4).opacity).toBe(0.4);
    expect(applyImageOpacity(element, 3).opacity).toBe(1);
    expect(applyImageOpacity(element, -1).opacity).toBe(0);
    expect(applyImageOpacity(element, Number.NaN).opacity).toBe(1);
    expect(applyImageOpacity(element, 1)).toBe(element);
  });

  test("applyImageSource trims, keeps every style field, and refuses an empty source", () => {
    const element = imageElementFixture();
    expect(applyImageSource(element, "   ")).toBe(element);
    const replaced = applyImageSource(
      element,
      " /app_data/images/new.png ",
    );
    expect(replaced.data).toBe("/app_data/images/new.png");
    expect(replaced.fit).toBe(element.fit);
    expect(replaced.focus_x).toBe(element.focus_x);
    expect(replaced.crop_scale).toBe(element.crop_scale);
    expect(replaced.border_radius).toEqual(element.border_radius);
    expect(applyImageSource(element, element.data)).toBe(element);
  });
});

test.describe("image asset normalization (D3)", () => {
  test("normalizes an engine image entry and reads the prompt from extras", () => {
    const entry = normalizePresentonImage({
      id: "7b2f7f8e-4c4e-4a25-9d1b-2f6a5b0c9a11",
      created_at: "2026-09-18T12:00:00",
      is_uploaded: false,
      path: "/app_data/images/users/u/generated----x.png",
      extras: { prompt: "a lighthouse at dusk", theme_prompt: "verdant" },
      file_url: "/app_data/images/users/u/generated----x.png",
    });
    expect(entry).toEqual({
      id: "7b2f7f8e-4c4e-4a25-9d1b-2f6a5b0c9a11",
      createdAt: "2026-09-18T12:00:00",
      isUploaded: false,
      fileUrl: "/app_data/images/users/u/generated----x.png",
      prompt: "a lighthouse at dusk",
    });
    /* Review fix: the engine filesystem path must never cross to a caller. */
    expect(entry).not.toHaveProperty("path");
  });

  test("drops malformed entries instead of guessing", () => {
    expect(normalizePresentonImage(null)).toBeNull();
    expect(normalizePresentonImage([])).toBeNull();
    expect(normalizePresentonImage({ id: 5, file_url: "/x.png" })).toBeNull();
    expect(
      normalizePresentonImage({ id: "a", file_url: "" }),
    ).toBeNull();
    expect(normalizePresentonImage({ id: "a" })).toBeNull();

    const noPrompt = normalizePresentonImage({
      id: "a",
      is_uploaded: true,
      path: 7,
      file_url: "/app_data/images/a.png",
    });
    expect(noPrompt).toEqual({
      id: "a",
      createdAt: null,
      isUploaded: true,
      fileUrl: "/app_data/images/a.png",
      prompt: null,
    });
  });

  test("keeps only non-empty strings from a search response", () => {
    expect(
      normalizePresentonImageSearch([
        "https://images.pexels.com/a.jpg",
        "",
        null,
        7,
        "https://images.pexels.com/b.jpg",
      ]),
    ).toEqual([
      "https://images.pexels.com/a.jpg",
      "https://images.pexels.com/b.jpg",
    ]);
    expect(normalizePresentonImageSearch(null)).toEqual([]);
    expect(normalizePresentonImageSearch({ items: [] })).toEqual([]);
  });

  test("flags only the engine's placeholder asset as unavailable generation", () => {
    expect(isPresentonPlaceholderImage("/static/images/placeholder.jpg")).toBe(
      true,
    );
    expect(
      isPresentonPlaceholderImage(
        "http://localhost:5001/static/images/placeholder.jpg",
      ),
    ).toBe(true);
    expect(isPresentonPlaceholderImage("/app_data/images/real.png")).toBe(false);
    expect(
      isPresentonPlaceholderImage("https://images.pexels.com/photos/1/x.jpg"),
    ).toBe(false);
    expect(isPresentonPlaceholderImage("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task D3 review fix — reference-based image scoping (pure rules)
// ---------------------------------------------------------------------------

test.describe("image scope rules (D3 review)", () => {
  /** The caller's own paths: one referenced by their decks, one fresh permit. */
  const scope = {
    referenced: new Set(["/app_data/images/users/u/mine.png"]),
    permitted: new Set(["/app_data/images/users/u/fresh.png"]),
  };

  test("classifies external http(s) sources as always insertable", () => {
    expect(
      isExternalImageSource("https://images.pexels.com/photos/1/x.jpg"),
    ).toBe(true);
    expect(isExternalImageSource("http://example.com/x.png")).toBe(true);
    expect(isExternalImageSource("  https://example.com/x.png  ")).toBe(true);
    expect(isExternalImageSource("/app_data/images/users/u/mine.png")).toBe(
      false,
    );
    expect(isExternalImageSource("data:image/png;base64,AAAA")).toBe(false);
    expect(isExternalImageSource("//images.example.com/x.png")).toBe(false);
    expect(isExternalImageSource("")).toBe(false);
    expect(isExternalImageSource(null)).toBe(false);
    expect(
      classifyImageSource("https://images.pexels.com/photos/1/x.jpg", scope),
    ).toBe("external");
  });

  test("allows engine paths only from the referenced union or a fresh permit", () => {
    expect(
      classifyImageSource("/app_data/images/users/u/mine.png", scope),
    ).toBe("referenced");
    expect(
      classifyImageSource("/app_data/images/users/u/fresh.png", scope),
    ).toBe("permitted");
    /* Another account's engine image — the exact review finding. */
    expect(
      classifyImageSource("/app_data/images/users/v/foreign.png", scope),
    ).toBe("denied");
  });

  test("denies unsafe, empty, relative and non-engine sources", () => {
    expect(classifyImageSource("/app_data/../secret", scope)).toBe("denied");
    expect(classifyImageSource("/app_data/images/../x.png", scope)).toBe(
      "denied",
    );
    expect(classifyImageSource("/etc/passwd", scope)).toBe("denied");
    expect(classifyImageSource("relative/mine.png", scope)).toBe("denied");
    expect(classifyImageSource("", scope)).toBe("denied");
    expect(classifyImageSource(null, scope)).toBe("denied");
    expect(classifyImageSource(7, scope)).toBe("denied");
  });

  test("filters the library to the caller's own images and keeps stock URLs unaffected", () => {
    const images = [
      { id: "a", fileUrl: "/app_data/images/users/u/mine.png" },
      { id: "b", fileUrl: "/app_data/images/users/v/foreign.png" },
      { id: "c", fileUrl: "/app_data/images/users/u/fresh.png" },
    ];
    expect(filterScopedImages(images, scope).map((image) => image.id)).toEqual([
      "a",
      "c",
    ]);
    expect(isImageInScope("/app_data/images/users/v/foreign.png", scope)).toBe(
      false,
    );
    expect(isImageInScope("/app_data/images/users/u/mine.png", scope)).toBe(
      true,
    );
    /* A stock result never goes through the scope filter or the proxy. */
    expect(
      isExternalImageSource("https://images.pexels.com/photos/1/x.jpg"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task D4 — icon search normalization, recolor and element ops (pure)
//
// The engine's icon catalog (`GET /api/v1/ppt/icons/search`) answers absolute
// or engine-relative `/static/icons/<weight>/…` URLs; the native path
// normalizes every entry to a path, previews/renders it through the
// owner-gated asset proxy and recolours SVG text client-side (spec §5.4,
// §6.5, §7.4). The live search/insert/recolor flow is proved in
// `qa-presentation-ui`; this project pins the pure contracts.
// ---------------------------------------------------------------------------

test.describe("icon search normalization (D4)", () => {
  test("normalizes relative and absolute catalog URLs to engine icon paths", () => {
    const relative =
      "/static/icons/bold/lightbulb-bold.svg";
    expect(normalizePresentonIcon(relative)).toEqual({
      path: relative,
      weight: "bold",
    });
    expect(
      normalizePresentonIcon(
        "http://127.0.0.1:5001/static/icons/regular/lightbulb.svg",
      ),
    ).toEqual({
      path: "/static/icons/regular/lightbulb.svg",
      weight: "regular",
    });
    /* The engine's own `absolute_fastapi_asset_url` may answer a
       protocol-relative URL too. */
    expect(
      normalizePresentonIcon("//cdn.example.com/static/icons/thin/star.svg"),
    ).toEqual({ path: "/static/icons/thin/star.svg", weight: "thin" });
    /* The catalog's raster icons survive as paths; the renderer then only
       recolors SVG sources. */
    expect(normalizePresentonIcon("/static/icons/duotone/x-duotone.png")).toEqual(
      { path: "/static/icons/duotone/x-duotone.png", weight: "duotone" },
    );
  });

  test("drops malformed, non-icon and unsafe entries instead of guessing", () => {
    for (const value of [
      null,
      undefined,
      7,
      [],
      {},
      "",
      "   ",
      "lightbulb.svg",
      "/app_data/images/lightbulb.svg",
      "/static/images/placeholder.jpg",
      "/static/icons/bold/../../secret.svg",
      "/static/icons/bold/star.svg?cache=1",
      "/static/icons/unknown-weight/star.svg",
      "https://host/not-an-icon",
    ]) {
      expect(
        normalizePresentonIcon(value),
        `must reject ${JSON.stringify(value)}`,
      ).toBeNull();
    }
  });

  test("normalizeIconWeight mirrors the engine: unknown weights read bold", () => {
    expect(DEFAULT_ICON_WEIGHT).toBe("bold");
    expect(ICON_WEIGHTS).toEqual([
      "bold",
      "duotone",
      "fill",
      "light",
      "regular",
      "thin",
    ]);
    for (const weight of ICON_WEIGHTS) {
      expect(normalizeIconWeight(weight)).toBe(weight);
      expect(normalizeIconWeight(` ${weight.toUpperCase()} `)).toBe(weight);
    }
    expect(normalizeIconWeight("semi-bold")).toBe("bold");
    expect(normalizeIconWeight(null)).toBe("bold");
    expect(normalizeIconWeight(7)).toBe("bold");
    expect(normalizeIconWeight("")).toBe("bold");
  });

  test("iconWeightFromPath reads only a valid weight directory", () => {
    expect(iconWeightFromPath("/static/icons/regular/lightbulb.svg")).toBe(
      "regular",
    );
    expect(iconWeightFromPath("/static/icons/bogus/x.svg")).toBeNull();
    expect(iconWeightFromPath("/static/images/x.svg")).toBeNull();
    expect(iconWeightFromPath(null)).toBeNull();
    expect(normalizeIconPath("/static/icons/fill/heart.svg")).toBe(
      "/static/icons/fill/heart.svg",
    );
    expect(normalizeIconPath("/static/icons/bold/../x.svg")).toBeNull();
  });
});

test.describe("icon SVG recolor (D4)", () => {
  const ICON =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">` +
    `<path d="M1 1" fill="#000000" stroke="#111111" stroke-width="2"/>` +
    `<path d='M2 2' fill='#010101'/>` +
    `<path d=M3 fill=#030303/>` +
    `<path d="M3 3" style="fill:#020202;stroke:rgb(2,2,2)"/>` +
    `<path d="M4 4" fill="none" stroke="currentColor"/>` +
    `<path d="M5 5" fill="url(#grad)" stroke="url(#grad2)"/>` +
    `<path d="M6 6" fill="transparent" stroke="inherit"/>` +
    `</svg>`;

  test("replaces fill/stroke attributes and styles, sets the root color/fill", () => {
    const recolored = recolorSvg(ICON, "#FF0000");
    expect(recolored).toContain('fill="#FF0000"');
    expect(recolored).toContain("stroke=\"#FF0000\"");
    expect(recolored).toContain("fill:#FF0000");
    expect(recolored).toContain("stroke:#FF0000");
    expect(recolored).toContain('color="#FF0000"');
    expect(recolored).not.toContain("#000000");
    expect(recolored).not.toContain("#111111");
    expect(recolored).not.toContain("#010101");
    expect(recolored).not.toContain("#020202");
    expect(recolored).not.toContain("currentColor");
  });

  test("preserves none, url(), transparent and inherit paints", () => {
    const recolored = recolorSvg(ICON, "#00FF00");
    expect(recolored).toContain('fill="none"');
    expect(recolored).toContain('stroke="url(#grad2)"');
    expect(recolored).toContain('fill="url(#grad)"');
    expect(recolored).toContain('fill="transparent"');
    expect(recolored).toContain('stroke="inherit"');
  });

  test("accepts bare hex, #hex and keywords; refuses unsafe or unknown values", () => {
    expect(recolorSvg(ICON, "FF0000")).toContain('color="#FF0000"');
    expect(recolorSvg(ICON, "#f00")).toContain('color="#f00"');
    expect(recolorSvg(ICON, "red")).toContain('color="red"');
    expect(recolorSvg(ICON, "rgb(1, 2, 3)")).toContain('color="rgb(1, 2, 3)"');

    /* An unusable color is a no-op: the markup is returned untouched. */
    for (const value of [
      '"><script>alert(1)</script>',
      "#000;background:url(x)",
      "url(#grad)",
      "",
      null,
      7,
    ]) {
      expect(recolorSvg(ICON, value)).toBe(ICON);
    }
    expect(normalizeIconColor("FFFFFF")).toBe("#FFFFFF");
    expect(normalizeIconColor("not a color")).toBeNull();
    expect(normalizeIconColor("rgba(1,2,3,0.5)")).toBe("rgba(1,2,3,0.5)");
  });

  test("sanitizeSvgMarkup strips script, foreignObject, event handlers and javascript: URLs", () => {
    const dirty =
      `<svg onload="alert(1)">` +
      `<script>alert(1)</script>` +
      `<script src="x.js"/>` +
      `<foreignObject><div>hi</div></foreignObject>` +
      `<a xlink:href="javascript:alert(1)">` +
      `<path d="M0 0" onclick="alert(2)"/>` +
      `</a></svg>`;
    const clean = sanitizeSvgMarkup(dirty);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("foreignObject");
    expect(clean).not.toContain("onload");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("javascript:");
    expect(clean).toContain("<svg");
    expect(clean).toContain('d="M0 0"');
  });

  test("recoloredIconDataUri returns an encoded SVG data URI or null", () => {
    const uri = recoloredIconDataUri(
      `<svg><script>x</script><path fill="#000"/></svg>`,
      "#00FF00",
    );
    expect(uri).not.toBeNull();
    expect(uri?.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(uri).not.toContain("<");
    const decoded = decodeURIComponent(uri!.slice(uri!.indexOf(",") + 1));
    expect(decoded).toContain('fill="#00FF00"');
    expect(decoded).not.toContain("<script");

    expect(recoloredIconDataUri("<svg/>", "not a color")).toBeNull();
    expect(recoloredIconDataUri("", "#fff")).toBeNull();
    expect(svgDataUri("<svg/>")).toBe(
      "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E",
    );
  });

  test("isSvgIconSource separates SVG sources from raster and inline data URLs", () => {
    expect(isSvgIconSource("/static/icons/regular/lightbulb.svg")).toBe(true);
    expect(isSvgIconSource("/app_data/x.svg?v=2")).toBe(true);
    expect(isSvgIconSource("https://host/path/star.SVG")).toBe(true);
    expect(isSvgIconSource("data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E")).toBe(
      true,
    );
    expect(isSvgIconSource("/static/icons/duotone/x.png")).toBe(false);
    expect(isSvgIconSource("data:image/png;base64,AAAA")).toBe(false);
    expect(isSvgIconSource("")).toBe(false);
    expect(isSvgIconSource(null)).toBe(false);
  });
});

test.describe("icon element ops (D4)", () => {
  test("applyIconSource writes the path and is_icon, preserving every style field", () => {
    const element = imageElementFixture({ is_icon: true, color: "#112233" });
    const next = applyIconSource(
      element,
      " /static/icons/regular/lightbulb.svg ",
    );
    expect(next).not.toBe(element);
    expect(next.data).toBe("/static/icons/regular/lightbulb.svg");
    expect(next.is_icon).toBe(true);
    expect(next.color).toBe("#112233");
    expect(next.fit).toBe(element.fit);
    expect(next.focus_x).toBe(element.focus_x);
    expect(next.border_radius).toEqual(element.border_radius);

    /* A plain image becomes an icon when a catalog path replaces its data. */
    const image = imageElementFixture();
    expect(applyIconSource(image, "/static/icons/bold/star-bold.svg")).toEqual({
      ...image,
      data: "/static/icons/bold/star-bold.svg",
      is_icon: true,
    });

    /* Same source already flagged: no new reference (autosave skips it). */
    const same = applyIconSource(next, next.data);
    expect(same).toBe(next);
    expect(applyIconSource(element, "")).toBe(element);
    expect(applyIconSource(element, "/static/images/photo.png")).toBe(element);
  });

  test("applyIconColor canonicalizes, clears and refuses invalid values", () => {
    const element = imageElementFixture({ is_icon: true });
    expect(applyIconColor(element, "C2410C").color).toBe("#C2410C");
    expect(applyIconColor(element, "#c2410c").color).toBe("#c2410c");

    const red = applyIconColor(element, "#FF0000");
    expect(red.color).toBe("#FF0000");
    expect(red.data).toBe(element.data);
    expect(applyIconColor(red, "#FF0000")).toBe(red);

    /* Clearing a stored color writes null; clearing one that was never set is
       a no-op (no pointless slide write for a fresh icon). */
    expect(applyIconColor(red, "").color).toBeNull();
    expect(applyIconColor(red, null).color).toBeNull();
    expect(applyIconColor(element, "")).toBe(element);
    expect(applyIconColor(element, null)).toBe(element);
    expect(applyIconColor(element, "not a color")).toBe(element);
    expect(applyIconColor(element, '"><script>')).toBe(element);
  });
});

test.describe("engine-public image sources (D4)", () => {
  /** An empty scope: nothing is referenced and no permit was minted. */
  const emptyScope = {
    referenced: new Set<string>(),
    permitted: new Set<string>(),
  };

  test("the icon catalog and vendored assets are insertable without a reference", () => {
    expect(
      classifyImageSource("/static/icons/regular/lightbulb.svg", emptyScope),
    ).toBe("public");
    expect(classifyImageSource("/vendor/fonts/x.woff2", emptyScope)).toBe(
      "public",
    );
    expect(
      classifyImageSource("/app_data/fonts/Inter/Inter.woff2", emptyScope),
    ).toBe("public");
    expect(
      isImageInScope("/static/icons/bold/star-bold.svg", emptyScope),
    ).toBe(true);
    expect(isEnginePublicImageSource("/static/icons/bold/x.svg")).toBe(true);
    expect(isEnginePublicImageSource("/app_data/images/users/u/x.png")).toBe(
      false,
    );
  });

  test("user-data paths stay denied and traversal shapes stay unsafe", () => {
    expect(
      classifyImageSource("/app_data/images/users/u/x.png", emptyScope),
    ).toBe("denied");
    expect(classifyImageSource("/static/../secret.svg", emptyScope)).toBe(
      "denied",
    );
    expect(classifyImageSource("/static//x.svg", emptyScope)).toBe("denied");
    expect(isEnginePublicImageSource("/static/../x.svg")).toBe(false);
    expect(isEnginePublicImageSource(null)).toBe(false);
  });
});
