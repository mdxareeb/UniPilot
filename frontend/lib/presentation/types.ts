/**
 * The native presentation viewer's wire types (Task B1).
 *
 * These mirror Presenton's FastAPI response models field-for-field — the
 * `PresentationWithSlides` / `SlideModel` / Template V2 shapes documented in
 * `docs/superpowers/specs/2026-09-15-presentation-ui-design.md` §4.2 and §6.1
 * and re-verified against the running engine (2026-09-16). Field names stay
 * snake_case exactly as the wire carries them, so every later task reads one
 * vocabulary and never guesses a name.
 *
 * The service stores `slides[].ui` as JSON without validating it on read
 * (`SlideModel.ui`), so payloads can be missing element geometry or schema
 * annotations; the helpers in `elements.ts` default rather than throw and the
 * renderer (B3) states absence honestly. Nothing here fetches, renders or
 * touches the DOM — this module is importable from server and client alike.
 */

// ---------------------------------------------------------------------------
// Geometry, styling and enum primitives (templates/v2/models/elements.py)
// ---------------------------------------------------------------------------

/** Canvas-space point; the stage is a fixed 1280×720 surface. */
export type Position = { x: number; y: number };

export type Size = { width: number; height: number };

export type Padding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type HorizontalAlignment = "left" | "center" | "right" | "justify";
export type VerticalAlignment = "top" | "middle" | "bottom";
export type LayoutAlignment = "flex-start" | "flex-end" | "center" | "stretch";

export type Alignment = {
  horizontal?: HorizontalAlignment | null;
  vertical?: VerticalAlignment | null;
};

export type Font = {
  size?: number | null;
  family?: string | null;
  color?: string | null;
  bold?: boolean | null;
  italic?: boolean | null;
  underline?: boolean | null;
  line_height?: number | null;
  letter_spacing?: number | null;
  ellipsis?: boolean | null;
  opacity?: number | null;
};

export type Fill = { color: string; opacity?: number | null };

export type Stroke = {
  color: string;
  opacity?: number | null;
  width: number;
  dash?: number[] | null;
};

export type BorderRadius = { tl: number; tr: number; bl: number; br: number };

export type Shadow = {
  color: string;
  blur?: number | null;
  opacity?: number | null;
  offset_x?: number | null;
  offset_y?: number | null;
};

export type Marker = "bullet" | "number" | "none";
export type FlexDirection = "row" | "column";
export type ImageFit = "contain" | "cover" | "fill";
export type IconType =
  | "bold"
  | "duotone"
  | "fill"
  | "light"
  | "regular"
  | "thin";

/** The engine's `ChartType` enum (the measured decks use nine of them). */
export type ChartType =
  | "bar"
  | "horizontal_bar"
  | "line"
  | "area"
  | "pie"
  | "donut"
  | "stacked_bar"
  | "horizontal_stacked_bar"
  | "scatter"
  | "radar"
  | "polar_area";

export type DataLabelPosition = "base" | "mid" | "top" | "outside";

export type ChartSeries = { name: string; values: number[] };

export type VectorShape = "polygon" | "ellipse";
export type VectorMarker =
  | "none"
  | "arrow"
  | "stealth"
  | "triangle"
  | "circle"
  | "square"
  | "diamond";
export type VectorCurve = {
  type: "smooth";
  tension?: number | null;
  segments?: number | null;
};

// ---------------------------------------------------------------------------
// Text runs (elements.py `TextRun` / `LatexTextRun`)
// ---------------------------------------------------------------------------

export type TextRun = { text: string; font?: Font | null };

/**
 * LaTeX math is not rendered natively (spec §6.4): the renderer shows the run's
 * source honestly. `isTextRun` deliberately returns false for it.
 */
export type LatexTextRun = {
  type: "latex";
  latex: string;
  display_mode?: boolean | null;
  font?: Font | null;
};

export type TextRunValue = TextRun | LatexTextRun;

// ---------------------------------------------------------------------------
// Slide elements — the discriminated union on `type` (spec §4.2, §6.2)
// ---------------------------------------------------------------------------

type ElementBase = {
  position?: Position | null;
  size?: Size | null;
  rotation?: number | null;
};

/** For elements the schema gives a `name` but no `decorative` flag. */
type NamedElementBase = ElementBase & { name?: string | null };

/** For generated-content elements the schema annotates with `name`/`decorative`. */
type AuthoredElementBase = NamedElementBase & {
  decorative?: boolean | null;
};

export type TextElement = AuthoredElementBase & {
  type: "text";
  font?: Font | null;
  alignment?: Alignment | null;
  fill?: Fill | null;
  stroke?: Stroke | null;
  shadow?: Shadow | null;
  runs: TextRunValue[];
  max_length?: number | null;
  min_length?: number | null;
};

export type TextListElement = AuthoredElementBase & {
  type: "text-list";
  font?: Font | null;
  marker?: Marker | null;
  gap?: number | null;
  marker_gap?: number | null;
  /** One run list per item (the engine nests runs inside list items). */
  items: TextRunValue[][];
  max_items?: number | null;
  min_items?: number | null;
  max_item_length?: number | null;
  min_item_length?: number | null;
};

