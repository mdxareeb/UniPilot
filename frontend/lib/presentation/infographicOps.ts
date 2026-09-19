/**
 * Task D9 — infographic insertion (spec §5.4 "Infographics", §6.7, plan D9).
 *
 * The native renderer implements exactly three of the engine's 27
 * `InfographicType` values — `gauge`, `progress_bar`, `vertical_funnel` — and
 * shows B3's honest "Infographic type not yet rendered" placeholder for every
 * other type. This module is the insertion palette's pure half:
 *
 * - `INFOGRAPHIC_CAPABILITIES` records all 27 types and whether the native
 *   renderer implements them. The palette lists the unsupported ones disabled
 *   with `UNSUPPORTED_INFOGRAPHIC_NOTE`; D10's capability checklist consumes
 *   the same record, so no type is ever silently dropped from the inventory.
 * - `defaultInfographicElement` and `insertInfographicElement` mirror the
 *   fork's insertion semantics (read-only:
 *   `presenton-ui/components/slide-editor/insert/insert-elements.ts` and
 *   `presenton-ui/components/slide-editor/model/inserted-content.ts`): one new
 *   component frame per inserted element, the component carrying the element's
 *   insert position, the element itself at `{x: 0, y: 0}` inside the frame and
 *   sized to the fork's natural content frame. The default payloads are the
 *   fork's own insert defaults (`makeInfographicElement` +
 *   `fitInfographicElementToData`, verified 2026-09-19), so a fresh insert
 *   renders natively — never a placeholder with invented data.
 *
 * Pure and client-safe: no React, no I/O, no mutation of the input slide.
 */
import type {
  DeckSlide,
  GaugeInfographicData,
  InfographicElement,
  InfographicType,
  ProgressBarInfographicData,
  SlideComponent,
  SlideUi,
  VerticalFunnelInfographicData,
} from "./types";

/** The types the native renderer implements and the palette may offer. */
export type InsertableInfographicType =
  | "gauge"
  | "progress_bar"
  | "vertical_funnel";

export type InfographicCapability = {
  type: InfographicType;
  /** The fork's palette label (`infographicItems` in PresentationActions). */
  label: string;
  /** True only for the types `InfographicElement` renders natively. */
  supported: boolean;
};

/** A capability the palette may offer as an insert action. */
export type SupportedInfographicCapability = InfographicCapability & {
  type: InsertableInfographicType;
  supported: true;
};

/**
 * The honest note every unsupported palette entry carries (spec §6.7). Exact
 * phrase, lower-case, so UI copy and tests read it as one string.
 */
export const UNSUPPORTED_INFOGRAPHIC_NOTE = "not rendered natively yet";

/**
 * Every `InfographicType` in the engine enum order, each marked with whether
 * the native renderer implements it (spec §6.7, plan D9). Three are supported;
 * the other 24 are recorded here — the palette renders them disabled and D10's
 * checklist is built from this list, never from a hand-copied subset.
 */
export const INFOGRAPHIC_CAPABILITIES: readonly InfographicCapability[] = [
  { type: "progress_bar", label: "Progress Bar", supported: true },
  { type: "gauge", label: "Gauge Chart", supported: true },
  { type: "gantt", label: "Gantt Chart", supported: false },
  { type: "timeline", label: "Timeline", supported: false },
  { type: "roadmap", label: "Roadmap", supported: false },
  { type: "milestone_timeline", label: "Milestones", supported: false },
  { type: "staircase", label: "Staircase", supported: false },
  { type: "supply_chain", label: "Supply Chain", supported: false },
  { type: "stair_step_blocks", label: "Step Blocks", supported: false },
  { type: "maturity_model", label: "Maturity Model", supported: false },
  { type: "pillar_framework", label: "Pillar Framework", supported: false },
  { type: "transformation_hub", label: "Transformation Hub", supported: false },
  { type: "diagonal_circles", label: "Diagonal Circles", supported: false },
  { type: "risk_matrix", label: "Risk Matrix", supported: false },
  { type: "chevron_process", label: "Chevron Process", supported: false },
  { type: "radial_cycle", label: "Radial Cycle", supported: false },
  { type: "conversion_funnel", label: "Conversion Funnel", supported: false },
  { type: "vertical_funnel", label: "Vertical Funnel", supported: true },
  { type: "pyramid", label: "Pyramid", supported: false },
  { type: "segmented_wheel", label: "Segmented Wheel", supported: false },
  { type: "customer_journey", label: "Customer Journey", supported: false },
  { type: "before_after", label: "Before & After", supported: false },
  { type: "impact_effort_matrix", label: "Impact / Effort", supported: false },
  { type: "comparison_matrix", label: "Comparison Matrix", supported: false },
  { type: "org_chart", label: "Organization Chart", supported: false },
  { type: "decision_tree", label: "Decision Tree", supported: false },
  { type: "mind_map", label: "Mind Map", supported: false },
];

