"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";

/**
 * Wraps the whole app in Motion's configuration. Mounted once in the root
 * layout.
 *
 * `reducedMotion="user"` disables transform and layout animations for anyone
 * with `prefers-reduced-motion: reduce`. The shared primitives additionally
 * zero their durations through `useReducedMotion()`, so under `reduce` an
 * open, a close and a reveal all land instantly — no opacity fade either —
 * while functionality is never hidden.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
