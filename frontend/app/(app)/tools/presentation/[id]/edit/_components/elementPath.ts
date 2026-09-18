/**
 * Element addressing for the native editor (Task C4).
 *
 * The stage renders a slide's `ui` as components → elements → nested children
 * (`container.child`, `flex|grid|group.children`). Editing has to name one of
 * those elements without touching the renderer, so every editable element gets
 * a path: which root list it lives in (`components` vs the rare root
 * `elements`), then the index chain down the tree. The helpers here are pure,
 * client-safe and immutable — the editor never mutates the loaded deck.
 *
 * Text editing is plain-text and run-preserving (spec §6.4): the editor shows
 * every run's text joined, and a write collapses the element to its first
 * run's style with the new text. LaTeX runs have no `text`; their source is
 * shown (the renderer's honest raw-run stance) and a write replaces them with
 * plain text — full run formatting is Phase D.
 */
import { isTextRun } from "@/lib/presentation/elements";
import type {
  DeckSlide,
  SlideElement,
  TextElement,
  TextRunValue,
} from "@/lib/presentation/types";

export type ElementPath = {
  /** `components` for `ui.components[i]…`, `elements` for root elements. */
  root: "components" | "elements";
  /** Index chain: component, then element, then each nested child. */
  indexes: number[];
};

export function elementPathKey(path: ElementPath): string {
  return `${path.root}:${path.indexes.join("/")}`;
}

export function parseElementPathKey(key: string): ElementPath | null {
  const [root, chain] = key.split(":", 2);
  if (root !== "components" && root !== "elements") return null;
  const indexes = (chain ?? "")
    .split("/")
    .filter((part) => part !== "")
    .map((part) => Number(part));
  if (indexes.some((index) => !Number.isInteger(index) || index < 0)) {
    return null;
  }
  return { root, indexes };
}

/** The plain text an editor shows for one run (LaTeX runs show their source). */
function runDisplayText(run: unknown): string {
  if (isTextRun(run)) return (run as { text: string }).text;
  if (
    typeof run === "object" &&
    run !== null &&
    typeof (run as { latex?: unknown }).latex === "string"
  ) {
    return (run as { latex: string }).latex;
  }
  return "";
}

/** Every run's text joined — the element's plain-text value (spec §6.4). */
export function textOfTextElement(element: TextElement): string {
  const runs = Array.isArray(element.runs) ? element.runs : [];
  return runs.map(runDisplayText).join("");
}

/** The element's runs as the wire stored them (never throws on absent). */
export function runsOfTextElement(element: TextElement): TextRunValue[] {
  return Array.isArray(element.runs) ? element.runs : [];
}

/**
 * The rich-run write (Task D2): replaces the run array as the inline editor
 * built it, leaving every other element field untouched. The caller owns run
 * semantics (`lib/presentation/textRuns`); this is the immutable wire write.
 */
export function setRunsOnElement(
  element: TextElement,
  runs: TextRunValue[],
): TextElement {
  return { ...element, runs };
}

/**
 * The run-preserving plain-text write: one run carrying the new text, styled
 * by the old first run (its font, or the element's own font when the first run
 * had none). A LaTeX first run cannot carry plain text, so it degrades to the
 * element font — the recorded §6.4 gap.
 */
export function setTextOnElement(
  element: TextElement,
  text: string,
): TextElement {
  const runs = Array.isArray(element.runs) ? element.runs : [];
  const first = runs[0];
  if (isTextRun(first)) {
    const base = { ...(first as Record<string, unknown>) };
    delete base.text;
    return { ...element, runs: [{ ...base, text } as TextRunValue] };
  }
  const font =
    (first as { font?: unknown } | undefined)?.font ?? element.font ?? null;
  return {
    ...element,
    runs: [{ text, ...(font ? { font } : {}) } as TextRunValue],
  };
}

type WalkEntry = { path: ElementPath; element: SlideElement };

/** Depth-first walk of every element under one root list. */
function walk(
  elements: SlideElement[],
  root: ElementPath["root"],
  prefix: number[],
  visit: (entry: WalkEntry) => void,
): void {
  elements.forEach((element, index) => {
    const indexes = [...prefix, index];
    visit({ path: { root, indexes }, element });
    if (element.type === "container") {
      if (element.child) {
        // A container's single child keeps its index slot at the path's tail.
        visitContainerChild(element.child, root, indexes, visit);
      }
      return;
    }
    if (
      element.type === "flex" ||
      element.type === "grid" ||
      element.type === "group"
    ) {
      if (Array.isArray(element.children)) {
        walk(element.children, root, indexes, visit);
      }
    }
  });
}

