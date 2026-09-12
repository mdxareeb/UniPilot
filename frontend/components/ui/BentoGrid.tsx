import type { HTMLAttributes, ReactNode } from "react";

type BentoGridProps = HTMLAttributes<HTMLDivElement> & {
  /** The ladder of entrance slots children may claim (unused by the grid
   *  itself; children render `MotionRevealItem`/`data-enter` as their surface
   *  dictates — the grid is layout only). */
  children: ReactNode;
};

type BentoItemProps = HTMLAttributes<HTMLDivElement> & {
  /** Width in grid columns at `md` (the working breakpoint). Dominant cells
   *  take 7–8 of 12; medium 5–6; small 3–4. */
  md?: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 12;
  /** Width in grid columns at `lg`. Omit to inherit `md`. */
  lg?: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 12;
  /** Height in rows of the base row unit. Omit for auto height. */
  rows?: 1 | 2 | 3;
};

/**
 * Task 3.13 — the bento grid primitive (DESIGN.md §Bento Grid).
 *
 * A 12-column grid at `md`/`lg` (single column below), one base row unit
 * (`--bento-row`, 9rem — an element spanning two rows reads as deliberately
 * larger, not accidentally taller), and span props so a child declares its
 * size in grid units. The composition rule lives in DESIGN.md, not here: a
 * view should have one dominant cell, a few medium cells, and several small
 * ones — a view where every cell is the same size is a defect. The grid
 * enforces nothing; the surfaces composing it are what make the bento read.
 *
 * Built and exercised on the dev specimen page only — it is adopted on no
 * real surface until the per-surface adoption tasks run after founder
 * review. It deliberately does not replace `Grid`: that primitive's equal
 * columns are correct for genuinely uniform sets; this one exists for views
 * whose cells differ in importance.
 */
export function BentoGrid({ className, children, ...props }: BentoGridProps) {
  return (
    <div
      className={`grid min-w-0 grid-cols-1 gap-4 md:grid-cols-12 md:gap-5${className ? ` ${className}` : ""}`}
      style={{ gridAutoRows: "var(--bento-row, 9rem)" }}
      {...props}
    >
      {children}
    </div>
  );
}

export function BentoItem({
  md = 6,
  lg,
  rows,
  className,
  children,
  ...props
}: BentoItemProps) {
  const span = [
    `md:col-span-${md}`,
    lg ? `lg:col-span-${lg}` : null,
    rows ? `row-span-${rows}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`min-w-0 ${span}${className ? ` ${className}` : ""}`} {...props}>
      {children}
    </div>
  );
}

export type { BentoGridProps, BentoItemProps };
