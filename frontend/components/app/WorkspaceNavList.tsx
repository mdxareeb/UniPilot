"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { softSpring } from "@/components/motion/presets";
import { isActiveNavPath, WORKSPACE_NAV } from "./workspaceNav";

/**
 * The sidebar's route list. The one client component in the rail — everything
 * else about the rail is static, and only the active item depends on where the
 * reader is.
 *
 * Task 3.13 — the two-level active state (DESIGN.md §Two-Level Active State):
 * the primary active row is the rationed emphasis device — a fully-rounded
 * (pill) row with Inverted fill and light text/icon, marking the current
 * top-level section. Inactive stays no-fill/muted; hover is a barely-there
 * fill step (`bg-glass-subtle` — one step, not a border or shadow). The
 * rail itself has no nested tree today, so the secondary active state is
 * specified but not exercised here — no surface builds a tree it does not
 * have.
 *
 * That surface is a single shared-layout element rather than a class on
 * whichever row is current. The rail lives in `(app)/layout.tsx` and survives
 * every navigation, so one `layoutId` is enough for Motion to animate the
 * highlight from the row the reader left to the row they arrived at: the
 * selection travels down the rail instead of blinking out of one row and into
 * another. It is the same idiom as the pricing plan cards on `softSpring`, at a
 * smaller scale — which is what makes the workspace read as the same product as
 * the marketing site without borrowing its pacing.
 *
 * This is a state change on the existing travelling element, not a new
 * animation: same `layoutId`, same `softSpring`, same rounded shape — only
 * the fill, text colour and ring tokens it reads changed (MOTION.md §states
 * are not animations).
 *
 * Not `MotionSelectionRing`: that primitive draws a 2px border around a card in
 * a chooser, and the rail's active treatment is a filled row. Both are `layoutId`
 * on `softSpring`, so they share the behaviour without one pretending to be the
 * other.
 *
 * The mobile drawer deliberately does not join this group. It renders its active
 * row with `bg-muted` (see `WorkspaceMobileNav` for why an inverted fill draws
 * nothing on an already-light drawer), it is unmounted while closed, and a second
 * element claiming the same `layoutId` would hand the highlight back and forth
 * between the two navigations every time the drawer opened.
 */
export function WorkspaceNavList() {
  const pathname = usePathname();

  return (
    <nav aria-label="Workspace" className="flex flex-col gap-0.5">
      {WORKSPACE_NAV.map((item) => {
        const active = isActiveNavPath(pathname, item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            // `relative` so the highlight below can fill the row. Weight and
            // colour stay per-row: they belong to the label rather than to the
            // surface, and a travelling element cannot carry them.
            className={`relative flex min-w-0 items-center gap-2.5 rounded-pill px-2.5 py-2 text-label-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background${
              active
                ? " font-semibold text-primary-foreground"
                : " text-muted-foreground hover:bg-glass-subtle hover:text-foreground"
            }`}
          >
            {active ? (
              <motion.span
                aria-hidden="true"
                layoutId="workspace-nav-active"
                transition={softSpring}
                className="pointer-events-none absolute inset-0 rounded-pill bg-surface-inverted"
              />
            ) : null}
            {/* `relative` on both, because a positioned sibling paints above
                static content however early it appears in the markup — without
                it the highlight would cover the icon and the label it is meant
                to sit behind. */}
            <item.icon aria-hidden="true" className="relative size-4 shrink-0" />
            <span className="relative min-w-0 truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
