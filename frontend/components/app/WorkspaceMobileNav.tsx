"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Rocket, X } from "lucide-react";
import { MotionMenu, MotionMenuItem } from "@/components/motion/MotionMenu";
import { IconButton } from "@/components/ui/IconButton";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { isActiveNavPath, WORKSPACE_NAV } from "./workspaceNav";

/**
 * The workspace navigation below `lg`, where there is no room for a rail.
 *
 * Built on the same architecture as the marketing navbar rather than a new one:
 * a bar with a toggle, and a drawer that animates through the shared
 * `MotionMenu` — the rows stagger in through variant propagation and leave
 * together, and the drawer unmounts once its exit finishes, which is what
 * keeps it out of the tab order and the accessibility tree while closed.
 *
 * Four ways out, because a menu that can only be closed the way it was opened is
 * a trap on a phone: the toggle, following a link, Escape, and a pointer press
 * anywhere else on the page. The last two are the assistant launcher's pattern
 * reused rather than reinvented — see the effect below.
 *
 * The routes and the active test both come from `workspaceNav`, the same module
 * the rail reads, so the two navigations cannot disagree about where the
 * workspace goes or which item owns a nested path.
 *
 * `footer` and `setupLink` arrive as server-rendered nodes — the user chip and
 * sign-out, and the completion-aware setup link — because this component is a
 * client boundary and both need the session. Passing the elements in keeps
 * those reads on the server; the setup link's own read streams inside the
 * `Suspense` boundary its caller wraps it in (Task 14.10). For a completed
 * student or a guest the boundary resolves to nothing, which is what hides the
 * row — there is no client-side condition here to disagree with the rail.
 *
 * The bar is sticky and the drawer is its sibling rather than its child: the bar
 * carries `backdrop-blur`, and an element with a backdrop filter becomes the
 * containing block for anything positioned inside it.
 */
export function WorkspaceMobileNav({
  footer,
  setupLink,
}: {
  footer: ReactNode;
  setupLink: ReactNode;
}) {
  const pathname = usePathname();
  // The drawer is open *for a route*, not open in the abstract. Storing the path
  // it was opened on means a navigation closes it during render, with no effect
  // synchronising the two — and it covers browser back and forward, not just a
  // tap on one of the links below.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const open = openedFor === pathname;

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenedFor(null);
      /* Focus is returned explicitly. The drawer unmounts after its exit, so
         a link that was focused inside it would otherwise be dropped and the
         next Tab would start from the top of the document. */
      toggleRef.current?.focus();
    };

    /* `pointerdown` on the document rather than a full-screen overlay: the drawer
       is a disclosure, not a modal, so the page behind it stays usable and the
       tap that reaches it should also do what it was aimed at. The toggle is
       inside `rootRef`, so pressing it is not an outside interaction — its own
       click handler closes the drawer a moment later.

       This is also what keeps the drawer and the assistant panel from ever being
       open together: each closes on a pointer press outside itself, and the two
       roots do not overlap. */
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpenedFor(null);
    };

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="sticky top-0 z-30 lg:hidden">
      <div className="border-b border-border bg-glass-strong backdrop-blur-md">
        <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-5">
          <Link
            href="/dashboard"
            onClick={() => setOpenedFor(null)}
            className="flex items-center gap-2 rounded-base text-body-md font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span className="flex items-center justify-center rounded-base bg-primary p-1.5 text-primary-foreground">
              <Rocket aria-hidden="true" className="size-4" />
            </span>
            UniPilot
          </Link>
          {/* `gap-2` at every width: the compact trio's 40px pointer targets
              (32px visual + 4px `::after` bleed per side) exactly abut at 8px,
              so no two hit areas overlap on a phone. */}
          <div className="flex items-center gap-2">
            <GlobalSearch />
            <NotificationCenter />
            <ThemeToggle />
            <IconButton
              ref={toggleRef}
              variant="outline"
              size="sm"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              aria-controls="mobile-navigation"
              className="rounded-pill"
              onClick={() => setOpenedFor(open ? null : pathname)}
            >
              {open ? (
                <X aria-hidden="true" className="size-4" />
              ) : (
                <Menu aria-hidden="true" className="size-4" />
              )}
            </IconButton>
          </div>
        </div>
      </div>

      {/* `max-height` rather than letting it run to its content height. The bar
          is stuck to the top, so the drawer always starts 4rem down the viewport
          (56px bar + 8px gap); reserving a further 6rem below it keeps the last
          row clear of the assistant launcher, which occupies the bottom 64px of a
          phone viewport and 80px from `sm` up. On a short viewport — a phone held
          sideways — the drawer scrolls inside itself instead of running its
          account controls off the bottom of the screen where nothing can reach
          them. `overscroll-contain` stops that scroll from continuing into the
          page underneath once it bottoms out. */}
      <MotionMenu
        open={open}
        as="nav"
        id="mobile-navigation"
        aria-label="Workspace"
        className="absolute inset-x-4 top-full mt-2 max-h-[calc(100dvh-10rem)] overflow-y-auto overscroll-contain rounded-card border border-border bg-glass-strong shadow-overlay backdrop-blur-md"
      >
        <div className="flex flex-col gap-0.5 p-2">
          {WORKSPACE_NAV.map((item) => {
            const active = isActiveNavPath(pathname, item.href);

            return (
              <MotionMenuItem key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpenedFor(null)}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-w-0 items-center gap-2.5 rounded-base px-3 py-2.5 text-body-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card${
                    active
                      ? /* `font-semibold` is the rail's own active weight, and
                           `aria-current` matches it. The row is a control, so it
                           keeps its solid `bg-muted` fill over the frosted
                           drawer — controls stay solid on every glass surface
                           (the rail's own inverted active pill is its
                           equivalent), and a `shadow-subtle` under a recessed
                           fill would read as a mistake rather than as the
                           rail's lift. */
                        " bg-muted font-semibold text-foreground"
                      : " text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <item.icon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="min-w-0 truncate">{item.label}</span>
                </Link>
              </MotionMenuItem>
            );
          })}
          <MotionMenuItem className="mt-1.5 flex px-3">
            {/* The same tier as in the rail: under the routes, muted, and
                aligned to the rows' own left edge — `flex` so the inline-flex
                link does not pick up a line box's leading. It reads as part of
                the navigation group, so the account rule below moved from `mt-1`
                to `mt-3`: the row above contributes its own 10px of padding as
                air, and matching that below is what keeps this line from
                belonging to the chip instead. Tapping it navigates; the drawer
                closes on the route change on its own.

                The node is server-owned (14.10): the completion read streams in
                and resolves to nothing for a completed student, leaving this
                row empty rather than flashing an offer they are done with. */}
            {setupLink}
          </MotionMenuItem>
          <MotionMenuItem className="mt-3 border-t border-border px-1 pt-3">
            {footer}
          </MotionMenuItem>
        </div>
      </MotionMenu>
    </div>
  );
}
