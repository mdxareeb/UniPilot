"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { MotionPopover } from "@/components/motion/MotionPopover";

type SelectSize = "sm" | "md" | "lg";

/** One row of the menu. The value is what the hidden input submits. */
type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SelectProps = {
  id?: string;
  /** Renders a hidden input under this name so forms submit unchanged. */
  name?: string;
  value: string;
  /** The chosen value, not a DOM event — this is a custom control. */
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  size?: SelectSize;
  /** Lands on the trigger, like the native select it replaces. */
  className?: string;
  disabled?: boolean;
  /** Semantic only (the hidden input cannot be required); sets `aria-required`. */
  required?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
};

/** `Input`'s classes; the chevron is in flow now, so the right padding is even. */
const baseClasses =
  "w-full rounded-base border border-border bg-card text-card-foreground transition-colors focus-visible:outline-none focus-visible:border-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

const sizeClasses: Record<SelectSize, string> = {
  sm: "h-9 pl-3 pr-3 text-label-sm",
  md: "h-11 pl-3.5 pr-3.5 text-body-md",
  lg: "h-14 pl-4 pr-4 text-body-lg",
};

/** The gap between the trigger and its menu. */
const MENU_GAP = 4;
/** The menu's tallest sensible box; placement is measured against it. */
const MENU_MAX_HEIGHT = 280;
/** Rough row height used to size the menu before it renders. */
const OPTION_HEIGHT = 40;

type MenuPosition = {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
};

/**
 * The project's dropdown: a real listbox, not the browser's.
 *
 * A native `<select>` cannot be styled where it matters — the open menu is
 * drawn by the OS, so it drops the site's surfaces, tokens and typography the
 * moment it opens. This control keeps the native select's closed look (same
 * border, radius, heights, focus ring and disabled treatment, all solid
 * `--card` per DESIGN.md) and replaces only the menu: a glass panel rendered
 * through the shared `MotionPopover` (MOTION.md's one popup transition),
 * anchored to the trigger, opening down or up by available space.
 *
 * The menu is portalled: an absolutely positioned panel is trapped by any
 * ancestor that creates a stacking context — and the app is full of them, since
 * `data-enter` and Motion entrances keep an identity-matrix transform after
 * they finish. A trapped menu paints under later siblings (the onboarding
 * Continue row taught this), so the panel is mounted with `position: fixed`
 * into the nearest `<dialog>` when the control is inside one, and into `body`
 * otherwise — the dialog's top layer for modal forms, the viewport for page
 * forms. The hidden input stays in the form either way.
 *
 * Accessibility is the ARIA combobox pattern, not a menu of buttons: focus
 * never leaves the trigger, which is `role="combobox"` with
 * `aria-expanded`/`aria-controls`/`aria-haspopup="listbox"` and
 * `aria-activedescendant` pointing at the active option; the panel is
 * `role="listbox"` and its rows are `role="option"` with `aria-selected`.
 * ArrowUp/Down, Home/End, Enter/Space, Escape (which stops propagating so an
 * enclosing dialog does not also close), Tab to leave, typeahead, and a
 * pointer press outside all behave as a reader expects. Under reduced motion
 * the panel arrives instantly — `MotionPopover` owns that — and every key
 * still works.
 *
 * Forms keep working because the control renders its own hidden input carrying
 * `name` + the selected `value`; the API stays controlled
 * (`value`/`onChange`), with `onChange` answering the value directly.
 */
