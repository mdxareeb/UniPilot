"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsRight, Search, Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useSignInPromptOptional } from "@/components/auth/SignInPromptProvider";
import { MotionPopover } from "@/components/motion/MotionPopover";
import { getTool, toolGroup } from "@/components/tools/toolCatalog";
import { Divider } from "@/components/ui/Divider";
import { IconButton } from "@/components/ui/IconButton";
import {
  morphContentIn,
  morphContentOut,
  morphTransition,
  softSpring,
} from "@/components/motion/presets";

const PANEL_ID = "unipilot-assistant-panel";
const COLLAPSED_KEY = "unipilot-assistant-collapsed";

/* The geometry the old class pairs expressed, as numbers Motion can
   interpolate. Lengths are rem-based so a non-default root font size scales
   the launcher the way the class recipe did. */
const BAR_HEIGHT_REM = 3; // h-12
const BAR_MAX_WIDTH_REM = 26; // w-[min(92%,26rem)]
const BAR_WIDTH_RATIO = 0.92;
const BUBBLE_SIZE_BASE_REM = 3; // size-12
const BUBBLE_SIZE_SM_REM = 3.5; // sm:size-14
const BUBBLE_GAP_BASE_REM = 1; // right-[calc(1rem+...)]
const BUBBLE_GAP_SM_REM = 1.5; // sm:right-6
const SM_BREAKPOINT = 640;
const SPARKLE_SIZE_BAR_REM = 1; // size-4
const SPARKLE_SIZE_BUBBLE_REM = 1.25; // size-5
/* Trailing-edge inset: shell px-4 (1rem) + minimize control size-10 (2.5rem)
   + gap-2 (0.5rem). */
const SPARKLE_TRAILING_INSET_REM = 4;

/* The same trick the navbar uses for its pixel endpoints: a layout effect
   runs before paint on the client, so the first painted frame already has
   real numeric geometry, while the server render falls back to the class
   recipe. */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

type LauncherMetrics = {
  viewportWidth: number;
  barWidth: number;
  barHeight: number;
  bubbleSize: number;
  bubbleGap: number;
  cardRadius: number;
  pillRadius: number;
  sparkleBarSize: number;
  sparkleBubbleSize: number;
  sparkleTrailingInset: number;
};

/**
 * Resolves the design tokens the morph's pixel targets need. `clientWidth` is
 * the fixed wrapper's own width — it excludes a classic scrollbar, which
 * `innerWidth` includes — and the radii are read from the tokens so the
 * breakpoint step in `--radius-card` is respected.
 */
function measureLauncher(): LauncherMetrics {
  const rootStyle = getComputedStyle(document.documentElement);
  const rootFontSize = parseFloat(rootStyle.fontSize) || 16;
  const readLength = (token: string, fallback: number) => {
    const raw = rootStyle.getPropertyValue(token).trim();
    const value = parseFloat(raw);
    if (!Number.isFinite(value)) return fallback;
    return raw.endsWith("rem") ? value * rootFontSize : value;
  };

  const viewportWidth = document.documentElement.clientWidth;
  const sm = viewportWidth >= SM_BREAKPOINT;
  const bubbleSize =
    rootFontSize * (sm ? BUBBLE_SIZE_SM_REM : BUBBLE_SIZE_BASE_REM);

  return {
    viewportWidth,
    barWidth: Math.min(
      viewportWidth * BAR_WIDTH_RATIO,
      BAR_MAX_WIDTH_REM * rootFontSize,
    ),
    barHeight: BAR_HEIGHT_REM * rootFontSize,
    bubbleSize,
    bubbleGap: rootFontSize * (sm ? BUBBLE_GAP_SM_REM : BUBBLE_GAP_BASE_REM),
    cardRadius: readLength("--radius-card", 1.25 * rootFontSize),
    /* `--radius-pill` is 9999px, but a square renders as a circle at half its
       side; animating the raw value would clamp and snap in the first frame,
       so the numeric target is the radius the pill actually renders at. */
    pillRadius: Math.min(readLength("--radius-pill", 9999), bubbleSize / 2),
    sparkleBarSize: SPARKLE_SIZE_BAR_REM * rootFontSize,
    sparkleBubbleSize: SPARKLE_SIZE_BUBBLE_REM * rootFontSize,
    sparkleTrailingInset: SPARKLE_TRAILING_INSET_REM * rootFontSize,
  };
}

