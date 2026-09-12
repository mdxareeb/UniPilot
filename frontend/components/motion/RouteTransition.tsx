"use client";

import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { DURATION, EASE_OUT, pageEnterVariants } from "./presets";

/**
 * RouteTransition — the only page-transition primitive in the workspace.
 *
 * Why a wrapper and not a template:
 * - `app/(app)/layout.tsx` is intentionally synchronous and never reads the
 *   session, so it persists across every navigation and can keep the shell
 *   (sidebar, mobile bar, dotted canvas, Assistant bubble) completely stable.
 * - `template.tsx` would re-mount the whole segment on every navigation and
 *   would also wrap `loading.tsx`/`error.tsx`, which we want to keep subtle and
 *   skeleton-based instead of animated as a second layer.
 * - This wrapper lives *inside* `<main>` in the layout, so only the changing
 *   page content animates. The shell, dotted canvas, sidebar (`z-10`),
 *   mobile bar (`z-30`), and Assistant (`z-20`) are siblings outside it and
 *   never receive a transform.
 *
 * Behaviour:
 * - On every `pathname` change the inner `motion.div` is remounted via `key`,
 *   which plays the shared page-enter variant (opacity 0 + 6px translateY →
 *   final). Duration is `DURATION.panel` (220ms) — the fastest panel token
 *   that still reads as intentional, matching Linear/Notion/Stripe rather
 *   than a marketing hero (400ms). Easing is `EASE_OUT`, the single default.
 * - Under `prefers-reduced-motion: reduce` the duration is zero — content
 *   appears instantly with no opacity/transform. `MotionProvider`'s
 *   `reducedMotion="user"` additionally disables transform animation at the
 *   Motion level.
 * - No exit animation is kept — the old page unmounts instantly and the new
 *   one enters softly. A true exit would require keeping the old tree mounted
 *   (e.g. AnimatePresence) and would re-introduce layout-jump and
 *   double-observer concerns. A single consistent enter covers normal
 *   navigation, back/forward, sidebar, and mobile drawer.
 * - The hidden state is Motion's `initial`, rendered identically on server
 *   and client, so there is no hydration mismatch. A `<noscript>` rule in the
 *   app layout un-hides `[data-route-transition]` when scripts never run.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const reduced = useReducedMotion() ?? false;

  return (
    <motion.div
      key={pathname}
      data-route-transition=""
      initial="hidden"
      animate="visible"
      variants={pageEnterVariants}
      transition={{ duration: reduced ? 0 : DURATION.panel, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}
