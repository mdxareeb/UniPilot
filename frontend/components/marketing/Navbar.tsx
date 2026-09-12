"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu, Rocket, X } from "lucide-react";
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Container } from "@/components/ui/Container";
import { IconButton } from "@/components/ui/IconButton";
import { MotionMenu, MotionMenuItem } from "@/components/motion/MotionMenu";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import {
  scrollMorphProgress,
  scrollMorphSpring,
} from "@/components/motion/presets";

const navLinks = [
  { label: "Features", anchor: "#features" },
  { label: "How it works", anchor: "#how-it-works" },
  { label: "Pricing", anchor: "#pricing" },
  { label: "Benchmarks", anchor: "#benchmarks" },
  { label: "FAQ", anchor: "#faq" },
  { label: "Dev's note", anchor: "#devs-note" },
];

/* The bar is 48px tall in both states; the only vertical change is the 16px
   top gap that appears when the pill detaches. The observer's top inset
   follows it so the active section flips at the same scroll position in
   both states. */
const BAR_HEIGHT = 48;
const PILL_GAP = 16;

/* Pill geometry: 16px inset from each viewport edge, capped at 820px. */
const PILL_INSET = 32;
const PILL_MAX_WIDTH = 820;
const PILL_RADIUS = 9999;

/* `useLayoutEffect` warns during SSR; falling back to `useEffect` there keeps
   the viewport seed ahead of the first paint with no warning. */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

type NavbarProps = {
  className?: string;
};

