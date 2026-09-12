"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronUp, User, Wand2 } from "lucide-react";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { MotionPopover } from "@/components/motion/MotionPopover";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Divider } from "@/components/ui/Divider";
import { LOGIN_PATH, SIGNUP_PATH } from "@/lib/auth/constants";
import type { SessionViewer } from "@/lib/auth/viewer";

/** No team or organisation exists, so there is only one kind of workspace. */
const WORKSPACE_LABEL = "Personal workspace";

/**
 * The chip's two lines, for the trigger and the panel alike.
 *
 * Three states: a provider-supplied name, a signed-in student with none (every
 * email/password account), and a guest. The no-name signed-in state is never
 * labelled "Guest" — that word belongs to the no-session state alone, and
 * pairing it with a sign-out button would contradict itself.
 */
function chipLines({ signedIn, name }: SessionViewer): {
  title: string;
  subtitle: string;
} {
  if (name) return { title: name, subtitle: WORKSPACE_LABEL };
  if (signedIn) return { title: WORKSPACE_LABEL, subtitle: "Signed in" };
  return { title: "Guest", subtitle: "Not signed in" };
}

/**
 * The identity disc. A signed-in student gets the filled primary mark, with the
 * first character of a provider-supplied name when there is one (`Array.from`,
 * not `charAt`: a name can begin with a character outside the BMP). A guest
 * gets a muted glyph instead — a solid primary disc is how this project draws
 * an identity, and there is none to draw here.
 */
function Avatar({ viewer }: { viewer: SessionViewer }) {
  const initial = viewer.name ? Array.from(viewer.name)[0] : undefined;

  return (
    <span
      aria-hidden="true"
      className={`flex size-8 shrink-0 items-center justify-center rounded-pill font-mono text-label-caps uppercase ${
        viewer.signedIn
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-muted text-muted-foreground"
      }`}
    >
      {initial ?? <User className="size-3.5" />}
    </span>
  );
}

/**
 * The user area: a chip that is the trigger, and the account menu it opens.
 *
 * Rendered once per breakpoint by `SidebarUser` — the same element in the rail
 * and in the mobile drawer — so there is one account architecture, not two.
 * The session is read on the server there; this component is a client boundary
 * that receives only the sanitized `SessionViewer`, never the Supabase user.
 * The display name is `sessionFirstName`'s output and nothing else: no raw
 * metadata, never an email address, and no invented fallback.
 *
 * The panel opens upward — `bottom-full` — because the chip is bottom-anchored
 * in both shells, and there is no room below it. Same disclosure pattern as
 * the assistant launcher, reused rather than reinvented: the open state is
 * keyed on the path that opened it, so following a link closes the panel with
 * no effect watching the router; Escape closes it and returns focus to the
 * trigger explicitly (the panel unmounts after its exit, so focus left inside
 * it would otherwise be dropped); a pointer press anywhere outside closes it,
 * which is also what keeps this panel and the assistant panel from ever being
 * open together.
 *
 * Motion is the shared popup system: `MotionPopover` with `direction="up"`
 * and `origin="bottom"` — the default `bottom right` belongs to the assistant
 * panel, while this one grows out of a full-width chip, so it scales from
 * `bottom` (see MOTION.md).
 *
 * The actions are the existing ones, all of them — nothing here is a new auth
 * path. Sign out is `LogoutButton` posting the `signOut` Server Function,
 * which owns the whole sequence (clear the session, revalidate, redirect to
 * /login). Sign in and create account are plain links to the auth routes.
 * "Set up your workspace" is the onboarding route's own title, offered only to
 * a signed-in student: for a guest it is a gated route whose only effect would
 * be a bounce through /login, and the guest's two ways out are already here.
 */
export function ProfileMenu({ viewer }: { viewer: SessionViewer }) {
  const pathname = usePathname();
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const open = openedFor === pathname;
  const { title, subtitle } = chipLines(viewer);

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
    <div ref={rootRef} className="relative">
      {/* The chip is a real button: the accessible name is its own content —
          the name (or "Guest") and the workspace line — with the chevron
          aria-hidden. `press-feedback` owns the transition list, so no
          `transition-colors` beside it. */}
      <button
        ref={triggerRef}
        type="button"
        data-fontprobe-role="content"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpenedFor(open ? null : pathname)}
        className="press-feedback flex w-full min-w-0 items-center gap-2.5 rounded-base p-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Avatar viewer={viewer} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-label-sm font-medium text-foreground">
            {title}
          </span>
          <span className="truncate text-label-caps uppercase text-muted-foreground">
            {subtitle}
          </span>
        </span>
        {/* Up, because the panel arrives from below it; turned over while the
            panel is open. `icon-turn` transitions the `rotate` property. */}
        <ChevronUp
          aria-hidden="true"
          className={`icon-turn size-4 shrink-0 text-muted-foreground${
            open ? " rotate-180" : ""
          }`}
        />
      </button>

      {/* `MotionPopover` unmounts the panel once its exit finishes, which is
          what keeps it out of the tab order and the accessibility tree while
          closed. The `max-height` is the assistant panel's insurance applied
          here: on a short viewport the panel scrolls inside itself instead of
          running off the top of the screen. */}
      <MotionPopover
        open={open}
        id={panelId}
        direction="up"
        origin="bottom"
        className="absolute inset-x-0 bottom-full mb-2 flex max-h-[min(20rem,calc(100dvh-10rem))] flex-col overflow-y-auto overscroll-contain rounded-card border border-border bg-glass-strong p-2 shadow-overlay backdrop-blur-md"
      >
        <div className="flex min-w-0 items-center gap-2.5 px-1.5 py-1.5">
          <Avatar viewer={viewer} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-label-sm font-medium text-foreground">
              {title}
            </span>
            <span className="truncate text-label-caps uppercase text-muted-foreground">
              {subtitle}
            </span>
          </span>
        </div>
        <Divider />
        {viewer.signedIn ? (
          <div className="flex flex-col gap-0.5 pt-1">
            {/* The row's styling is the rail's own: the same padding, type and
                hover as a nav row, because this is navigation and should read
                as such. `ring-offset-card` against the panel's surface. */}
            <Link
              href="/onboarding"
              onClick={() => setOpenedFor(null)}
              className="flex min-w-0 items-center gap-2.5 rounded-base px-2.5 py-2 text-label-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            >
              <Wand2 aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 truncate">Set up your workspace</span>
            </Link>
            <LogoutButton
              label="Sign out"
              variant="ghost"
              size="sm"
              className="w-full"
            />
          </div>
        ) : (
          /* The same two ways out as `GuestCallout`, in the menu's compact
             stack: sign in first because a returning student is the likelier
             guest, create account as the quieter second. */
          <div className="flex flex-col gap-1.5 px-0.5 pb-0.5 pt-1.5">
            <ButtonLink
              href={LOGIN_PATH}
              size="sm"
              className="w-full"
              onClick={() => setOpenedFor(null)}
            >
              Sign in
            </ButtonLink>
            <ButtonLink
              href={SIGNUP_PATH}
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setOpenedFor(null)}
            >
              Create account
            </ButtonLink>
          </div>
        )}
      </MotionPopover>
    </div>
  );
}
