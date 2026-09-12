import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";
import { motionIndex } from "@/components/motion/stagger";
import { MotionRevealItem } from "@/components/motion/MotionRevealGroup";
import type { Tool } from "@/components/tools/toolCatalog";
import { toolStatusLabel } from "@/components/tools/toolCatalog";

type ToolCardProps = {
  tool: Tool;
  /**
   * The card's contextual action.
   *
   * Passed in rather than built here because the two surfaces that show tool
   * cards use different link components on purpose — the marketing pages have
   * `FeatureAction` in a route-private folder, the workspace has
   * `WorkspaceAction` — and a card that imported one of them would drag a
   * marketing component into the app shell to save four lines.
   */
  action: ReactNode;
  /**
   * Stagger position within the grid. Read by the `enter` variant only — a card
   * revealed on scroll takes its order from the `MotionRevealGroup` around the
   * grid, so a per-card index there would be a second, competing schedule.
   */
  index?: number;
  /**
   * Both surfaces put a group label above the grid, so a tool's name is a
   * fourth-level heading. Pass `3` for a grid that sits directly under a section
   * header.
   */
  headingLevel?: 3 | 4;
  /**
   * Dashboard wants its tool hub visible on first paint (no scroll required),
   * so it uses the page-entrance `data-enter` rather than the Motion scroll
   * reveal. Marketing keeps the default scroll reveal.
   */
  enter?: boolean;
};

/**
 * One tool, as a compact card: icon, name, the sentence from the catalogue, a
 * status when it is not built yet, and an action.
 *
 * It reads like a tool rather than an advertisement — no oversized button, no
 * headline, nothing that would make seventeen of them in a column feel like a
 * pitch deck. The status is a small mono label instead of a badge for the same
 * reason: with every tool in the catalogue still `planned`, seventeen badges
 * would be louder than the tools.
 *
 * The reveal goes on the `li` and the hover lift on the `Card` inside it, never
 * both on one element: the reveal's transform and the `hover-lift` utility's
 * transition would fight over the same element and the lift would silently
 * stop working.
 */
function ToolCard({
  tool,
  action,
  index = 0,
  headingLevel = 4,
  enter = false,
}: ToolCardProps) {
  const Heading = `h${headingLevel}` as "h3" | "h4";

  const card = (
    <Card
      variant="compact"
      className="flex h-full min-w-0 flex-col gap-2 bg-glass p-4 hover-lift hover:border-foreground"
    >
      <tool.icon
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <Heading className="text-body-lg font-semibold text-foreground">
        {tool.name}
      </Heading>
      <p className="text-label-sm text-muted-foreground">{tool.description}</p>
      <div className="mt-auto flex flex-col gap-2.5 pt-3">
        <Divider />
        {/* Wraps rather than truncates: at 320px the action and the status
            cannot always share a line. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          {action}
          {/* An unlabelled card reads as shipped, so only the unbuilt ones
              carry a word — the registry's own word for the state. */}
          {tool.status === "planned" ? (
            <span className="shrink-0 font-mono text-label-caps text-muted-foreground">
              {toolStatusLabel(tool)}
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  );

  /* Dashboard wants its tool hub visible on first paint, so it keeps the
     CSS-only page-entrance `data-enter`. Marketing scrolls to its grids, so
     they arrive with depth as members of the section's reveal group — the card
     is a surface being placed, which a flat rise does not say. */
  if (enter) {
    return (
      <li data-enter style={motionIndex(index)} className="min-w-0">
        {card}
      </li>
    );
  }

  return (
    <MotionRevealItem as="li" variant="scale" className="min-w-0">
      {card}
    </MotionRevealItem>
  );
}

export { ToolCard };
export type { ToolCardProps };
