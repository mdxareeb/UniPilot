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
  normalizeChatConversation,
  normalizeChatHistory,
  normalizePresentonIcon,
  normalizePresentonImage,
  normalizePresentonImageSearch,
} from "../../lib/integrations/presenton";
import {
  applyChatFrame,
  CHAT_ERROR_COPY,
  chatHistoryResponseApplies,
  chatHistoryDiscardReleasesLoading,
  chatTraceMutatesDeck,
  chatTurnMayChangeDeck,
  classifyChatDeckDiff,
  createChatEntry,
  frameToSse,
  normalizeChatFramePayload,
  normalizeChatSseEvent,
  parseSseBlocks,
  slideTextSummary,
  type ChatDeckSnapshot,
  type ChatTrace,
} from "../../lib/presentation/chatFrames";
import {
  classifyImageSource,
  filterScopedImages,
  isEnginePublicImageSource,
  isExternalImageSource,
  isImageInScope,
} from "../../lib/presentation/imageScope";
import {
  addChartRow,
  addChartSeries,
  applyChartField,
  categoryPlaceholder,
  chartAxisLabels,
  chartColorSlots,
  chartColorTargetMode,
  chartHasAxes,
  chartRowCount,
  chartSeriesSupportsMultiple,
  chartThemePalette,
  CHART_COLOR_LIMIT,
  CHART_ROW_LIMIT,
  CHART_SERIES_LIMIT,
  CHART_TEXT_MAX_LENGTH,
  CHART_TYPE_OPTIONS,
  DATA_LABEL_OPTIONS,
  readChartCategories,
  readChartSeries,
  removeChartRow,
  removeChartSeries,
  setCategory,
  setChartColor,
  setSeriesName,
  setSeriesValue,
} from "../../lib/presentation/chartOps";
import {
  addTableColumn,
  addTableRow,
  removeTableColumn,
  removeTableRow,
  setTableCellText,
  tableBounds,
  tableCellText,
  tableColumnCount,
  TABLE_COLUMN_HARD_CAP,
  TABLE_ROW_HARD_CAP,
  tableHasHeader,
  tableRenderedRowCount,
} from "../../lib/presentation/tableOps";
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
import {
  clearElementClipboard,
  cloneElementForClipboard,
  createElementClipboard,
  deleteElements,
  duplicateElements,
  ELEMENT_CLIPBOARD_MIME,
  ELEMENT_CLIPBOARD_PREFIX,
  ELEMENT_DUPLICATE_OFFSET,
  ELEMENT_PASTE_OFFSET,
  elementClipboardText,
  nextElementPasteOffset,
  parseElementClipboard,
  parseElementClipboardText,
  pasteElementClipboard,
  readElementClipboard,
  refreshElementIds,
  rememberElementClipboard,
  resetElementPasteSequence,
  serializeElementClipboard,
} from "../../lib/presentation/clipboardOps";
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
// Task D6 — hydration gaps closed: repeated children + markdown/LaTeX runs
//
// The C2 report parked two engine paths on the critical path for block
// insertion: an array value on a flex/grid/group expands one repeated child per
// item (`_apply_template_content_to_children`, presentation.py:732-761, with
// `repeated_child_source_index`/`_normalize_repeated_names` in
// `templates/v2/content.py`) and text values parse markdown/LaTeX into styled
// runs (`_template_text_runs_from_markdown`, :1131-1169, and
// `utils/latex_text.py`). Both are ported in `hydrateSlide.ts`; every expected
// value below was produced by running the engine's own functions on these
// fixtures. The third C2 gap — the schema-derived top-level repeated-group
// expansion — stays recorded: the block palette labels those layouts
// replace-disabled (`layoutReplaceSupport`), never guesses.
// ---------------------------------------------------------------------------

function d6CardText(
  name: string,
  placeholder: string,
  font: Record<string, unknown>,
): SlideElement {
  return {
    type: "text",
    name,
    decorative: false,
    position: { x: 0, y: 0 },
    size: { width: 200, height: 40 },
    font,
    runs: [{ text: placeholder, font }],
  } as SlideElement;
}

function d6StepGroup(index: number, manual = false): SlideElement {
  const group: Record<string, unknown> = {
    type: "group",
    name: `step_${index}`,
    position: { x: 0, y: index * 90 },
    children: [
      d6CardText("card_heading", `Heading ${index}`, {
        size: 24,
        bold: true,
        family: "Inter",
      }),
      d6CardText("card_description", `Description ${index}`, {
        size: 14,
        family: "Inter",
      }),
    ],
  };
  if (manual) group.__presenton_manual_position = true;
  return group as unknown as SlideElement;
}

function d6TimelineLayout(container: "flex" | "group"): TemplateLayout {
  return {
    id: "timeline_layout",
    description: "Timeline cards.",
    components: [
      {
        id: "connected_timeline_cards",
        description: "Timeline cards.",
        position: { x: 10, y: 20 },
        elements: [
          {
            type: "group",
            name: "timeline",
            position: { x: 0, y: 0 },
            children: [
              {
                type: container,
                name: "steps",
                position: { x: 0, y: 0 },
                size: { width: 900, height: 400 },
                children: [d6StepGroup(1, true), d6StepGroup(2), d6StepGroup(3)],
              },
            ],
          } as SlideElement,
        ],
      },
    ],
  };
}

test.describe("hydrateSlide — repeated children (D6)", () => {
  test("expands an array value into one child per item, clamping and re-suffixing like the engine", () => {
    const layout = d6TimelineLayout("flex");
    const layoutSnapshot = jsonClone(layout);
    const ui = hydrateSlide({
      layout,
      content: {
        connected_timeline_cards: {
          timeline: {
            steps: [
              {
                card_heading: "Capture",
                card_description: "**Photons** strike the leaf.",
              },
              {
                card_heading: "Transport",
                card_description: "Electrons move along the *chain*.",
              },
              {
                card_heading: "Synthesis",
                card_description: "ATP is generated.",
              },
              {
                card_heading: "Extra",
                card_description: "Beyond the template.",
              },
            ],
          },
        },
      },
    });

    const timeline = ui.components[0].elements[0] as unknown as {
      children: Array<{
        children: Array<{
          name?: string;
          position?: unknown;
          children: SlideElement[];
        }>;
      }>;
    };
    const steps = timeline.children[0].children;
    expect(steps).toHaveLength(4);
    expect(steps.map((step) => step.name)).toEqual([
      "step_1",
      "step_2",
      "step_3",
      "step_4",
    ]);
    // The 4th item clamps to the last template child and its numeric name token
    // is re-suffixed; the manual-position marker never survives the copy.
    expect(steps[3].position).toEqual(steps[2].position);
    expect(
      (steps[0] as unknown as Record<string, unknown>)
        .__presenton_manual_position,
    ).toBeUndefined();
    expect((steps[0].children[0] as TextElement).runs).toEqual([
      { text: "Capture", font: { size: 24, bold: true, family: "Inter" } },
    ]);
    expect((steps[0].children[1] as TextElement).runs).toEqual([
      { text: "Photons", font: { size: 14, family: "Inter", bold: true } },
      { text: " strike the leaf.", font: { size: 14, family: "Inter" } },
    ]);
    expect((steps[1].children[1] as TextElement).runs).toEqual([
      { text: "Electrons move along the ", font: { size: 14, family: "Inter" } },
      { text: "chain", font: { size: 14, family: "Inter", italic: true } },
      { text: ".", font: { size: 14, family: "Inter" } },
    ]);

    // The deep-clone contract holds for the repeated copies too.
    expect(layout).toEqual(layoutSnapshot);
    expect(steps[0]).not.toBe(layout.components[0].elements[0]);
  });

  test("centers a reduced group's children but clamps a flex's, and maps direct item values", () => {
    const content = {
      connected_timeline_cards: {
        timeline: {
          steps: [{ card_heading: "Only", card_description: "Solo" }],
        },
      },
    };

    const grouped = hydrateSlide({
      layout: d6TimelineLayout("group"),
      content,
    });
    const groupedSteps = (
      grouped.components[0].elements[0] as unknown as {
        children: Array<{
          children: Array<{ name?: string; children: SlideElement[] }>;
        }>;
      }
    ).children[0].children;
    // Three template children reduced to one: the group centers on the middle
    // child (`(3 - 1) // 2`), the flex starts at the first.
    expect(groupedSteps.map((step) => step.name)).toEqual(["step_2"]);

    const flexed = hydrateSlide({
      layout: d6TimelineLayout("flex"),
      content,
    });
    const flexedSteps = (
      flexed.components[0].elements[0] as unknown as {
        children: Array<{
          children: Array<{ name?: string; children: SlideElement[] }>;
        }>;
      }
    ).children[0].children;
    expect(flexedSteps.map((step) => step.name)).toEqual(["step_1"]);

    // A repeated item that is itself a generated value is used directly: two
    // label children take the array's strings, with the template first-run
    // style (presentation.py:648-659 in the repeated path).
    const labels = hydrateElement(
      {
        type: "flex",
        name: "labels",
        children: [
          d6CardText("label", "Placeholder 1", { size: 12 }),
          d6CardText("label", "Placeholder 2", { size: 12 }),
        ],
      } as SlideElement,
      { labels: ["One", "Two"] },
    ) as FlexElement;
    expect((labels.children[0] as TextElement).runs).toEqual([
      { text: "One", font: { size: 12 } },
    ]);
    expect((labels.children[1] as TextElement).runs).toEqual([
      { text: "Two", font: { size: 12 } },
    ]);
  });

  test("keeps the outer occurrence scope out of a repeated item (engine passes None)", () => {
    /* The engine hydrates repeated items with `name_occurrences=None`
       (presentation.py:743-752), so a nested list starts a fresh scope. A
       shared scope let the group's own name count as the first occurrence and
       the nested text then preferred `card_2` over `card`. */
    const ui = hydrateSlide({
      layout: {
        id: "nested_scope_layout",
        description: "Nested repeated scope.",
        components: [
          {
            id: "c1",
            description: "Cards.",
            position: { x: 0, y: 0 },
            elements: [
              {
                type: "flex",
                name: "cards",
                children: [
                  {
                    type: "group",
                    name: "card",
                    children: [
                      {
                        type: "text",
                        name: "card",
                        decorative: false,
                        runs: [
                          { text: "placeholder", font: { size: 12 } },
                        ],
                        font: { size: 12 },
                      },
                    ],
                  },
                ],
              } as unknown as SlideElement,
            ],
          },
        ],
      },
      content: {
        c1: { cards: [{ card: "item-value", card_2: "other" }] },
      },
    });

    const cardGroup = (
      ui.components[0].elements[0] as unknown as {
        children: Array<{ children: SlideElement[] }>;
      }
    ).children[0];
    expect((cardGroup.children[0] as TextElement).runs).toEqual([
      { text: "item-value", font: { size: 12 } },
    ]);
  });
});

