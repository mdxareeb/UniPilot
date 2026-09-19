/**
 * Pure clipboard, duplicate and delete operations for the native editor (Task
 * D7, spec §5.4 "Copy / paste / duplicate", §8.3 motion, §8.5 keyboard
 * equivalents).
 *
 * Everything here is a function over the wire JSON: no DOM, no React, no
 * fetch. The module also owns the editor's **in-app element clipboard** — a
 * module-level buffer (the brief's "module-level clipboard") that survives
 * slide navigation, so a copy on one slide pastes onto another slide of the
 * same deck. The DeckEditor only translates keys and menu events into these
 * calls.
 *
 * Recorded rules (verified, not guessed):
 * - **Element identity.** The running engine's element models carry no `id`
 *   field (checked 2026-09-19 against the live engine: text/image/vector/
 *   flex/… all serialize without one), so a deep clone cannot collide on
 *   identity. Because `slides[].ui` is stored unvalidated, a payload *could*
 *   carry unknown `id` fields; the clone preserves every unknown field and
 *   refreshes any string `id` found anywhere in the copied subtree, so a
 *   stored id never duplicates on paste/duplicate. On today's decks this is a
 *   no-op, and the tests pin both behaviors.
 * - **Geometry.** Elements keep their **component-local** coordinates
 *   (`position` is relative to the component frame; vectors hold stage-space
 *   points and are translated). The paste offset is a component-local delta.
 *   Pasting into a different component therefore renders at (new component
 *   origin + local position + offset) — the origin delta is the component's,
 *   never silently rewritten.
 * - **Targeting.** The same component is preferred: when the copied element's
 *   source component id exists on the target slide, the clone lands there.
 *   Root elements prefer the target slide's root `elements` list. Otherwise
 *   the anchor (the editor's primary selection on the target slide) decides,
 *   then the first component, then the root list — deterministic, recorded.
 * - **Nested parents.** When the copy came from inside a `container` / `flex`
 *   / `grid` / `group` and the target root list holds an element of the same
 *   type at the same parent chain, the clone lands inside that parent too.
 *   A `container` holds exactly one child, so an occupied slot falls back to
 *   the target list's top level instead of replacing the child.
 * - **Flow parents.** `flex`/`grid` children are positioned by CSS layout,
 *   not by `position`, so a clone inserted there is not offset (the layout
 *   places it; offsetting the wire would be a lie the renderer ignores).
 *   Absolute lists (component top level, group children, root elements) are
 *   offset with `applyElementMove`, which also translates vectors.
 * - **Container children.** A `container`'s single child has no sibling slot:
 *   duplicate/delete handle delete by clearing the slot (the honest wire
 *   representation), and duplicate leaves the slot content untouched (the
 *   parent's list would misplace it) — recorded, never faked.
 * - **OS clipboard.** `serializeElementClipboard` / `parseElementClipboard`
 *   and the MIME/prefix constants back the editor's best-effort OS clipboard
 *   integration; failures there never touch the in-app buffer.
 */
import {
  applyElementMove,
  getElementAtPath,
  parseIndexes,
  resolveSelection,
  updateElementAtPath,
  type ElementPath,
} from "./editorOps";
import type { DeckSlide, SlideElement } from "./types";

// ---------------------------------------------------------------------------
// Types, constants, module buffer
// ---------------------------------------------------------------------------

export type ElementClipboardItem = {
  /** Deep clone of the copied element (component-local coordinates). */
  element: SlideElement;
  /** Which root list the element was copied from. */
  sourceRoot: "components" | "elements";
  /** The source component's id; `null` for root elements. */
  sourceComponentId: string | null;
  /** Parent element chain within the root list; `[]` = top level. */
  parentIndexes: number[];
  /** The parent element's type when `parentIndexes` is not empty. */
  parentType: SlideElement["type"] | null;
};

export type ElementClipboard = { items: ElementClipboardItem[] };

