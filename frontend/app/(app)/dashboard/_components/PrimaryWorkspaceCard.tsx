import { ArrowRight, Upload } from "lucide-react";
import { motionIndex } from "@/components/motion/stagger";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Card } from "@/components/ui/Card";
import { LOGIN_PATH, REDIRECT_PARAM } from "@/lib/auth/constants";

/**
 * The one card on the page that is trying to get something done.
 *
 * Honest about the state of the product. Uploading does not exist — there is no
 * storage bucket, no parser and no documents table — so the primary action goes
 * to the real `/documents` route rather than to a control that would look like
 * it accepts a file and then do nothing. The heading and the description are the
 * ones the design calls for, because the intent is right; the button says what
 * it actually does, and the dashed note says why. When upload ships, this is the
 * one place that changes.
 *
 * `bg-glass` and no `hover-lift`. It sits on the dotted canvas like the other
 * cards, but it is the anchor of the page rather than a tile in a set — lifting
 * the largest surface on hover reads as instability, and it is not a link.
 *
 * `data-enter` on the wrapper, never on the `Card`: the entrance animation uses
 * `animation-fill-mode: both`, so its final `transform: none` persists and would
 * permanently win against a hover transform on the same element. The wrapper also
 * carries the column span, so the animated box is the grid item itself.
 *
 * `data-enter="scale"` rather than the default rise: this is the anchor of the
 * page, and arriving with a little depth is what separates it from the tiles
 * around it without a second animation system — the variant is one of the four
 * keyframes in `globals.css`.
 */
export function PrimaryWorkspaceCard({
  index,
  guest = false,
}: {
  index: number;
  guest?: boolean;
}) {
  const documentsHref = guest
    ? `${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent("/documents")}`
    : "/documents";
  const assistantHref = guest
    ? `${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent("/assistant")}`
    : "/assistant";
  return (
    <div
      data-enter="scale"
      style={motionIndex(index)}
      className="min-w-0 lg:col-span-2"
    >
      <Card className="flex h-full min-w-0 flex-col gap-3 bg-glass p-5 backdrop-blur-md md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className="flex items-center gap-1.5 font-mono text-label-caps uppercase text-muted-foreground">
            <Upload aria-hidden="true" className="size-3.5 shrink-0" />
            Get started
          </span>
          {/* The project's existing marker for a feature that is described but
              not shipped — same badge the features page uses. */}
          <Badge size="sm" variant="outline">
            Uploads not yet available
          </Badge>
        </div>

        <h2 className="wrap-anywhere text-headline-md text-foreground">
          Build your academic workspace
        </h2>
        <p className="max-w-[52ch] text-body-md text-muted-foreground">
          Upload your syllabus, notes, assignment briefs or other course
          materials to get started.
        </p>

        <div className="rounded-base border border-dashed border-secondary p-3">
          <p className="text-label-sm text-muted-foreground">
            Uploading isn&rsquo;t built yet. Your documents, tasks and calendar
            stay empty until it ships — nothing here is filled in for you.
          </p>
        </div>

        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          <ButtonLink href={documentsHref}>
            Open documents
            <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
          </ButtonLink>
          <ButtonLink href={assistantHref} variant="outline">
            Explore assistant
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}