/**
 * The supported entries, in the enum order above (the palette's add list). The
 * `supported` flag and `InfographicElement`'s switch are the same three types,
 * pinned by the renderer fixtures; this narrows the record for the palette.
 */
export function supportedInfographicCapabilities(): SupportedInfographicCapability[] {
  return INFOGRAPHIC_CAPABILITIES.filter(
    (capability): capability is SupportedInfographicCapability =>
      capability.supported,
  );
}

/** The disabled entries the palette lists with the honest note. */
export function unsupportedInfographicCapabilities(): InfographicCapability[] {
  return INFOGRAPHIC_CAPABILITIES.filter((capability) => !capability.supported);
}

/** The label the palette and the inserted component share for one type. */
export function infographicLabel(type: InsertableInfographicType): string {
  return (
    INFOGRAPHIC_CAPABILITIES.find((capability) => capability.type === type)
      ?.label ?? type
  );
}

/** The fork's `DEFAULT_INFOGRAPHIC_INSERT_POSITION`. */
const INFOGRAPHIC_INSERT_POSITION = { x: 128, y: 170 } as const;

/**
 * The fork's natural insert frames for the three implemented types
 * (`infographicContentSize` in
 * `presenton-ui/components/slide-editor/infographics/infographic-sizing.ts`):
 * the fixed progress bar and gauge frames, and the funnel's
 * `620 × (240 + 4 × 60)` frame for its four default stages.
 */
const INFOGRAPHIC_NATURAL_SIZE: Record<
  InsertableInfographicType,
  { width: number; height: number }
> = {
  gauge: { width: 320, height: 190 },
  progress_bar: { width: 420, height: 74 },
  vertical_funnel: { width: 620, height: 480 },
};

/**
 * The fork's insert defaults (`makeInfographicElement`): engine-default data
 * values, the two-tone neutral/accent palette (bare hex, `#`-optional — the
 * renderer normalizes) and the element name. The funnel's four stages are the
 * fork's own stage defaults.
 */
const INFOGRAPHIC_INSERT_DEFAULTS: Record<
  InsertableInfographicType,
  {
    name: string;
    colors: string[];
    text_color: string | null;
    data:
      | ProgressBarInfographicData
      | GaugeInfographicData
      | VerticalFunnelInfographicData;
  }
> = {
  gauge: {
    name: "gauge_chart",
    colors: ["E5E7EB", "2563EB"],
    text_color: "111111",
    data: { type: "gauge", min_value: 0, max_value: 100, value: 76 },
  },
  progress_bar: {
    name: "progress_bar",
    colors: ["E5E7EB", "2563EB"],
    text_color: "111111",
    data: { type: "progress_bar", min_value: 0, max_value: 100, value: 68 },
  },
  vertical_funnel: {
    name: "vertical_funnel",
    colors: ["FFFFFF", "102E79", "24468E", "4D73BE", "7CA2E5"],
    text_color: null,
    data: {
      type: "vertical_funnel",
      items: [
        {
          value: 100,
          heading: "Awareness",
          description: "The full audience entering the funnel.",
        },
        {
          value: 60,
          heading: "Interest",
          description: "People engaging with the offering.",
        },
        {
          value: 35,
          heading: "Consideration",
          description: "Prospects evaluating the solution.",
        },
        {
          value: 20,
          heading: "Conversion",
          description: "People completing the target action.",
        },
      ],
    },
  },
};

