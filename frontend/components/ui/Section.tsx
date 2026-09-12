import type { HTMLAttributes } from "react";

/**
 * One band of a page: vertical rhythm from `py-section`, nothing else.
 *
 * `overflow-x-clip` is the guard that makes the reveal vocabulary's directional
 * entrances safe to use in any section. `left`/`right` start their content 24px
 * off-axis while the page gutter is 20px, so for the ~380ms of the entrance the
 * element's edge sits a few pixels outside the viewport — enough to add a
 * horizontal scrollbar at 320px. `clip` rather than `hidden` on purpose: `clip`
 * does not create a scroll container, so it cannot capture the page's scrolling,
 * break `scroll-mt` anchors, or give a sticky descendant a new scrollport.
 */
export function Section({
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <section className={`py-section overflow-x-clip ${className ?? ""}`} {...props} />
  );
}
