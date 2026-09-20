import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";

type IntegrationCardProps = {
  name: string;
  description: string;
  /** The integration's official brand mark (see `BrandMarks.tsx`). */
  mark: ReactNode;
  /**
   * Replaces the planned card's `Coming soon` badge text when an integration
   * has a real state to report (F3's Presenton card). The outline pill itself
   * stays the same, so a live card is still one visual family with the
   * planned one.
   */
  badge?: ReactNode;
  /**
   * Replaces the planned card's `Not connected` mono status line. The line's
   * mono styling lives here, so every caller reads as the same one line.
   */
  status?: ReactNode;
  /**
   * Extra card content between the description and the closing chrome — a
   * live integration's own note or link. Absent for the planned card, whose
   * DOM stays exactly what it was.
   */
  children?: ReactNode;
};

/**
 * One integration card (14.13; F3): official mark, name, one honest sentence,
 * then the closing chrome — an outline badge and the one mono status line
 * behind a `Divider`.
 *
 * The planned variant is the default and stays what it was: `Coming soon` and
 * `Not connected`, with deliberately no action and no hover lift — nothing is
 * wired, so the card offers nothing to click and must not pretend to be an
 * interactive surface. A live integration (the Presenton card, F3) overrides
 * the two state slots and may add its own content through `children`; the
 * chrome and typography stay shared, so both variants read as one card family.
 * A live card's link is the caller's own `WorkspaceAction`, never a card-wide
 * link.
 */
export function IntegrationCard({
  name,
  description,
  mark,
  badge,
  status,
  children,
}: IntegrationCardProps) {
  return (
    <Card
      variant="compact"
      className="flex h-full min-w-0 flex-col gap-3 bg-glass p-4 backdrop-blur-md"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-control border border-border bg-glass-subtle">
          {mark}
        </span>
        <h2 className="min-w-0 text-body-lg font-semibold text-foreground">
          {name}
        </h2>
      </div>
      <p className="text-label-sm text-muted-foreground">{description}</p>
      {children}
      <div className="mt-auto flex flex-col gap-2.5 pt-3">
        <Divider />
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <Badge variant="outline" size="sm">
            {badge ?? "Coming soon"}
          </Badge>
          <span className="shrink-0 font-mono text-label-caps text-muted-foreground">
            {status ?? "Not connected"}
          </span>
        </div>
      </div>
    </Card>
  );
}

export type { IntegrationCardProps };
