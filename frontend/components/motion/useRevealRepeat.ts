"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The replay reveal's visibility lifecycle, shared by `MotionReveal` and
 * `MotionRevealGroup`.
 *
 * Motion's viewport API (`whileInView`, `useInView`) has a single boundary and
 * no notion of which edge an element left through, so it cannot express this
 * behaviour's two requirements: hysteresis — reveal at 10% of the viewport
 * inside, reset only after the element has left *completely*, so an element
 * parked on the boundary does not flip state on every stray scroll pixel — and
 * direction — only what leaves through the bottom resets, so content above the
 * reader never replays on the way back up. This is the one place a hand-rolled
 * `IntersectionObserver` is genuinely necessary; it is the same two-observer
 * arrangement the CSS-era `RevealObserver` used, now driving Motion variants
 * instead of a data attribute.
 *
 * Lives in its own module so a section-level group and a single element share
 * exactly one implementation — two copies would be two chances to get the exit
 * direction wrong.
 */
export function useRevealRepeat(enabled: boolean) {
  const ref = useRef<HTMLElement | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;

    if (typeof IntersectionObserver === "undefined") {
      // No observer to subscribe through, so reveal on the next frame. The
      // callback keeps this out of the effect's synchronous body.
      const frame = requestAnimationFrame(() => setRevealed(true));
      return () => cancelAnimationFrame(frame);
    }

    const show = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setRevealed(true);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.01 },
    );

    const hide = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) continue;
          // `top` is negative above the viewport and roughly viewport-height
          // below it, which separates the two exit directions without reading
          // a possibly-null `rootBounds`.
          if (entry.boundingClientRect.top > 0) setRevealed(false);
        }
      },
      { threshold: 0 },
    );

    show.observe(element);
    hide.observe(element);
    return () => {
      show.disconnect();
      hide.disconnect();
    };
  }, [enabled]);

  return { ref, revealed };
}
