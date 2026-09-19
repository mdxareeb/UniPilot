/**
 * Task D6 — the block/layout palette's pure half (spec §5.4 "Blocks", plan D6).
 *
 * The palette lists the deck template's layouts (`getPresentationTemplate`,
 * read server-side by the edit route) grouped for `Collapsible` disclosure.
 * Each entry can become a new slide after the current one (hydrated from
 * template defaults) or replace the current slide's layout (hydrated with its
 * existing content).
 *
 * Honesty rules this module owns:
 *
 * - The engine's **schema-derived top-level repeated-group expansion**
 *   (`hydrate_repeated_top_level_groups`, `templates/v2/content.py:26-56`) is
 *   the one C2 hydration gap this task records instead of porting: its field
 *   name comes from a JSON-Schema derivation the module does not implement.
 *   A layout whose component is the shape that expansion consumes — two or
 *   more top-level `group` elements whose editable content fields match — is
 *   therefore **add-only**: it can be inserted as a new slide (template
 *   defaults need no mapping), but never applied over an existing slide's
 *   content with a silent partial merge. The detector below approximates the
 *   engine's test (`_component_repeated_top_level_group_node`,
 *   `templates/v2/schema.py:822-852`); its boundary and corpus verification
 *   are documented at the function.
 * - Insertion is capped at the engine's 50 slides (`PRESENTON_MAX_SLIDES`,
 *   spec D11); the palette carries the same "Slide limit reached (50)" copy the
 *   rail's structural toolbar already shows.
 *
 * Pure and client-safe: no React, no I/O, no mutation of its inputs.
 */
import type { SlideComponent, TemplateLayout } from "@/lib/presentation/types";

/** JSON object view of the wire structures the detector walks. */
type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

/** The engine's slide cap (`PRESENTON_MAX_SLIDES`, spec D11). */
export const SLIDE_LIMIT = 50;
/** The disabled control's title (the rail toolbar's existing wording). */
export const SLIDE_LIMIT_TITLE = "Slide limit reached (50)";
/** The visible note (the rail toolbar's existing wording). */
export const SLIDE_LIMIT_NOTE = `${SLIDE_LIMIT_TITLE}.`;

/** True once the deck carries the engine's maximum number of slides. */
export function slideLimitReached(slideCount: number): boolean {
  return slideCount >= SLIDE_LIMIT;
}

/** The add action's state at the deck's current size. */
export function paletteAddState(atSlideLimit: boolean): {
  disabled: boolean;
  title: string;
} {
  return atSlideLimit
    ? { disabled: true, title: SLIDE_LIMIT_TITLE }
    : { disabled: false, title: "Add as a new slide" };
}

/**
 * The replace action's honest label for an add-only layout. It states the
 * *native* limit (this module does not map the shape), not a claim about what
 * the engine does with it.
 */
export const TOP_LEVEL_GROUP_REPLACE_REASON =
  "This layout builds each repeated item as its own top-level group — a shape the native hydration module doesn't map, so applying it could drop content. Add it as a new slide instead.";

export type LayoutReplaceSupport = {
  replaceable: boolean;
  reason: string | null;
};

/* -------------------------------------------------------------------------
 * The top-level repeated-group detector (approximation)
 *
 * The engine decides the same question from generated JSON Schemas
 * (`get_repeated_top_level_group_schema_name` → `_component_schema_nodes_for_element`
 * → `_component_repeated_children_schema_result`, schema.py). This port walks
 * the same editable-field structure and compares a compact signature instead
 * of a full schema:
 *
 * - every element must be a `group` (the engine's first condition);
 * - every group must yield at least one editable node (named, `decorative ===
 *   false`, content type) — an empty node set rejects the layout;
 * - the groups' item signatures must be identical: the ordered, deduplicated
 *   field map of each group (field name, type, and the constraint values the
 *   engine's schema carries: text min/max length, text-list item bounds, table
 *   bounds, chart/infographic caps, image prompt key).
 *
 * Boundary (recorded): the engine also strips a token shared by the group
 * names through the item schemas and detects nested repeated child arrays
 * inside a group; this port compares raw field signatures and treats nested
 * repeats as ordered fields. Verified 2026-09-19 against the engine's own
 * `get_repeated_top_level_group_schema_name` over all 219 bundled layouts:
 * identical classification (4 expandable, 0 mismatches), which is the corpus
 * the palette can ever serve.
 * ------------------------------------------------------------------------- */

/** Element types the engine's schema walk treats as editable content. */
const CONTENT_TYPE_SET = new Set([
  "text",
  "image",
  "text-list",
  "table",
  "chart",
  "infographic",
]);

/** The constraint fields each content type contributes to a signature. */
const CONSTRAINT_KEYS: Record<string, readonly string[]> = {
  text: ["min_length", "max_length"],
  "text-list": ["min_items", "max_items", "min_item_length", "max_item_length"],
  table: ["min_columns", "max_columns", "min_rows", "max_rows"],
  chart: ["max_categories", "max_series", "max_length"],
  infographic: ["max_items"],
};

type SignatureNode = { name: string; signature: string };

function signatureValue(value: unknown): string {
  return value === undefined ? "null" : JSON.stringify(value);
}

/** One editable field's schema-relevant signature. */
function leafSignature(record: JsonRecord): string {
  const elementType = typeof record.type === "string" ? record.type : "";
  const parts: string[] = [elementType];
  if (elementType === "image") {
    parts.push(record.is_icon === true ? "icon_query" : "image_prompt");
  } else {
    for (const key of CONSTRAINT_KEYS[elementType] ?? []) {
      parts.push(`${key}=${signatureValue(record[key])}`);
    }
  }
  return `(${parts.join("|")})`;
}

