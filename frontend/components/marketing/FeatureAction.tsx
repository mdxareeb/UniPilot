import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * The single interactive element in a feature card.
 *
 * Cards themselves are not links: one explicit action per card keeps the
 * accessible name short and specific ("Explore documents" rather than the
 * card's entire text), and leaves room for the card to hold a preview without
 * a nested-link problem.
 *
 * Quieter than `LearnMoreLink` on purpose — this sits inside a card that
 * already has a title, so it reads as an action rather than competing with the
 * heading. Movement and colour come from the `action-arrow` utility.
 *
 * Never wraps: the label is the affordance, and "Explore the / calendar"
 * broken across two lines reads as a layout accident. The row it sits in wraps
 * instead.
 *
 * `py-1 -my-1` grows the touch target to 26px while the negative margin gives
 * the padding back to the layout, so the row is the same height it was. A
 * 13px/1.4 label is an 18px box on its own, which is under the 24px minimum —
 * the target needed to be bigger without the link looking bigger.
 *
 * Lives here rather than in a route-private `_components` folder because both
 * the homepage grid and the features catalogue use it, and it is the marketing
 * twin of `components/app/WorkspaceAction.tsx`.
 */
export function FeatureAction({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
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