export type ImageElement = AuthoredElementBase & {
  type: "image";
  /** An engine path (`/app_data/…`, `/static/…`, `/vendor/…`) or a raw URL. */
  data: string;
  fit?: ImageFit | null;
  focus_x?: number | null;
  focus_y?: number | null;
  crop_scale?: number | null;
  border_radius?: BorderRadius | null;
  clip_path?: string | null;
  flip_h?: boolean | null;
  flip_v?: boolean | null;
  opacity?: number | null;
  color?: string | null;
  prompt?: string | null;
  is_icon?: boolean | null;
  icon_type?: IconType | null;
};

export type TableCell = {
  color?: Fill | null;
  font?: Font | null;
  alignment?: HorizontalAlignment | null;
  runs: TextRunValue[];
};

export type TableElement = AuthoredElementBase & {
  type: "table";
  columns: TableCell[];
  rows: TableCell[][];
  max_columns?: number | null;
  min_columns?: number | null;
  max_rows?: number | null;
  min_rows?: number | null;
};

/**
 * Vectors carry `points` in canvas space and no `name`/`decorative`/`size`;
 * their frame is derived from the points, so `elementFrame` reports zero size.
 */
export type VectorElement = ElementBase & {
  type: "vector";
  shape?: VectorShape | null;
  points: Position[];
  closed?: boolean | null;
  curve?: VectorCurve | null;
  corner_radii?: number[] | null;
  start_marker?: VectorMarker | null;
  end_marker?: VectorMarker | null;
  opacity?: number | null;
  fill?: Fill | null;
  stroke?: Stroke | null;
  shadow?: Shadow | null;
};

export type ChartElement = AuthoredElementBase & {
  type: "chart";
  chart_type: ChartType;
  title?: string | null;
  title_color?: string | null;
  legend_color?: string | null;
  text_color?: string | null;
  colors?: string[] | null;
  x_axis?: boolean | null;
  y_axis?: boolean | null;
  x_axis_title?: string | null;
  y_axis_title?: string | null;
  axis_color?: string | null;
  categories?: string[] | null;
  series?: ChartSeries[] | null;
  data_labels?: DataLabelPosition | null;
  legend?: boolean | null;
  x_axis_grid?: boolean | null;
  y_axis_grid?: boolean | null;
  grid_color?: string | null;
  source?: string | null;
};

/** The engine's full `InfographicType` enum (27 values; the decks use three). */
export type InfographicType =
  | "progress_bar"
  | "gauge"
  | "gantt"
  | "timeline"
  | "roadmap"
  | "milestone_timeline"
  | "staircase"
  | "supply_chain"
  | "stair_step_blocks"
  | "maturity_model"
  | "pillar_framework"
  | "transformation_hub"
  | "diagonal_circles"
  | "risk_matrix"
  | "chevron_process"
  | "radial_cycle"
  | "conversion_funnel"
  | "vertical_funnel"
  | "pyramid"
  | "segmented_wheel"
  | "customer_journey"
  | "before_after"
  | "impact_effort_matrix"
  | "comparison_matrix"
  | "org_chart"
  | "decision_tree"
  | "mind_map";

export type ProgressBarInfographicData = {
  type: "progress_bar";
  max_value: number;
  min_value: number;
  value: number;
};

export type GaugeInfographicData = {
  type: "gauge";
  max_value: number;
  min_value: number;
  value: number;
};

/**
 * The engine's catalog shape for `vertical_funnel`
 * (`items: array of {value:number, heading:string, description?}`),
 * verified against the served verdant template (2026-09-16). Fields stay
 * optional because `ui` is stored unvalidated and the renderer defaults
 * honestly instead of throwing.
 */
export type VerticalFunnelItem = {
  value?: number | null;
  heading?: string | null;
  description?: string | null;
};

export type VerticalFunnelInfographicData = {
  type: "vertical_funnel";
  items?: VerticalFunnelItem[] | null;
};

/**
 * Every other structural infographic type carries type-specific payload fields
 * the engine normalizes; the native renderer only implements the three measured
 * ones and shows an honest placeholder for the rest (spec §6.7).
 */
export type StructuralInfographicData = {
  type: Exclude<
    InfographicType,
    "progress_bar" | "gauge" | "vertical_funnel"
  >;
  [key: string]: unknown;
};

export type InfographicData =
  | ProgressBarInfographicData
  | GaugeInfographicData
  | VerticalFunnelInfographicData
  | StructuralInfographicData;

export type InfographicElement = AuthoredElementBase & {
  type: "infographic";
  data: InfographicData;
  colors: string[];
  text_color?: string | null;
};

export type ContainerElement = ElementBase & {
  type: "container";
  alignment?: Alignment | null;
  fill?: Fill | null;
  stroke?: Stroke | null;
  border_radius?: BorderRadius | null;
  shadow?: Shadow | null;
  padding?: Padding | null;
  child?: SlideElement | null;
};