export function Select({
  id,
  name,
  value,
  onChange,
  options,
  size = "md",
  className,
  disabled = false,
  required = false,
  ...aria
}: SelectProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const typeaheadRef = useRef({ query: "", at: 0 });

  const selectedIndex = options.findIndex((option) => option.value === value);
  const firstEnabled = options.findIndex((option) => !option.disabled);
  const lastEnabled = options.reduce(
    (found, option, index) => (option.disabled ? found : index),
    0,
  );

  const [open, setOpen] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [placement, setPlacement] = useState<"up" | "down">("down");
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [activeIndex, setActiveIndex] = useState(
    selectedIndex >= 0 ? selectedIndex : Math.max(0, firstEnabled),
  );

  const optionId = useCallback(
    (index: number) => `${listboxId}-option-${index}`,
    [listboxId],
  );

  /* The menu opens where the room is: below the trigger when it fits, above it
     otherwise, and capped to the space it actually has. Re-measured if the page
     (or a modal body) scrolls or resizes while it is open. */
  const positionMenu = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const wanted = Math.min(
      MENU_MAX_HEIGHT,
      options.length * OPTION_HEIGHT + 8,
    );
    const below = window.innerHeight - rect.bottom - MENU_GAP;
    const above = rect.top - MENU_GAP;
    const openUp = below < wanted && above > below;
    const maxHeight = Math.max(96, Math.min(MENU_MAX_HEIGHT, openUp ? above : below));
    setPlacement(openUp ? "up" : "down");
    setMenuPosition({
      left: rect.left,
      width: rect.width,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + MENU_GAP }
        : { top: rect.bottom + MENU_GAP }),
      maxHeight,
    });
  }, [options.length]);

  const openMenu = useCallback(
    (mode: "selected" | "first" | "last" = "selected") => {
      if (disabled || options.length === 0) return;
      setPortalTarget(triggerRef.current?.closest("dialog") ?? document.body);
      positionMenu();
      if (mode === "first") setActiveIndex(Math.max(0, firstEnabled));
      else if (mode === "last") setActiveIndex(lastEnabled);
      else
        setActiveIndex(
          selectedIndex >= 0 ? selectedIndex : Math.max(0, firstEnabled),
        );
      setOpen(true);
    },
    [disabled, firstEnabled, lastEnabled, options.length, positionMenu, selectedIndex],
  );

  const closeMenu = useCallback(() => setOpen(false), []);

  const commit = useCallback(
    (option: SelectOption | undefined) => {
      if (!option || option.disabled) return;
      if (option.value !== value) onChange(option.value);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [onChange, value],
  );

  const move = useCallback(
    (delta: number) => {
      const count = options.length;
      let index = activeIndex;
      for (let step = 0; step < count; step += 1) {
        index = (index + delta + count) % count;
        if (!options[index].disabled) {
          setActiveIndex(index);
          return;
        }
      }
    },
    [activeIndex, options],
  );

  /* Typeahead: printable keys accumulate into a query, then jump to the first
     option whose label starts with it. A single key cycles forwards from the
     active row; a longer query searches from the top. */
  const typeahead = useCallback(
    (key: string) => {
      const state = typeaheadRef.current;
      const now = Date.now();
      state.query = now - state.at < 600 ? state.query + key : key;
      state.at = now;
      const query = state.query.toLowerCase();
      const count = options.length;
      const start = state.query.length > 1 ? 0 : activeIndex + 1;
      for (let step = 0; step < count; step += 1) {
        const index = (start + step) % count;
        const option = options[index];
        if (!option.disabled && option.label.toLowerCase().startsWith(query)) {
          setActiveIndex(index);
          if (!open) openMenu("selected");
          return;
        }
      }
    },
    [activeIndex, open, openMenu, options],
  );

  /* Focus stays on the trigger while the menu is open, so the keys are all
     handled there and the active option travels by `aria-activedescendant`. */
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    const { key } = event;

    if (!open) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
        event.preventDefault();
        openMenu(key === "ArrowUp" ? "last" : "selected");
        return;
      }
      if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        openMenu("selected");
        typeahead(key);
      }
      return;
    }

    switch (key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(Math.max(0, firstEnabled));
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(lastEnabled);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(options[activeIndex]);
        break;
      case "Escape":
        /* Keep Escape for the menu: without the stop, an enclosing dialog's
           cancel handler would close the whole dialog on the same press. */
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        break;
      case "Tab":
        /* Tab leaves the field: close, commit what is already selected, and
           let focus move on. */
        setOpen(false);
        break;
      default:
        if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          typeahead(key);
        }
    }
  }

  /* A press outside both the trigger and the portalled menu closes it. */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open, positionMenu]);

  /* Keep the active row visible in a long menu. */
  useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const menuStyle: CSSProperties = menuPosition
    ? {
        left: menuPosition.left,
        width: menuPosition.width,
        ...(menuPosition.top !== undefined ? { top: menuPosition.top } : {}),
        ...(menuPosition.bottom !== undefined ? { bottom: menuPosition.bottom } : {}),
      }
    : { left: -9999, top: -9999, width: 0 };

  return (
    <div ref={rootRef} className="relative">
      {name ? <input type="hidden" name={name} value={value} readOnly /> : null}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        aria-required={required || undefined}
        aria-label={aria["aria-label"]}
        aria-labelledby={aria["aria-labelledby"]}
        aria-describedby={aria["aria-describedby"]}
        aria-invalid={aria["aria-invalid"]}
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu("selected"))}
        onKeyDown={onKeyDown}
        className={`${baseClasses} ${sizeClasses[size]} flex items-center justify-between gap-2 text-left${className ? ` ${className}` : ""}`}
      >
        <span className="min-w-0 truncate">
          {selected ? selected.label : ""}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`icon-turn size-4 shrink-0 text-muted-foreground${open ? " rotate-180" : ""}`}
        />
      </button>

      {portalTarget
        ? createPortal(
            <MotionPopover
              open={open}
              id={listboxId}
              role="listbox"
              aria-label={aria["aria-label"]}
              aria-labelledby={aria["aria-labelledby"] ?? undefined}
              direction={placement}
              className="fixed z-50"
              style={menuStyle}
            >
              <div
                ref={menuRef}
                style={{ maxHeight: menuPosition?.maxHeight ?? MENU_MAX_HEIGHT }}
                className="overflow-y-auto overscroll-contain rounded-card border border-border bg-glass p-1 shadow-overlay backdrop-blur-md"
              >
                {options.map((option, index) => {
                  const isSelected = option.value === value;
                  const isActive = index === activeIndex;
                  return (
                    <div
                      key={`${option.value}-${index}`}
                      id={optionId(index)}
                      ref={(element) => {
                        optionRefs.current[index] = element;
                      }}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={option.disabled || undefined}
                      onMouseEnter={() => {
                        if (!option.disabled) setActiveIndex(index);
                      }}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => commit(option)}
                      className={`flex min-w-0 items-center justify-between gap-2 rounded-base px-3 py-2 text-label-sm transition-colors ${
                        option.disabled
                          ? "cursor-not-allowed text-muted-foreground/50"
                          : isActive
                            ? "cursor-pointer bg-muted text-foreground"
                            : "cursor-pointer text-foreground"
                      }`}
                    >
                      <span className="min-w-0 truncate">{option.label}</span>
                      {isSelected ? (
                        <Check aria-hidden="true" className="size-3.5 shrink-0" />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </MotionPopover>,
            portalTarget,
          )
        : null}
    </div>
  );
}

export type { SelectOption, SelectProps, SelectSize };
