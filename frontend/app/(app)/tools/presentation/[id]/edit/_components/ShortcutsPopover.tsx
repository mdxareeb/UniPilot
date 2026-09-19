"use client";

/**
 * The editor's shortcuts sheet (Task D7, spec §8.3 "panels/toolbars
 * `MotionPopover`", §8.5 accessibility).
 *
 * A small, honest reference: only the shortcuts the native editor actually
 * implements are listed — element movement (arrows / Shift+arrows), the
 * fork's layering chords (Alt+J/K, Shift+Alt+J/K), group/ungroup, the D7
 * clipboard commands (Mod+C/V/D, Delete/Backspace), text-run formatting while
 * inline editing (Mod+B/I/U, Tab), Escape semantics and history (Mod+Z /
 * Mod+Shift+Z / Mod+Y). A shortcut that does not exist is not advertised.
 *
 * `MotionPopover` owns the popup transition; this component owns the dialog
 * behavior that a `role="dialog"` surface promises: focus moves into the
 * panel on open, Escape closes and returns focus to the trigger, and a press
 * outside dismisses it without stealing focus.
 *
 * Placement: the sheet is portalled to `document.body` and positioned
 * `fixed z-50` from the trigger's measured rect, clamped to the viewport.
 * The toolbar Card is a `backdrop-blur-md` stacking context, so an absolute
 * panel would paint under the rail, the stage card and the assistant bar —
 * the same reason `RunFormatToolbar`, `ChartControls` and `Select` portal
 * their panels (the editor's one popover pattern).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Keyboard } from "lucide-react";
import { MotionPopover } from "@/components/motion/MotionPopover";
import { IconButton } from "@/components/ui/IconButton";

type ShortcutRow = {
  id: string;
  keys: string[];
  label: string;
};

type ShortcutGroup = {
  title: string;
  rows: ShortcutRow[];
};

/**
 * The implemented set, grouped by surface. `Mod` stands for the platform
 * modifier the editor accepts (`metaKey || ctrlKey` everywhere).
 */
export const EDITOR_SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Elements",
    rows: [
      { id: "move", keys: ["Arrows"], label: "Move the selection 1 px" },
      {
        id: "move-large",
        keys: ["Shift", "Arrows"],
        label: "Move the selection 10 px",
      },
      { id: "z-backward", keys: ["Alt", "J"], label: "Send backward" },
      { id: "z-forward", keys: ["Alt", "K"], label: "Bring forward" },
      {
        id: "z-to-back",
        keys: ["Alt", "Shift", "J"],
        label: "Send to back",
      },
      {
        id: "z-to-front",
        keys: ["Alt", "Shift", "K"],
        label: "Bring to front",
      },
      { id: "group", keys: ["Mod", "G"], label: "Group the selection" },
      { id: "ungroup", keys: ["Mod", "Shift", "G"], label: "Ungroup" },
      { id: "copy", keys: ["Mod", "C"], label: "Copy elements" },
      { id: "paste", keys: ["Mod", "V"], label: "Paste into this slide" },
      { id: "duplicate", keys: ["Mod", "D"], label: "Duplicate the selection" },
      {
        id: "delete",
        keys: ["Delete"],
        label: "Delete the selection (Backspace too)",
      },
    ],
  },
  {
    title: "Text editing",
    rows: [
      { id: "bold", keys: ["Mod", "B"], label: "Bold the selected text" },
      { id: "italic", keys: ["Mod", "I"], label: "Italicize the selected text" },
      {
        id: "underline",
        keys: ["Mod", "U"],
        label: "Underline the selected text",
      },
      { id: "next-text", keys: ["Tab"], label: "Edit the next text element" },
      { id: "escape", keys: ["Escape"], label: "Finish editing / close a panel" },
    ],
  },
  {
    title: "Deck",
    rows: [
      { id: "undo", keys: ["Mod", "Z"], label: "Undo" },
      { id: "redo", keys: ["Mod", "Shift", "Z"], label: "Redo" },
      { id: "redo-alt", keys: ["Mod", "Y"], label: "Redo" },
    ],
  },
];

/** The panel's design width (`w-80`); clamped down on narrow viewports. */
const PANEL_WIDTH = 320;
/** The gap the sheet keeps from every viewport edge. */
const VIEWPORT_MARGIN = 8;
/** The gap between the trigger and the sheet. */
const TRIGGER_GAP = 8;

export function ShortcutsPopover() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  /**
   * Places the portalled sheet under the trigger, right-aligned, with the
   * height clamped so the scroll area always ends inside the viewport. The
   * centre of the panel is the occlusion test's probe point (a `fixed`
   * panel must stay hit-testable where the rail/stage chrome used to paint
   * over an absolute one).
   */
  const computePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(
      PANEL_WIDTH,
      window.innerWidth - VIEWPORT_MARGIN * 2,
    );
    const top = rect.bottom + TRIGGER_GAP;
    setPosition({
      left: Math.max(
        VIEWPORT_MARGIN,
        Math.min(rect.right - width, window.innerWidth - width - VIEWPORT_MARGIN),
      ),
      top,
      width,
      maxHeight: Math.max(160, window.innerHeight - top - VIEWPORT_MARGIN),
    });
  }, []);

  /** Closes the sheet; focus returns to the trigger unless asked not to. */
  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const focusFrame = window.requestAnimationFrame(() => {
      panelRef.current?.focus();
    });
    const updatePosition = () => computePosition();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target === null) return;
      if (panelRef.current?.contains(target)) return;
      if (wrapRef.current?.contains(target)) return;
      close(false);
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [close, computePosition, open]);

  return (
    <div ref={wrapRef} className="relative">
      <IconButton
        ref={triggerRef}
        type="button"
        variant="outline"
        size="sm"
        aria-label="Editor shortcuts"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-editor-shortcuts-toggle=""
        onClick={() => {
          if (open) {
            close();
          } else {
            computePosition();
            setOpen(true);
          }
        }}
      >
        <Keyboard aria-hidden="true" className="size-4" />
      </IconButton>
      <MotionPopover
        open={open}
        portal
        direction="down"
        role="dialog"
        aria-label="Editor shortcuts"
        className="fixed z-50"
        style={position ?? { left: -9999, top: -9999, width: PANEL_WIDTH }}
      >
        <div
          ref={panelRef}
          tabIndex={-1}
          data-editor-shortcuts=""
          className="overflow-y-auto rounded-card border border-border bg-glass p-3 shadow-overlay backdrop-blur-md focus-visible:outline-none"
          style={{ maxHeight: position?.maxHeight }}
        >
          <p className="mb-2 text-body-md font-medium text-foreground">
            Editor shortcuts
          </p>
          {EDITOR_SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="mt-3 first:mt-0">
              <p className="mb-1 text-label-sm text-muted-foreground">
                {group.title}
              </p>
              <ul className="flex flex-col gap-1">
                {group.rows.map((row) => (
                  <li
                    key={row.id}
                    data-editor-shortcut={row.id}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="text-label-sm text-muted-foreground">
                      {row.label}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {row.keys.map((key) => (
                        <kbd
                          key={key}
                          className="rounded-xs border border-border bg-muted px-1.5 py-0.5 font-mono text-label-sm text-foreground"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </MotionPopover>
    </div>
  );
}
