/**
 * The native mirror of the Motion vocabulary (plan §E.4).
 *
 * Source of truth: `MOTION.md` and `frontend/components/motion/presets.ts`.
 * The numbers are byte-identical to the web tokens; a new animation uses one
 * of these values or adds to this file as a shared primitive — never a
 * page-local duration. Curves are exported as cubic-bezier control points;
 * components build `Easing.bezier(...)` from them.
 */

/** `--ease-out` — anything entering, exiting or responding to input. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
/** `--ease-in-out` — something moving or morphing on screen. */
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
/** `--ease-drawer` — large sliding surfaces. */
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

/** The duration tokens, in milliseconds, exactly as the web file lists them. */
export const DURATION = {
  press: 140,
  hover: 160,
  popover: 180,
  panel: 220,
  panelExit: 150,
  entrance: 400,
  reveal: 380,
  revealExit: 260,
  morph: 380,
  morphContentOut: 90,
  morphContentIn: 140,
  bar: 720,
} as const;

/** `--stagger-sm|md|lg` — position in a group comes from the slot index. */
export const STAGGER = {
  sm: 40,
  md: 60,
  lg: 80,
} as const;
