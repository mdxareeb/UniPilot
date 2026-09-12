"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Search, X } from "lucide-react";
import { useSignInPromptOptional } from "@/components/auth/SignInPromptProvider";
import { MotionPopover } from "@/components/motion/MotionPopover";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";

/**
 * GlobalSearch — the compact search entry point and shell for the later
 * retrieval layer.
 *
 * Scope is intentionally UI-only: an icon trigger consistent with
 * NotificationCenter/ProfileMenu, and a glass popover that reserves the chrome
 * for the real search backend (Phase 19 / 25.x). No embeddings, indexing,
 * keyword retrieval, or result fetching lives here, and no fake results are
 * ever rendered.
 *
 * Architecture mirrors NotificationCenter and ProfileMenu so the shell does not
 * diverge:
 * - open state keyed on the pathname that opened it, so navigation closes it
 *   during render without an effect watching the router
 * - Escape closes and returns focus to the trigger explicitly (the panel
 *   unmounts after its exit, so a focused input inside would otherwise be
 *   dropped)
 * - pointer press outside the root closes it, which also keeps this panel and
 *   the notification/profile/assistant panels from ever being open together
 * - `MotionPopover` unmounts the panel once its exit finishes, which keeps it
 *   out of the tab order and the accessibility tree while closed
 * - `direction="center"`: the panel is wide on every breakpoint
 *   (full-width-minus-margins on mobile, 26rem in the rail), so it reads best
 *   growing into place out of its own centre rather than out of one corner
 *   (NotificationCenter keeps `top right` — its narrow panel hangs from the
 *   bell itself)
 * - `Ctrl/Cmd + K` opens the panel and moves focus into the input — the one
 *   existing keyboard pattern acceptable for a global search entry point; it is
 *   prevented only when the same chord is used, so no browser/system shortcut
 *   is taken
 *
 * Visual discipline:
 * - `bg-glass` (60% Muted) + `backdrop-blur-md` (12px) — the same translucent
 *   surface as PrimaryWorkspaceCard and NotificationCenter after its dotted fix;
 *   one step more transparent than `bg-glass-strong` (ProfileMenu/Assistant) so
 *   the single global `bg-dotted-grid::before` canvas shows through as a faint
 *   frosted grid without a second dot layer anywhere in this component
 * - `border-border rounded-card shadow-raised` and monochrome text/border
 *   tokens — no new visual language
 * - panel is `absolute inset-x-4 top-full` relative to the sticky header root
 *   on mobile (`WorkspaceMobileNav`'s `sticky z-30` container via `lg:relative`
 *   on the wrapper), so it spans viewport minus 2rem and stays inside the
 *   isolated `bg-dotted-grid` stacking context; desktop is
 *   `lg:absolute lg:left-0` relative to the wrapper itself, so the compact
 *   panel drops from the trigger inside the rail without overcrowding the
 *   sidebar navigation
 * - inputs and chips inside stay on solid `bg-card` — only the outer shell is
 *   glass
 *
 * Future-ready boundary:
 *   The panel's content area is a single deliberate slot. Today it renders only
 *   the empty state ("Search your UniPilot workspace" / "Search across your
 *   documents, tasks, calendar and other workspace content."). The retrieval
 *   layer will later occupy the commented `{results slot}` with loading / error
 *   / result groups (documents, pages/sections, tasks, calendar/events,
 *   AI/workspace content) without changing the trigger, shell, or interaction
 *   contract. Query state is local and reset on close so reopening is
 *   predictable.
 *
 * Accessibility:
 * - trigger has meaningful name `Search` and `aria-expanded`/`aria-controls`
 * - input has an associated visible-accessible label (`<label htmlFor>` with
 *   `sr-only` text) and a visible heading that describes the purpose — both
 *   announce as "Search"
 * - focus moves into the input when opened; Escape returns it to the trigger
 * - panel is `role="dialog"` with `aria-label="Search"` and `aria-modal="false"`
 *   (popover, not a blocking modal) so it is announced as a search dialog;
 *   unmounted while closed, so no `aria-hidden` needed
 * - keyboard hint is decorative and hidden from AT
 */
