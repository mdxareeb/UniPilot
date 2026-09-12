"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { MotionPopover } from "@/components/motion/MotionPopover";
import { IconButton } from "@/components/ui/IconButton";

/**
 * Notification entry point — the bell that will own the later notification
 * system without pretending it exists yet.
 *
 * Intentionally data-free. No fetch, no store, no count, no badge, no dot.
 * The panel exists only to reserve the chrome and to tell a reader where
 * future activity will land, so later phases can provide real items without
 * moving the trigger or rethinking the shell.
 *
 * Uses the same disclosure architecture as ProfileMenu and AssistantLauncher:
 * - open state keyed on the pathname that opened it, so navigation closes it
 *   during render without an effect watching the router
 * - Escape closes and returns focus to the trigger explicitly (the panel
 *   unmounts after its exit, so focus left inside it would otherwise be
 *   dropped)
 * - a pointer press outside the root closes it, which also keeps this panel
 *   and the other two from ever being open together
 * - `MotionPopover` unmounts the panel once its exit finishes, which keeps it
 *   out of the tab order and the accessibility tree while closed; no
 *   `aria-hidden` needed
 * - `direction="down"` because the panel drops from a top-bar trigger, so it
 *   grows from the default `top right` origin (ProfileMenu is `bottom`,
 *   Assistant is `bottom right`)
 */
export function NotificationCenter() {
  const pathname = usePathname();
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const open = openedFor === pathname;

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenedFor(null);
      triggerRef.current?.focus();
    };

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
    <div ref={rootRef} className="lg:relative">
      <IconButton
        ref={triggerRef}
        variant="outline"
        size="sm"
        aria-label="Notifications"
        aria-expanded={open}
        aria-controls={panelId}
        className="rounded-pill"
        onClick={() => setOpenedFor(open ? null : pathname)}
      >
        <Bell aria-hidden="true" className="size-4" />
      </IconButton>

      {/* `MotionPopover` unmounts the panel once its exit finishes, which is
          what keeps it out of the tab order and the accessibility tree while
          closed. `max-h` mirrors ProfileMenu's insurance: on a short viewport
          the panel scrolls inside itself instead of running off the screen.

          Mobile is `absolute inset-x-4` relative to the sticky header root
          (`WorkspaceMobileNav`'s `sticky z-30` container), so the panel sits
          below the bar and spans the viewport minus 2rem — the same inset the
          mobile drawer uses. That keeps it inside the isolated `bg-dotted-grid`
          stacking context and lets the fixed dotted canvas show through the
          translucent `bg-glass` + `backdrop-blur-md` surface. `bg-glass` (60%
          Muted) is one step more transparent than `bg-glass-strong` (80% + blur)
          used for `ProfileMenu`/`Assistant` — inspection showed `bg-glass-strong`
          hid the 1.1px dots, while `bg-glass` with blur keeps them faintly
          readable and heavily softens the dashboard text behind the panel,
          giving a premium frosted hierarchy without a second dot layer. The
          single global `bg-dotted-grid::before` remains the only dot source.
          Desktop is `lg:absolute lg:left-0` relative to this wrapper, so the
          22rem panel drops from the bell inside the sidebar rail. */}
      <MotionPopover
        open={open}
        id={panelId}
        role="region"
        aria-label="Notifications"
        direction="down"
        className="absolute inset-x-4 top-full z-10 mt-2 flex max-h-[min(20rem,calc(100dvh-10rem))] flex-col overflow-y-auto overscroll-contain rounded-card border border-border bg-glass p-4 shadow-overlay backdrop-blur-md lg:inset-x-auto lg:left-0 lg:right-auto lg:w-[22rem] lg:max-w-[22rem]"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-body-md font-semibold text-foreground">
            Notifications
          </h2>
          <p className="text-label-sm font-medium text-foreground">
            You&apos;re all caught up.
          </p>
          <p className="text-label-sm leading-5 text-muted-foreground">
            New deadlines, workload alerts, document updates and other important
            activity will appear here.
          </p>
        </div>
      </MotionPopover>
    </div>
  );
}