/**
 * The six things people arrive wanting to do, and where in UniPilot each one
 * lives.
 *
 * They are links, not prompts. Nothing here sends a message or produces an
 * answer, because nothing behind them can yet: three go to workspace routes that
 * exist, three go to the part of the features page that explains a tool that
 * does not. A chip that opened a chat and printed a made-up reply would be the
 * one thing this panel must never do.
 *
 * The three workspace routes are guest-viewable now: opening one shows the real
 * route with an empty state rather than a redirect. The launcher itself reads
 * no session and makes no Supabase call — inside the workspace shell it asks
 * the shared sign-in prompt (a context fed by a streamed server flag), so a
 * guest opening the panel is invited to sign in; on marketing pages there is no
 * provider and the panel opens exactly as it always did.
 */
const STARTERS: readonly { label: string; href: string }[] = [
  { label: "Ask about my workspace", href: "/assistant" },
  /* Tool destinations resolve from the registry, so a renamed or moved tool
     section moves this link with it. */
  { label: "Create a presentation", href: getTool("presentation").href },
  { label: "Make flashcards", href: toolGroup("study").href },
  { label: "Generate a quiz", href: toolGroup("study").href },
  { label: "Explain a document", href: "/documents" },
  { label: "Plan my week", href: "/calendar" },
];

/**
 * The assistant launcher: a persistent search bar at the centre-bottom of
 * every page, with an explicit minimize control that condenses it into the
 * bottom-right sparkle bubble. The bubble expands the bar again when clicked.
 * Nothing collapses on a timer, and Escape never docks the bar — minimizing
 * is always a deliberate action.
 *
 * The bar and the bubble are one surface. A fixed, centre-justified wrapper
 * holds a single `motion.div` that carries the visible shell — glass, border,
 * shadow, blur — and animates its REAL `width`, `height`, `x` and
 * `borderRadius` between the two placements. This is the navbar's rule
 * (MOTION.md §"The navbar morph"): real box geometry never smears the border,
 * the type or the `backdrop-blur` the way a Motion `layout` FLIP scale does,
 * and the shell genuinely narrows each frame, clipping its contents instead
 * of scaling them. A viewport-width state, recomputed by a resize listener
 * (never per frame), supplies the pixel targets.
 *
 * Two content layers live inside the shell: the bar (search affordance,
 * minimize control and the assistant panel) and the bubble (primary fill and
 * the expand hit target). Only their opacity is animated —
 * `morphContentOut` (90ms) then `morphContentIn` (140ms, delayed by the out
 * leg) — and the layer that is not current is `inert`, so it leaves the tab
 * order, the accessibility tree and hit testing while it fades. No text is
 * ever scaled: the label truncates in place and `overflow-hidden` clips it.
 *
 * One sparkle element is shared by both states. It stays mounted and glides
 * between the bar's trailing edge and the bubble's centre on `softSpring`,
 * the spring MOTION.md reserves for shared-layout movement, while its ink
 * colour swaps with the surface arriving beneath it. Because it is never
 * unmounted or handed off between clones, it cannot blink mid-morph. This is
 * the documented fallback to a single shared element: keeping both layers
 * mounted for the `inert` guarantee rules out a `layoutId` pair.
 *
 * The bar is the default and the SSR/first-paint state on both server and
 * client, so there is no hydration disagreement; the server falls back to
 * the class geometry until the layout effect measures the viewport before
 * first paint. The collapsed choice is remembered in sessionStorage and
 * applied in an effect after mount, so a minimize survives navigation and
 * reload for the rest of the session while a fresh session starts expanded.
 *
 * The bar body opens the assistant panel above the launcher and the trailing
 * minimize control docks it; minimizing also closes an open panel. Escape
 * closes an open panel and returns focus to the bar body, and minimizing
 * hands focus to the bubble, so keyboard users are never stranded mid-morph.
 * The panel is a sibling of the shell rather than a child, because the shell
 * clips its contents; the outside-press check treats both as the launcher.
 *
 * Mounted once per shell, inside the element that carries `bg-dotted-grid`.
 * That placement is deliberate on two counts. The dotted canvas utility sets
 * `isolation: isolate`, so the shell is a stacking context — a launcher
 * mounted as its sibling would sit above the whole subtree and cover the
 * navigation no matter how low its z-index. Inside it, `z-20` lands where it
 * should: over the page and the sidebar rail (`z-10`), under the workspace's
 * mobile bar (`z-30`) and the marketing navbar and tooltips (`z-50`), and
 * clear of the workspace drawer's reserved bottom space. The launcher blocks
 * nothing — scrolling, pointer presses and keyboard travel all keep working
 * around it — and it respects `env(safe-area-inset-bottom)`.
 *
 * It also means the panel inherits the typography of whichever shell it is
 * in, which is the right outcome: Bricolage alongside marketing copy, Geist
 * inside the workspace.
 */
