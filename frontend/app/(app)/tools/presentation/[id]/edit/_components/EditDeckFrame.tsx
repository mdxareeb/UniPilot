"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { MotionNotice } from "@/components/motion/MotionNotice";

/**
 * The presentation editor frame (Task 31.x, GATE 2; the themed fork surfaced
 * per the 2026-09-15 fork-theme spec).
 *
 * The frame loads the UniPilot-themed presentation editor — the forked
 * Presenton UI on its own origin (`PRESENTON_UI_URL` when it is reachable), or
 * the engine's own editor as the honest fallback (`resolveEditorUrl` in the
 * adapter). UniPilot's chrome around it — header, label, frame, loading state —
 * is built from the shared design system and the themed fork matches it.
 *
 * One scope note: the slide stage *inside* the editor renders the deck's own
 * fonts and colors. That is deck content, not UniPilot chrome, and it is
 * deliberately left alone (see presenton-ui/DIVERGENCE.md, "Frozen content
 * scope").
 *
 * Auth bridge: the editor authenticates against the presentation service. The
 * frame loads whatever the browser's session allows; when that session is
 * missing or expired the editor shows its own sign-in screen, which the
 * labelled line above the frame explains. Opening the editor in its own tab is
 * offered for any flow the embedded frame cannot complete.
 */
export function EditDeckFrame({
  src,
  title,
}: {
  src: string;
  title: string;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-[72ch] text-label-sm text-muted-foreground">
          The editor is UniPilot&rsquo;s themed presentation editor, surfaced
          here from your presentation service. Slides keep the deck&rsquo;s own
          fonts and colors. If it asks you to sign in first, sign in to the
          presentation service once in this browser.
        </p>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="action-arrow -my-1 inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-base py-1 text-label-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Open editor in a new tab
          <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
        </a>
      </div>

      <div className="relative min-h-[70vh] overflow-hidden rounded-card border border-border bg-card">
        {!loaded ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <MotionNotice className="text-label-sm text-muted-foreground">
              Loading the editor…
            </MotionNotice>
          </div>
        ) : null}
        <iframe
          src={src}
          title={title}
          onLoad={() => setLoaded(true)}
          className="h-[70vh] w-full border-0"
        />
      </div>
    </div>
  );
}
