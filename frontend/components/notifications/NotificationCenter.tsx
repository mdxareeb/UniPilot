"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { MotionPopover } from "@/components/motion/MotionPopover";
import { IconButton } from "@/components/ui/IconButton";

/** The desktop panel width (22rem); phones span the viewport minus margins. */
const NOTIFICATIONS_PANEL_WIDTH = 352;

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
 *
 * The panel is portalled to `body` and positioned from the trigger rect
 * (`fixed`, top/left/width, recomputed on resize and on any scroll). It cannot
 * stay absolutely positioned inside the rail: the rail is itself a
 * `backdrop-blur-md` element, and a backdrop filter nested inside another one
 * samples the parent's painted output instead of the page, so the panel's blur
 * would be defeated. Portalling puts it in the page's own backdrop root, where
 * the page genuinely blurs behind it.
 */
export function NotificationCenter() {
  const pathname = usePathname();
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const open = openedFor === pathname;

  /* Placement for the portalled panel, computed from the trigger rect before
     the open state flips so it renders in place on the first frame. */
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({
    visibility: "hidden",
  });

  const positionPanel = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 16;
    const width = Math.min(
      NOTIFICATIONS_PANEL_WIDTH,
      window.innerWidth - margin * 2,
    );
    const left = Math.max(
      margin,
      Math.min(rect.left, window.innerWidth - width - margin),
    );
    setPanelStyle({
      top: Math.round(rect.bottom + 8),
      left: Math.round(left),
      width: Math.round(width),
    });
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenedFor(null);
      triggerRef.current?.focus();
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target && rootRef.current?.contains(target)) return;
      /* The panel is portalled into `body`, so containment is by its own id. */
      if (target?.closest?.("[data-popover]")?.id === panelId) return;
      setOpenedFor(null);
    };

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, panelId]);

  /* Keep the portalled panel anchored while the page moves under it. */
  useEffect(() => {
    if (!open) return;
    positionPanel();
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    return () => {
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
    };
  }, [open, positionPanel]);

  return (
    <div ref={rootRef}>
      <IconButton
        ref={triggerRef}
        variant="glass"
        size="xs"
        aria-label="Notifications"
        aria-expanded={open}
        aria-controls={panelId}
        className="rounded-pill"
        onClick={() => {
          if (open) {
            setOpenedFor(null);
          } else {
            positionPanel();
            setOpenedFor(pathname);
          }
        }}
      >
        <Bell aria-hidden="true" className="size-3.5" />
      </IconButton>

      {/* `MotionPopover` unmounts the panel once its exit finishes, which is
          what keeps it out of the tab order and the accessibility tree while
          closed. `max-h` mirrors ProfileMenu's insurance: on a short viewport
          the panel scrolls inside itself instead of running off the screen.
          The panel is portalled (`fixed` from the trigger rect) so its
          `backdrop-blur-md` samples the page rather than the rail's own blurred
          output; it stays anchored through resize and scroll. */}
      <MotionPopover
        open={open}
        id={panelId}
        role="region"
        aria-label="Notifications"
        direction="down"
        portal
        style={panelStyle}
        className="fixed z-40 flex max-h-[min(20rem,calc(100dvh-10rem))] flex-col overflow-y-auto overscroll-contain rounded-card border border-border bg-glass p-4 shadow-overlay backdrop-blur-md"
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