function visitContainerChild(
  child: SlideElement,
  root: ElementPath["root"],
  prefix: number[],
  visit: (entry: WalkEntry) => void,
): void {
  // The container's child occupies the next index (0) so paths stay uniform.
  visit({ path: { root, indexes: [...prefix, 0] }, element: child });
  if (child.type === "container" && child.child) {
    visitContainerChild(child.child, root, [...prefix, 0], visit);
    return;
  }
  if (
    child.type === "flex" ||
    child.type === "grid" ||
    child.type === "group"
  ) {
    if (Array.isArray(child.children)) {
      walk(child.children, root, [...prefix, 0], visit);
    }
  }
}

/** Every text element in the slide, in render order, with its path. */
export function listTextElements(
  slide: DeckSlide | null,
): Array<{ key: string; path: ElementPath; element: TextElement }> {
  if (!slide?.ui || typeof slide.ui !== "object") return [];
  const entries: Array<{ key: string; path: ElementPath; element: TextElement }> =
    [];
  const collect = ({ path, element }: WalkEntry) => {
    if (element.type !== "text") return;
    entries.push({ key: elementPathKey(path), path, element });
  };

  const components = Array.isArray(slide.ui.components)
    ? slide.ui.components
    : [];
  components.forEach((component, componentIndex) => {
    const elements = Array.isArray(component.elements)
      ? component.elements
      : [];
    walk(elements, "components", [componentIndex], collect);
  });

  if (Array.isArray(slide.ui.elements)) {
    walk(slide.ui.elements as SlideElement[], "elements", [], collect);
  }

  return entries;
}

/** The element at `path`, or null when the path no longer resolves. */
export function getElementAtPath(
  slide: DeckSlide | null,
  path: ElementPath,
): SlideElement | null {
  if (!slide?.ui || typeof slide.ui !== "object") return null;
  const first = path.indexes[0];
  if (first === undefined) return null;

  const rootList =
    path.root === "components"
      ? Array.isArray(slide.ui.components)
        ? (slide.ui.components[first]?.elements ?? [])
        : []
      : Array.isArray(slide.ui.elements)
        ? (slide.ui.elements as SlideElement[])
        : [];
  const startIndex = path.root === "components" ? 1 : 0;
  return descend(rootList, path.indexes, startIndex);
}

function descend(
  elements: SlideElement[],
  indexes: number[],
  at: number,
): SlideElement | null {
  const index = indexes[at];
  if (index === undefined) return null;
  const element = elements[index];
  if (element === undefined) return null;
  if (at === indexes.length - 1) return element;
  if (element.type === "container") {
    if (!element.child) return null;
    const next = indexes[at + 1];
    const expected = 0;
    if (next !== expected) return null;
    if (at + 1 === indexes.length - 1) return element.child;
    return descend([element.child], indexes, at + 1);
  }
  if (
    element.type === "flex" ||
    element.type === "grid" ||
    element.type === "group"
  ) {
    return descend(
      Array.isArray(element.children) ? element.children : [],
      indexes,
      at + 1,
    );
  }
  return null;
}

/** Immutably replaces the slide's element at `path` via `updater`. */
export function updateElementAtPath(
  slide: DeckSlide,
  path: ElementPath,
  updater: (element: SlideElement) => SlideElement,
): DeckSlide {
  if (!slide.ui || typeof slide.ui !== "object") return slide;

  if (path.root === "components") {
    const componentIndex = path.indexes[0];
    if (componentIndex === undefined) return slide;
    const components = Array.isArray(slide.ui.components)
      ? slide.ui.components
      : [];
    if (componentIndex >= components.length) return slide;
    const nextComponents = components.map((component, index) =>
      index === componentIndex
        ? {
            ...component,
            elements: updateList(
              component.elements ?? [],
              path.indexes,
              1,
              updater,
            ),
          }
        : component,
    );
    return { ...slide, ui: { ...slide.ui, components: nextComponents } };
  }

  const elements = Array.isArray(slide.ui.elements)
    ? (slide.ui.elements as SlideElement[])
    : [];
  return {
    ...slide,
    ui: { ...slide.ui, elements: updateList(elements, path.indexes, 0, updater) },
  };
}

function updateList(
  elements: SlideElement[],
  indexes: number[],
  at: number,
  updater: (element: SlideElement) => SlideElement,
): SlideElement[] {
  const index = indexes[at];
  if (index === undefined) return elements;
  return elements.map((element, position) => {
    if (position !== index) return element;
    if (at === indexes.length - 1) return updater(element);
    if (element.type === "container") {
      if (!element.child) return element;
      if (indexes[at + 1] !== 0) return element;
      const child =
        at + 1 === indexes.length - 1
          ? updater(element.child)
          : updateList([element.child], indexes, at + 1, updater)[0];
      return { ...element, child };
    }
    if (
      element.type === "flex" ||
      element.type === "grid" ||
      element.type === "group"
    ) {
      return {
        ...element,
        children: updateList(
          Array.isArray(element.children) ? element.children : [],
          indexes,
          at + 1,
          updater,
        ),
      };
    }
    return element;
  });
}
