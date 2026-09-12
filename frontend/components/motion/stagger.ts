import type { CSSProperties } from "react";

/**
 * Position of an element inside its stagger group.
 *
 * The CSS in `app/globals.css` multiplies this by the relevant `--stagger-*`
 * token, so the delay ladder is defined once there instead of as a hardcoded
 * delay per component. Index 0 is the first element and has no delay.
 */
export function motionIndex(index: number): CSSProperties {
  return { "--motion-index": index } as CSSProperties;
}
