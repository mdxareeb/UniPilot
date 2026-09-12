import type { HTMLAttributes, ReactNode } from "react";

type MetricProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  /** The large reading. Deliberately a display-ready string, not a number:
   *  the future service that owns the reading owns its formatting (the
   *  QuickStats convention). */
  value: ReactNode;
  /** The small quiet label beneath the numeral — states what the slot is
   *  for, never a fabricated reading. */
  label: ReactNode;
  /** Numeral font role (open founder decision, DESIGN.md §Metric Pattern):
   *  the body face by default; `mono` selects Geist Mono for tabular
   *  stability when several numerals change width. Unresolved at the gate —
   *  shipped with the body face as the provisional default. */
  numeralFont?: "body" | "mono";
};

/**
 * Task 3.13 — the metric pattern (DESIGN.md §Metric Pattern).
 *
 * One very large numeral with a small quiet label beneath it; a row of these
 * separates members by internal dividers and the group from what follows by
 * a thin rule. Built and exercised on the dev specimen page only — populated
 * nowhere real until per-surface adoption tasks run after founder review
 * (the no-fabrication rule §0.9 stands: a real metric needs a real service).
 *
 * The numeral takes the app scale's large step (`text-headline-md`, 24px —
 * the step PageHeader's h1 already uses), never the marketing display steps;
 * the dashboard's type scale stays flatter than marketing's by design.
 */
export function Metric({
  value,
  label,
  numeralFont = "body",
  className,
  ...props
}: MetricProps) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-1${className ? ` ${className}` : ""}`}
      {...props}
    >
      <span
        className={
          numeralFont === "mono"
            ? "wrap-anywhere font-mono text-headline-md font-semibold leading-tight text-foreground"
            : "wrap-anywhere font-heading text-headline-md font-semibold leading-tight text-foreground"
        }
      >
        {value}
      </span>
      <span className="text-label-sm text-muted-foreground">{label}</span>
    </div>
  );
}

/** A row of metrics: internal dividers between members (DESIGN.md §Metric
 *  Pattern's grouping rule) and a thin rule separating the group from what
 *  follows. */
export function MetricRow({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`grid min-w-0 grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-3${className ? ` ${className}` : ""}`}
      {...props}
    >
      {children}
    </div>
  );
}

export type { MetricProps };
