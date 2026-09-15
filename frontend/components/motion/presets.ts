import type { Transition, Variants } from "motion/react";

/**
 * The Motion layer's shared vocabulary: every duration, curve and stagger step
 * used by `motion/react` components, defined once here.
 *
 * These values MIRROR the CSS motion tokens in `app/globals.css`
 * (`--ease-out`, `--duration-panel`, `--stagger-sm`, …). CSS cannot read this
 * file and Motion cannot read CSS variables as durations, so the two tables are
 * kept in sync by hand: retiming a behaviour means editing both. The CSS tokens
 * stay authoritative for the CSS-driven behaviours (`data-enter`,
 * `data-collapsible`, `press-feedback`, `hover-lift`, `action-arrow`,
 * `icon-turn`); this file is authoritative for everything Motion-driven.
 * See MOTION.md.
 */

/** `--ease-out` — anything entering, exiting or responding to input. */
export const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

/** `--ease-drawer` — large sliding surfaces. */
export const EASE_DRAWER: [number, number, number, number] = [0.32, 0.72, 0, 1];

/** Second values of the `--duration-*` tokens. */
export const DURATION = {
  press: 0.14,
  hover: 0.16,
  popover: 0.18,
  panel: 0.22,
  panelExit: 0.15,
  entrance: 0.4,
  reveal: 0.38,
  revealExit: 0.26,
  morph: 0.38,
  morphContentOut: 0.09,
  morphContentIn: 0.14,
  bar: 0.72,
} as const;

/**
 * The triggered surface-morph transition: a fixed element changing between
 * two placements of itself as a state change — the assistant launcher's
 * bar→bubble. Mirrors `--duration-morph`. The navbar's bar↔pill does not use
 * it: that morph is scroll-linked and continuous (see below).
 */
export const morphTransition: Transition = {
  duration: DURATION.morph,
  ease: EASE_OUT,
};

/**
 * The assistant launcher's content crossfade during the bar↔bubble morph.
 * The outgoing layer leaves first (90ms) and the incoming layer follows on a
 * delay equal to that leg, so no text is ever visible while the shell has
 * narrowed to a bubble. Mirrors `--duration-morph-content-out` /
 * `--duration-morph-content-in`.
 */
export const morphContentOut: Transition = {
  duration: DURATION.morphContentOut,
  ease: EASE_OUT,
};

export const morphContentIn: Transition = {
  duration: DURATION.morphContentIn,
  ease: EASE_OUT,
  delay: DURATION.morphContentOut,
};

/** The scroll band over which the flush bar becomes the floating pill. */
export const SCROLL_MORPH_BAND: [number, number] = [0, 64];

/**
 * Scroll offset → 0→1 morph progress. The navbar's bar↔pill is driven by
 * scroll position, not a threshold: this maps `scrollY` across
 * `SCROLL_MORPH_BAND` and clamps outside it. Everything visual — the
 * header's `y`, the wrapper's pixel `width`, the nav's `borderRadius` — is a
 * transform of this one value.
 */
export function scrollMorphProgress(scrollY: number): number {
  const [start, end] = SCROLL_MORPH_BAND;
  return Math.min(1, Math.max(0, (scrollY - start) / (end - start)));
}

/**
 * Smooths the navbar's scroll progress so fast scrolls read as one continuous
 * morph rather than stepped. `skipInitialAnimation` makes the spring adopt
 * the first real scroll position outright — the built-in behaviour for
 * `useScroll` + `useSpring` — so a refresh or back-navigation landing
 * mid-page starts in the settled state instead of morphing in from the top.
 */
export const scrollMorphSpring = {
  stiffness: 300,
  damping: 40,
  mass: 0.9,
  skipInitialAnimation: true,
} as const;

/** Second values of the `--stagger-*` tokens. */
export const STAGGER = {
  sm: 0.04,
  md: 0.06,
  lg: 0.08,
} as const;

/* --- Shared transitions ------------------------------------------------ */

export const revealIn: Transition = {
  duration: DURATION.reveal,
  ease: EASE_OUT,
};

/* --- Scroll reveal -------------------------------------------------------
   One reveal, five directions. `up` (fade + 16px rise) is the homepage's
   visual reference and the default; `down`, `left`, `right` and `scale`
   exist so neighbouring sections do not all repeat the same entrance.
   Offsets stay small — 16px on the travel axis, `scale(0.96)` + 8px rise
   for cards — so the motion reads as dimension, not decoration.

   The repeat variant carries its own transitions: the exit is quicker and
   unstaggered because the stagger exists to lead the eye in, and there is
   nothing to lead it into on the way out. */

export type RevealVariant = "up" | "down" | "left" | "right" | "scale";