export function AssistantLauncher() {
  const pathname = usePathname();
  /* Null outside the workspace shell (the marketing mount), where the panel
     opens exactly as before. Inside the shell a guest is asked to sign in
     before the panel opens. */
  const prompt = useSignInPromptOptional();
  const reduced = useReducedMotion() ?? false;
  /* Keyed on the path that opened it rather than a plain boolean, so
     following a link closes the panel without an effect watching the
     router. */
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  /* The bar. True at first render on both server and client, so the bar is
     what SSR paints and there is no hydration disagreement; the mount effect
     below may then dock it from the remembered session choice. */
  const [expanded, setExpanded] = useState(true);
  const [metrics, setMetrics] = useState<LauncherMetrics | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const barBodyRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLButtonElement>(null);
  /* Which surface should receive focus once the bar↔bubble swap commits. */
  const pendingFocus = useRef<"bar" | "bubble" | null>(null);
  const open = expanded && openedFor === pathname;

  /* The morph's pixel targets. Re-measured on resize and on navigation (a
     route change can add or remove the scrollbar and change `clientWidth`),
     never per frame. */
  useIsomorphicLayoutEffect(() => {
    const update = () => setMetrics(measureLauncher());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [pathname]);

  /* Restore the session's collapsed choice after mount. The set is deferred
     to a frame so it is applied from a callback rather than synchronously in
     the effect body — and so the measured bar is the animation's origin. A
     blocked sessionStorage just means the choice is not remembered, not that
     the launcher breaks. */
  useEffect(() => {
    let collapsed = false;
    try {
      collapsed = sessionStorage.getItem(COLLAPSED_KEY) === "1";
    } catch {
      /* Ignored — the launcher stays expanded. */
    }
    if (!collapsed) return;
    const frame = requestAnimationFrame(() => setExpanded(false));
    return () => cancelAnimationFrame(frame);
  }, []);

  /* While the panel is open: Escape closes it and focus is returned
     explicitly (the panel unmounts after its exit, so anything focused
     inside it would otherwise be dropped), and a pointer press outside
     the shell and the panel closes it — which is also what keeps this panel
     and the workspace's drawer from ever being open together. Escape
     deliberately does not collapse the bar: minimizing is an explicit
     action. */
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenedFor(null);
      barBodyRef.current?.focus();
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        rootRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setOpenedFor(null);
    };

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  /* Hand focus to the surface that replaced the one that was activated, once
     the swap has committed. */
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    (target === "bar" ? barBodyRef : bubbleRef).current?.focus();
  }, [expanded]);

  const persist = (collapsed: boolean) => {
    try {
      if (collapsed) sessionStorage.setItem(COLLAPSED_KEY, "1");
      else sessionStorage.removeItem(COLLAPSED_KEY);
    } catch {
      /* Unwritable sessionStorage only means the choice is not remembered. */
    }
  };

  const minimize = () => {
    persist(true);
    setOpenedFor(null);
    pendingFocus.current = "bubble";
    setExpanded(false);
  };

  const expand = () => {
    persist(false);
    pendingFocus.current = "bar";
    setExpanded(true);
  };

  const contentTransition = (visible: boolean) =>
    reduced ? { duration: 0 } : visible ? morphContentIn : morphContentOut;

  /* Real geometry for the shell. Until the layout effect has measured the
     viewport, only `x` is animated and the class fallback carries the bar. */
  const surface = metrics
    ? expanded
      ? {
          width: metrics.barWidth,
          height: metrics.barHeight,
          x: 0,
          borderRadius: metrics.cardRadius,
        }
      : {
          width: metrics.bubbleSize,
          height: metrics.bubbleSize,
          x:
            metrics.viewportWidth / 2 -
            metrics.bubbleGap -
            metrics.bubbleSize / 2,
          borderRadius: metrics.pillRadius,
        }
    : { x: 0 };

  /* The sparkle's box, relative to the shell's top-left. Its ink colour is
     not Motion state: it comes from the `sparkle-ink` CSS behaviour so a live
     theme switch re-resolves the token without a re-measure. */
  const sparkle = metrics
    ? expanded
      ? {
          x: metrics.barWidth - metrics.sparkleTrailingInset - metrics.sparkleBarSize,
          y: (metrics.barHeight - metrics.sparkleBarSize) / 2,
          width: metrics.sparkleBarSize,
          height: metrics.sparkleBarSize,
        }
      : {
          x: (metrics.bubbleSize - metrics.sparkleBubbleSize) / 2,
          y: (metrics.bubbleSize - metrics.sparkleBubbleSize) / 2,
          width: metrics.sparkleBubbleSize,
          height: metrics.sparkleBubbleSize,
        }
    : null;

  /* The panel's right edge follows the bar's right edge, which is the inset
     the centred shell leaves on either side. */
  const panelInset = metrics
    ? Math.max(0, (metrics.viewportWidth - metrics.barWidth) / 2)
    : undefined;

  return (
    /* The fixed wrapper is only the stage: full-bleed, bottom-anchored and
       centred. It is pointer-transparent so the full-width strip outside the
       surface never blocks the page or bottom-anchored chrome; the surface and
       the panel opt back in. The surface inside it owns the geometry. */
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-20 flex justify-center">
      <motion.div
        ref={rootRef}
        initial={false}
        animate={surface}
        transition={reduced ? { duration: 0 } : morphTransition}
        className={`pointer-events-auto relative overflow-hidden border border-border bg-glass-strong shadow-floating backdrop-blur-md${
          metrics
            ? ""
            : expanded
              ? " h-12 w-[min(92%,26rem)] rounded-card"
              : " size-12 rounded-pill sm:size-14"
        }`}
      >
        {/* The bar content. Fades out first on minimize and is `inert` once
            the bubble owns the launcher. */}
        <motion.div
          initial={false}
          animate={{ opacity: expanded ? 1 : 0 }}
          transition={contentTransition(expanded)}
          inert={!expanded}
          className="absolute inset-0 flex items-center gap-2 px-4"
        >
          <button
            ref={barBodyRef}
            type="button"
            aria-label="Ask UniPilot anything — opens search and the assistant"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={PANEL_ID}
            onClick={() => {
              if (
                prompt &&
                !prompt.requireAuth(
                  "Sign in to ask the assistant about your workspace.",
                )
              ) {
                return;
              }
              setOpenedFor(open ? null : pathname);
            }}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-base font-heading text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Search
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 flex-1 truncate text-label-sm text-muted-foreground">
              Ask UniPilot anything — search your workspace...
            </span>
            {/* The shared sparkle is layered above the shell, not inside this
                button, but its space stays reserved so the truncated label
                never runs beneath it. */}
            <span aria-hidden="true" className="size-4 shrink-0" />
          </button>
          <IconButton
            variant="default"
            size="sm"
            aria-label="Minimize UniPilot search"
            onClick={minimize}
            className="rounded-pill focus-visible:ring-inset"
          >
            <ChevronsRight aria-hidden="true" className="size-4" />
          </IconButton>
        </motion.div>

        {/* The bubble content. Fills the condensing shell, so its primary
            fill follows the real geometry rather than crossfading as a
            second shape. */}
        <motion.div
          initial={false}
          animate={{ opacity: expanded ? 0 : 1 }}
          transition={contentTransition(!expanded)}
          inert={expanded}
          className="absolute inset-0"
        >
          <IconButton
            ref={bubbleRef}
            variant="primary"
            size="lg"
            aria-label="Expand UniPilot search"
            className="size-full! rounded-pill focus-visible:ring-inset"
            onClick={expand}
          />
        </motion.div>

        {/* One sparkle for both states. It is never unmounted, so it cannot
            blink during the swap; it glides on the shared spring while its
            ink colour follows the arriving surface. Before the layout effect
            has measured the viewport (server render, no-JS) a static mark
            holds the bar's trailing-edge position. */}
        {sparkle ? (
          <motion.span
            aria-hidden="true"
            initial={false}
            animate={sparkle}
            transition={reduced ? { duration: 0 } : softSpring}
            className={`sparkle-ink pointer-events-none absolute left-0 top-0 flex items-center justify-center ${
              expanded ? "text-primary" : "text-primary-foreground"
            }`}
          >
            <Sparkles className="size-full" />
          </motion.span>
        ) : (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-16 top-4 flex size-4 items-center justify-center text-primary"
          >
            <Sparkles className="size-full" />
          </span>
        )}
      </motion.div>

      {/* The assistant panel sits outside the shell, because the shell clips
          its contents. It is anchored to the bar's right edge and treated as
          part of the launcher for the outside-press check. It only renders
          while the bar is expanded, so it unmounts with the bar. */}
      <div
        ref={panelRef}
        className="pointer-events-auto absolute bottom-full mb-3"
        style={{ right: panelInset }}
      >
        <MotionPopover
          open={open}
          id={PANEL_ID}
          direction="up"
          className="flex w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto overscroll-contain rounded-card border border-border bg-glass-strong p-4 shadow-overlay backdrop-blur-md sm:w-[23rem] lg:w-[25rem] max-h-[min(28rem,calc(100dvh-10rem))]"
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-body-lg font-semibold text-foreground">
              UniPilot Assistant
            </h2>
            <p className="text-label-sm text-muted-foreground">
              Ask questions, plan your work, or create something.
            </p>
          </div>
          <Divider />
          <ul className="flex list-none flex-wrap gap-2">
            {STARTERS.map((starter) => (
              <li key={starter.label} className="min-w-0">
                {/* Prefetch off: the panel is closed on load, so six
                    destinations would be fetched for a panel most visitors
                    never open — and three of them are gated routes whose
                    prefetch would run a session read on every page view. */}
                <Link
                  href={starter.href}
                  prefetch={false}
                  onClick={() => setOpenedFor(null)}
                  className="inline-flex rounded-pill border border-border bg-card px-3 py-1.5 font-heading text-label-sm text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {starter.label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-label-sm text-muted-foreground">
            The assistant cannot answer yet. Each of these opens the part
            of UniPilot it will work from.
          </p>
        </MotionPopover>
      </div>
    </div>
  );
}