/** The fork's paste step (`useClipboard.ts`): 16 px per consecutive paste. */
export const ELEMENT_PASTE_OFFSET = 16;
/** Mod+D moves the clone one step; repeated Mod+D walks because the clone is selected. */
export const ELEMENT_DUPLICATE_OFFSET = 16;
export const ELEMENT_CLIPBOARD_MIME =
  "application/x-unipilot-presentation-elements";
export const ELEMENT_CLIPBOARD_PREFIX = "UNIPILOT_ELEMENTS_V1:";
const ELEMENT_CLIPBOARD_FORMAT = "unipilot/presentation-elements";
const ELEMENT_CLIPBOARD_VERSION = 1;

let clipboard: ElementClipboard | null = null;
let pasteSequence = 0;

function defaultMakeId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `element-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/** Stores the payload as the in-app buffer and restarts the paste sequence. */
export function rememberElementClipboard(payload: ElementClipboard): void {
  clipboard = payload;
  pasteSequence = 0;
}

/** The in-app buffer (module-level: it survives slide navigation). */
export function readElementClipboard(): ElementClipboard | null {
  return clipboard;
}

/** Empties the in-app buffer (used by tests and explicit clears). */
export function clearElementClipboard(): void {
  clipboard = null;
  pasteSequence = 0;
}

/** The next paste's stage offset: 16, 32, 48… within one copy. */
export function nextElementPasteOffset(): number {
  pasteSequence += 1;
  return ELEMENT_PASTE_OFFSET * pasteSequence;
}

/** Restarts the paste walk without touching the buffer. */
export function resetElementPasteSequence(): void {
  pasteSequence = 0;
}

// ---------------------------------------------------------------------------
// Clone, ids, serialization
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A deep clone of one element (the copy never aliases the source). */
export function cloneElementForClipboard(element: SlideElement): SlideElement {
  return cloneJson(element);
}

/**
 * Replaces every string `id` field anywhere in the element subtree with a
 * fresh id. Unknown fields survive; today's wire elements carry no `id`, so
 * the result is structurally identical to the input.
 */
export function refreshElementIds(
  element: SlideElement,
  makeId: () => string = defaultMakeId,
): SlideElement {
  return refreshIdsDeep(element, makeId) as SlideElement;
}

function refreshIdsDeep(value: unknown, makeId: () => string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => refreshIdsDeep(entry, makeId));
  }
  if (isRecord(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      next[key] =
        key === "id" && typeof entry === "string"
          ? makeId()
          : refreshIdsDeep(entry, makeId);
    }
    return next;
  }
  return value;
}

/** The wire JSON for the custom-MIME OS clipboard write (raw, no prefix). */
export function serializeElementClipboard(payload: ElementClipboard): string {
  return JSON.stringify({
    format: ELEMENT_CLIPBOARD_FORMAT,
    version: ELEMENT_CLIPBOARD_VERSION,
    items: payload.items,
  });
}

/** Strict validation: anything malformed parses to `null`, never throws. */
export function parseElementClipboard(
  serialized: string | null | undefined,
): ElementClipboard | null {
  if (typeof serialized !== "string" || serialized.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (
      !isRecord(parsed) ||
      parsed.format !== ELEMENT_CLIPBOARD_FORMAT ||
      parsed.version !== ELEMENT_CLIPBOARD_VERSION ||
      !Array.isArray(parsed.items) ||
      parsed.items.length === 0
    ) {
      return null;
    }
    const items: ElementClipboardItem[] = [];
    for (const raw of parsed.items) {
      if (!isRecord(raw)) return null;
      const { element, sourceRoot, sourceComponentId, parentIndexes } = raw;
      if (!isRecord(element) || typeof element.type !== "string") return null;
      if (sourceRoot !== "components" && sourceRoot !== "elements") return null;
      if (sourceComponentId !== null && typeof sourceComponentId !== "string") {
        return null;
      }
      if (
        !Array.isArray(parentIndexes) ||
        parentIndexes.some(
          (index) => !Number.isInteger(index) || (index as number) < 0,
        )
      ) {
        return null;
      }
      const parentType = raw.parentType;
      if (parentType !== null && typeof parentType !== "string") return null;
      items.push({
        element: element as unknown as SlideElement,
        sourceRoot,
        sourceComponentId,
        parentIndexes: parentIndexes as number[],
        parentType: (parentType ?? null) as SlideElement["type"] | null,
      });
    }
    return { items };
  } catch {
    return null;
  }
}

/** The `text/plain` OS clipboard form: the prefix plus the wire JSON. */
export function elementClipboardText(payload: ElementClipboard): string {
  return `${ELEMENT_CLIPBOARD_PREFIX}${serializeElementClipboard(payload)}`;
}

/** Reads either the prefixed `text/plain` form or raw custom-MIME JSON. */
export function parseElementClipboardText(
  text: string | null | undefined,
): ElementClipboard | null {
  if (typeof text !== "string") return null;
  return parseElementClipboard(
    text.startsWith(ELEMENT_CLIPBOARD_PREFIX)
      ? text.slice(ELEMENT_CLIPBOARD_PREFIX.length)
      : text,
  );
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/**
 * The payload for one selection: deep clones plus the addressing metadata
 * paste needs. Unresolved/duplicate keys are skipped; an empty result is
 * `null` (nothing to copy). The slide is never mutated.
 */
export function createElementClipboard(
  slide: DeckSlide | null,
  keys: string[],
): ElementClipboard | null {
  if (slide === null || keys.length === 0) return null;
  const seen = new Set<string>();
  const items: ElementClipboardItem[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const resolved = resolveSelection(slide, key);
    if (resolved === null) continue;
    const path = resolved.path;
    let sourceComponentId: string | null = null;
    if (path.root === "components") {
      const componentIndex = path.indexes[0];
      const components =
        slide.ui !== null && slide.ui !== undefined
          ? Array.isArray(slide.ui.components)
            ? slide.ui.components
            : []
          : [];
      const component =
        componentIndex === undefined ? null : components[componentIndex];
      sourceComponentId =
        component !== null &&
        component !== undefined &&
        typeof component.id === "string"
          ? component.id
          : null;
    }
    const parentIndexes =
      path.root === "components"
        ? path.indexes.slice(1, -1)
        : path.indexes.slice(0, -1);
    /* The resolved element is the copy target; the parent is re-read for the
       type that nested paste targeting compares against. */
    const parentElement =
      parentIndexes.length === 0
        ? null
        : getElementAtPath(slide, {
            root: path.root,
            indexes:
              path.root === "components"
                ? [path.indexes[0] ?? -1, ...parentIndexes]
                : parentIndexes,
          });
    items.push({
      element: cloneElementForClipboard(resolved.element),
      sourceRoot: path.root,
      sourceComponentId,
      parentIndexes,
      parentType:
        parentElement !== null && parentElement !== undefined
          ? parentElement.type
          : null,
    });
  }
  return items.length > 0 ? { items } : null;
}

// ---------------------------------------------------------------------------
// Insertion helpers (address = a list inside the slide)
// ---------------------------------------------------------------------------

type ListAddress = {
  root: "components" | "elements";
  /** Present when `root` is `components`. */
  componentIndex: number | null;
  /** Parent element chain within the root list; `[]` = the root list itself. */
  parentIndexes: number[];
};

function parentPathFor(address: ListAddress): ElementPath | null {
  if (address.parentIndexes.length === 0) return null;
  if (address.root === "components") {
    if (address.componentIndex === null) return null;
    return {
      root: "components",
      indexes: [address.componentIndex, ...address.parentIndexes],
    };
  }
  return { root: "elements", indexes: [...address.parentIndexes] };
}

/** Which address the list a resolved path's element lives in. */
function listAddressOfPath(path: ElementPath): ListAddress | null {
  if (path.indexes.length === 0) return null;
  if (path.root === "components") {
    if (path.indexes.length < 2) return null;
    return {
      root: "components",
      componentIndex: path.indexes[0] ?? null,
      parentIndexes: path.indexes.slice(1, -1),
    };
  }
  return {
    root: "elements",
    componentIndex: null,
    parentIndexes: path.indexes.slice(0, -1),
  };
}

/** Whether the address names a flow parent (its children ignore `position`). */
function isFlowAddress(slide: DeckSlide, address: ListAddress): boolean {
  const parentPath = parentPathFor(address);
  if (parentPath === null) return false;
  const parent = getElementAtPath(slide, parentPath);
  return (
    parent !== null &&
    parent !== undefined &&
    parent.type !== "group"
  );
}

/** Appends `element` at the end of the addressed list; answers its key chain. */
function insertElementAtEnd(
  slide: DeckSlide,
  address: ListAddress,
  element: SlideElement,
): { slide: DeckSlide; keyIndexes: number[] } | null {
  const ui = slide.ui;
  if (ui === null || ui === undefined) return null;

  if (address.parentIndexes.length === 0) {
    if (address.root === "elements") {
      const elements = Array.isArray(ui.elements)
        ? (ui.elements as SlideElement[])
        : [];
      return {
        slide: { ...slide, ui: { ...ui, elements: [...elements, element] } },
        keyIndexes: [elements.length],
      };
    }
    const componentIndex = address.componentIndex;
    if (componentIndex === null) return null;
    const components = Array.isArray(ui.components) ? ui.components : [];
    const component = components[componentIndex];
    if (component === undefined) return null;
    const elements = Array.isArray(component.elements)
      ? component.elements
      : [];
    const nextComponents = components.map((candidate, index) =>
      index === componentIndex
        ? { ...candidate, elements: [...elements, element] }
        : candidate,
    );
    return {
      slide: { ...slide, ui: { ...ui, components: nextComponents } },
      keyIndexes: [componentIndex, elements.length],
    };
  }

  const parentPath = parentPathFor(address);
  if (parentPath === null) return null;
  const parent = getElementAtPath(slide, parentPath);
  if (parent === null || parent === undefined) return null;
  if (parent.type === "container") {
    if (parent.child !== null && parent.child !== undefined) return null;
    return {
      slide: updateElementAtPath(slide, parentPath, () => ({
        ...parent,
        child: element,
      })),
      keyIndexes: [...parentPath.indexes, 0],
    };
  }
  if (
    parent.type === "flex" ||
    parent.type === "grid" ||
    parent.type === "group"
  ) {
    const children = Array.isArray(parent.children) ? parent.children : [];
    return {
      slide: updateElementAtPath(slide, parentPath, () => ({
        ...parent,
        children: [...children, element],
      })),
      keyIndexes: [...parentPath.indexes, children.length],
    };
  }
  return null;
}

/** Inserts `element` directly after the element at `path` (duplicate). */
function insertElementAfterPath(
  slide: DeckSlide,
  path: ElementPath,
  element: SlideElement,
): { slide: DeckSlide; key: string } | null {
  const address = listAddressOfPath(path);
  if (address === null) return null;
  const elementIndex = path.indexes[path.indexes.length - 1];
  if (elementIndex === undefined) return null;

  if (address.parentIndexes.length === 0) {
    const ui = slide.ui;
    if (ui === null || ui === undefined) return null;
    if (address.root === "elements") {
      const elements = Array.isArray(ui.elements)
        ? (ui.elements as SlideElement[])
        : [];
      if (elementIndex >= elements.length) return null;
      const next = [
        ...elements.slice(0, elementIndex + 1),
        element,
        ...elements.slice(elementIndex + 1),
      ];
      return {
        slide: { ...slide, ui: { ...ui, elements: next } },
        key: `elements:${elementIndex + 1}`,
      };
    }
    const componentIndex = address.componentIndex;
    if (componentIndex === null) return null;
    const components = Array.isArray(ui.components) ? ui.components : [];
    const component = components[componentIndex];
    if (component === undefined) return null;
    const elements = Array.isArray(component.elements)
      ? component.elements
      : [];
    if (elementIndex >= elements.length) return null;
    const next = [
      ...elements.slice(0, elementIndex + 1),
      element,
      ...elements.slice(elementIndex + 1),
    ];
    const nextComponents = components.map((candidate, index) =>
      index === componentIndex ? { ...candidate, elements: next } : candidate,
    );
    return {
      slide: { ...slide, ui: { ...ui, components: nextComponents } },
      key: `components:${componentIndex}/${elementIndex + 1}`,
    };
  }

  const parentPath = parentPathFor(address);
  if (parentPath === null) return null;
  const parent = getElementAtPath(slide, parentPath);
  if (parent === null || parent === undefined) return null;
  /* A container's single child has no sibling slot. */
  if (parent.type === "container") return null;
  if (
    parent.type !== "flex" &&
    parent.type !== "grid" &&
    parent.type !== "group"
  ) {
    return null;
  }
  const children = Array.isArray(parent.children) ? parent.children : [];
  if (elementIndex >= children.length) return null;
  const next = [
    ...children.slice(0, elementIndex + 1),
    element,
    ...children.slice(elementIndex + 1),
  ];
  return {
    slide: updateElementAtPath(slide, parentPath, () => ({
      ...parent,
      children: next,
    })),
    key: `${path.root}:${[...parentPath.indexes, elementIndex + 1].join("/")}`,
  };
}

/** Removes the element at `path` (clears an occupied container slot). */
function removeElementAtPath(
  slide: DeckSlide,
  path: ElementPath,
): DeckSlide | null {
  const address = listAddressOfPath(path);
  if (address === null) return null;
  const elementIndex = path.indexes[path.indexes.length - 1];
  if (elementIndex === undefined) return null;

  if (address.parentIndexes.length > 0) {
    const parentPath = parentPathFor(address);
    if (parentPath === null) return null;
    const parent = getElementAtPath(slide, parentPath);
    if (parent === null || parent === undefined) return null;
    if (parent.type === "container") {
      if (parent.child === null || parent.child === undefined) return null;
      return updateElementAtPath(slide, parentPath, () => ({
        ...parent,
        child: null,
      }));
    }
    if (
      parent.type !== "flex" &&
      parent.type !== "grid" &&
      parent.type !== "group"
    ) {
      return null;
    }
    const children = Array.isArray(parent.children) ? parent.children : [];
    if (elementIndex >= children.length) return null;
    const next = [
      ...children.slice(0, elementIndex),
      ...children.slice(elementIndex + 1),
    ];
    return updateElementAtPath(slide, parentPath, () => ({
      ...parent,
      children: next,
    }));
  }

  const ui = slide.ui;
  if (ui === null || ui === undefined) return null;
  if (address.root === "elements") {
    const elements = Array.isArray(ui.elements)
      ? (ui.elements as SlideElement[])
      : [];
    if (elementIndex >= elements.length) return null;
    return {
      ...slide,
      ui: {
        ...ui,
        elements: [
          ...elements.slice(0, elementIndex),
          ...elements.slice(elementIndex + 1),
        ],
      },
    };
  }
  const componentIndex = address.componentIndex;
  if (componentIndex === null) return null;
  const components = Array.isArray(ui.components) ? ui.components : [];
  const component = components[componentIndex];
  if (component === undefined) return null;
  const elements = Array.isArray(component.elements)
    ? component.elements
    : [];
  if (elementIndex >= elements.length) return null;
  const next = [
    ...elements.slice(0, elementIndex),
    ...elements.slice(elementIndex + 1),
  ];
  const nextComponents = components.map((candidate, index) =>
    index === componentIndex ? { ...candidate, elements: next } : candidate,
  );
  return { ...slide, ui: { ...ui, components: nextComponents } };
}

// ---------------------------------------------------------------------------
// Paste targeting
// ---------------------------------------------------------------------------

function nestedAddressOrTop(
  slide: DeckSlide,
  base: ListAddress,
  item: ElementClipboardItem,
): ListAddress {
  if (item.parentIndexes.length === 0 || item.parentType === null) return base;
  const candidate: ListAddress = {
    ...base,
    parentIndexes: item.parentIndexes,
  };
  const parentPath = parentPathFor(candidate);
  if (parentPath === null) return base;
  const parent = getElementAtPath(slide, parentPath);
  if (parent === null || parent === undefined) return base;
  if (parent.type !== item.parentType) return base;
  if (parent.type === "container") {
    return parent.child === null || parent.child === undefined ? candidate : base;
  }
  if (
    parent.type === "flex" ||
    parent.type === "grid" ||
    parent.type === "group"
  ) {
    return candidate;
  }
  return base;
}

/**
 * The list one copied element lands in: the same component id when the target
 * slide has it, the root list for root copies, then the anchor's component
 * (the editor's primary selection), then the first component, then the root
 * list. Nested parents are preserved when the target offers the same parent
 * type at the same chain (an occupied container slot falls back to the top).
 */
function resolveTargetAddress(
  slide: DeckSlide,
  item: ElementClipboardItem,
  anchorKey: string | null,
): ListAddress | null {
  const ui = slide.ui;
  if (ui === null || ui === undefined) return null;
  const components = Array.isArray(ui.components) ? ui.components : [];
  const hasRootList = Array.isArray(ui.elements);

  if (item.sourceRoot === "components" && item.sourceComponentId !== null) {
    const index = components.findIndex(
      (component) => component.id === item.sourceComponentId,
    );
    if (index >= 0) {
      return nestedAddressOrTop(
        slide,
        { root: "components", componentIndex: index, parentIndexes: [] },
        item,
      );
    }
  }
  if (item.sourceRoot === "elements" && hasRootList) {
    return nestedAddressOrTop(
      slide,
      { root: "elements", componentIndex: null, parentIndexes: [] },
      item,
    );
  }

  const anchor = anchorKey === null ? null : parseIndexes(anchorKey);
  if (anchor !== null) {
    if (anchor.root === "components") {
      const index = anchor.indexes[0];
      if (index !== undefined && components[index] !== undefined) {
        return nestedAddressOrTop(
          slide,
          { root: "components", componentIndex: index, parentIndexes: [] },
          item,
        );
      }
    } else if (hasRootList) {
      return nestedAddressOrTop(
        slide,
        { root: "elements", componentIndex: null, parentIndexes: [] },
        item,
      );
    }
  }

  if (components.length > 0) {
    return nestedAddressOrTop(
      slide,
      { root: "components", componentIndex: 0, parentIndexes: [] },
      item,
    );
  }
  return { root: "elements", componentIndex: null, parentIndexes: [] };
}

/**
 * Pastes every clipboard item into `slide`, offsetting absolute targets by
 * `options.offset` (vectors included), and answers the slide plus the pasted
 * elements' selection keys. The input slide and the clipboard payload are
 * never mutated; each paste re-clones every item.
 */
export function pasteElementClipboard(
  slide: DeckSlide,
  payload: ElementClipboard,
  options: { offset: number; anchorKey?: string | null; makeId?: () => string },
): { slide: DeckSlide; keys: string[] } | null {
  if (payload.items.length === 0) return null;
  const makeId = options.makeId ?? defaultMakeId;
  const anchorKey = options.anchorKey ?? null;
  let nextSlide = slide;
  const keys: string[] = [];

  for (const item of payload.items) {
    const address = resolveTargetAddress(nextSlide, item, anchorKey);
    if (address === null) continue;
    const clone = refreshElementIds(cloneJson(item.element), makeId);
    const positioned = isFlowAddress(nextSlide, address)
      ? clone
      : applyElementMove(clone, options.offset, options.offset);
    const inserted = insertElementAtEnd(nextSlide, address, positioned);
    if (inserted === null) continue;
    nextSlide = inserted.slide;
    keys.push(`${address.root}:${inserted.keyIndexes.join("/")}`);
  }

  return keys.length > 0 ? { slide: nextSlide, keys } : null;
}

// ---------------------------------------------------------------------------
// Duplicate
// ---------------------------------------------------------------------------

/**
 * Duplicates every resolvable selection key in its own list, directly after
 * the source element, offsetting absolute targets. Flow children (inside
 * `container`/`flex`/`grid`) are inserted unoffset — the layout places them.
 * The container child slot has no sibling position and is skipped (recorded).
 * Answers the slide plus the clones' keys, in selection order.
 */
export function duplicateElements(
  slide: DeckSlide,
  keys: string[],
  options: { offset: number; makeId?: () => string },
): { slide: DeckSlide; keys: string[] } | null {
  if (keys.length === 0) return null;
  const makeId = options.makeId ?? defaultMakeId;
  const entries: Array<{
    key: string;
    path: ElementPath;
    element: SlideElement;
    flow: boolean;
  }> = [];
  for (const key of keys) {
    const resolved = resolveSelection(slide, key);
    if (resolved === null) continue;
    const address = listAddressOfPath(resolved.path);
    const parentPath = address === null ? null : parentPathFor(address);
    const parent =
      parentPath === null ? null : getElementAtPath(slide, parentPath);
    const flow =
      parent !== null &&
      parent !== undefined &&
      parent.type !== "group";
    entries.push({
      key,
      path: resolved.path,
      element: resolved.element,
      flow,
    });
  }
  if (entries.length === 0) return null;

  /* Group by parent list; process higher indexes first so earlier removals
     never shift a lower index that is still queued. */
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const groupKey = `${entry.path.root}:${
      listAddressOfPath(entry.path)?.parentIndexes.join("/") ?? ""
    }`;
    const group = groups.get(groupKey) ?? [];
    group.push(entry);
    groups.set(groupKey, group);
  }

  let nextSlide = slide;
  const keyMap = new Map<string, string>();
  for (const group of groups.values()) {
    group.sort(
      (a, b) =>
        (b.path.indexes[b.path.indexes.length - 1] ?? 0) -
        (a.path.indexes[a.path.indexes.length - 1] ?? 0),
    );
    for (const entry of group) {
      const clone = refreshElementIds(cloneJson(entry.element), makeId);
      const positioned = entry.flow
        ? clone
        : applyElementMove(clone, options.offset, options.offset);
      const inserted = insertElementAfterPath(nextSlide, entry.path, positioned);
      if (inserted === null) continue;
      nextSlide = inserted.slide;
      keyMap.set(entry.key, inserted.key);
    }
  }

  if (keyMap.size === 0) return null;
  return {
    slide: nextSlide,
    keys: keys
      .filter((key) => keyMap.has(key))
      .map((key) => keyMap.get(key) as string),
  };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Removes every resolvable selection key. Same-list keys delete
 * highest-index-first so remaining paths stay valid; a container's child is
 * removed by clearing the slot. Returns `null` when nothing was removed (the
 * caller must not schedule a save).
 */
export function deleteElements(
  slide: DeckSlide,
  keys: string[],
): { slide: DeckSlide } | null {
  if (keys.length === 0) return null;
  const unique = [...new Set(keys)];
  const entries = unique
    .map((key) => {
      const resolved = resolveSelection(slide, key);
      return resolved === null ? null : { key, path: resolved.path };
    })
    .filter((entry): entry is { key: string; path: ElementPath } => entry !== null);
  if (entries.length === 0) return null;

  /* Deepest first, then highest index first: a parent deletion can never
     invalidate a child that still has to be removed, and same-list removals
     never shift a queued lower index. */
  entries.sort((a, b) => {
    const depth = b.path.indexes.length - a.path.indexes.length;
    if (depth !== 0) return depth;
    return (
      (b.path.indexes[b.path.indexes.length - 1] ?? 0) -
      (a.path.indexes[a.path.indexes.length - 1] ?? 0)
    );
  });

  let nextSlide = slide;
  let removed = 0;
  for (const entry of entries) {
    const next = removeElementAtPath(nextSlide, entry.path);
    if (next !== null) {
      nextSlide = next;
      removed += 1;
    }
  }
  return removed > 0 ? { slide: nextSlide } : null;
}