/** The hidden state each reveal direction starts from. */
export const REVEAL_HIDDEN: Record<RevealVariant, Record<string, number>> = {
  up: { opacity: 0, y: 16 },
  down: { opacity: 0, y: -16 },
  left: { opacity: 0, x: -24 },
  right: { opacity: 0, x: 24 },
  scale: { opacity: 0, y: 8, scale: 0.96 },
};

export const revealVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

export function revealVariantFrom(variant: RevealVariant): Variants {
  return {
    hidden: REVEAL_HIDDEN[variant],
    visible: { opacity: 1, x: 0, y: 0, scale: 1 },
  };
}

export function revealRepeatVariants(
  index: number,
  reduced = false,
  variant: RevealVariant = "up",
): Variants {
  return {
    hidden: {
      ...REVEAL_HIDDEN[variant],
      transition: { duration: reduced ? 0 : DURATION.revealExit, ease: EASE_OUT },
    },
    visible: {
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      transition: reduced
        ? { duration: 0 }
        : { ...revealIn, delay: index * STAGGER.sm },
    },
  };
}

/* --- Section choreography --------------------------------------------------
   A section that reveals as one composition rather than as N independent
   elements: the parent is the orchestrator and animates nothing itself, and
   its children play in order through Motion's variant propagation.

   Two reasons this exists next to `MotionReveal`'s `index` prop. It is one
   observer per section instead of one per element, which is what keeps a page
   of a dozen groups off the "dozens of duplicate observers" path. And the
   order is real orchestration — a child cannot start before the parent says
   so — where per-element delays are N timers that happen to agree.

   The parent carries no transform of its own on purpose: animating a whole
   section container is the expensive case, and it would also drag the group's
   own hidden children through a second transform. */

export function revealGroupVariants(reduced = false): Variants {
  return {
    hidden: {
      transition: { staggerChildren: 0, delayChildren: 0 },
    },
    visible: {
      transition: {
        staggerChildren: reduced ? 0 : STAGGER.md,
        delayChildren: 0,
      },
    },
  };
}

/**
 * One member of a `MotionRevealGroup`. Same five directions as the standalone
 * reveal, but no delay of its own — the parent's `staggerChildren` supplies it,
 * which is what makes the order a sequence rather than a coincidence.
 */
export function revealGroupItemVariants(
  variant: RevealVariant = "up",
  reduced = false,
): Variants {
  return {
    hidden: {
      ...REVEAL_HIDDEN[variant],
      transition: { duration: reduced ? 0 : DURATION.revealExit, ease: EASE_OUT },
    },
    visible: {
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      transition: reduced ? { duration: 0 } : revealIn,
    },
  };
}

/* --- Page / route enter ---------------------------------------------------
   Fade + 6px rise: the fastest panel motion that still reads as intentional. */

export const pageEnterVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0 },
};

/* --- Popovers -----------------------------------------------------------
   Directional: a panel arriving from below its trigger (`up`) starts 8px
   lower and rises into place; one dropping from a top-bar trigger (`down`)
   starts 8px higher and settles down; a centred surface (`center`) grows in
   place. 0.97 rather than 0 — nothing in the real world appears from no
   size at all. */

export type PopoverDirection = "up" | "down" | "center";

export function popoverVariants(
  direction: PopoverDirection,
  reduced = false,
): Variants {
  const y = direction === "up" ? 8 : direction === "down" ? -8 : 0;
  return {
    hidden: {
      opacity: 0,
      y,
      scale: 0.97,
      transition: { duration: reduced ? 0 : DURATION.panelExit, ease: EASE_OUT },
    },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { duration: reduced ? 0 : DURATION.panel, ease: EASE_OUT },
    },
  };
}

/** Where a popover grows from when the caller does not set its own origin. */
export const POPOVER_ORIGIN: Record<PopoverDirection, string> = {
  up: "bottom right",
  down: "top right",
  center: "center",
};

/* --- Mobile navigation drawer ----------------------------------------------
   The parent owns the slide; the items stagger in through variant propagation
   and leave together — `staggerChildren: 0` on the way out, because a
   staggered exit makes closing feel slower than opening. */

export function menuVariants(reduced = false): Variants {
  return {
    hidden: {
      opacity: 0,
      y: -8,
      transition: {
        duration: reduced ? 0 : DURATION.panelExit,
        ease: EASE_OUT,
        staggerChildren: 0,
        delayChildren: 0,
      },
    },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: reduced ? 0 : DURATION.panel,
        ease: EASE_OUT,
        staggerChildren: reduced ? 0 : STAGGER.sm,
        delayChildren: 0,
      },
    },
  };
}

export function menuItemVariants(reduced = false): Variants {
  return {
    hidden: {
      opacity: 0,
      y: -4,
      transition: { duration: reduced ? 0 : DURATION.panelExit, ease: EASE_OUT },
    },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: reduced ? 0 : DURATION.popover,
        ease: EASE_OUT,
      },
    },
  };
}