export type FlexElement = NamedElementBase & {
  type: "flex";
  direction: FlexDirection;
  wrap?: boolean | null;
  align_items?: LayoutAlignment | null;
  justify_content?: LayoutAlignment | null;
  gap?: number | null;
  column_gap?: number | null;
  row_gap?: number | null;
  children: SlideElement[];
  max_children?: number | null;
  min_children?: number | null;
};

export type GridElement = NamedElementBase & {
  type: "grid";
  columns: number;
  rows?: number | null;
  gap?: number | null;
  column_gap?: number | null;
  row_gap?: number | null;
  align_items?: LayoutAlignment | null;
  justify_items?: LayoutAlignment | null;
  children: SlideElement[];
  max_children?: number | null;
  min_children?: number | null;
};

export type GroupElement = NamedElementBase & {
  type: "group";
  children: SlideElement[];
};

export type SlideElement =
  | TextElement
  | TextListElement
  | ImageElement
  | TableElement
  | VectorElement
  | ChartElement
  | InfographicElement
  | ContainerElement
  | FlexElement
  | GridElement
  | GroupElement;

// ---------------------------------------------------------------------------
// Slide `ui` — what gets rendered (elements sit inside component frames)
// ---------------------------------------------------------------------------

export type SlideComponent = {
  id: string;
  description: string;
  position: Position;
  elements: SlideElement[];
};

export type SlideUi = {
  /** The layout id/description the `ui` was hydrated from. */
  id?: string;
  description?: string;
  /**
   * The authored canvas background. Verified on blank decks, which carry
   * `background` as a color string; hydrated decks omit it (the stage falls
   * back to the theme background). Kept `unknown` because `ui` is stored
   * unvalidated — the renderer reads it only when it is a non-empty string.
   */
  background?: unknown;
  /**
   * Root-level elements some layouts hydrate. Hydrated decks we verified put
   * everything in `components`; blank decks carry `""` here — so this is
   * `unknown` on purpose and the renderer treats only arrays as elements.
   */
  elements?: unknown;
  components: SlideComponent[];
};

// ---------------------------------------------------------------------------
// Deck (`GET /api/v1/ppt/presentation/{id}` → PresentationWithSlides)
// ---------------------------------------------------------------------------

export type DeckSlide = {
  id: string;
  /** Owning presentation id; the engine includes it on every slide row. */
  presentation: string;
  layout_group: string;
  layout: string;
  index: number;
  content: Record<string, unknown>;
  /** Smart-mode HTML — its presence routes to the honest fallback (B6). */
  html_content?: string | null;
  speaker_note?: string | null;
  properties?: Record<string, unknown> | null;
  ui?: SlideUi | null;
};

/** The sixteen role colors every template theme defines (spec §6.1). */
export type DeckThemeColors = {
  primary: string;
  background: string;
  card: string;
  stroke: string;
  background_text: string;
  primary_text: string;
  graph_0: string;
  graph_1: string;
  graph_2: string;
  graph_3: string;
  graph_4: string;
  graph_5: string;
  graph_6: string;
  graph_7: string;
  graph_8: string;
  graph_9: string;
};

export type DeckThemeTextFont = { name: string; url: string };

export type DeckThemeFonts = { textFont: DeckThemeTextFont };

/** The resolved theme: colors + the one text font (spec §6.8). */
export type DeckTheme = { colors: DeckThemeColors; fonts: DeckThemeFonts };

/**
 * The package the generation pipeline stores on every generated deck
 * (`template_theme_for_presentation`): the resolved theme sits under `data`,
 * verified against the running engine (2026-09-16). B3 resolves through this
 * wrapper; templates carry `DeckTheme` directly.
 */
export type DeckThemePackage = {
  name: string;
  description: string | null;
  data: DeckTheme;
  source: string | null;
  template_id: string | null;
};

export type PresentationDeck = {
  id: string;
  version: "v1-standard" | "v2-standard" | null;
  content: string;
  n_slides: number;
  language: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  tone: string | null;
  verbosity: string | null;
  slides: DeckSlide[];
  /** `{family: url}` — engine paths and absolute font-service URLs. */
  fonts: Record<string, string> | null;
  theme: DeckTheme | DeckThemePackage | null;
  generation_mode: "standard" | "smart";
  type: "standard" | "smart";
  /** Present in the response though the spec's summary omits it. */
  community_design_ids?: number[] | null;
};

// ---------------------------------------------------------------------------
// Template (`GET /api/v1/ppt/template/{id}` → TemplateResponse)
// ---------------------------------------------------------------------------

export type TemplateLayout = {
  id: string;
  description: string;
  components: SlideComponent[];
};

export type TemplateLayouts = { layouts: TemplateLayout[] };

export type MergedTemplateComponent = {
  id: string;
  description: string;
  variants: SlideComponent[];
};

export type MergedTemplateComponents = {
  components: MergedTemplateComponent[];
};

export type PresentationTemplate = {
  id: string;
  name: string;
  description: string | null;
  layout_count: number;
  thumbnail: string | null;
  preview_url: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  merged_components: MergedTemplateComponents | null;
  layouts: TemplateLayouts | null;
  theme: DeckTheme | null;
  /** `{family: url}` for every font the layouts reference. */
  fonts: Record<string, string>;
};
