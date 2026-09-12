import type { HTMLAttributes, ReactNode } from "react";

type CollapsibleVariant = "fade" | "scale";

type CollapsibleProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  open: boolean;
  /**
   * `scale` adds a subtle scale-in, for panels that read as a surface
   * appearing. Text-only panels stay on `fade`.
   */
  variant?: CollapsibleVariant;
  children: ReactNode;
};

/**
 * Disclosure panel that animates open and closed.
 *
 * Stays mounted so it can animate out, and relies on `visibility: hidden`
 * (applied by the `[data-collapsible]` rules in `app/globals.css`) to keep the
 * closed content out of the tab order and the accessibility tree. That is why
 * this is a shared component rather than a `hidden`/`block` toggle per call
 * site: getting the closed state wrong is an accessibility bug, not a visual
 * one.
 *
 * Pass ARIA and identity props straight through — they land on the panel
 * element, so `aria-controls` on the trigger keeps resolving.
 */
export function Collapsible({
  open,
  variant = "fade",
  children,
  ...props
}: CollapsibleProps) {
  return (
    <div
      data-collapsible={variant === "scale" ? "scale" : ""}
      data-open={open}
      {...props}
    >
      {/* Clipper. Carries no padding, border or background of its own: it
          collapses to zero height, and anything on its own box would survive
          the collapse as a visible sliver. Style the content instead. */}
      <div>{children}</div>
    </div>
  );
}

export type { CollapsibleProps, CollapsibleVariant };