/* --- Modal -----------------------------------------------------------------
   The scrim fades on the same panel tokens as the dialog panel so the two
   arrive and leave together. A full-viewport scrim has no origin to grow
   from, so opacity is its only property. */

export function scrimVariants(reduced = false): Variants {
  return {
    hidden: {
      opacity: 0,
      transition: { duration: reduced ? 0 : DURATION.panelExit, ease: EASE_OUT },
    },
    visible: {
      opacity: 1,
      transition: { duration: reduced ? 0 : DURATION.panel, ease: EASE_OUT },
    },
  };
}

/* --- Benchmark bars ---------------------------------------------------------
   `clip-path` fills from the left while the bar's width stays the layout
   value it always was, so the track reserves its final size and nothing
   reflows. */

export const barVariants: Variants = {
  hidden: { clipPath: "inset(0 100% 0 0)" },
  visible: { clipPath: "inset(0 0 0 0)" },
};

/* --- Onboarding steps --------------------------------------------------------
   A step change slides in from the direction of travel: forward from the
   right, back from the left. */

export function stepVariants(direction: 1 | -1): Variants {
  return {
    hidden: { opacity: 0, x: 16 * direction },
    visible: { opacity: 1, x: 0 },
  };
}

/* --- Selection / layout --------------------------------------------------------
   The one spring in the vocabulary: tight and fast, no visible overshoot.
   Reserved for shared-layout movement (`layoutId`) — selection rings and
   indicators that travel between positions. `MotionConfig reducedMotion="user"`
   disables layout animation entirely under `prefers-reduced-motion: reduce`,
   so the indicator lands instantly there. */

export const softSpring: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.8,
};

/* --- Inline notices -------------------------------------------------------------
   Auth errors, validation messages, small status lines. A 4px drop-in at
   popover speed: present without making anyone wait for the message. */

export const noticeIn: Transition = {
  duration: DURATION.popover,
  ease: EASE_OUT,
};

export const noticeVariants: Variants = {
  hidden: { opacity: 0, y: -4 },
  visible: { opacity: 1, y: 0 },
};

/* --- Progress rails ---------------------------------------------------------
   A step rail whose progress moves rather than redraws. The segment between
   two markers fills from its left edge (`scaleX` on a `left` origin, so the
   track keeps its layout width and nothing reflows — the same principle as the
   benchmark bars' `clip-path`), and the marker it arrives at scales up on the
   shared spring so the step being reached is the thing that moves. */

export const railFillVariants: Variants = {
  hidden: { scaleX: 0 },
  visible: { scaleX: 1 },
};

export const railFillIn: Transition = {
  duration: DURATION.panel,
  ease: EASE_OUT,
};

export const railMarkerVariants: Variants = {
  /* 0.72, not 0 — a marker that grows from nothing reads as appearing rather
     than as being reached, and the unreached marker is already on screen. */
  hidden: { scale: 0.72 },
  visible: { scale: 1 },
};

/* --- List items -------------------------------------------------------------------
   Rows being inserted into (or removed from) a short list — onboarding
   subjects today, task lists later. Insertion drops in from above the row's
   own position; removal is a quick fade; `layout` on the item lets the rows
   below close the gap smoothly. */

export function listItemVariants(reduced = false): Variants {
  return {
    initial: { opacity: 0, y: -6 },
    animate: { opacity: 1, y: 0 },
    /* The exit carries its own transition because it is the one leg with a
       different duration; that override is also why `reduced` has to reach in
       here rather than only zeroing the component's `transition` prop. */
    exit: {
      opacity: 0,
      transition: {
        duration: reduced ? 0 : DURATION.panelExit,
        ease: EASE_OUT,
      },
    },
  };
}

export const listItemIn: Transition = {
  duration: DURATION.panel,
  ease: EASE_OUT,
};

/* --- Status dissolve ----------------------------------------------------------
   Task 18.13's parsing → indexed change: the status word dissolves out and
   resolves back in at the same spot. A monochrome system has no dither
   palette to animate, so the honest analogue of a pixel dissolve is blur +
   opacity at a hair of scale — the word is always content (present in the
   DOM regardless of animation), and only its arrival is animated. Reduced
   motion zeroes both legs. */

export function dissolveVariants(reduced = false): Variants {
  const blurred = reduced ? "blur(0px)" : "blur(5px)";
  const scratched = reduced ? 1 : 0.98;
  return {
    initial: { opacity: 0, filter: blurred, scale: scratched },
    animate: {
      opacity: 1,
      filter: "blur(0px)",
      scale: 1,
      transition: { duration: reduced ? 0 : DURATION.panel, ease: EASE_OUT },
    },
    exit: {
      opacity: 0,
      filter: blurred,
      scale: scratched,
      transition: { duration: reduced ? 0 : DURATION.panelExit, ease: EASE_OUT },
    },
  };
}
