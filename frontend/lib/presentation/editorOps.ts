/**
 * Pure editor operations for the native deck editor (Task D1, spec §5.4
 * "Drag / resize / rotate | Z-order / group / ungroup", §6.3 stage
 * coordinates, §8.5 keyboard equivalents).
 *
 * Everything here is a function over the wire JSON: no DOM, no React, no
 * fetch — the same posture as `elements.ts`, so the coordinate and command
 * semantics are unit-testable and the editor components only translate
 * pointer/keyboard input into these calls. Every helper is immutable.
 *
 * Coordinate model (spec §6.3): the stage is a fixed 1280×720 canvas,
 * `component.position` offsets the component and element `position` is
 * relative to it. Vectors ignore `position`/`size` on the wire — their frame
 * is derived from `points` — so move translates their points and resize is
 * honestly unsupported for them (recorded, not faked).
 *
 * Honest decisions recorded in this module:
 * - `rotation` is a real wire field on every element base and the renderer
 *   applies it (`transformCss`), so rotate is available to every element that
 *   has a visible frame (vectors included — the renderer rotates their box).
 * - resize requires explicit `size` (the wire's own resize semantics) and is
 *   skipped for `vector` (there is nothing to resize but raw points). A
 *   rotated frame resizes in the element's local axes: the pointer delta is
 *   inverse-rotated, the axis resize runs on the unrotated box and the frame
 *   is repositioned so the rendered anchor corner stays fixed (D1b).
 * - group/ungroup use the wire's real `group` element (renderer parity in
 *   `ContainerElement.tsx`); children keep their own positions so a
 *   group/ungroup round-trip is not pixel-identical for flow children that
 *   carried no position (recorded in the D1 report).
 */
import { elementBox } from "./elements";
import type {
  DeckSlide,
  GroupElement,
  Position,
  SlideComponent,
  SlideElement,
  SlideUi,
} from "./types";

/**
 * The editor's element path vocabulary: `root` names the list the element
 * lives in (`components[i]` or the rare root `elements`), `indexes` is the
 * flat chain — component index, then element index, then one index per nested
 * child (a container's single child occupies index 0).
 */
export type ElementPath = {
  root: "components" | "elements";
  indexes: number[];
};

/** A point in stage pixels (1280×720). */
export type StagePoint = { x: number; y: number };

/** One element's stage-space frame plus where it came from. */
export type SelectionFrame = {
  key: string;
  path: ElementPath;
  frame: { x: number; y: number; width: number; height: number };
  element: SlideElement;
};

/** The eight resize handles (corners and edge midpoints). */
export type ResizeHandle =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w";

export type ElementGeometry = {
  position: Position | null;
  size: { width: number; height: number } | null;
};

/** Commands the toolbar and the keyboard both dispatch. */
export type EditorCommand =
  | { kind: "nudge"; dx: number; dy: number }
  | { kind: "z-order"; direction: ZOrderDirection }
  | { kind: "group" }
  | { kind: "ungroup" };

export type ZOrderDirection =
  | "forward"
  | "backward"
  | "to-front"
  | "to-back";

/** The engine minimum a resize may produce (fork `MIN_TRANSFORM_BOX_SIZE`). */
export const MIN_ELEMENT_SIZE = 8;

