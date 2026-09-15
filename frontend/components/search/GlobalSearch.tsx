"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { useSignInPromptOptional } from "@/components/auth/SignInPromptProvider";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { MotionPopover } from "@/components/motion/MotionPopover";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import {
  SEARCH_QUERY_MIN_LENGTH,
  type SearchHit,
  type SemanticSearchStatus,
} from "@/lib/data/searchValues";
import { searchAction } from "@/lib/data/searchActions";

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
 *   surface as PrimaryWorkspaceCard and NotificationCenter
 * - `border-border rounded-card shadow-overlay` and monochrome text/border
 *   tokens — no new visual language
 * - the panel is portalled to `body` and positioned from the trigger rect
 *   (`fixed`, top/left/width, recomputed on resize and on any scroll). It
 *   cannot stay absolutely positioned inside the rail: the rail is itself a
 *   `backdrop-blur-md` element, and a backdrop filter nested inside another one
 *   samples the parent's painted output instead of the page, so the panel's
 *   blur would be defeated. Portalling puts it in the page's own backdrop root,
 *   where the page genuinely blurs behind it.
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
/** The desktop panel width (26rem); phones span the viewport minus margins. */
const SEARCH_PANEL_WIDTH = 416;

export function GlobalSearch() {
  const pathname = usePathname();
  const router = useRouter();
  /* Inside the workspace shell this is the sign-in prompt; where the shell is
     absent the hook is null and the trigger behaves exactly as before. A guest
     pressing search gets the skippable prompt instead of a panel that claims
     to search an account they do not have. */
  const prompt = useSignInPromptOptional();
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<{
    status: "idle" | "searching" | "ready" | "error";
    hits: SearchHit[];
    error: string | null;
    semantic: SemanticSearchStatus | null;
  }>({ status: "idle", hits: [], error: null, semantic: null });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const inputId = useId();
  const headingId = useId();
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
    const width = Math.min(SEARCH_PANEL_WIDTH, window.innerWidth - margin * 2);
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
          positionPanel();
          setOpenedFor(pathname);
        }
      }
    };

    window.addEventListener("keydown", onGlobalKeyDown);
    return () => window.removeEventListener("keydown", onGlobalKeyDown);
  }, [open, pathname, positionPanel, prompt]);

  /* 25.10 — the real retrieval call: debounce the typed query, ask the
     Server Action, and keep only the newest response. Every state write
     happens inside the timer/promise callbacks, never synchronously in the
     effect body. Queries shorter than the minimum never hit the network; the
     render path shows the empty state for them regardless of stale hits. */
  useEffect(() => {
    if (!open) return;
    const queryToRun = query.trim();
    if (queryToRun.length < SEARCH_QUERY_MIN_LENGTH) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearchState({
        status: "searching",
        hits: [],
        error: null,
        semantic: null,
      });
      const result = await searchAction(queryToRun);
      if (cancelled) return;
      if (result.error !== null) {
        setSearchState({
          status: "error",
          hits: [],
          error: result.error,
          semantic: result.semantic,
        });
      } else {
        setSearchState({
          status: "ready",
          hits: result.hits,
          error: null,
          semantic: result.semantic,
        });
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  const close = () => {
    setOpenedFor(null);
    triggerRef.current?.focus();
  };

  const trimmedQuery = query.trim();
  /* Queries below the minimum never search; stale hits from a longer query
     must not render for them. */
  const showResults = trimmedQuery.length >= SEARCH_QUERY_MIN_LENGTH;

  return (
    <div ref={rootRef}>
      <IconButton
        ref={triggerRef}
        variant="glass"
        size="xs"
        aria-label="Search"
        aria-expanded={open}
        aria-controls={panelId}
        className="rounded-pill"
        onClick={() => {
          if (prompt && !prompt.requireAuth("Sign in to search your workspace.")) {
            return;
          }
          if (open) {
            setOpenedFor(null);
          } else {
            positionPanel();
            setOpenedFor(pathname);
          }
        }}
      >
        <Search aria-hidden="true" className="size-3.5" />
      </IconButton>

      {/* `MotionPopover` unmounts the panel once its exit finishes, which is
           what keeps it out of the tab order and the accessibility tree while
           closed. `max-h` keeps it scrollable on short viewports. The panel is
           portalled (`fixed` position from the trigger rect) so its
           `backdrop-blur-md` samples the page rather than the rail's own blurred
           output; it stays anchored through resize and scroll. */}
      <MotionPopover
        open={open}
        id={panelId}
        role="dialog"
        aria-label="Search"
        aria-modal="false"
        aria-labelledby={headingId}
        direction="center"
        portal
        style={panelStyle}
        className="fixed z-40 flex max-h-[min(20rem,calc(100dvh-10rem))] flex-col gap-5 overflow-hidden rounded-card border border-border bg-glass p-5 shadow-overlay backdrop-blur-md"
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

        {/* 25.10 — the real retrieval slot. The shell above is unchanged
            (trigger, Escape/focus, Ctrl+K, glass popover); this area now
            renders loading, error, honest no-match and document hits. Each
            hit cites the document and page (25.9) and opens the 18.11 preview
            for that document — no content is rendered here, the preview owns
            safe serving. Semantic search stays keyword-only until 25.3's
            provider exists, and the quiet mode line says so. */}
        <div className="flex max-h-[min(16rem,40dvh)] flex-col gap-2 overflow-y-auto px-1 pb-1">
          <div className="flex flex-col gap-1">
            <h2
              id={headingId}
              className="text-[15px] font-medium leading-tight text-foreground"
            >
              Search your UniPilot workspace
            </h2>
            <p className="text-[13px] leading-[1.6] text-muted-foreground/80">
              Search the text of your documents. Results cite the document and
              page.
            </p>
          </div>

          {showResults && searchState.status === "searching" ? (
            <>
              <p role="status" className="sr-only">
                Searching…
              </p>
              <div aria-hidden="true" className="flex flex-col gap-2">
                <div className="h-9 rounded-nested bg-muted" />
                <div className="h-9 rounded-nested bg-muted" />
              </div>
            </>
          ) : null}

          {showResults && searchState.status === "error" ? (
            <MotionNotice
              role="alert"
              className="text-label-sm text-destructive"
            >
              {searchState.error}
            </MotionNotice>
          ) : null}

          {showResults &&
          searchState.status === "ready" &&
          searchState.hits.length === 0 ? (
            <p className="rounded-nested bg-muted px-3 py-2 text-label-sm leading-5 text-muted-foreground">
              No matches for “{trimmedQuery}”.
            </p>
          ) : null}

          {showResults &&
          searchState.status === "ready" &&
          searchState.hits.length > 0 ? (
            <ul aria-label="Search results" className="flex list-none flex-col gap-1">
              {searchState.hits.map((hit) => (
                <li key={`${hit.documentId}-${hit.chunkIndex}`}>
                  {/* A hit is document content that happens to be clickable,
                      not an action label: the fonts guard reads the explicit
                      content marker instead of forcing Bricolage. */}
                  <button
                    type="button"
                    data-search-result=""
                    data-document-id={hit.documentId}
                    data-fontprobe-role="content"
                    onClick={() => {
                      setOpenedFor(null);
                      router.push(`/documents?preview=${hit.documentId}`);
                    }}
                    className="flex w-full flex-col gap-1 rounded-nested border border-transparent px-3 py-2 text-left transition-colors hover:border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate font-heading text-label-sm text-foreground">
                        {hit.documentName}
                      </span>
                      <span className="shrink-0 font-mono text-label-caps uppercase text-muted-foreground">
                        {hit.page ? `Page ${hit.page}` : "Document"}
                      </span>
                    </span>
                    <span className="text-[13px] leading-[1.5] text-muted-foreground/80">
                      <Snippet text={hit.snippet} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {showResults && searchState.status === "ready" ? (
            <p
              data-search-mode="keyword"
              className="px-1 text-[12px] leading-5 text-muted-foreground/70"
            >
              {searchState.semantic?.available
                ? "Hybrid search."
                : "Keyword search. Semantic search isn't available yet."}
            </p>
          ) : null}
        </div>
      </MotionPopover>
    </div>
  );
}

/**
 * The snippet renderer: `[[matched term]]` markers become `<mark>` text
 * nodes. The SQL function produces the markers; everything is rendered as
 * text, so no document content is ever parsed as HTML.
 */
function Snippet({ text }: { text: string }) {
  const segments: { text: string; match: boolean }[] = [];
  const pattern = /\[\[(.+?)\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), match: false });
    }
    segments.push({ text: match[1], match: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), match: false });
  }

  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark
            key={index}
            className="bg-transparent font-medium text-foreground"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