/** The engine's `_component_add_schema_property` dedupe, order-insensitive. */
function objectSignature(nodes: SignatureNode[]): string {
  const properties = new Map<string, string>();
  for (const node of nodes) {
    let key = node.name;
    let suffix = 2;
    while (properties.has(key)) {
      key = `${node.name}_${suffix}`;
      suffix += 1;
    }
    properties.set(key, node.signature);
  }
  const entries = [...properties.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, signature]) => `${key}:${signature}`).join(",")}}`;
}

/**
 * The engine's `_component_schema_nodes_for_element` (schema.py:762-819),
 * reduced to signatures: named wrappers become one object node, unnamed ones
 * flatten their children, non-editable elements contribute nothing.
 */
function walkSchemaNodes(value: unknown): SignatureNode[] {
  const record = asRecord(value);
  if (!record) return [];
  const elementType = typeof record.type === "string" ? record.type : "";
  const name =
    typeof record.name === "string" && record.name.trim() !== ""
      ? record.name.trim()
      : null;

  if (
    CONTENT_TYPE_SET.has(elementType) &&
    record.decorative === false &&
    name !== null
  ) {
    return [{ name, signature: leafSignature(record) }];
  }

  if (elementType === "container") {
    const nodes = walkSchemaNodes(record.child);
    if (name === null || nodes.length === 0) return nodes;
    return [{ name, signature: objectSignature(nodes) }];
  }

  if (
    elementType === "flex" ||
    elementType === "grid" ||
    elementType === "group"
  ) {
    const children = Array.isArray(record.children) ? record.children : [];
    const nodes: SignatureNode[] = [];
    for (const child of children) nodes.push(...walkSchemaNodes(child));
    if (name === null || nodes.length === 0) return nodes;
    return [{ name, signature: objectSignature(nodes) }];
  }

  return [];
}

/** The engine's `_component_normalized_repeated_item_schema` item shape. */
function itemSignature(nodes: SignatureNode[]): string {
  if (nodes.length === 1 && nodes[0].signature.startsWith("{")) {
    return nodes[0].signature;
  }
  return objectSignature(nodes);
}

/**
 * The approximation of `get_repeated_top_level_group_schema_name`: true when
 * this component is the engine-expandable top-level repeated-group shape.
 */
function needsTopLevelGroupExpansion(component: SlideComponent): boolean {
  const elements = Array.isArray(component.elements) ? component.elements : [];
  if (elements.length < 2) return false;
  const groups: JsonRecord[] = [];
  for (const element of elements) {
    const record = asRecord(element);
    if (!record || record.type !== "group") return false;
    groups.push(record);
  }
  const nodeSets = groups.map((group) => walkSchemaNodes(group));
  if (nodeSets.some((nodes) => nodes.length === 0)) return false;
  const first = itemSignature(nodeSets[0]);
  return nodeSets.every((nodes) => itemSignature(nodes) === first);
}

/**
 * Whether the native hydration module can faithfully apply this layout over an
 * existing slide's content. Flags the one recorded unmappable pattern — the
 * engine's top-level repeated-group shape — and leaves every other layout
 * replaceable.
 */
export function layoutReplaceSupport(
  layout: TemplateLayout,
): LayoutReplaceSupport {
  const components = Array.isArray(layout.components) ? layout.components : [];
  const unmapped = components.some(needsTopLevelGroupExpansion);
  return unmapped
    ? { replaceable: false, reason: TOP_LEVEL_GROUP_REPLACE_REASON }
    : { replaceable: true, reason: null };
}

export type PaletteLayoutEntry = {
  id: string;
  /** The description when the engine serves one, else the id. */
  label: string;
  replaceable: boolean;
  replaceReason: string | null;
};

export type LayoutPaletteGroup = {
  /** The layout group (the deck's template id). */
  id: string;
  label: string;
  layouts: PaletteLayoutEntry[];
};

/**
 * Groups the template's layouts for the palette. Today the deck has one
 * template, so this yields one group keyed by its layout group; the shape stays
 * a list so the templates browser (E) can reuse it without a rewrite.
 * Malformed entries (no usable id) are dropped, never guessed at.
 */
export function buildLayoutPalette(input: {
  layouts: TemplateLayout[] | null;
  groupId: string;
  groupLabel: string;
}): LayoutPaletteGroup[] {
  const layouts = Array.isArray(input.layouts) ? input.layouts : [];
  const entries: PaletteLayoutEntry[] = [];
  for (const layout of layouts) {
    if (typeof layout?.id !== "string" || layout.id === "") continue;
    const support = layoutReplaceSupport(layout);
    entries.push({
      id: layout.id,
      label:
        typeof layout.description === "string" && layout.description.trim() !== ""
          ? layout.description.trim()
          : layout.id,
      replaceable: support.replaceable,
      replaceReason: support.reason,
    });
  }
  if (entries.length === 0) return [];
  return [{ id: input.groupId, label: input.groupLabel, layouts: entries }];
}

/** How many of the template's layouts are add-only (the honest count line). */
export function addOnlyLayoutCount(layouts: TemplateLayout[] | null): number {
  const list = Array.isArray(layouts) ? layouts : [];
  return list.filter((layout) => !layoutReplaceSupport(layout).replaceable)
    .length;
}
