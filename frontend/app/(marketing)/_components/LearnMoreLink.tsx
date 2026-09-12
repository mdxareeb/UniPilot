import Link from "next/link";
import { ArrowRight } from "lucide-react";

type LearnMoreLinkProps = {
  href: string;
  children?: string;
};

/**
 * The "read the full page" link that sits in a section header. Both halves of
 * the hover — the underline warming up and the arrow nudging 3px forward — come
 * from the shared `action-arrow` utility, so this link behaves like every other
 * inline action in the product and needs no `transition-colors` of its own.
 */
export function LearnMoreLink({ href, children = "Learn more" }: LearnMoreLinkProps) {
  return (
    <Link
      href={href}
      className="action-arrow inline-flex items-center gap-1 rounded-base text-label-sm font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {children}
      <ArrowRight aria-hidden="true" className="size-3.5" />
    </Link>
  );
}

export type { LearnMoreLinkProps };
