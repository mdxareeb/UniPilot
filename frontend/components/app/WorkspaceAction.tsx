import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The quiet arrow link that ends a workspace card or panel.
 *
 * One explicit action per card, rather than making the whole card a link: it
 * keeps the accessible name short and specific ("View tasks" rather than the
 * card's entire text) and leaves the card free to hold its own copy without a
 * nested-link problem.
 *
 * Deliberately a sibling of the marketing `FeatureAction` rather than an import
 * of it — that one lives in a route-private `_components` folder. Movement and
 * colour both come from the shared `action-arrow` utility, so the two behave
 * identically without one reaching into the other.
 *
 * `py-1 -my-1` grows the touch target past the 24px minimum and gives the
 * padding back to the layout, so the row it sits in is the height it was.
 */
export function WorkspaceAction({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="action-arrow -my-1 inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-base py-1 text-label-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {children}
      <ArrowRight aria-hidden="true" className="size-3.5 shrink-0" />
    </Link>
  );
}