export function Navbar({ className }: NavbarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [pill, setPill] = useState(false);
  const reduced = useReducedMotion() ?? false;
  const { scrollY } = useScroll();
  const onHome = pathname === "/";

  /* One progress value drives the whole morph. `scrollMorphProgress` maps
     scrollY across the shared band and the spring smooths it, so fast scrolls
     read as one continuous morph. Under reduced motion the raw progress is
     used instead, so every transform lands directly on the scroll-linked
     value with no easing. */
  const rawProgress = useTransform(scrollY, scrollMorphProgress);
  const smoothProgress = useSpring(rawProgress, scrollMorphSpring);
  const progress = reduced ? rawProgress : smoothProgress;

  const y = useTransform(progress, [0, 1], [0, PILL_GAP]);
  const borderRadius = useTransform(progress, [0, 1], [0, PILL_RADIUS]);

  /* The viewport width is a MotionValue, not state: a resize recomputes the
     pixel endpoints without a React render. Until it is known (server render,
     first hydration pass) the width falls back to "100%" — the bar's resting
     width — so server HTML, the hydration render and the no-JS page all
     agree. `documentElement.clientWidth` is the fixed header's own width: it
     excludes a classic scrollbar, which `window.innerWidth` includes. */
  const viewportWidth = useMotionValue(0);
  useIsomorphicLayoutEffect(() => {
    const update = () => {
      viewportWidth.set(document.documentElement.clientWidth);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [viewportWidth]);

  /* The width interpolates in pixels between the full viewport and the pill —
     `100%` ↔ `calc()` is not interpolatable, pixel endpoints are. It animates
     the real width (not a FLIP scale), which keeps borders, type and the
     backdrop-blur surface crisp; Motion batches the one small shell's
     re-layout into rAF. */
  const width = useTransform<number, string>(
    [progress, viewportWidth],
    ([p, viewport]) => {
      if (!viewport) return "100%";
      const pillWidth = Math.min(viewport - PILL_INSET, PILL_MAX_WIDTH);
      return `${viewport + (pillWidth - viewport) * p}px`;
    }
  );

  /* The observer needs one discrete boolean to switch its top inset; it flips
     only at the threshold, never per frame, so no React state updates while
     scrolling. */
  useMotionValueEvent(progress, "change", (value) => {
    const next = value > 0.5;
    setPill((prev) => (prev === next ? prev : next));
  });

  /* The change listener never reports the position the page mounted at, so
     seed the boolean once: a load landing mid-page (or on an anchor) starts
     in the detached pill state. It reads `scrollY` directly because that seed
     is synchronous; the read is deferred to a frame so state is set from a
     subscription callback, not synchronously in the effect body. */
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setPill(scrollMorphProgress(scrollY.get()) > 0.5);
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollY]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!onHome) return;
    const sections = navLinks
      .map((link) =>
        typeof document !== "undefined"
          ? document.getElementById(link.anchor.slice(1))
          : null
      )
      .filter((section): section is HTMLElement => section !== null);
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        setActive(visible[0]?.target.id ?? null);
      },
      {
        rootMargin: `-${pill ? BAR_HEIGHT + PILL_GAP : BAR_HEIGHT}px 0px -55% 0px`,
        threshold: 0,
      }
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [onHome, pill]);

  const activeSection = onHome ? active : null;

  const linkHref = (anchor: string) =>
    onHome ? anchor : `/${anchor}`;

  const linkClasses = (anchor: string) =>
    `rounded-base px-1 py-1 text-label-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card${
      activeSection === anchor.slice(1)
        ? " text-foreground"
        : " text-muted-foreground hover:text-foreground"
    }`;

  return (
    /* Fixed at the top edge, not below it: the pill's gap is this element's
       own scroll-linked `y`, so its fixed positioning never re-anchors. */
    <motion.header
      className={`fixed inset-x-0 top-0 z-50 flex justify-center${className ? ` ${className}` : ""}`}
      style={{ y }}
    >
      {/* The wrapper's real width interpolates between the full viewport and
          the pill in direct proportion to scroll — no class swap and no FLIP,
          so the content reflows in place as the shell narrows. The drawer
          below is absolutely positioned off this wrapper, so it tracks the
          morph in both states. */}
      <motion.div className="relative w-full" style={{ width }}>
        <motion.nav
          aria-label="Main"
          className="border border-border bg-card/85 shadow-subtle backdrop-blur-md"
          style={{ borderRadius }}
        >
          <Container className="flex h-12 items-center justify-between px-4">
            <Link
              href={onHome ? "#top" : "/#top"}
              onClick={() => setOpen(false)}
              className="flex shrink-0 items-center gap-2 rounded-base text-body-lg font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            >
              <span className="flex items-center justify-center rounded-base bg-primary p-1.5 text-primary-foreground">
                <Rocket aria-hidden="true" className="size-4" />
              </span>
              UniPilot
            </Link>
            <div className="hidden min-w-0 items-center gap-2 whitespace-nowrap lg:flex">
              {navLinks.map((link) => (
                <Link
                  key={link.anchor}
                  href={linkHref(link.anchor)}
                  aria-current={
                    activeSection === link.anchor.slice(1) ? "true" : undefined
                  }
                  className={linkClasses(link.anchor)}
                >
                  {link.label}
                </Link>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <ThemeToggle />
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="hidden whitespace-nowrap rounded-pill px-2 py-1.5 text-label-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card lg:inline-flex"
              >
                Sign in
              </Link>
              {/* "Open App" navigates, so it is an anchor: middle-clickable,
                  copyable, and announced as a link like every other item
                  here. The href stays /dashboard because that route now
                  answers for itself — it is public, and renders the
                  workspace's guest state for a visitor without a session
                  instead of redirecting to /login. Nothing here needs to
                  know which of the two it will be, which is what keeps this
                  layout free of Supabase calls.

                  Prefetch is off precisely because of that. The header is
                  fixed, so this link is in view on every marketing page, and
                  /dashboard is dynamic: the default viewport prefetch would
                  render the whole workspace — session read included — once
                  per marketing page view, for a link most visitors never
                  click. */}
              <ButtonLink
                href="/dashboard"
                prefetch={false}
                size="sm"
                onClick={() => setOpen(false)}
                className="shrink-0 whitespace-nowrap"
              >
                Open App
                <ArrowRight aria-hidden="true" className="size-4" />
              </ButtonLink>
              <IconButton
                variant="outline"
                size="sm"
                aria-label={open ? "Close menu" : "Open menu"}
                aria-expanded={open}
                aria-controls="mobile-navigation"
                className="rounded-pill lg:hidden"
                onClick={() => setOpen(!open)}
              >
                {open ? (
                  <X aria-hidden="true" className="size-4" />
                ) : (
                  <Menu aria-hidden="true" className="size-4" />
                )}
              </IconButton>
            </div>
          </Container>
        </motion.nav>
        {/* The drawer animates through the shared `MotionMenu` and unmounts
            once its exit finishes, which is what keeps it out of the tab
            order and the accessibility tree while closed. It is absolutely
            positioned, so it follows the bar's width in both states — full
            bleed at the top, the pill's width when detached. */}
        <MotionMenu
          open={open}
          as="nav"
          id="mobile-navigation"
          aria-label="Mobile navigation"
          className="absolute inset-x-0 top-full mt-2 rounded-card border border-border bg-card shadow-overlay lg:hidden"
        >
          <div className="flex flex-col px-2 py-2">
            {navLinks.map((link) => (
              <MotionMenuItem key={link.anchor}>
                <Link
                  href={linkHref(link.anchor)}
                  onClick={() => setOpen(false)}
                  className="rounded-base px-3 py-2.5 text-body-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                >
                  {link.label}
                </Link>
              </MotionMenuItem>
            ))}
            <MotionMenuItem>
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="mt-2 rounded-base border-t border-border px-3 pb-2.5 pt-4 text-body-md font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                Sign in
              </Link>
            </MotionMenuItem>
          </div>
        </MotionMenu>
      </motion.div>
    </motion.header>
  );
}

export type { NavbarProps };