/** Resize math with no element writes: what a handle drag means in a frame. */
export type ResizeInput = {
  handle: ResizeHandle;
  frame: { x: number; y: number; width: number; height: number };
  /** Pointer movement since the gesture started, in stage pixels. */
  dx: number;
  dy: number;
  /** Shift: keep the frame's aspect ratio (corner handles). */
  keepAspectRatio?: boolean;
  /** The element's rotation (deg): the drag is composed in its local axes. */
  rotation?: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readNumber(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

/** A component-shaped carrier for root-level elements (origin 0,0). */
function rootComponent(): SlideComponent {
  return { id: "root", description: "Root elements", position: { x: 0, y: 0 }, elements: [] };
}

/** The component whose origin offsets one selection key's stage frame. */
function componentForSelection(
  slide: DeckSlide,
  key: string,
): SlideComponent {
  const parsed = parseIndexes(key);
  if (parsed !== null && parsed.root === "components") {
    const component = componentAt(slide.ui as SlideUi, parsed.indexes[0]);
    if (component !== null) return component;
  }
  return rootComponent();
}

/**
 * The deepest `(element, child list)` pair on a flat index chain: the element
 * itself is the chain's target and the list is the array its *parent* owns,
 * so a write can replace that array in place. A chain that names a component
 * (`components:2`) has no parent list — it returns `null` and the caller
 * updates the component's `elements` directly.
 */
function deepestParentList(
  slide: DeckSlide,
  path: ElementPath,
): { element: SlideElement; list: SlideElement[]; index: number } | null {
  const ui = slide.ui;
  if (ui === null || ui === undefined) return null;
  const first = path.indexes[0];
  if (first === undefined) return null;

  if (path.root === "components") {
    if (path.indexes.length === 1) return null;
    const component = componentAt(ui, first);
    if (component === null) return null;
    let list: SlideElement[] = Array.isArray(component.elements)
      ? component.elements
      : [];
    let element: SlideElement | undefined;
    for (let at = 1; at < path.indexes.length; at += 1) {
      const index = path.indexes[at];
      element = list[index];
      if (element === undefined) return null;
      if (at === path.indexes.length - 1) {
        return { element, list, index };
      }
      list = childrenOf(element) ?? [];
    }
    return null;
  }

  if (path.indexes.length === 0) return null;
  let list: SlideElement[] = Array.isArray(ui.elements)
    ? (ui.elements as SlideElement[])
    : [];
  let element: SlideElement | undefined;
  for (let at = 0; at < path.indexes.length; at += 1) {
    const index = path.indexes[at];
    element = list[index];
    if (element === undefined) return null;
    if (at === path.indexes.length - 1) {
      return { element, list, index };
    }
    list = childrenOf(element) ?? [];
  }
  return null;
}

/**
 * The element and resolved parent list behind one selection key. The key
 * format is the editor's own path vocabulary (`components:<c>/<i>…`), so the
 * helpers work without importing a parser from the app layer.
 */
export function resolveSelection(
  slide: DeckSlide | null,
  key: string,
): {
  key: string;
  path: ElementPath;
  element: SlideElement;
  list: SlideElement[];
  index: number;
} | null {
  if (slide?.ui === null || slide?.ui === undefined) return null;
  const parsed = parseIndexes(key);
  if (parsed === null) return null;
  const path: ElementPath = parsed;
  const element = getElementAtPath(slide, path);
  if (element === null) return null;

  const deepest = deepestParentList(slide, path);
  if (deepest === null) return null;
  if (deepest.element !== element) return null;
  return { key, path, element, list: deepest.list, index: deepest.index };
}

export function parseIndexes(key: string): { root: "components" | "elements"; indexes: number[] } | null {
  const [root, chain] = key.split(":", 2);
  if (root !== "components" && root !== "elements") return null;
  const indexes = (chain ?? "")
    .split("/")
    .filter((part) => part !== "")
    .map((part) => Number(part));
  if (indexes.length === 0) return null;
  if (indexes.some((index) => !Number.isInteger(index) || index < 0)) return null;
  return { root, indexes };
}

function componentAt(ui: SlideUi, index: number): SlideComponent | null {
  const components = Array.isArray(ui.components) ? ui.components : [];
  return components[index] ?? null;
}

function childrenOf(element: SlideElement | null): SlideElement[] | null {
  if (element === null) return null;
  if (element.type === "container") {
    return element.child ? [element.child] : null;
  }
  if (element.type === "flex" || element.type === "grid" || element.type === "group") {
    return Array.isArray(element.children) ? element.children : null;
  }
  return null;
}

/**
 * Walks the flat index chain to the element it names, mirroring the editor's
 * `elementPath` resolution (component list → element → nested child). Kept
 * here so this module has no dependency on the app-layer editor chunk.
 */
export function getElementAtPath(
  slide: DeckSlide | null,
  path: ElementPath,
): SlideElement | null {
  if (slide?.ui === null || slide?.ui === undefined) return null;
  const first = path.indexes[0];
  if (first === undefined) return null;
  const rootList =
    path.root === "components"
      ? (componentAt(slide.ui, first)?.elements ?? null)
      : Array.isArray(slide.ui.elements)
        ? (slide.ui.elements as SlideElement[])
        : null;
  if (rootList === null) return null;
  const start = path.root === "components" ? 1 : 0;
  let list: SlideElement[] = Array.isArray(rootList) ? rootList : [];
  let element: SlideElement | undefined;
  for (let at = start; at < path.indexes.length; at += 1) {
    element = list[path.indexes[at]];
    if (element === undefined) return null;
    if (at === path.indexes.length - 1) return element;
    list = childrenOf(element) ?? [];
  }
  return null;
}

/**
 * Immutably replaces the element at `path` via `updater` (same walk as
 * `getElementAtPath`). The slide is returned unchanged when the path no
 * longer resolves.
 */
export function updateElementAtPath(
  slide: DeckSlide,
  path: ElementPath,
  updater: (element: SlideElement) => SlideElement,
): DeckSlide {
  if (slide.ui === null || slide.ui === undefined) return slide;
  const first = path.indexes[0];
  if (first === undefined) return slide;

  if (path.root === "components") {
    const component = componentAt(slide.ui, first);
    if (component === null) return slide;
    const nextList = updateAtChain(
      Array.isArray(component.elements) ? component.elements : [],
      path.indexes,
      1,
      updater,
    );
    const components = Array.isArray(slide.ui.components) ? slide.ui.components : [];
    return {
      ...slide,
      ui: {
        ...slide.ui,
        components: components.map((candidate, index) =>
          index === first ? { ...candidate, elements: nextList } : candidate,
        ),
      },
    };
  }

  const elements = Array.isArray(slide.ui.elements)
    ? (slide.ui.elements as SlideElement[])
    : [];
  return {
    ...slide,
    ui: { ...slide.ui, elements: updateAtChain(elements, path.indexes, 0, updater) },
  };
}

function updateAtChain(
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
      if (!element.child || indexes[at + 1] !== 0) return element;
      const child =
        at + 1 === indexes.length - 1
          ? updater(element.child)
          : updateAtChain([element.child], indexes, at + 1, updater)[0];
      return { ...element, child };
    }
    if (
      element.type === "flex" ||
      element.type === "grid" ||
      element.type === "group"
    ) {
      return {
        ...element,
        children: updateAtChain(
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

/**
 * Element frames in stage pixels, in the order the keys were given.
 *
 * Uses `elementBox` rather than `elementFrame`: the box derives vectors'
 * frames from their points (and groups' from their children) and defaults a
 * missing size to 0, which is exactly what the overlay and the handles need.
 */
export function selectionFrames(
  slide: DeckSlide | null,
  keys: string[],
): SelectionFrame[] {
  const frames: SelectionFrame[] = [];
  for (const key of keys) {
    const resolved = resolveSelection(slide, key);
    if (resolved === null) continue;
    const parsed = parseIndexes(key);
    if (parsed === null) continue;
    const component =
      parsed.root === "components"
        ? (slide?.ui !== null && slide?.ui !== undefined
            ? componentAt(slide.ui, parsed.indexes[0])
            : null)
        : rootComponent();
    if (component === null) continue;
    frames.push({
      key,
      path: resolved.path,
      frame: elementStageFrame(resolved.element, component),
      element: resolved.element,
    });
  }
  return frames;
}
/** The axis-aligned union of frames; `null` for an empty list. */
export function unionFrame(
  frames: Array<{ x: number; y: number; width: number; height: number }>,
): { x: number; y: number; width: number; height: number } | null {
  if (frames.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const frame of frames) {
    minX = Math.min(minX, frame.x);
    minY = Math.min(minY, frame.y);
    maxX = Math.max(maxX, frame.x + frame.width);
    maxY = Math.max(maxY, frame.y + frame.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ---------------------------------------------------------------------------
// Move / resize / rotate
// ---------------------------------------------------------------------------

/**
 * A drag delta in stage pixels for a pointer delta in screen pixels at the
 * current stage scale (spec §6.3): the editor's `fit-width` overlay and the
 * stage share one measured scale.
 */
export function stageDelta(
  dx: number,
  dy: number,
  scale: number | null,
): { dx: number; dy: number } {
  const divisor = scale !== null && scale > 0 ? scale : 1;
  return { dx: dx / divisor, dy: dy / divisor };
}

/** The element's own geometry, read off the wire (vectors hold points). */
export function elementGeometry(element: SlideElement): ElementGeometry {
  const position: Position | null =
    isFiniteNumber(element.position?.x) && isFiniteNumber(element.position?.y)
      ? { x: element.position.x, y: element.position.y }
      : null;
  const width = readNumber(element.size?.width);
  const height = readNumber(element.size?.height);
  const size =
    width !== null && height !== null ? { width, height } : null;
  return { position, size };
}

/** Whether the wire can represent a frame resize for this element. */
export function supportsResize(element: SlideElement): boolean {
  return element.type !== "vector";
}

/**
 * Whether a frame resize is honest for this element: a non-vector whose box
 * is explicit on the wire. A rotated frame is resizable too — `resizeFrame`
 * composes the rotation in the element's local axes — so rotation no longer
 * blocks a handle.
 */
export function canFrameResize(element: SlideElement): boolean {
  return supportsResize(element) && elementGeometry(element).size !== null;
}

/** The element's stage frame: `elementBox` translated by the component origin. */
export function elementStageFrame(
  element: SlideElement,
  component: SlideComponent,
): { x: number; y: number; width: number; height: number } {
  const box = elementBox(element);
  return {
    x: (readNumber(component.position?.x) ?? 0) + box.x,
    y: (readNumber(component.position?.y) ?? 0) + box.y,
    width: box.width ?? 0,
    height: box.height ?? 0,
  };
}

/** Whether the element has a visible frame the selection layer can address. */
export function hasVisibleFrame(element: SlideElement, component: SlideComponent): boolean {
  const frame = elementStageFrame(element, component);
  return frame.width > 0 && frame.height > 0;
}

function translatePoints(element: SlideElement, dx: number, dy: number): SlideElement {
  if (element.type !== "vector") return element;
  const points = Array.isArray(element.points) ? element.points : [];
  return {
    ...element,
    points: points.map((point) =>
      isFiniteNumber(point?.x) && isFiniteNumber(point?.y)
        ? { ...point, x: point.x + dx, y: point.y + dy }
        : point,
    ),
  };
}

/** The stage canvas the editor clamps moves to (spec §6.3). */
export const STAGE_WIDTH = 1280;
export const STAGE_HEIGHT = 720;

/**
 * Moves the element by `dx`/`dy` **component-local** units, clamped so its
 * frame stays inside the 1280×720 stage: pointer drags must not push an
 * element past the canvas edge where the stage's clip would hide it.
 *
 * Each axis clamps independently and only against edges the frame currently
 * respects: an element whose frame is already outside (e.g. a decorative
 * ribbon that intentionally bleeds) keeps its overflow and may move further
 * out, while the opposite edge still stops at the canvas — so a move is never
 * turned around and nothing snaps.
 */
export function applyBoundedMove(
  element: SlideElement,
  component: SlideComponent,
  dx: number,
  dy: number,
): SlideElement {
  const frame = elementStageFrame(element, component);
  if (frame.width <= 0 || frame.height <= 0) {
    return applyElementMove(element, dx, dy);
  }
  let boundedDx = dx;
  let boundedDy = dy;
  if (frame.x >= 0) boundedDx = Math.max(boundedDx, -frame.x);
  if (frame.x + frame.width <= STAGE_WIDTH) {
    boundedDx = Math.min(boundedDx, STAGE_WIDTH - frame.width - frame.x);
  }
  if (frame.y >= 0) boundedDy = Math.max(boundedDy, -frame.y);
  if (frame.y + frame.height <= STAGE_HEIGHT) {
    boundedDy = Math.min(boundedDy, STAGE_HEIGHT - frame.height - frame.y);
  }
  return applyElementMove(element, boundedDx, boundedDy);
}

/**
 * Applies a component-local `position` delta. Vectors translate their points
 * (their renderer ignores `position`), everything else gains/updates
 * `position`.
 */
export function applyElementMove(
  element: SlideElement,
  dx: number,
  dy: number,
): SlideElement {
  if (element.type === "vector") return translatePoints(element, dx, dy);
  const position = elementGeometry(element).position ?? { x: 0, y: 0 };
  return { ...element, position: { x: position.x + dx, y: position.y + dy } };
}

/**
 * Resize math only: the frame the handle drag produces, anchored on the
 * opposite corner/edge, floored at `MIN_ELEMENT_SIZE` so a drag can never
 * invert the box. `keepAspectRatio` locks the frame's ratio on corners
 * (Shift).
 *
 * A rotated element resizes in its **local axes**: the stage-space pointer
 * delta is inverse-rotated, the axis resize runs on the unrotated box, and
 * the frame is repositioned so the rendered anchor — the handle's opposite
 * corner/edge after the renderer's center rotation (`transformCss`) — stays
 * fixed. Rotation is normalized first, so 0°/360°/−360° keep the exact D1
 * stage-axis behavior and −180° behaves as 180°.
 */
export function resizeFrame(input: ResizeInput): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const rotation = normalizeRotation(input.rotation ?? 0);
  if (rotation === 0) return resizeAxisAligned(input);

  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  /* The same drag expressed in the element's local axes (inverse rotation). */
  const localDx = input.dx * cos + input.dy * sin;
  const localDy = -input.dx * sin + input.dy * cos;
  const local = resizeAxisAligned({
    handle: input.handle,
    frame: input.frame,
    dx: localDx,
    dy: localDy,
    keepAspectRatio: input.keepAspectRatio,
  });

  const { handle, frame } = input;
  const left = handle.includes("w");
  const right = handle.includes("e");
  const top = handle.includes("n");
  const bottom = handle.includes("s");
  /* The anchored corner/edge midpoint in local coordinates, as a signed
     fraction of the size: +1 east/south of the center for a left/top handle,
     −1 for a right/bottom handle, 0 on an axis the handle does not touch. */
  const anchorX = left ? 1 : right ? -1 : 0;
  const anchorY = top ? 1 : bottom ? -1 : 0;
  const oldAnchor = {
    x: (anchorX * frame.width) / 2,
    y: (anchorY * frame.height) / 2,
  };
  const newAnchor = {
    x: (anchorX * local.width) / 2,
    y: (anchorY * local.height) / 2,
  };
  /* The rendered anchor: the old center plus the rotated local offset. */
  const center = {
    x: frame.x + frame.width / 2,
    y: frame.y + frame.height / 2,
  };
  const anchor = {
    x: center.x + cos * oldAnchor.x - sin * oldAnchor.y,
    y: center.y + sin * oldAnchor.x + cos * oldAnchor.y,
  };
  /* The new center is that anchor minus the rotated offset of the new local
     anchor from the new center, so the rendered anchor stays put. */
  const nextCenter = {
    x: anchor.x - (cos * newAnchor.x - sin * newAnchor.y),
    y: anchor.y - (sin * newAnchor.x + cos * newAnchor.y),
  };
  return {
    x: nextCenter.x - local.width / 2,
    y: nextCenter.y - local.height / 2,
    width: local.width,
    height: local.height,
  };
}

/** The unrotated (stage-axis) resize behind `resizeFrame`. */
function resizeAxisAligned(input: ResizeInput): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const { handle, frame, dx, dy } = input;
  const left = handle.includes("w");
  const right = handle.includes("e");
  const top = handle.includes("n");
  const bottom = handle.includes("s");

  let x = frame.x;
  let y = frame.y;
  let width = frame.width;
  let height = frame.height;

  if (left) {
    width = frame.width - dx;
    x = frame.x + dx;
  } else if (right) {
    width = frame.width + dx;
  }
  if (top) {
    height = frame.height - dy;
    y = frame.y + dy;
  } else if (bottom) {
    height = frame.height + dy;
  }

  if (left && width < MIN_ELEMENT_SIZE) x = frame.x + (frame.width - MIN_ELEMENT_SIZE);
  if (top && height < MIN_ELEMENT_SIZE) y = frame.y + (frame.height - MIN_ELEMENT_SIZE);
  width = Math.max(MIN_ELEMENT_SIZE, width);
  height = Math.max(MIN_ELEMENT_SIZE, height);

  if (input.keepAspectRatio === true && left !== right && top !== bottom) {
    const safeWidth = frame.width > 0 ? frame.width : MIN_ELEMENT_SIZE;
    const safeHeight = frame.height > 0 ? frame.height : MIN_ELEMENT_SIZE;
    const scale = Math.max(width / safeWidth, height / safeHeight);
    const scaledWidth = Math.max(MIN_ELEMENT_SIZE, safeWidth * scale);
    const scaledHeight = Math.max(MIN_ELEMENT_SIZE, safeHeight * scale);
    if (left) x = frame.x + frame.width - scaledWidth;
    if (top) y = frame.y + frame.height - scaledHeight;
    width = scaledWidth;
    height = scaledHeight;
  }

  return { x, y, width, height };
}

/**
 * The element after a frame resize: the element's component-local box
 * (`elementFrame` minus the component origin) is replaced by the new frame's
 * size and — when the element sat at an explicit position — its position.
 * Vectors return the element untouched (resize is unsupported for them).
 */
export function applyElementResize(
  element: SlideElement,
  component: SlideComponent,
  frame: { x: number; y: number; width: number; height: number },
): SlideElement {
  if (!supportsResize(element)) return element;
  if (elementGeometry(element).size === null) return element;
  const origin = component.position ?? { x: 0, y: 0 };
  const position = elementGeometry(element).position;
  const nextPosition =
    position === null
      ? element.position
      : { x: frame.x - (origin.x ?? 0), y: frame.y - (origin.y ?? 0) };
  return {
    ...element,
    ...(nextPosition !== undefined && nextPosition !== null
      ? { position: nextPosition }
      : {}),
    size: { width: frame.width, height: frame.height },
  };
}

/** Rotation normalized to [0, 360). */
export function normalizeRotation(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

/** The screen-angle (degrees) of a pointer around a frame's center. */
export function pointerAngle(
  frame: { x: number; y: number; width: number; height: number },
  pointer: StagePoint,
): number {
  const centerX = frame.x + frame.width / 2;
  const centerY = frame.y + frame.height / 2;
  return (Math.atan2(pointer.y - centerY, pointer.x - centerX) * 180) / Math.PI;
}

/**
 * The rotation a rotate gesture produces. `baseAngle` is the angle at which
 * the gesture started and `startRotation` the element's rotation then; the
 * handle sits above the frame, hence the +90° offset between the pointer
 * angle and the element angle.
 */
export function rotationFromGesture(input: {
  startRotation: number;
  baseAngle: number;
  pointer: StagePoint;
  frame: { x: number; y: number; width: number; height: number };
  snap?: boolean;
}): number {
  const delta = pointerAngle(input.frame, input.pointer) - input.baseAngle;
  const next = input.startRotation + delta;
  if (input.snap === true) return normalizeRotation(Math.round(next / 15) * 15);
  return normalizeRotation(next);
}

// ---------------------------------------------------------------------------
// Z-order (Alt+J / Alt+K and Shift+Alt+J/K — the fork's layering commands)
// ---------------------------------------------------------------------------

export const Z_ORDER_SHORTCUTS: Record<string, ZOrderDirection> = {
  "alt+j": "backward",
  "alt+k": "forward",
  "alt+shift+j": "to-back",
  "alt+shift+k": "to-front",
};

function reorder(
  list: SlideElement[],
  from: number,
  to: number,
): SlideElement[] | null {
  if (from === to || to < 0 || to >= list.length) return null;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Moves the selected element within its own `elements` array (one slide's
 * `ui` only — the save path is the single-slide `slide_update`). Answers the
 * slide and the selection's new key so the caller can keep the selection on
 * the same element.
 */
export function reorderSelection(
  slide: DeckSlide,
  key: string,
  direction: ZOrderDirection,
): { slide: DeckSlide; key: string } | null {
  const resolved = resolveSelection(slide, key);

  if (resolved === null) return null;
  const { path, list, index } = resolved;
  const target =
    direction === "forward"
      ? index + 1
      : direction === "backward"
        ? index - 1
        : direction === "to-front"
          ? list.length - 1
          : 0;
  const next = reorder(list, index, target);
  if (next === null) return null;
  const nextIndexes = [...path.indexes];
  nextIndexes[nextIndexes.length - 1] = target;
  const nextKey = `${path.root}:${nextIndexes.join("/")}`;
  const slideAtList = updateElementListAtPath(slide, path, next);

  if (slideAtList === null) return null;
  return { slide: slideAtList, key: nextKey };
}

/**
 * Replaces the parent array of `path` with `list` (path tail = element).
 * Two shapes exist: the parent is the root list — a component's `elements`
 * (`components:<c>/<i>`) or the slide's root `elements` — or the parent is an
 * element further up the chain (`container.child`, `flex|grid|group.children`),
 * which is rebuilt through `updateElementAtPath`.
 */
function updateElementListAtPath(
  slide: DeckSlide,
  path: ElementPath,
  list: SlideElement[],
): DeckSlide | null {
  if (slide.ui === null || slide.ui === undefined) return null;
  const parentIndexes = path.indexes.slice(0, -1);

  /* The parent is the slide's root `elements` list. */
  if (path.root === "elements" && parentIndexes.length === 0) {
    return {
      ...slide,
      ui: { ...slide.ui, elements: list } as SlideUi,
    };
  }

  /* The parent is a component: the chain is `components:<c>/<element index>`,
     so the component's whole `elements` array is replaced. */
  if (path.root === "components" && parentIndexes.length === 1) {
    const componentIndex = parentIndexes[0];
    const components = Array.isArray(slide.ui.components)
      ? slide.ui.components
      : [];
    if (components[componentIndex] === undefined) return null;
    const nextComponents = components.map((component, index) =>
      index === componentIndex ? { ...component, elements: list } : component,
    );
    return { ...slide, ui: { ...slide.ui, components: nextComponents } };
  }

  /* The parent is an element further up the chain; rebuilding it through
     `updateElementAtPath` re-derives its child array. A `container` holds
     exactly one child, so a sibling reorder cannot target it (the selection
     helpers never resolve one). */
  const parentPath: ElementPath = { root: path.root, indexes: parentIndexes };
  const parent = getElementAtPath(slide, parentPath);
  if (parent === null) return null;
  if (parent.type === "container") {
    const child = list[0];
    if (child === undefined || parent.child === null || parent.child === undefined) {
      return null;
    }
    return updateElementAtPath(slide, parentPath, () => ({
      ...parent,
      child,
    }));
  }
  if (parent.type === "flex" || parent.type === "grid" || parent.type === "group") {
    return updateElementAtPath(slide, parentPath, () => ({
      ...parent,
      children: list,
    }));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Group / ungroup
// ---------------------------------------------------------------------------

/**
 * Whether the selection can be grouped: at least two frames, all in the same
 * `elements` list (a group's children are siblings), all with real geometry.
 */
export function canGroupSelection(
  slide: DeckSlide | null,
  keys: string[],
): boolean {
  if (keys.length < 2 || slide === null) return false;
  if (new Set(keys).size !== keys.length) return false;
  const resolved = keys.map((key) => resolveSelection(slide, key));
  if (resolved.some((entry) => entry === null)) return false;
  const lists = resolved.map((entry) => entry!.list);
  const first = lists[0];
  if (!lists.every((list) => list === first)) return false;
  return framesWithComponents(slide, keys).length === keys.length;
}

function framesWithComponents(
  slide: DeckSlide,
  keys: string[],
): Array<{ key: string; frame: { x: number; y: number; width: number; height: number } }> {
  const frames: Array<{
    key: string;
    frame: { x: number; y: number; width: number; height: number };
  }> = [];
  for (const key of keys) {
    const parsed = parseIndexes(key);
    if (parsed === null || slide.ui === null || slide.ui === undefined) continue;
    const component =
      parsed.root === "components"
        ? componentAt(slide.ui, parsed.indexes[0])
        : rootComponent();
    if (component === null) continue;
    const element = getElementAtPath(slide, parsed);
    if (element === null) continue;
    frames.push({ key, frame: elementStageFrame(element, component) });
  }
  return frames;
}

/**
 * Groups the selected siblings into a wire `group` element: the group's frame
 * is the union of the selected frames, children move relative to it and the
 * group takes the layer slot of the frontmost selected element. Answers the
 * slide and the group's new key.
 */
export function groupSelection(
  slide: DeckSlide,
  keys: string[],
): { slide: DeckSlide; key: string } | null {
  if (!canGroupSelection(slide, keys)) return null;
  const resolved = keys
    .map((key) => resolveSelection(slide, key))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const first = resolved[0];
  if (first === undefined) return null;
  const list = first.list;
  const indexes = resolved
    .map((entry) => entry.index)
    .sort((a, b) => a - b);
  const entries = framesWithComponents(slide, keys);
  const byKey = new Map(entries.map((entry) => [entry.key, entry.frame]));
  const ordered = indexes.map((index) => list[index]);
  const orderedKeys = resolved
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.key);
  const frames = orderedKeys
    .map((key) => byKey.get(key))
    .filter((frame): frame is NonNullable<typeof frame> => frame !== undefined);
  const box = unionFrame(frames);
  if (box === null) return null;
  // The selection helpers answer stage frames; group boxes/children live in
  // component-local coordinates (`position` is component-relative), so the
  // component origin comes back out before the children are inset.
  const origin = componentForSelection(slide, first.key).position ?? {
    x: 0,
    y: 0,
  };
  const localX = box.x - origin.x;
  const localY = box.y - origin.y;

  const children = ordered.map((element, position) => {
    const frame = byKey.get(orderedKeys[position]) ?? { x: 0, y: 0, width: 0, height: 0 };
    const inset = {
      x: frame.x - box.x,
      y: frame.y - box.y,
    };
    if (element.type === "vector") {
      /* The group renders its children inside its own frame, so points —
         component-local at the top level — become group-local here: subtract
         the group's component-local origin so the rendered stage position is
         unchanged. (Adding it rendered the vector at origin + 2·local + p
         and corrupted it through a group→ungroup round trip.) */
      return translatePoints(element, -localX, -localY);
    }
    return { ...element, position: inset };
  });

  const group: GroupElement = {
    type: "group",
    name: "Group",
    position: { x: localX, y: localY },
    size: { width: box.width, height: box.height },
    children,
  };

  // The group takes the layer slot of the frontmost selected element: in the
  // surviving list, that is the number of elements that sat before it and
  // were not themselves selected away.
  const frontmost = indexes[indexes.length - 1];

  const kept = list.filter((_element, index) => indexes.indexOf(index) === -1);
  const belowFlags = indexes.map((index) => (index < frontmost ? 1 : 0));
  const selectedBelow = belowFlags.reduce<number>((sum, value) => sum + value, 0);
  const prefixLength = Math.max(0, frontmost - selectedBelow);

  const merged = [
    ...kept.slice(0, prefixLength),
    group,
    ...kept.slice(prefixLength),
  ];

  const slideAtList = updateElementListAtPath(slide, first.path, merged);
  if (slideAtList === null) return null;
  const parentIndexes = first.path.indexes.slice(0, -1);
  const groupKey = `${first.path.root}:${[
    ...parentIndexes,
    prefixLength,
  ].join("/")}`;

  return { slide: slideAtList, key: groupKey };
}

/** Whether the selection is exactly one wire `group` element. */
export function canUngroupSelection(
  slide: DeckSlide | null,
  keys: string[],
): boolean {
  if (keys.length !== 1 || slide === null) return false;
  const resolved = resolveSelection(slide, keys[0]);
  return resolved !== null && resolved.element.type === "group";
}

/**
 * Ungroups the selected group one level: its children splice back into the
 * parent list at the group's slot, each child's position compensated by the
 * group's own position (vectors translate their points instead). Answers the
 * slide and the exposed children's keys.
 */
export function ungroupSelection(
  slide: DeckSlide,
  key: string,
): { slide: DeckSlide; keys: string[] } | null {
  const resolved = resolveSelection(slide, key);
  if (resolved === null || resolved.element.type !== "group") return null;
  const group = resolved.element;
  const children = Array.isArray(group.children) ? group.children : [];
  if (children.length === 0) return null;
  const groupPosition = group.position ?? { x: 0, y: 0 };
  const nextChildren = children.map((child) => {
    if (child.type === "vector") {
      return translatePoints(child, groupPosition.x, groupPosition.y);
    }
    const position = elementGeometry(child).position;
    if (position === null) return { ...child, position: groupPosition };
    return {
      ...child,
      position: { x: position.x + groupPosition.x, y: position.y + groupPosition.y },
    };
  });

  const { list, index, path } = resolved;
  const nextList = [
    ...list.slice(0, index),
    ...nextChildren,
    ...list.slice(index + 1),
  ];
  const slideAtList = updateElementListAtPath(slide, path, nextList);
  if (slideAtList === null) return null;
  const parentIndexes = path.indexes.slice(0, -1);
  const childKeys = nextChildren.map(
    (_child, offset) => `${path.root}:${[...parentIndexes, index + offset].join("/")}`,
  );
  return { slide: slideAtList, keys: childKeys };
}

// ---------------------------------------------------------------------------
// Keyboard equivalents (spec §8.5): arrows move 1px / Shift 10px
// ---------------------------------------------------------------------------

export const NUDGE_STEP = 1;
export const NUDGE_STEP_LARGE = 10;

/**
 * The command an arrow key dispatches on the stage, or `null` for every other
 * key. `Shift` selects the 10px step.
 */
export function commandForArrowKey(
  key: string,
  shiftKey: boolean,
): EditorCommand | null {
  const step = shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
  switch (key) {
    case "ArrowLeft":
      return { kind: "nudge", dx: -step, dy: 0 };
    case "ArrowRight":
      return { kind: "nudge", dx: step, dy: 0 };
    case "ArrowUp":
      return { kind: "nudge", dx: 0, dy: -step };
    case "ArrowDown":
      return { kind: "nudge", dx: 0, dy: step };
    default:
      return null;
  }
}

/**
 * Whether an event target is a text field the keyboard commands must leave
 * alone (`input`/`textarea`/`select` or a contenteditable). Accepts `unknown`
 * so callers can pass `event.target` without narrowing first.
 */
export function isEditableTarget(target: unknown): boolean {
  if (target === null || typeof target !== "object") return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof element.tagName === "string" ? element.tagName.toUpperCase() : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return element.isContentEditable === true;
}
