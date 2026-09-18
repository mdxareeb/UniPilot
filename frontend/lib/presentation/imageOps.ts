/**
 * Image element operations for the native editor (Task D3, spec §5.4 images
 * row, §6.5).
 *
 * The viewer's `ImageElement` already renders `fit`/`focus_x`/`focus_y`/
 * `crop_scale`/`border_radius`/`flip_h`/`flip_v`/`opacity` and clamps focus to
 * 0..100 and crop_scale to 1..6. Every helper here writes the same range the
 * renderer draws, so what gets stored is exactly what the stage shows — no
 * value can be persisted that would render differently after a reload.
 *
 * Pure and client-safe: each helper takes one image element and returns either
 * a new element or the same reference when nothing changed (so the editor's
 * autosave can skip a no-op commit instead of writing the same slide twice).
 */
import type { ImageElement, ImageFit } from "./types";

/** The focus range the renderer clamps into (percent, 50 = centered). */
export const IMAGE_FOCUS_MIN = 0;
export const IMAGE_FOCUS_MAX = 100;
/** The renderer's centered default for a malformed focus value. */
export const IMAGE_FOCUS_DEFAULT = 50;
/** The crop-zoom range the renderer clamps into (`ImageElement.cropScale`). */
export const IMAGE_CROP_SCALE_MIN = 1;
export const IMAGE_CROP_SCALE_MAX = 6;
/** The renderer's no-zoom default for a malformed crop scale. */
export const IMAGE_CROP_SCALE_DEFAULT = 1;

/**
 * Clamp one focus percentage: non-finite input reads as the centered default
 * (never NaN on the wire), infinities clamp to their nearest bound.
 */
export function clampImageFocus(value: number): number {
  if (Number.isNaN(value)) return IMAGE_FOCUS_DEFAULT;
  return Math.min(Math.max(value, IMAGE_FOCUS_MIN), IMAGE_FOCUS_MAX);
}

/** Clamp one crop zoom: non-finite input reads as no-zoom (the renderer's 1). */
export function clampImageCropScale(value: number): number {
  if (Number.isNaN(value)) return IMAGE_CROP_SCALE_DEFAULT;
  return Math.min(Math.max(value, IMAGE_CROP_SCALE_MIN), IMAGE_CROP_SCALE_MAX);
}

/** Writes `fit`; the same fit keeps the same element reference (a no-op). */
export function applyImageFit(
  element: ImageElement,
  fit: ImageFit,
): ImageElement {
  if (element.fit === fit) return element;
  return { ...element, fit };
}

/** One crop patch: absent fields stay, `null` clears, numbers clamp. */
export type ImageCropPatch = {
  focusX?: number | null;
  focusY?: number | null;
  cropScale?: number | null;
};

/**
 * Writes a crop patch. `focus_x`/`focus_y` clamp to 0..100 and `crop_scale` to
 * 1..6 (the renderer's ranges); an explicit `null` clears a field so a
 * previously cropped image can return to the wire's default.
 */
export function applyImageCrop(
  element: ImageElement,
  patch: ImageCropPatch,
): ImageElement {
  let next = element;
  if (patch.focusX !== undefined) {
    const focusX = patch.focusX === null ? null : clampImageFocus(patch.focusX);
    if (next.focus_x !== focusX) next = { ...next, focus_x: focusX };
  }
  if (patch.focusY !== undefined) {
    const focusY = patch.focusY === null ? null : clampImageFocus(patch.focusY);
    if (next.focus_y !== focusY) next = { ...next, focus_y: focusY };
  }
  if (patch.cropScale !== undefined) {
    const cropScale =
      patch.cropScale === null ? null : clampImageCropScale(patch.cropScale);
    if (next.crop_scale !== cropScale) next = { ...next, crop_scale: cropScale };
  }
  return next;
}

/**
 * Writes one radius value to all four corners (`border_radius` is a per-corner
 * record on the wire; the editor exposes one control). Negative and
 * non-finite input floor at 0 — a radius has no negative meaning.
 */
export function applyImageBorderRadius(
  element: ImageElement,
  radius: number,
): ImageElement {
  const value = Number.isFinite(radius) ? Math.max(radius, 0) : 0;
  const current = element.border_radius;
  if (
    current?.tl === value &&
    current?.tr === value &&
    current?.bl === value &&
    current?.br === value
  ) {
    return element;
  }
  return {
    ...element,
    border_radius: { tl: value, tr: value, bl: value, br: value },
  };
}

/** Which axis a flip toggles. */
export type ImageFlipAxis = "h" | "v";

/**
 * Flips `flip_h`/`flip_v`. Without an explicit value the axis toggles (the
 * toolbar button's behavior); an unchanged result keeps the element reference.
 */
export function applyImageFlip(
  element: ImageElement,
  axis: ImageFlipAxis,
  value?: boolean,
): ImageElement {
  const key = axis === "h" ? "flip_h" : "flip_v";
  const current = element[key] === true;
  const next = value ?? !current;
  if (next === current) return element;
  return { ...element, [key]: next };
}

/** Writes opacity (0..1, the wire's range); malformed input reads as 1. */
export function applyImageOpacity(
  element: ImageElement,
  opacity: number,
): ImageElement {
  const value = Number.isNaN(opacity) ? 1 : Math.min(Math.max(opacity, 0), 1);
  if (element.opacity === value) return element;
  return { ...element, opacity: value };
}

/**
 * Replaces the image source, keeping every style field (fit, crop, radius,
 * flips, opacity, icon flags). An empty source is refused by returning the
 * element unchanged — the editor never blanks an image by accident.
 */
export function applyImageSource(
  element: ImageElement,
  data: string,
): ImageElement {
  const next = typeof data === "string" ? data.trim() : "";
  if (next === "" || next === element.data) return element;
  return { ...element, data: next };
}