export function GlobalSearch() {
  const pathname = usePathname();
  /* Inside the workspace shell this is the sign-in prompt; where the shell is
     absent the hook is null and the trigger behaves exactly as before. A guest
     pressing search gets the skippable prompt instead of a panel that claims
     to search an account they do not have. */
  const prompt = useSignInPromptOptional();
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const inputId = useId();
  const headingId = useId();
  const open = openedFor === pathname;

  // Focus input when opened; reset query when closed so reopening is predictable.
  // The panel mounts when it opens, so the input exists by the time this effect
  // runs. Fallback to DOM query covers the case where `Input`'s forwarded ref
  // is not attached in time (React 19 ref-as-prop timing).
  useEffect(() => {
    if (!open) return;
    const el =
      inputRef.current ??
      (rootRef.current?.querySelector(
        'input[type="search"]'
      ) as HTMLInputElement | null);
    el?.focus();
  }, [open]);

  useEffect(() => {
    if (open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on close so reopen is empty
    setQuery("");
  }, [open]);

  // Escape + outside pointer + focus return — same pattern as NotificationCenter.
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

  // Global `Ctrl/Cmd + K` — open and focus. Avoids stealing browser find or
  // other chords; only this exact combination is handled. Respects an input
  // already focused inside the panel (no re-open needed).
  useEffect(() => {
    const onGlobalKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        !event.altKey &&
        !event.shiftKey
      ) {
        // Don't intercept when typing in another search/input — except our own
        // panel already open, where the chord should still focus the input.
        const target = event.target as HTMLElement | null;
        const typingInOwnInput = target === inputRef.current;
        if (!open || !typingInOwnInput) {
          // A guest is prompted, and the chord falls through to the browser
          // rather than being swallowed by a panel that will not open.
          if (prompt && !prompt.requireAuth("Sign in to search your workspace.")) {
            return;
          }
          event.preventDefault();
          setOpenedFor(pathname);
        }
      }
    };

    window.addEventListener("keydown", onGlobalKeyDown);
    return () => window.removeEventListener("keydown", onGlobalKeyDown);
  }, [open, pathname, prompt]);

  const close = () => {
    setOpenedFor(null);
    triggerRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="lg:relative">
      <IconButton
        ref={triggerRef}
        variant="outline"
        size="sm"
        aria-label="Search"
        aria-expanded={open}
        aria-controls={panelId}
        className="rounded-pill"
        onClick={() => {
          if (prompt && !prompt.requireAuth("Sign in to search your workspace.")) {
            return;
          }
          setOpenedFor(open ? null : pathname);
        }}
      >
        <Search aria-hidden="true" className="size-4" />
      </IconButton>

      {/* `MotionPopover` unmounts the panel once its exit finishes, which is
           what keeps it out of the tab order and the accessibility tree while
           closed. `max-h` keeps it scrollable on short viewports. Mobile is
           `absolute inset-x-4` relative to the sticky header root — same
           containment fix as NotificationCenter — so the fixed
           `bg-dotted-grid::before` canvas shows through the translucent glass
           surface. Desktop is `lg:left-0 lg:w-[26rem]`. The single global dot
           source is never duplicated inside this panel. */}
      <MotionPopover
        open={open}
        id={panelId}
        role="dialog"
        aria-label="Search"
        aria-modal="false"
        aria-labelledby={headingId}
        direction="center"
        className="absolute inset-x-4 top-full z-10 mt-2 flex max-h-[min(20rem,calc(100dvh-10rem))] flex-col gap-5 overflow-hidden rounded-card border border-border bg-glass p-5 shadow-overlay backdrop-blur-md lg:inset-x-auto lg:left-0 lg:right-auto lg:w-[26rem] lg:max-w-[26rem]"
      >
        {/* Search field row — [ Search input ] [ × ] — no keyboard badge. */}
        <div className="flex items-center gap-3">
          <div className="relative flex min-w-0 flex-1 items-center">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-4 size-3.5 text-muted-foreground/60"
            />
            {/* Visible-accessible label: `sr-only` keeps the compact layout while
                satisfying the label association requirement; the heading below
                provides a visible description of the same purpose. */}
            <label htmlFor={inputId} className="sr-only">
              Search
            </label>
            <Input
              id={inputId}
              ref={inputRef}
              type="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Search your workspace"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              // Guard: input must not propagate Escape to the global handler
              // before this panel's own Escape handler runs — both close, but
              // this keeps focus return consistent.
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  close();
                }
              }}
              className="h-[52px] bg-card pl-11 pr-4 text-[15px] font-normal leading-none !rounded-card !border-border placeholder:text-[14px] placeholder:font-normal placeholder:text-muted-foreground/60 focus-visible:!border-border focus-visible:!ring-2 focus-visible:!ring-ring focus-visible:!ring-offset-2 focus-visible:!ring-offset-background"
              aria-describedby={headingId}
            />
          </div>

          <IconButton
            variant="outline"
            size="md"
            aria-label="Close search"
            onClick={close}
            className="shrink-0 rounded-full border-border bg-card hover:bg-muted"
          >
            <X aria-hidden="true" className="size-4" />
          </IconButton>
        </div>

        {/* Content area — future retrieval slot boundary. Today: empty state only,
            integrated into the panel rather than a separate giant card.
            No fake results are rendered regardless of query length. When the
            real search backend exists, this block will be replaced by a
            conditional rendering of loading / error / grouped results for
            documents, pages/sections, tasks, calendar/events, and other
            workspace content — without changing the shell above. */}
        <div className="flex flex-col gap-2 px-1 pb-1">
          <div className="flex flex-col gap-1">
            <h2
              id={headingId}
              className="text-[15px] font-medium leading-tight text-foreground"
            >
              Search your UniPilot workspace
            </h2>
            <p className="text-[13px] leading-[1.6] text-muted-foreground/80">
              Search across your documents, tasks, calendar and other workspace
              content.
            </p>
          </div>

          {/* Subtle hint that the surface is awaiting the Phase 19 backend —
              not a result, not a document, not a task. Keeps the panel from
              reading as broken when a query is typed before the backend exists. */}
          {query.trim().length > 0 ? (
            <p className="rounded-nested bg-muted px-3 py-2 text-label-sm leading-5 text-muted-foreground">
              Search will look across your workspace once the retrieval layer
              is connected. No results are shown in this preview.
            </p>
          ) : null}

          {/* === FUTURE BOUNDARY ===
              results slot: will render
                - loading skeleton
                - error state
                - grouped results: documents, document pages/sections, tasks,
                  calendar/events, AI/workspace content
              behind the same glass shell; query + filters will be lifted to
              a search hook/service (Phase 19 / 25.x). Do not render invented
              items here.
          */}
        </div>
      </MotionPopover>
    </div>
  );
}
