import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";

type IntegrationCardProps = {
  name: string;
  description: string;
  /** The integration's official brand mark (see `BrandMarks.tsx`). */
  mark: ReactNode;
};

/**
 * One planned integration (14.13): official mark, name, one honest future-tense
 * sentence and its state. There is deliberately no action and no hover lift —
 * nothing is wired, so the card offers nothing to click and must not pretend
 * to be an interactive surface. `Coming soon` is the same outline badge the
 * calendar uses for its unbuilt create flow, and `Not connected` is the
 * card's one status line; a real connected state replaces it only when one
 * exists.
 */
export function IntegrationCard({
  name,
  description,
  mark,
}: IntegrationCardProps) {
  return (
    <Card
      variant="compact"
      className="flex h-full min-w-0 flex-col gap-3 bg-glass p-4"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-control border border-border bg-card">
          {mark}
        </span>
        <h2 className="min-w-0 text-body-lg font-semibold text-foreground">
          {name}
        </h2>
      </div>
      <p className="text-label-sm text-muted-foreground">{description}</p>
      <div className="mt-auto flex flex-col gap-2.5 pt-3">
        <Divider />
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <Badge variant="outline" size="sm">
            Coming soon
          </Badge>
          <span className="shrink-0 font-mono text-label-caps text-muted-foreground">
            Not connected
          </span>
        </div>
      </div>
    </Card>
  );
}

export type { IntegrationCardProps };