test.describe("hydrateSlide — markdown and LaTeX runs (D6)", () => {
  /** One body text whose first run is bold — the base style the parser uses. */
  function markdownText(value: string): TextElement {
    return hydrateElement(
      {
        type: "text",
        name: "body",
        decorative: false,
        font: { size: 18, family: "Inter", color: "#111111" },
        runs: [
          {
            text: "placeholder",
            font: { size: 18, family: "Inter", color: "#111111", bold: true },
          },
        ],
      } as SlideElement,
      { body: value },
    ) as TextElement;
  }

  const plain = { size: 18, family: "Inter", color: "#111111" };

  test("splits **bold** and *italic* over the first run's style", () => {
    expect(markdownText("**bold** and *italic*").runs).toEqual([
      { text: "bold", font: { ...plain, bold: true } },
      { text: " and ", font: { ...plain } },
      { text: "italic", font: { ...plain, italic: true } },
    ]);
  });

  test("keeps literal delimiters honest (markers, products, underscores)", () => {
    // No style found: the first run's bold survives untouched.
    expect(markdownText("2 * 3 = 6").runs).toEqual([
      { text: "2 * 3 = 6", font: { ...plain, bold: true } },
    ]);
    // Unclosed markers merge back into one plain run.
    expect(markdownText("a **unclosed").runs).toEqual([
      { text: "a **unclosed", font: { ...plain, bold: true } },
    ]);
    // The engine's underscore rule still reads `_case_` as emphasis.
    expect(markdownText("snake_case_name").runs).toEqual([
      { text: "snake", font: { ...plain } },
      { text: "case", font: { ...plain, italic: true } },
      { text: "name", font: { ...plain } },
    ]);
    // `***triple***` bolds the `*triple` span and leaves the last star plain
    // (the strong delimiter consumes the outer pair, exactly like the engine).
    expect(markdownText("***triple***").runs).toEqual([
      { text: "*triple", font: { ...plain, bold: true } },
      { text: "*", font: { ...plain } },
    ]);
  });

  test("parses <latex> spans into raw-source latex runs and keeps surrounding text", () => {
    const formula = hydrateElement(
      {
        type: "text",
        name: "formula",
        decorative: false,
        font: { size: 18, family: "Inter" },
        runs: [
          { text: "placeholder", font: { size: 18, family: "Inter" } },
        ],
      } as SlideElement,
      { formula: "pre <latex>x^2 + y^2</latex> post" },
    ) as TextElement;
    expect(formula.runs).toEqual([
      { text: "pre ", font: { size: 18, family: "Inter" } },
      {
        font: { size: 18, family: "Inter" },
        type: "latex",
        latex: "x^2 + y^2",
        display_mode: false,
      },
      { text: " post", font: { size: 18, family: "Inter" } },
    ]);

    // An empty latex span parses to an empty run list, exactly like the engine.
    const empty = hydrateElement(
      {
        type: "text",
        name: "formula",
        decorative: false,
        runs: [{ text: "placeholder" }],
      } as SlideElement,
      { formula: "<latex></latex>" },
    ) as TextElement;
    expect(empty.runs).toEqual([]);
  });

  test("hands text-list items through the same parser", () => {
    const bullets = hydrateElement(
      {
        type: "text-list",
        name: "bullets",
        decorative: false,
        font: { family: "Inter" },
        items: [[{ text: "old", font: { size: 16 } }]],
      } as SlideElement,
      {
        bullets: ["**First** bullet", "", "snake_case_name", "a **unclosed"],
      },
    ) as TextListElement;
    expect(bullets.items).toEqual([
      [
        { text: "First", font: { family: "Inter", size: 16, bold: true } },
        { text: " bullet", font: { family: "Inter", size: 16 } },
      ],
      [
        { text: "snake", font: { family: "Inter" } },
        { text: "case", font: { family: "Inter", italic: true } },
        { text: "name", font: { family: "Inter" } },
      ],
      [{ text: "a **unclosed", font: { family: "Inter" } }],
    ]);
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

// ---------------------------------------------------------------------------
// Task D5 — chart data ops (spec §5.4 charts row, §6.6)
//
// The pure half of the chart editor: `chartOps` maps the editor's writes onto
// the exact `ChartElement` fields `chartConfig` reads, with the renderer's own
// normalization, palette precedence and per-type rules (pie/donut single
// series; no scales for pie/donut/polar_area). Every helper is bounds-safe and
// returns the same element reference when a write is a no-op — the live
// editor, re-render and persistence are proved in `qa-presentation-ui`.
// ---------------------------------------------------------------------------

function chartOpsFixture(overrides: Partial<ChartElement> = {}): ChartElement {
  return {
    type: "chart",
    chart_type: "bar",
    title: "Trend",
    categories: ["Jan", "Feb", "Mar"],
    series: [{ name: "Series 1", values: [1, 2, 3] }],
    colors: null,
    name: "chart",
    ...overrides,
  };
}

test.describe("chart data ops — types and fields (D5)", () => {
  test("the type list covers the wire enum and the data-label positions", () => {
    expect(
      CHART_TYPE_OPTIONS.map((option) => option.value).sort(),
    ).toEqual(WIRE_CHART_TYPES.map(([chartType]) => chartType).sort());
    expect(CHART_TYPE_OPTIONS.every((option) => option.label.trim() !== "")).toBe(
      true,
    );
    expect(DATA_LABEL_OPTIONS.map((option) => option.value)).toEqual([
      "base",
      "mid",
      "top",
      "outside",
    ]);
  });

  test("applyChartField normalizes the title and preserves identity on no-ops", () => {
    const element = chartOpsFixture();
    expect(applyChartField(element, { field: "title", value: "Trend" })).toBe(
      element,
    );
    expect(applyChartField(element, { field: "chart_type", value: "bar" })).toBe(
      element,
    );
    expect(
      applyChartField(element, { field: "data_labels", value: null }),
    ).toBe(element);
    expect(applyChartField(element, { field: "x_axis", value: true })).not.toBe(
      element,
    );

    const cleared = applyChartField(element, { field: "title", value: "   " });
    expect(cleared.title).toBeNull();
    expect(applyChartField(cleared, { field: "title", value: "" })).toBe(cleared);

    const line = applyChartField(element, {
      field: "chart_type",
      value: "line",
    });
    expect(line.chart_type).toBe("line");
    expect(line.categories).toBe(element.categories);

    const labels = applyChartField(element, {
      field: "data_labels",
      value: "outside",
    });
    expect(labels.data_labels).toBe("outside");

    const axis = applyChartField(element, { field: "x_axis", value: false });
    expect(axis.x_axis).toBe(false);
    expect(applyChartField(axis, { field: "x_axis", value: false })).toBe(axis);
    const grid = applyChartField(axis, { field: "y_axis_grid", value: false });
    expect(grid.y_axis_grid).toBe(false);
    expect(element.x_axis).toBeUndefined();
  });

  test("per-type rules: series multiplicity, axes and radar labels", () => {
    expect(chartSeriesSupportsMultiple("bar")).toBe(true);
    expect(chartSeriesSupportsMultiple("pie")).toBe(false);
    expect(chartSeriesSupportsMultiple("donut")).toBe(false);

    expect(chartHasAxes("bar")).toBe(true);
    expect(chartHasAxes("radar")).toBe(true);
    expect(chartHasAxes("pie")).toBe(false);
    expect(chartHasAxes("donut")).toBe(false);
    expect(chartHasAxes("polar_area")).toBe(false);

    expect(chartAxisLabels("radar")).toEqual({
      xAxis: "Category labels",
      xGrid: "Spokes",
      yAxis: "Value labels",
      yGrid: "Rings",
    });
    expect(chartAxisLabels("bar").xAxis).toBe("Show X axis");
  });
});

test.describe("chart data ops — series, categories and rows (D5)", () => {
  test("readChartSeries applies the renderer's normalization without throwing", () => {
    const element = chartOpsFixture({
      series: [
        { name: "", values: [1, Number.NaN, Number.POSITIVE_INFINITY] },
        { name: "Named", values: [3] },
        { name: "Strings", values: ["5", "x", ""] },
        null,
        "junk",
      ] as unknown as ChartElement["series"],
    });
    expect(readChartSeries(element)).toEqual([
      { name: "Series 1", values: [1, 0, 0] },
      { name: "Named", values: [3] },
      { name: "Strings", values: [5, 0, 0] },
    ]);
    expect(readChartSeries(chartOpsFixture({ series: null }))).toEqual([]);
    expect(readChartSeries(chartOpsFixture({ series: undefined }))).toEqual([]);
  });

  test("readChartCategories keeps positions and empties non-strings", () => {
    const element = chartOpsFixture({
      categories: ["A", 7, null, "  D  "] as unknown as string[],
    });
    expect(readChartCategories(element)).toEqual(["A", "", "", "  D  "]);
    expect(readChartCategories(chartOpsFixture({ categories: null }))).toEqual(
      [],
    );
    expect(categoryPlaceholder(2)).toBe("Value 3");
  });

  test("setSeriesValue writes finite values and pads unstored rendered cells", () => {
    const element = chartOpsFixture({
      series: [
        { name: "One", values: [1, 2] },
        { name: "Two", values: [3, 4] },
      ],
    });
    expect(setSeriesValue(element, 0, 1, 2)).toBe(element);
    expect(setSeriesValue(element, 1, 0, 9).series).toEqual([
      { name: "One", values: [1, 2] },
      { name: "Two", values: [9, 4] },
    ]);
    expect(setSeriesValue(element, 0, 1, Number.NaN)).toBe(element);
    expect(setSeriesValue(element, 0, 1, Number.POSITIVE_INFINITY)).toBe(element);
    expect(setSeriesValue(element, 0, -1, 5)).toBe(element);
    /* Past the rendered grid (three categories) the write is refused. */
    expect(setSeriesValue(element, 0, 3, 5)).toBe(element);
    expect(setSeriesValue(element, 5, 0, 5)).toBe(element);

    /* Row 2 renders but Series One does not store a value for it: the write
       pads with the zeros the renderer already draws (mirrors setCategory). */
    const padded = setSeriesValue(element, 0, 2, 7);
    expect(padded.series).toEqual([
      { name: "One", values: [1, 2, 7] },
      { name: "Two", values: [3, 4] },
    ]);
    expect(element.series?.[0].values).toEqual([1, 2]);
    const config = chartConfig(padded, null);
    expect(chartDatasets(config)[0].data).toEqual([1, 2, 7]);

    /* A later write to the now-stored cell is a plain in-range edit. */
    expect(setSeriesValue(padded, 0, 2, 7)).toBe(padded);
  });

  test("the edited value reaches chartConfig's dataset (editor → renderer parity)", () => {
    const edited = setSeriesValue(chartOpsFixture(), 0, 1, 42);
    const config = chartConfig(edited, null);
    expect(chartDatasets(config)[0].data).toEqual([1, 42, 3]);
  });

  test("setSeriesName and setCategory cap text and materialize only edited gaps", () => {
    const element = chartOpsFixture({ categories: ["Jan"] });
    expect(setSeriesName(element, 0, "Series 1")).toBe(element);
    expect(setSeriesName(element, 0, "Revenue").series?.[0].name).toBe("Revenue");
    expect(setSeriesName(element, 9, "Nope")).toBe(element);

    expect(setCategory(element, 0, "Jan")).toBe(element);
    const padded = setCategory(element, 2, "Mar");
    expect(padded.categories).toEqual(["Jan", "Value 2", "Mar"]);
    expect(readChartCategories(padded)).toEqual(["Jan", "Value 2", "Mar"]);

    const long = "x".repeat(CHART_TEXT_MAX_LENGTH + 20);
    const capped = setCategory(element, 0, long);
    expect(capped.categories?.[0]).toHaveLength(CHART_TEXT_MAX_LENGTH);
    expect(setCategory(element, -1, "x")).toBe(element);
    expect(setCategory(element, CHART_ROW_LIMIT, "x")).toBe(element);
  });

  test("addChartRow appends a category and a zero per series, capped at 24", () => {
    const element = chartOpsFixture();
    const added = addChartRow(element);
    expect(added.categories).toEqual(["Jan", "Feb", "Mar", "Item 4"]);
    expect(added.series?.[0].values).toEqual([1, 2, 3, 0]);
    expect(element.categories).toEqual(["Jan", "Feb", "Mar"]);

    /* Series shorter than the row count are padded to the new width. */
    const shortSeries = chartOpsFixture({
      categories: ["A", "B", "C"],
      series: [{ name: "One", values: [1] }],
    });
    expect(addChartRow(shortSeries).series?.[0].values).toEqual([1, 0, 0, 0]);

    /* No stored series: the category row is appended honestly, no series. */
    const noSeries = chartOpsFixture({ series: [] });
    const noSeriesNext = addChartRow(noSeries);
    expect(noSeriesNext.categories).toHaveLength(4);
    expect(noSeriesNext.series).toEqual([]);

    const full = chartOpsFixture({
      categories: Array.from({ length: CHART_ROW_LIMIT }, (_, index) => `C${index}`),
      series: [{ name: "One", values: Array.from({ length: CHART_ROW_LIMIT }, () => 1) }],
    });
    expect(addChartRow(full)).toBe(full);
  });

  test("removeChartRow drops the category and every stored value, keeping one row", () => {
    const element = chartOpsFixture({
      series: [
        { name: "One", values: [1, 2, 3] },
        { name: "Two", values: [4] },
      ],
    });
    const removed = removeChartRow(element, 1);
    expect(removed.categories).toEqual(["Jan", "Mar"]);
    expect(removed.series).toEqual([
      { name: "One", values: [1, 3] },
      { name: "Two", values: [4] },
    ]);
    expect(removeChartRow(element, 9)).toBe(element);
    expect(removeChartRow(element, -1)).toBe(element);

    const single = chartOpsFixture({ categories: ["Only"], series: [] });
    expect(removeChartRow(single, 0)).toBe(single);
  });

  test("addChartSeries pads to the row count and refuses pie/donut and the cap", () => {
    const element = chartOpsFixture();
    const added = addChartSeries(element);
    expect(added.series).toHaveLength(2);
    expect(added.series?.[1]).toEqual({
      name: "Series 2",
      values: [0, 0, 0],
    });

    const pie = chartOpsFixture({ chart_type: "pie" });
    expect(addChartSeries(pie)).toBe(pie);
    const donut = chartOpsFixture({ chart_type: "donut" });
    expect(addChartSeries(donut)).toBe(donut);

    const capped = chartOpsFixture({
      series: Array.from({ length: CHART_SERIES_LIMIT }, (_, index) => ({
        name: `Series ${index + 1}`,
        values: [1, 2, 3],
      })),
    });
    expect(addChartSeries(capped)).toBe(capped);
  });

  test("removeChartSeries keeps the last series and removes by index", () => {
    const element = chartOpsFixture({
      series: [
        { name: "One", values: [1, 2, 3] },
        { name: "Two", values: [4, 5, 6] },
      ],
    });
    expect(removeChartSeries(element, 0).series).toEqual([
      { name: "Two", values: [4, 5, 6] },
    ]);
    expect(removeChartSeries(element, 7)).toBe(element);

    const single = chartOpsFixture();
    expect(removeChartSeries(single, 0)).toBe(single);
  });

  test("chartRowCount follows the longest of categories and values, capped at 24", () => {
    expect(chartRowCount(chartOpsFixture())).toBe(3);
    expect(
      chartRowCount(
        chartOpsFixture({
          categories: ["A"],
          series: [{ name: "One", values: [1, 2, 3, 4] }],
        }),
      ),
    ).toBe(4);
    expect(
      chartRowCount(chartOpsFixture({ categories: [], series: [] })),
    ).toBe(0);

    /* The renderer caps its labels at 24 (chartLabels): the editor exposes
       exactly the rows the renderer draws. */
    const wide = chartOpsFixture({
      categories: Array.from({ length: CHART_ROW_LIMIT + 6 }, (_, i) => `C${i}`),
      series: [
        {
          name: "One",
          values: Array.from({ length: CHART_ROW_LIMIT + 6 }, () => 1),
        },
      ],
    });
    expect(chartRowCount(wide)).toBe(CHART_ROW_LIMIT);

    /* Row writers keep the raw width: an unrelated add never truncates a
       series the renderer does not draw. */
    const added = addChartRow(wide);
    expect(added).toBe(wide);
  });
});

test.describe("chart data ops — colors (D5)", () => {
  const THEME = ["#111111", "#222222", "#333333"];

  test("chartThemePalette reads the ten graph roles, or the fork defaults", () => {
    const palette = chartThemePalette(themeColors());
    expect(palette).toHaveLength(10);
    expect(palette[0]).toBe("#285F20");
    expect(chartThemePalette(null).length).toBeGreaterThan(0);
    expect(chartThemePalette({ graph_0: "not a color" }).length).toBeGreaterThan(
      0,
    );
  });

  test("slots target series or categories with the renderer's labels", () => {
    const single = chartOpsFixture();
    expect(chartColorTargetMode(single)).toBe("category");
    expect(
      chartColorSlots(single, THEME).map((slot) => slot.label),
    ).toEqual(["Jan", "Feb", "Mar"]);
    expect(chartColorSlots(single, THEME).map((slot) => slot.color)).toEqual(
      THEME,
    );
    expect(chartColorSlots(single, THEME).every((slot) => !slot.explicit)).toBe(
      true,
    );

    const multi = chartOpsFixture({
      series: [
        { name: "One", values: [1, 2, 3] },
        { name: "Two", values: [4, 5, 6] },
      ],
    });
    expect(chartColorTargetMode(multi)).toBe("series");
    expect(chartColorSlots(multi, THEME).map((slot) => slot.label)).toEqual([
      "One",
      "Two",
    ]);

    /* Pie keeps the category mode even with several stored series. */
    const pie = chartOpsFixture({
      chart_type: "pie",
      series: [
        { name: "One", values: [1, 2, 3] },
        { name: "Two", values: [4, 5, 6] },
      ],
    });
    expect(chartColorTargetMode(pie)).toBe("category");
    expect(chartColorSlots(pie, THEME).map((slot) => slot.label)).toEqual([
      "Jan",
      "Feb",
      "Mar",
    ]);

    /* Explicit colors win, cycling exclusively like the renderer: a 2-color
       palette on a 3-category chart draws explicit[2 % 2] for the third
       category, and the chip reports exactly that. */
    const explicit = chartOpsFixture({ colors: ["#ABCDEF", "#123456"] });
    const slots = chartColorSlots(explicit, THEME);
    expect(slots[0]).toMatchObject({ color: "#ABCDEF", explicit: true });
    expect(slots[1]).toMatchObject({ color: "#123456", explicit: true });
    expect(slots[2]).toMatchObject({ color: "#ABCDEF", explicit: false });
    expect(
      chartDatasets(chartConfig(explicit, null))[0].backgroundColor,
    ).toEqual(["#ABCDEF", "#123456", "#ABCDEF"]);
  });

  test("setChartColor preserves every other slot's rendered color and the chips agree", () => {
    /* Fresh element: no explicit colors, three rendered slots seeded from the
       theme. Editing Feb must keep Jan and Mar drawing their theme colors. */
    const element = chartOpsFixture({ colors: null });
    const before = chartColorSlots(element, THEME);
    expect(before.map((slot) => slot.color)).toEqual(THEME);

    const written = setChartColor(element, 1, "#ABCDEF", THEME);
    /* The whole exposed slot set materializes: a shorter array would make the
       renderer cycle explicit[2 % 2] = explicit[0] for Mar. */
    expect(written.colors).toEqual(["#111111", "#ABCDEF", "#333333"]);

    const after = chartColorSlots(written, THEME);
    expect(after[0].color).toBe(before[0].color);
    expect(after[1].color).toBe("#ABCDEF");
    expect(after[2].color).toBe(before[2].color);
    expect(after.map((slot) => slot.color)).toEqual([
      "#111111",
      "#ABCDEF",
      "#333333",
    ]);

    /* Chip-vs-render agreement: the dataset draws exactly what the chips
       report, category by category. */
    const config = chartConfig(written, null);
    expect(chartDatasets(config)[0].backgroundColor).toEqual(
      after.map((slot) => slot.color),
    );

    /* Editing the first slot from no explicit colors keeps the others too. */
    const first = setChartColor(element, 0, "#ABCDEF", THEME);
    expect(first.colors).toEqual(["#ABCDEF", "#222222", "#333333"]);
    expect(chartColorSlots(first, THEME).slice(1).map((slot) => slot.color)).toEqual([
      "#222222",
      "#333333",
    ]);

    /* Same-value writes are identity; reset removes the explicit slot, and the
       remaining explicit pair then cycles (the renderer's own all-or-nothing
       palette) — the chips report exactly that. */
    expect(setChartColor(written, 1, "#ABCDEF", THEME)).toBe(written);
    const reset = setChartColor(written, 1, null, THEME);
    expect(reset.colors).toEqual(["#111111", "#333333"]);
    expect(chartColorSlots(reset, THEME).map((slot) => slot.color)).toEqual([
      "#111111",
      "#333333",
      "#111111",
    ]);

    /* Invalid and out-of-range writes are refused. */
    expect(setChartColor(element, 0, "not a color", THEME)).toBe(element);
    expect(setChartColor(element, CHART_COLOR_LIMIT, "#FFFFFF", THEME)).toBe(
      element,
    );
    expect(setChartColor(written, 5, null, THEME)).toBe(written);
  });

  test("setChartColor keeps an existing explicit palette's other slots untouched", () => {
    /* Explicit colors cycle exclusively: with two stored colors, the third
       category draws explicit[0]. Editing one slot must not shift that. */
    const element = chartOpsFixture({ colors: ["#AABBCC", "#112233"] });
    const before = chartColorSlots(element, THEME);
    expect(before.map((slot) => slot.color)).toEqual([
      "#AABBCC",
      "#112233",
      "#AABBCC",
    ]);

    const written = setChartColor(element, 1, "#ABCDEF", THEME);
    expect(written.colors).toEqual(["#AABBCC", "#ABCDEF", "#AABBCC"]);
    const after = chartColorSlots(written, THEME);
    expect(after[0].color).toBe(before[0].color);
    expect(after[2].color).toBe(before[2].color);
    expect(chartDatasets(chartConfig(written, null))[0].backgroundColor).toEqual(
      after.map((slot) => slot.color),
    );
    expect(element.colors).toEqual(["#AABBCC", "#112233"]);

    /* Invalid stored colors are dropped like the renderer drops them: one
       valid explicit color cycles exclusively over every slot. */
    const dirty = chartOpsFixture({
      colors: ["#123456", "junk", "  "] as string[],
    });
    expect(
      chartColorSlots(dirty, THEME).map((slot) => slot.color),
    ).toEqual(["#123456", "#123456", "#123456"]);
    expect(setChartColor(dirty, 1, "#ABCDEF", THEME).colors).toEqual([
      "#123456",
      "#ABCDEF",
      "#123456",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Task D5 — table data ops (spec §5.4 tables row, §6.4)
//
// The pure half of the table editor: rendered-row addressing (row 0 is the
// stored header when `columns` is non-empty), run-preserving plain-text cell
// writes, and bounds-safe row/column add/remove that respect the wire's
// declared min/max (falling back to the fork editor's own caps). The live
// cell edit and persistence are proved in `qa-presentation-ui`.
// ---------------------------------------------------------------------------

function tableOpsFixture(overrides: Partial<TableElement> = {}): TableElement {
  return {
    type: "table",
    name: "metrics",
    size: { width: 800, height: 200 },
    columns: [
      {
        font: { size: 14, bold: true },
        runs: [{ text: "Region", font: { size: 14, bold: true } }],
      },
      { runs: [{ text: "Sales" }] },
    ],
    rows: [
      [{ runs: [{ text: "US" }] }, { runs: [{ text: "10" }] }],
      [{ runs: [{ text: "EU" }] }, { runs: [{ text: "20" }] }],
    ],
    ...overrides,
  };
}

test.describe("table data ops — shape and bounds (D5)", () => {
  test("rendered rows/columns and header detection follow the renderer", () => {
    const element = tableOpsFixture();
    expect(tableRenderedRowCount(element)).toBe(3);
    expect(tableColumnCount(element)).toBe(2);
    expect(tableHasHeader(element)).toBe(true);

    const headerless = tableOpsFixture({ columns: [] });
    expect(tableRenderedRowCount(headerless)).toBe(2);
    expect(tableHasHeader(headerless)).toBe(false);

    const wide = tableOpsFixture({
      columns: [{ runs: [{ text: "A" }] }],
      rows: [[{ runs: [{ text: "x" }] }], []],
    });
    expect(tableColumnCount(wide)).toBe(1);
    expect(tableRenderedRowCount(wide)).toBe(3);

    const malformed = {
      type: "table",
      columns: undefined,
      rows: undefined,
    } as unknown as TableElement;
    expect(tableRenderedRowCount(malformed)).toBe(0);
    expect(tableColumnCount(malformed)).toBe(1);
    expect(tableHasHeader(malformed)).toBe(false);
  });

  test("declared bounds win and clamp into the editor's hard caps", () => {
    expect(tableBounds(tableOpsFixture())).toEqual({
      minRows: 1,
      maxRows: 8,
      minColumns: 1,
      maxColumns: 6,
    });
    expect(
      tableBounds(
        tableOpsFixture({
          min_rows: 2,
          max_rows: 3,
          min_columns: 2,
          max_columns: 4,
        }),
      ),
    ).toEqual({ minRows: 2, maxRows: 3, minColumns: 2, maxColumns: 4 });

    /* min > max collapses to the minimum; huge values clamp to the hard cap. */
    expect(
      tableBounds(tableOpsFixture({ min_rows: 5, max_rows: 2 })),
    ).toMatchObject({ minRows: 5, maxRows: 5 });
    expect(
      tableBounds(tableOpsFixture({ max_rows: 999, max_columns: 999 })),
    ).toMatchObject({
      maxRows: TABLE_ROW_HARD_CAP,
      maxColumns: TABLE_COLUMN_HARD_CAP,
    });
  });

  test("tableCellText reads stored runs and tolerates missing cells", () => {
    const element = tableOpsFixture();
    expect(tableCellText(element, 0, 0)).toBe("Region");
    expect(tableCellText(element, 1, 1)).toBe("10");
    /* A padded column the row does not store reads empty. */
    expect(tableCellText(element, 1, 7)).toBe("");
    /* Out-of-range rows read empty, never throw. */
    expect(tableCellText(element, 9, 0)).toBe("");
    expect(tableCellText(element, -1, 0)).toBe("");
  });
});

test.describe("table data ops — cell writes (D5)", () => {
  test("setTableCellText preserves the first run's style and every cell field", () => {
    const styledCell = {
      font: { size: 12, color: "#03362D" },
      color: { color: "#F8F4E9", opacity: 1 },
      alignment: "center" as const,
      runs: [{ text: "US", font: { bold: true } }, { text: "!" }],
    };
    const element = tableOpsFixture({ rows: [[styledCell]] });
    const next = setTableCellText(element, 1, 0, "USA");
    expect(next.rows[0][0]).toEqual({
      ...styledCell,
      runs: [{ text: "USA", font: { bold: true } }],
    });
    expect(element.rows[0][0].runs).toEqual([
      { text: "US", font: { bold: true } },
      { text: "!" },
    ]);
  });

  test("a LaTeX first run degrades to its font (or the cell font), never kept as text", () => {
    const latexCell = {
      font: { size: 10 },
      runs: [{ type: "latex" as const, latex: "x^2", font: { italic: true } }],
    };
    const element = tableOpsFixture({ rows: [[latexCell]] });
    expect(setTableCellText(element, 1, 0, "x²").rows[0][0].runs).toEqual([
      { text: "x²", font: { italic: true } },
    ]);

    const plainLatex = {
      runs: [{ type: "latex" as const, latex: "y" }],
    };
    const latexOnly = tableOpsFixture({ rows: [[plainLatex]] });
    /* Rewriting the LaTeX source as itself is a no-op (the displayed text is
       already that source); a real edit degrades to plain text. */
    expect(setTableCellText(latexOnly, 1, 0, "y")).toBe(latexOnly);
    expect(
      setTableCellText(latexOnly, 1, 0, "y2").rows[0][0].runs,
    ).toEqual([{ text: "y2" }]);
  });

  test("the header row addresses `columns` and the body rows address `rows`", () => {
    const element = tableOpsFixture();
    const header = setTableCellText(element, 0, 1, "Revenue");
    expect(header.columns?.[1].runs).toEqual([{ text: "Revenue" }]);
    expect(header.rows?.[0][1].runs).toEqual([{ text: "10" }]);

    const body = setTableCellText(element, 2, 0, "APAC");
    expect(body.rows?.[1][0].runs).toEqual([{ text: "APAC" }]);
    expect(body.columns?.[0].runs).toEqual([
      { text: "Region", font: { size: 14, bold: true } },
    ]);
  });

  test("an unaddressable or unchanged write is a no-op with the same reference", () => {
    const element = tableOpsFixture();
    expect(setTableCellText(element, 1, 0, "US")).toBe(element);
    expect(setTableCellText(element, 9, 0, "x")).toBe(element);
    expect(setTableCellText(element, -1, 0, "x")).toBe(element);
    expect(setTableCellText(element, 1, -1, "x")).toBe(element);

    const malformed = {
      type: "table",
      columns: undefined,
      rows: undefined,
    } as unknown as TableElement;
    expect(setTableCellText(malformed, 0, 0, "x")).toBe(malformed);
  });

  test("editing a padded cell materializes it at the right column", () => {
    const twoColumns = tableOpsFixture({
      columns: [{ runs: [{ text: "A" }] }, { runs: [{ text: "B" }] }],
      rows: [[{ runs: [{ text: "x" }] }]],
    });
    const next = setTableCellText(twoColumns, 1, 1, "y");
    expect(next.rows[0]).toEqual([
      { runs: [{ text: "x" }] },
      { runs: [{ text: "y" }] },
    ]);
    expect(twoColumns.rows[0]).toEqual([{ runs: [{ text: "x" }] }]);
  });
});

test.describe("table data ops — row and column structure (D5)", () => {
  test("addTableRow appends empty cells and respects the default/declared cap", () => {
    const element = tableOpsFixture();
    const added = addTableRow(element);
    expect(added.rows).toHaveLength(3);
    expect(added.rows?.[2]).toEqual([{ runs: [] }, { runs: [] }]);
    expect(element.rows).toHaveLength(2);

    const sevenBodyRows = tableOpsFixture({
      rows: Array.from({ length: 7 }, () => [{ runs: [] }, { runs: [] }]),
    });
    expect(tableRenderedRowCount(sevenBodyRows)).toBe(8);
    expect(addTableRow(sevenBodyRows)).toBe(sevenBodyRows);

    const declared = tableOpsFixture({ max_rows: 3 });
    expect(addTableRow(declared)).toBe(declared);
  });

  test("removeTableRow promotes the header, keeps the last row and honours min_rows", () => {
    const element = tableOpsFixture();
    const promoted = removeTableRow(element, 0);
    expect(promoted.columns).toEqual([{ runs: [{ text: "US" }] }, { runs: [{ text: "10" }] }]);
    expect(promoted.rows).toEqual([[{ runs: [{ text: "EU" }] }, { runs: [{ text: "20" }] }]]);
    expect(element.columns?.[0].runs).toEqual([
      { text: "Region", font: { size: 14, bold: true } },
    ]);

    const body = removeTableRow(element, 1);
    expect(body.rows).toHaveLength(1);
    expect(body.columns).toEqual(element.columns);

    const headerOnly = tableOpsFixture({ rows: [] });
    expect(removeTableRow(headerOnly, 0)).toBe(headerOnly);

    const singleBody = tableOpsFixture({ columns: [], rows: [[{ runs: [] }]] });
    expect(removeTableRow(singleBody, 0)).toBe(singleBody);

    const declared = tableOpsFixture({ min_rows: 3 });
    expect(removeTableRow(declared, 1)).toBe(declared);
    expect(removeTableRow(element, 9)).toBe(element);
  });

  test("addTableColumn pads short rows so the new cell lands at the new index", () => {
    const short = tableOpsFixture({
      columns: [{ runs: [{ text: "A" }] }, { runs: [{ text: "B" }] }],
      rows: [[{ runs: [{ text: "only" }] }], []],
    });
    const added = addTableColumn(short);
    expect(added.columns).toHaveLength(3);
    expect(added.columns?.[2]).toEqual({ runs: [] });
    expect(added.rows?.[0]).toEqual([
      { runs: [{ text: "only" }] },
      { runs: [] },
      { runs: [] },
    ]);
    expect(added.rows?.[1]).toEqual([{ runs: [] }, { runs: [] }, { runs: [] }]);

    const declared = tableOpsFixture({ max_columns: 2 });
    expect(addTableColumn(declared)).toBe(declared);

    /* An empty element initializes its first renderable cell (1×1 body). */
    const empty = tableOpsFixture({ columns: [], rows: [] });
    const initialized = addTableColumn(empty);
    expect(initialized.rows).toEqual([[{ runs: [] }]]);
    expect(tableRenderedRowCount(initialized)).toBe(1);
    expect(tableColumnCount(initialized)).toBe(1);
    expect(empty.rows).toEqual([]);
  });

  test("an empty table initializes its first cell from either add action", () => {
    const empty = tableOpsFixture({ columns: [], rows: [] });
    expect(tableRenderedRowCount(empty)).toBe(0);

    const withRow = addTableRow(empty);
    expect(withRow.rows).toEqual([[{ runs: [] }]]);
    expect(tableRenderedRowCount(withRow)).toBe(1);
    expect(tableColumnCount(withRow)).toBe(1);

    const withColumn = addTableColumn(empty);
    expect(withColumn.rows).toEqual([[{ runs: [] }]]);

    /* The initialized cell is editable like any other. */
    const edited = setTableCellText(withRow, 0, 0, "First");
    expect(edited.rows?.[0][0].runs).toEqual([{ text: "First" }]);
  });

  test("removeTableColumn drops the column from header and body, bounds-safe", () => {
    const element = tableOpsFixture();
    const removed = removeTableColumn(element, 0);
    expect(removed.columns).toEqual([{ runs: [{ text: "Sales" }] }]);
    expect(removed.rows).toEqual([
      [{ runs: [{ text: "10" }] }],
      [{ runs: [{ text: "20" }] }],
    ]);
    expect(element.columns).toHaveLength(2);

    /* Rows too short to store the column keep their other cells. */
    const ragged = tableOpsFixture({
      columns: [{ runs: [{ text: "A" }] }, { runs: [{ text: "B" }] }],
      rows: [[{ runs: [{ text: "only" }] }], []],
    });
    const raggedRemoved = removeTableColumn(ragged, 1);
    expect(raggedRemoved.columns).toEqual([{ runs: [{ text: "A" }] }]);
    expect(raggedRemoved.rows).toEqual([
      [{ runs: [{ text: "only" }] }],
      [],
    ]);

    const declared = tableOpsFixture({ min_columns: 2 });
    expect(removeTableColumn(declared, 0)).toBe(declared);
    const single = tableOpsFixture({
      columns: [{ runs: [] }],
      rows: [[{ runs: [] }]],
    });
    expect(removeTableColumn(single, 0)).toBe(single);
    expect(removeTableColumn(element, 9)).toBe(element);
  });
});

// ---------------------------------------------------------------------------
// Task D7 — clipboard, duplicate and delete (pure)
// ---------------------------------------------------------------------------

/**
 * One slide with a component holding a text, a vector, a flex (with a flow
 * child), an occupied container and a group (with an absolute child), plus a
 * second component — the shapes the D7 targeting rules branch on.
 */
function clipboardSlide(): DeckSlide {
  return {
    id: "33333333-4444-4555-8666-777777777777",
    presentation: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    layout_group: "general",
    layout: "clipboard_fixture",
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
              type: "vector",
              points: [
                { x: 30, y: 260 },
                { x: 230, y: 260 },
                { x: 230, y: 300 },
              ],
              closed: true,
              fill: { color: "#111111" },
            },
            {
              type: "flex",
              name: "stack",
              direction: "column",
              children: [
                {
                  type: "text",
                  name: "caption",
                  position: { x: 5, y: 5 },
                  size: { width: 100, height: 40 },
                  runs: [{ text: "Caption" }],
                },
              ],
            },
            {
              type: "container",
              position: { x: 0, y: 0 },
              size: { width: 220, height: 120 },
              child: {
                type: "text",
                name: "only_child",
                runs: [{ text: "Inside" }],
              },
            },
            {
              type: "group",
              name: "cluster",
              position: { x: 0, y: 0 },
              size: { width: 100, height: 100 },
              children: [
                {
                  type: "image",
                  name: "nested_image",
                  position: { x: 0, y: 0 },
                  size: { width: 50, height: 50 },
                  data: "/app_data/images/n.png",
                },
              ],
            },
          ],
        },
        {
          id: "sidebar",
          description: "Sidebar",
          position: { x: 900, y: 0 },
          elements: [
            {
              type: "text",
              name: "side_note",
              position: { x: 0, y: 0 },
              size: { width: 100, height: 40 },
              runs: [{ text: "Side" }],
            },
          ],
        },
      ],
    },
  };
}

function componentElements(slide: DeckSlide, index = 0): SlideElement[] {
  const component = slide.ui?.components[index];
  return component !== undefined && Array.isArray(component.elements)
    ? component.elements
    : [];
}

/** The element's `name`, or its type where the wire shape carries none. */
function elementName(element: SlideElement): string {
  const name = (element as { name?: unknown }).name;
  return typeof name === "string" ? name : element.type;
}

test.describe("clipboard operations — copy buffer (D7)", () => {
  test("createElementClipboard deep-clones the selection with its addressing", () => {
    const slide = clipboardSlide();
    const before = structuredClone(slide);
    const payload = createElementClipboard(slide, [
      "components:0/0",
      "components:0/2/0",
      "components:0/9",
    ]);

    expect(payload).not.toBeNull();
    expect(payload?.items).toHaveLength(2);
    const heading = payload?.items[0];
    const caption = payload?.items[1];
    expect(heading?.sourceRoot).toBe("components");
    expect(heading?.sourceComponentId).toBe("body");
    expect(heading?.parentIndexes).toEqual([]);
    expect(heading?.parentType).toBeNull();
    expect(caption?.parentIndexes).toEqual([2]);
    expect(caption?.parentType).toBe("flex");

    // The clone is a distinct object graph; the slide was not mutated.
    expect(heading?.element).not.toBe(componentElements(slide)[0]);
    expect(slide).toEqual(before);

    // Root-level copies carry the root identity instead of a component id.
    const withRoot = clipboardSlide();
    withRoot.ui!.elements = [
      {
        type: "text",
        name: "root_title",
        position: { x: 1, y: 2 },
        size: { width: 10, height: 10 },
        runs: [{ text: "Root" }],
      },
    ] as unknown;
    const rootPayload = createElementClipboard(withRoot, ["elements:0"]);
    expect(rootPayload?.items[0]?.sourceRoot).toBe("elements");
    expect(rootPayload?.items[0]?.sourceComponentId).toBeNull();

    expect(createElementClipboard(slide, [])).toBeNull();
    expect(createElementClipboard(null, ["components:0/0"])).toBeNull();
  });

  test("the module buffer survives navigation and restarts the paste walk", () => {
    clearElementClipboard();
    expect(readElementClipboard()).toBeNull();

    const payload = createElementClipboard(clipboardSlide(), ["components:0/0"]);
    expect(payload).not.toBeNull();
    rememberElementClipboard(payload!);
    expect(readElementClipboard()).toBe(payload);
    expect(ELEMENT_PASTE_OFFSET).toBe(16);
    expect(nextElementPasteOffset()).toBe(16);
    expect(nextElementPasteOffset()).toBe(32);
    // A new copy restarts the walk; the explicit reset does the same.
    rememberElementClipboard(payload!);
    expect(nextElementPasteOffset()).toBe(16);
    resetElementPasteSequence();
    expect(nextElementPasteOffset()).toBe(16);
    clearElementClipboard();
    expect(readElementClipboard()).toBeNull();
  });

  test("refreshElementIds replaces stored ids deeply and invents none for today's wire", () => {
    let counter = 0;
    const makeId = () => `fresh-${(counter += 1)}`;
    const element = {
      type: "group",
      id: "group-old",
      name: "g",
      children: [
        { type: "text", id: "text-old", name: "t", runs: [{ text: "x" }] },
      ],
    } as unknown as SlideElement;

    const refreshed = refreshElementIds(element, makeId);
    expect((refreshed as { id?: string }).id).toBe("fresh-1");
    const children = (refreshed as { children: Array<{ id?: string }> })
      .children;
    expect(children[0]?.id).toBe("fresh-2");
    // The source element keeps its ids (immutability).
    expect((element as { id?: string }).id).toBe("group-old");

    // A plain wire element (no `id` anywhere) gains no id field.
    const plain = refreshElementIds(
      { type: "text", name: "t", runs: [{ text: "x" }] } as SlideElement,
      makeId,
    );
    expect("id" in (plain as Record<string, unknown>)).toBe(false);

    // The copy keeps stored ids; the fresh ids are assigned at paste time.
    const clone = cloneElementForClipboard(element);
    expect((clone as { id?: string }).id).toBe("group-old");
    expect(clone).not.toBe(element);
  });

  test("serialize/parse round-trips the payload and rejects every malformed shape", () => {
    const slide = clipboardSlide();
    const payload = createElementClipboard(slide, [
      "components:0/0",
      "components:0/2/0",
    ])!;
    const serialized = serializeElementClipboard(payload);
    expect(JSON.parse(serialized)).toMatchObject({
      format: "unipilot/presentation-elements",
      version: 1,
    });
    expect(parseElementClipboard(serialized)?.items).toEqual(payload.items);

    expect(ELEMENT_CLIPBOARD_MIME).toBe(
      "application/x-unipilot-presentation-elements",
    );
    const text = elementClipboardText(payload);
    expect(text.startsWith(ELEMENT_CLIPBOARD_PREFIX)).toBe(true);
    expect(parseElementClipboardText(text)?.items).toEqual(payload.items);
    // Raw custom-MIME JSON parses through the same reader.
    expect(parseElementClipboardText(serialized)?.items).toEqual(payload.items);

    for (const junk of [
      null,
      undefined,
      "",
      "   ",
      "not json",
      "{}",
      JSON.stringify({ format: "x", version: 1, items: [] }),
      JSON.stringify({
        format: "unipilot/presentation-elements",
        version: 2,
        items: payload.items,
      }),
      JSON.stringify({
        format: "unipilot/presentation-elements",
        version: 1,
        items: [],
      }),
      JSON.stringify({
        format: "unipilot/presentation-elements",
        version: 1,
        items: [{ element: { runs: [] }, sourceRoot: "components" }],
      }),
      JSON.stringify({
        format: "unipilot/presentation-elements",
        version: 1,
        items: [
          {
            element: { type: "text" },
            sourceRoot: "elsewhere",
            sourceComponentId: null,
            parentIndexes: [],
          },
        ],
      }),
    ]) {
      expect(parseElementClipboard(junk as string | null | undefined)).toBeNull();
    }
  });
});

test.describe("clipboard operations — paste targeting (D7)", () => {
  test("pastes into the same component, offsets absolute targets and selects the clones", () => {
    const slide = clipboardSlide();
    const before = structuredClone(slide);
    const payload = createElementClipboard(slide, [
      "components:0/0",
      "components:0/1",
    ])!;

    const result = pasteElementClipboard(slide, payload, {
      offset: ELEMENT_PASTE_OFFSET,
    });
    expect(result).not.toBeNull();
    expect(result?.keys).toEqual(["components:0/5", "components:0/6"]);
    const elements = componentElements(result!.slide);
    expect(elements).toHaveLength(7);
    expect((elements[5] as TextElement).position).toEqual({ x: 26, y: 36 });
    // Vectors translate their points (they carry no position).
    expect((elements[6] as VectorElement).points[0]).toEqual({
      x: 46,
      y: 276,
    });

    // The source slide and the clipboard payload are untouched.
    expect(slide).toEqual(before);
    expect((payload.items[0]?.element as TextElement).position).toEqual({
      x: 10,
      y: 20,
    });
    expect((elements[5] as TextElement).runs).toEqual(
      (elements[0] as TextElement).runs,
    );
  });

  test("repeated pastes walk the offset and reach another slide's same component", () => {
    const payload = createElementClipboard(clipboardSlide(), [
      "components:0/0",
    ])!;
    const target: DeckSlide = {
      ...clipboardSlide(),
      id: "44444444-5555-4666-8777-888888888888",
      index: 1,
      ui: {
        components: [
          {
            id: "body",
            description: "Body",
            position: { x: 0, y: 0 },
            elements: [],
          },
        ],
      },
    };

    rememberElementClipboard(payload);
    const first = pasteElementClipboard(target, payload, {
      offset: nextElementPasteOffset(),
    })!;
    const second = pasteElementClipboard(first.slide, payload, {
      offset: nextElementPasteOffset(),
    })!;

    expect(first.keys).toEqual(["components:0/0"]);
    expect(second.keys).toEqual(["components:0/1"]);
    const elements = componentElements(second.slide);
    // The heading's own component-local position plus the walked offsets.
    expect((elements[0] as TextElement).position).toEqual({ x: 26, y: 36 });
    expect((elements[1] as TextElement).position).toEqual({ x: 42, y: 52 });
    // The source component's id keeps the clone in the same component; the
    // component-local geometry is what the offset moves.
    expect(target.ui?.components[0].elements).toEqual([]);
  });

  test("falls back to the anchor's component, then the first component, then the root list", () => {
    const payload = createElementClipboard(clipboardSlide(), [
      "components:0/0",
    ])!;

    // No `body` on the target: the anchor (sidebar) receives the paste.
    const target = clipboardSlide();
    target.ui!.components[0] = {
      ...target.ui!.components[0],
      id: "renamed_body",
    };
    const anchored = pasteElementClipboard(target, payload, {
      offset: 4,
      anchorKey: "components:1/0",
    })!;
    expect(anchored.keys).toEqual(["components:1/1"]);
    // The heading's position {10,20} plus the 4 px offset.
    expect(
      (componentElements(anchored.slide, 1)[1] as TextElement).position,
    ).toEqual({ x: 14, y: 24 });

    // No anchor: the first component is the recorded fallback.
    const fallback = pasteElementClipboard(target, payload, { offset: 4 })!;
    expect(fallback.keys).toEqual(["components:0/5"]);

    // A component-less slide gets the root list (created when absent).
    const rootTarget: DeckSlide = {
      ...clipboardSlide(),
      ui: { components: [] },
    };
    const rootPasted = pasteElementClipboard(rootTarget, payload, {
      offset: 2,
    })!;
    expect(rootPasted.keys).toEqual(["elements:0"]);
    const rootElements = rootPasted.slide.ui?.elements as SlideElement[];
    expect((rootElements[0] as TextElement).position).toEqual({ x: 12, y: 22 });

    expect(
      pasteElementClipboard(target, { items: [] }, { offset: 1 }),
    ).toBeNull();
  });

  test("preserves a nested flow parent and falls back for an occupied container slot", () => {
    const slide = clipboardSlide();

    // The flex child copies into the same flex: an appended flow sibling.
    const captionPayload = createElementClipboard(slide, ["components:0/2/0"])!;
    const captionPasted = pasteElementClipboard(slide, captionPayload, {
      offset: 16,
    })!;
    expect(captionPasted.keys).toEqual(["components:0/2/1"]);
    const flex = componentElements(captionPasted.slide)[2] as FlexElement;
    expect(flex.children).toHaveLength(2);
    expect((flex.children[1] as TextElement).name).toBe("caption");
    // Flow children are not offset: the layout places them.
    expect((flex.children[1] as TextElement).position).toEqual({ x: 5, y: 5 });

    // The container already holds its single child: top-level fallback.
    const childPayload = createElementClipboard(slide, ["components:0/3/0"])!;
    const childPasted = pasteElementClipboard(slide, childPayload, {
      offset: 16,
    })!;
    expect(childPasted.keys).toEqual(["components:0/5"]);
    expect((componentElements(childPasted.slide)[3] as { child?: unknown }).child).not.toBeNull();
    expect(
      (componentElements(childPasted.slide)[5] as TextElement).position,
    ).toEqual({ x: 16, y: 16 });

    // A group child keeps its absolute parent (and takes the offset).
    const groupPayload = createElementClipboard(slide, ["components:0/4/0"])!;
    const groupPasted = pasteElementClipboard(slide, groupPayload, {
      offset: 10,
    })!;
    expect(groupPasted.keys).toEqual(["components:0/4/1"]);
    const group = componentElements(groupPasted.slide)[4] as SlideElement & {
      children: SlideElement[];
    };
    expect(group.children).toHaveLength(2);
    expect((group.children[1] as ImageElement).position).toEqual({
      x: 10,
      y: 10,
    });
  });

  test("a stored id never duplicates: each paste and duplicate answers a fresh id", () => {
    const slide = clipboardSlide();
    (componentElements(slide)[0] as SlideElement & { id?: string }).id =
      "heading-id";
    const payload = createElementClipboard(slide, ["components:0/0"])!;
    expect((payload.items[0]?.element as { id?: string }).id).toBe(
      "heading-id",
    );

    let counter = 0;
    const makeId = () => `fresh-${(counter += 1)}`;
    const first = pasteElementClipboard(slide, payload, {
      offset: 0,
      makeId,
    })!;
    const second = pasteElementClipboard(first.slide, payload, {
      offset: 0,
      makeId,
    })!;
    expect(
      (componentElements(first.slide)[5] as { id?: string }).id,
    ).toBe("fresh-1");
    expect(
      (componentElements(second.slide)[6] as { id?: string }).id,
    ).toBe("fresh-2");
    // The buffer still holds the copied id, not a used one.
    expect((payload.items[0]?.element as { id?: string }).id).toBe(
      "heading-id",
    );
  });
});

test.describe("clipboard operations — duplicate and delete (D7)", () => {
  test("duplicateElements inserts after the source, offsets, and walks on repeat", () => {
    const slide = clipboardSlide();
    const before = structuredClone(slide);
    expect(ELEMENT_DUPLICATE_OFFSET).toBe(16);

    const result = duplicateElements(
      slide,
      ["components:0/0", "components:1/0"],
      { offset: ELEMENT_DUPLICATE_OFFSET },
    )!;
    expect(result.keys).toEqual(["components:0/1", "components:1/1"]);
    expect((componentElements(result.slide)[1] as TextElement).position).toEqual(
      { x: 26, y: 36 },
    );
    expect(
      (componentElements(result.slide, 1)[1] as TextElement).position,
    ).toEqual({ x: 16, y: 16 });
    expect(slide).toEqual(before);

    // The clone is selected: repeating Mod+D walks it further.
    const again = duplicateElements(result.slide, result.keys, {
      offset: ELEMENT_DUPLICATE_OFFSET,
    })!;
    expect(again.keys).toEqual(["components:0/2", "components:1/2"]);
    expect((componentElements(again.slide)[2] as TextElement).position).toEqual(
      { x: 42, y: 52 },
    );
  });

  test("a multi-selection duplicates descending so keys stay adjacent and ordered", () => {
    const slide = clipboardSlide();
    const result = duplicateElements(
      slide,
      ["components:0/0", "components:0/1"],
      { offset: 1 },
    )!;
    expect(result.keys).toEqual(["components:0/1", "components:0/2"]);
    expect(componentElements(result.slide).map(elementName)).toEqual([
      "heading",
      "heading",
      "vector",
      "vector",
      "stack",
      "container",
      "cluster",
    ]);
  });

  test("flow children duplicate in flow; a container child has no sibling slot", () => {
    const slide = clipboardSlide();
    const caption = duplicateElements(slide, ["components:0/2/0"], {
      offset: 16,
    })!;
    const flex = componentElements(caption.slide)[2] as FlexElement;
    expect(flex.children.map(elementName)).toEqual(["caption", "caption"]);
    // Both keep their wire position; the flex layout places them.
    expect((flex.children[0] as TextElement).position).toEqual({ x: 5, y: 5 });
    expect((flex.children[1] as TextElement).position).toEqual({ x: 5, y: 5 });
    expect(caption.keys).toEqual(["components:0/2/1"]);

    // The container's single child cannot gain a sibling in place (recorded).
    expect(
      duplicateElements(slide, ["components:0/3/0"], { offset: 16 }),
    ).toBeNull();
    // A mixed selection still duplicates the representable keys.
    const mixed = duplicateElements(
      slide,
      ["components:0/3/0", "components:0/0"],
      { offset: 16 },
    )!;
    expect(mixed.keys).toEqual(["components:0/1"]);
  });

  test("deleteElements removes lists, clears a container slot and reports no-ops", () => {
    const slide = clipboardSlide();
    const before = structuredClone(slide);

    const single = deleteElements(slide, ["components:0/1"])!;
    expect(componentElements(single.slide).map(elementName)).toEqual([
      "heading",
      "stack",
      "container",
      "cluster",
    ]);

    const multi = deleteElements(slide, ["components:0/0", "components:0/1"])!;
    expect(componentElements(multi.slide).map(elementName)).toEqual([
      "stack",
      "container",
      "cluster",
    ]);

    const nested = deleteElements(slide, ["components:0/2/0"])!;
    expect(
      (componentElements(nested.slide)[2] as FlexElement).children,
    ).toEqual([]);

    const groupChild = deleteElements(slide, ["components:0/4/0"])!;
    expect(
      (componentElements(groupChild.slide)[4] as SlideElement & { children: unknown[] })
        .children,
    ).toEqual([]);

    // A container's child is removed by clearing the slot (the honest wire).
    const containerChild = deleteElements(slide, ["components:0/3/0"])!;
    expect(
      (componentElements(containerChild.slide)[3] as { child?: unknown }).child,
    ).toBeNull();

    // The source is untouched; nothing-to-delete answers null (no save).
    expect(slide).toEqual(before);
    expect(deleteElements(slide, [])).toBeNull();
    expect(deleteElements(slide, ["components:9/9"])).toBeNull();
    expect(deleteElements(slide, ["not-a-key"])).toBeNull();
  });

  test("deleting a container and its child together removes both (deepest first)", () => {
    const slide = clipboardSlide();
    const both = deleteElements(slide, [
      "components:0/3",
      "components:0/3/0",
    ])!;
    expect(componentElements(both.slide).map(elementName)).toEqual([
      "heading",
      "vector",
      "stack",
      "cluster",
    ]);
  });
});

/**
 * Task D8 — the chat proxy's pure contract (spec §7.8, §5.4).
 *
 * The editor's chat panel consumes `chunk`/`status`/`trace`/`complete`/`error`
 * frames from `POST /api/presentation/{id}/chat`. These cases pin the frame
 * vocabulary, the SSE framing per the engine's `SSEResponse.to_string()`
 * (`event: response\ndata: {json}\n\n`), the sanitized error frame (no
 * provider internals ever survive normalization), the client-side
 * accumulation, the conservative "did this turn mutate the deck?" rule and
 * the edit-review representability rule (whole-slide before/after only; every
 * structural or metadata change says so honestly).
 */

/** One synthetic slide with ordered text elements (a title, optional body). */
function chatDiffSlide(
  id: string,
  title: string,
  body = "",
  note: string | null = null,
): DeckSlide {
  return {
    id,
    presentation: "deck-1",
    layout_group: "general",
    layout: "general:1",
    index: 0,
    content: {},
    speaker_note: note,
    ui: {
      components: [
        {
          id: `c-${id}`,
          description: "content",
          position: { x: 0, y: 0 },
          elements: [
            { type: "text", name: "title", runs: [{ text: title }] },
            ...(body === ""
              ? []
              : [{ type: "text", name: "body", runs: [{ text: body }] }]),
          ],
        },
      ],
    },
  } as unknown as DeckSlide;
}

function chatDeckSnapshot(slides: DeckSlide[]): ChatDeckSnapshot {
  return { slides, theme: { colors: {}, fonts: {} }, title: "Deck" };
}

test.describe("presenton chat normalizers (pure)", () => {
  test("normalizeChatConversation keeps shaped entries and drops malformed ones", () => {
    expect(
      normalizeChatConversation({
        conversation_id: "c1",
        updated_at: "2026-09-19T10:00:00Z",
        last_message_preview: "Make the title shorter",
      }),
    ).toEqual({
      conversationId: "c1",
      updatedAt: "2026-09-19T10:00:00Z",
      lastMessagePreview: "Make the title shorter",
    });

    expect(
      normalizeChatConversation({ conversation_id: "c1" }),
    ).toEqual({
      conversationId: "c1",
      updatedAt: null,
      lastMessagePreview: null,
    });

    expect(normalizeChatConversation({ conversation_id: "" })).toBeNull();
    expect(normalizeChatConversation({})).toBeNull();
    expect(normalizeChatConversation(null)).toBeNull();
  });

  test("normalizeChatHistory reads the engine envelope and its message rows", () => {
    const history = normalizeChatHistory({
      presentation_id: "p1",
      conversation_id: "c1",
      messages: [
        { role: "user", content: "Hi", created_at: "2026-09-19T10:00:00Z" },
        { role: "assistant", content: "Hello" },
        { role: 7, content: 9 },
      ],
    });

    expect(history).toEqual({
      presentationId: "p1",
      conversationId: "c1",
      messages: [
        { role: "user", content: "Hi", createdAt: "2026-09-19T10:00:00Z" },
        { role: "assistant", content: "Hello", createdAt: null },
      ],
    });

    expect(
      normalizeChatHistory({ presentation_id: "p1", conversation_id: "c1" }),
    ).toBeNull();
    expect(normalizeChatHistory(null)).toBeNull();
  });
});

test.describe("chat frames (pure)", () => {
  test("parseSseBlocks splits complete frames and keeps the partial tail", () => {
    const buffer =
      'data: {"type":"status","status":"Reading deck context"}\n\ndata: {"type":"chunk","chunk":"Hel';
    const { events, rest } = parseSseBlocks(buffer);

    expect(events).toEqual([
      {
        event: null,
        data: '{"type":"status","status":"Reading deck context"}',
      },
    ]);
    expect(rest).toBe('data: {"type":"chunk","chunk":"Hel');
  });

  test("parseSseBlocks accepts event lines, CRLF, comments and multi-line data", () => {
    const buffer =
      ': keepalive\r\nevent: response\r\ndata: {"type":"chunk",\r\ndata: "chunk":"Hi"}\r\n\r\ndata: second\n\n';
    const { events, rest } = parseSseBlocks(buffer);

    expect(rest).toBe("");
    expect(events).toEqual([
      { event: "response", data: '{"type":"chunk",\n"chunk":"Hi"}' },
      { event: null, data: "second" },
    ]);
  });

  test("normalizeChatFramePayload maps every engine frame shape", () => {
    expect(normalizeChatFramePayload({ type: "chunk", chunk: "Hello" })).toEqual(
      { type: "chunk", text: "Hello" },
    );
    expect(
      normalizeChatFramePayload({ type: "status", status: "Saving chat" }),
    ).toEqual({ type: "status", status: "Saving chat" });
    expect(
      normalizeChatFramePayload({
        type: "trace",
        trace: {
          kind: "tool_call",
          round: 1,
          tool: "updateSlide",
          status: "start",
          message: "Updating slide 2",
          raw: { provider: "internal" },
        },
      }),
    ).toEqual({
      type: "trace",
      trace: {
        kind: "tool_call",
        round: 1,
        tool: "updateSlide",
        status: "start",
        message: "Updating slide 2",
      },
    });
    expect(
      normalizeChatFramePayload({
        type: "complete",
        chat: {
          conversation_id: "c1",
          response: "Done",
          tool_calls: ["updateSlide", 7, "searchSlide"],
        },
      }),
    ).toEqual({
      type: "complete",
      conversationId: "c1",
      response: "Done",
      toolCalls: ["updateSlide", "searchSlide"],
    });
  });

  test("normalizeChatFramePayload sanitizes error frames and drops unknown types", () => {
    const error = normalizeChatFramePayload({
      type: "error",
      detail: "Groq 429: rate limit exceeded for org_xyz key sk-secret",
      status_code: 429,
      source: "llm",
    });

    expect(error).toEqual({ type: "error", message: CHAT_ERROR_COPY });
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("Groq");
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("detail");

    expect(normalizeChatFramePayload({ type: "something-else" })).toBeNull();
    expect(normalizeChatFramePayload(null)).toBeNull();
    expect(normalizeChatFramePayload("data")).toBeNull();
    expect(normalizeChatFramePayload({ type: "chunk" })).toBeNull();
  });

  test("normalizeChatFramePayload drops trace messages that can carry upstream internals", () => {
    /* Error traces are built from raw tool exceptions (`tools.py`) and model
       notes from provider output — neither may cross the proxy. */
    const failed = normalizeChatFramePayload({
      type: "trace",
      trace: {
        kind: "tool_call",
        round: 1,
        tool: "updateSlide",
        status: "error",
        message: "openai.APIError: invalid api key sk-secret at /app/servers/foo.py",
      },
    });
    expect(failed).toEqual({
      type: "trace",
      trace: {
        kind: "tool_call",
        round: 1,
        tool: "updateSlide",
        status: "error",
        message: null,
      },
    });
    expect(JSON.stringify(failed)).not.toContain("sk-secret");
    expect(JSON.stringify(failed)).not.toContain("/app/");

    const note = normalizeChatFramePayload({
      type: "trace",
      trace: {
        kind: "model_note",
        round: 1,
        status: "info",
        message: "provider internal: rate limit for org_xyz",
      },
    });
    expect(note).toEqual({
      type: "trace",
      trace: {
        kind: "model_note",
        round: 1,
        tool: null,
        status: "info",
        message: null,
      },
    });

    /* A successful tool call's canned engine label still renders. */
    const ok = normalizeChatFramePayload({
      type: "trace",
      trace: {
        kind: "tool_call",
        round: 1,
        tool: "updateSlide",
        status: "start",
        message: "Updating slide 2",
      },
    });
    expect(ok?.type === "trace" && ok.trace.message).toBe("Updating slide 2");
  });

  test("normalizeChatSseEvent ignores non-response events and non-JSON data", () => {
    expect(
      normalizeChatSseEvent({
        event: "response",
        data: '{"type":"chunk","chunk":"a"}',
      }),
    ).toEqual({ type: "chunk", text: "a" });
    expect(
      normalizeChatSseEvent({
        event: "ping",
        data: '{"type":"chunk","chunk":"a"}',
      }),
    ).toBeNull();
    expect(normalizeChatSseEvent({ event: null, data: "not json" })).toBeNull();
  });

  test("frameToSse writes one JSON data line per frame", () => {
    expect(frameToSse({ type: "chunk", text: "hi" })).toBe(
      'data: {"type":"chunk","text":"hi"}\n\n',
    );
  });

  test("applyChatFrame accumulates text, status, traces and the completed turn", () => {
    let entry = createChatEntry("assistant");
    expect(entry.interrupted).toBe(false);
    entry = applyChatFrame(entry, {
      type: "status",
      status: "Reading deck context",
    });
    entry = applyChatFrame(entry, { type: "chunk", text: "Sure" });
    entry = applyChatFrame(entry, { type: "chunk", text: " — done." });
    entry = applyChatFrame(entry, {
      type: "trace",
      trace: {
        kind: "tool_call",
        round: 1,
        tool: "updateSlide",
        status: "success",
        message: "Slide updated",
      },
    });
    entry = applyChatFrame(entry, {
      type: "complete",
      conversationId: "c9",
      response: "Sure — done.",
      toolCalls: ["updateSlide"],
    });

    expect(entry.text).toBe("Sure — done.");
    expect(entry.status).toBe("Reading deck context");
    expect(entry.traces).toHaveLength(1);
    expect(entry.conversationId).toBe("c9");
    expect(entry.complete).toBe(true);
    expect(entry.error).toBeNull();

    const failed = applyChatFrame(createChatEntry("assistant"), {
      type: "error",
      message: CHAT_ERROR_COPY,
    });
    expect(failed.error).toBe(CHAT_ERROR_COPY);
    expect(failed.text).toBe("");
  });

  test("chatTurnMayChangeDeck flags mutating tools and treats unknown tools as mutating", () => {
    expect(chatTurnMayChangeDeck([])).toBe(false);
    expect(
      chatTurnMayChangeDeck([
        "searchSlide",
        "getSlideAtIndex",
        "getAvailableLayouts",
      ]),
    ).toBe(false);
    expect(chatTurnMayChangeDeck(["getSlideAtIndex", "updateSlide"])).toBe(true);
    expect(chatTurnMayChangeDeck(["addNewSlide"])).toBe(true);
    expect(chatTurnMayChangeDeck(["someFutureTool"])).toBe(true);
  });

  test("chatTraceMutatesDeck flags a mutating tool that started", () => {
    const trace = (patch: Partial<ChatTrace>): ChatTrace => ({
      kind: "tool_call",
      round: 1,
      tool: "updateSlide",
      status: "start",
      message: null,
      ...patch,
    });

    expect(chatTraceMutatesDeck(trace({}))).toBe(true);
    expect(chatTraceMutatesDeck(trace({ tool: "addNewSlide" }))).toBe(true);
    expect(chatTraceMutatesDeck(trace({ tool: "futureTool" }))).toBe(true);
    expect(chatTraceMutatesDeck(trace({ tool: "searchSlide" }))).toBe(false);
    expect(chatTraceMutatesDeck(trace({ status: "success" }))).toBe(false);
    expect(chatTraceMutatesDeck(trace({ tool: null }))).toBe(false);
  });

  test("chatHistoryResponseApplies rejects superseded or moved-on responses", () => {
    expect(
      chatHistoryResponseApplies({
        responseToken: 2,
        latestToken: 2,
        requestedConversationId: "a",
        currentConversationId: "a",
        streamActive: false,
      }),
    ).toBe(true);
    expect(
      chatHistoryResponseApplies({
        responseToken: 1,
        latestToken: 2,
        requestedConversationId: "a",
        currentConversationId: "a",
        streamActive: false,
      }),
    ).toBe(false);
    expect(
      chatHistoryResponseApplies({
        responseToken: 2,
        latestToken: 2,
        requestedConversationId: "a",
        currentConversationId: "b",
        streamActive: false,
      }),
    ).toBe(false);
    expect(
      chatHistoryResponseApplies({
        responseToken: 2,
        latestToken: 2,
        requestedConversationId: "a",
        currentConversationId: null,
        streamActive: false,
      }),
    ).toBe(false);
    /* A just-started turn owns the thread; a late history read must not wipe
       its messages even when the token and selection still match. */
    expect(
      chatHistoryResponseApplies({
        responseToken: 2,
        latestToken: 2,
        requestedConversationId: "a",
        currentConversationId: "a",
        streamActive: true,
      }),
    ).toBe(false);
  });

  test("chatHistoryDiscardReleasesLoading frees only the owning request", () => {
    /* The discarded response that owns the loading state releases it (the
       `complete`-bumped token case that used to wedge "Loading conversation…"
       forever); a newer request keeps ownership. */
    expect(
      chatHistoryDiscardReleasesLoading({ responseToken: 3, loadingToken: 3 }),
    ).toBe(true);
    expect(
      chatHistoryDiscardReleasesLoading({ responseToken: 2, loadingToken: 3 }),
    ).toBe(false);
    expect(
      chatHistoryDiscardReleasesLoading({ responseToken: 3, loadingToken: null }),
    ).toBe(false);
  });

  test("classifyChatDeckDiff is representable for same-slide content edits", () => {
    const before = chatDeckSnapshot([
      chatDiffSlide("s1", "Intro", "Welcome"),
      chatDiffSlide("s2", "Agenda", "Topics"),
    ]);
    const after = chatDeckSnapshot([
      chatDiffSlide("s1", "Intro", "Welcome back"),
      chatDiffSlide("s2", "Agenda", "Topics"),
    ]);

    const diff = classifyChatDeckDiff(before, after);

    expect(diff.representable).toBe(true);
    if (!diff.representable) return;
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0].slideId).toBe("s1");
    expect(diff.changes[0].slideNumber).toBe(1);
    expect(diff.changes[0].beforeText).toBe("Intro · Welcome");
    expect(diff.changes[0].afterText).toBe("Intro · Welcome back");
  });

  test("classifyChatDeckDiff reports an unchanged deck honestly", () => {
    const snapshot = chatDeckSnapshot([chatDiffSlide("s1", "Intro", "Hi")]);
    const diff = classifyChatDeckDiff(snapshot, structuredClone(snapshot));

    expect(diff.representable).toBe(true);
    if (!diff.representable) return;
    expect(diff.changes).toEqual([]);
  });

  test("classifyChatDeckDiff treats an index-only slide change as representable", () => {
    /* The engine renumbers a slide without touching its body; that is still a
       stored change and must not read as "No slide changes". */
    const before = chatDeckSnapshot([
      { ...chatDiffSlide("s1", "Intro", "Welcome"), index: 0 },
    ]);
    const after = chatDeckSnapshot([
      { ...chatDiffSlide("s1", "Intro", "Welcome"), index: 3 },
    ]);

    const diff = classifyChatDeckDiff(before, after);

    expect(diff.representable).toBe(true);
    if (!diff.representable) return;
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0].slideId).toBe("s1");
    expect(diff.changes[0].beforeText).toBe("Intro · Welcome");
  });

  test("classifyChatDeckDiff refuses added, removed or reordered slides", () => {
    const base = chatDeckSnapshot([
      chatDiffSlide("s1", "One", "a"),
      chatDiffSlide("s2", "Two", "b"),
    ]);

    const added = classifyChatDeckDiff(
      base,
      chatDeckSnapshot([
        chatDiffSlide("s1", "One", "a"),
        chatDiffSlide("s2", "Two", "b"),
        chatDiffSlide("s3", "Three", "c"),
      ]),
    );
    expect(added).toEqual({
      representable: false,
      reason: "structural",
      changedSlideCount: 1,
    });

    const removed = classifyChatDeckDiff(base, chatDeckSnapshot([base.slides[0]]));
    expect(removed).toEqual({
      representable: false,
      reason: "structural",
      changedSlideCount: 1,
    });

    const reordered = classifyChatDeckDiff(
      base,
      chatDeckSnapshot([chatDiffSlide("s2", "Two", "b"), chatDiffSlide("s1", "One", "a")]),
    );
    expect(reordered).toEqual({
      representable: false,
      reason: "structural",
      changedSlideCount: 2,
    });
  });

  test("classifyChatDeckDiff refuses theme and title changes", () => {
    const before = chatDeckSnapshot([chatDiffSlide("s1", "One", "a")]);
    const themeChanged = classifyChatDeckDiff(before, {
      ...structuredClone(before),
      theme: { colors: { primary: "#000000" } },
    });
    expect(themeChanged).toEqual({
      representable: false,
      reason: "metadata",
      changedSlideCount: 0,
    });

    const titleChanged = classifyChatDeckDiff(before, {
      ...structuredClone(before),
      title: "A new title",
    });
    expect(titleChanged).toEqual({
      representable: false,
      reason: "metadata",
      changedSlideCount: 0,
    });

    const mixed = classifyChatDeckDiff(before, {
      ...structuredClone(before),
      title: "A new title",
      slides: [chatDiffSlide("s1", "One", "changed")],
    });
    expect(mixed).toEqual({
      representable: false,
      reason: "mixed",
      changedSlideCount: 1,
    });
  });

  test("slideTextSummary joins the slide's text elements in order", () => {
    const slide = chatDiffSlide("s1", "Title here", "Body copy", "A note");
    expect(slideTextSummary(slide)).toBe("Title here · Body copy");
    expect(slideTextSummary({ ...slide, ui: null })).toBe("");
  });
});
