"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { MotionNotice } from "@/components/motion/MotionNotice";

/**
 * The Presenton editor frame (Task 31.x, GATE 2).
 *
 * Presenton's drag-edit UI is a separate Next.js app on its own origin; it is
 * embedded here as-is. The wrapper around it — header, actions, frame, loading
 * and empty states — is UniPilot's and built from the shared system. The
 * editor's interior deliberately keeps Presenton's own look: cross-origin CSS
 * injection is impossible, and restyling it to UniPilot's design is a later,
 * separate fork task (recorded in TASK.md 31.x), not something this wrapper
 * attempts.
 *
 * Auth bridge: Presenton authenticates against its own service. The frame
 * loads whatever the browser's Presenton session allows; when that session is
 * missing or expired the iframe shows Presenton's own sign-in screen, which
 * the labelled line above the frame explains. Opening the editor in its own
 * tab is offered for any flow the embedded frame cannot complete.
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
          The editor is Presenton&rsquo;s own interface, served by your
          presentation service, so its look differs from UniPilot&rsquo;s. If it
          asks you to sign in first, sign in to the presentation service once in
          this browser.
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