/** A fresh, renderable element for one implemented type (fork defaults). */
export function defaultInfographicElement(
  type: InsertableInfographicType,
): InfographicElement {
  const defaults = INFOGRAPHIC_INSERT_DEFAULTS[type];
  return {
    type: "infographic",
    position: { ...INFOGRAPHIC_INSERT_POSITION },
    size: { ...INFOGRAPHIC_NATURAL_SIZE[type] },
    data: structuredClone(defaults.data),
    colors: [...defaults.colors],
    text_color: defaults.text_color,
    decorative: false,
    name: defaults.name,
  };
}

// ---------------------------------------------------------------------------
// Insertion — the fork's `insertedElementToComponent` semantics
// ---------------------------------------------------------------------------

/** The fork's component id and description bounds (`inserted-content.ts`). */
const COMPONENT_ID_MAX_LENGTH = 80;
const COMPONENT_DESCRIPTION_MIN_LENGTH = 10;
const COMPONENT_DESCRIPTION_MAX_LENGTH = 300;

/** The fork's `normalizeId`: one safe token, never empty. */
function normalizeComponentId(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "component";
}

/** The fork's `withUniqueComponentId`: `_2`, `_3`… on a taken base id. */
function uniqueComponentId(
  label: string,
  siblings: SlideComponent[],
  index: number,
): string {
  const base = normalizeComponentId(label).slice(0, COMPONENT_ID_MAX_LENGTH);
  const taken = new Set(
    siblings
      .map((sibling) =>
        typeof sibling.id === "string" && sibling.id !== "" ? sibling.id : null,
      )
      .filter((id): id is string => id !== null),
  );
  const first = `${base}_${index + 1}`;
  if (!taken.has(first)) return first;
  let copyIndex = 2;
  let candidate = componentIdWithSuffix(first, copyIndex);
  while (taken.has(candidate)) {
    copyIndex += 1;
    candidate = componentIdWithSuffix(first, copyIndex);
  }
  return candidate;
}

function componentIdWithSuffix(candidate: string, copyIndex: number): string {
  const suffix = `_${copyIndex}`;
  return `${candidate.slice(0, COMPONENT_ID_MAX_LENGTH - suffix.length)}${suffix}`;
}

/** The fork's `insertedComponentDescription` (min 10 chars, max 300). */
function insertedComponentDescription(label: string): string {
  const candidate = label.trim() || "Inserted component";
  const description =
    candidate.length >= COMPONENT_DESCRIPTION_MIN_LENGTH
      ? candidate
      : `Inserted ${candidate}`;
  return description.slice(0, COMPONENT_DESCRIPTION_MAX_LENGTH);
}

function slideUiRecord(value: unknown): SlideUi | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as SlideUi)
    : null;
}

export type InfographicInsertResult = {
  /** The slide with the new component appended (the input is never mutated). */
  slide: DeckSlide;
  /** The appended component's index — the element key is `components:<i>/0`. */
  componentIndex: number;
  component: SlideComponent;
};

/**
 * Appends one freshly built infographic element to the slide's `ui.components`
 * as its own component frame — the fork's insertion shape. The slide's other
 * fields (layout, content, speaker note, ui background/root elements) travel
 * untouched; a slide without a stored `ui` gets a minimal one carrying just the
 * new frame, so the insert still renders natively.
 */
export function insertInfographicElement(
  slide: DeckSlide,
  type: InsertableInfographicType,
): InfographicInsertResult {
  const ui = slideUiRecord(slide.ui);
  const existing = Array.isArray(ui?.components) ? ui.components : [];
  const label = infographicLabel(type);
  const element = defaultInfographicElement(type);
  const position = element.position ?? INFOGRAPHIC_INSERT_POSITION;
  const component: SlideComponent = {
    id: uniqueComponentId(label, existing, existing.length),
    description: insertedComponentDescription(label),
    position: { x: position.x, y: position.y },
    elements: [{ ...element, position: { x: 0, y: 0 } }],
  };

  return {
    slide: {
      ...slide,
      ui: { ...(ui ?? {}), components: [...existing, component] },
    },
    componentIndex: existing.length,
    component,
  };
}
