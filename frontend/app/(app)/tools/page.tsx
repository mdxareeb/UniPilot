import { PageHeader } from "@/components/app/PageHeader";
import { WorkspaceAction } from "@/components/app/WorkspaceAction";
import { motionIndex } from "@/components/motion/stagger";
import { ToolCard } from "@/components/tools/ToolCard";
import { toolRegistry } from "@/components/tools/toolCatalog";
import { Container } from "@/components/ui/Container";
import { getWorkspaceAccess } from "@/lib/onboarding/gate";

/**
 * Tools (14.12): the workspace's tool catalogue, registry-driven end to end
 * (TASK.md 0.11/0.12).
 *
 * The four families and every card inside them come from
 * `components/tools/toolCatalog.ts` through its canonical `toolRegistry` API:
 * names, icons, one-line descriptions, status words and destinations are the
 * registry's, never restated here. `inGroup` excludes the Tier-3 `disabled`
 * entries for the same reason the homepage marquee excludes them — a
 * research-only tool must not be carded as a peer of the launch set.
 *
 * Honesty is structural, not a wording choice: every tool is `planned` today,
 * so each card carries the registry's "Planned" word and links to the features
 * section that explains it (`How it will work`), and the aggregate note is
 * gated on `hasLiveTool`, so it disappears by itself the day one ships. No
 * card can say "Open" for something that does not open.
 *
 * Guest-aware like every workspace route: `getWorkspaceAccess` sends an
 * unfinished signed-in student into /onboarding and lets a guest (or a
 * completed student) render the same page. The registry is static, so this
 * route never reads user data.
 *
 * Motion reuses the workspace entrance ladder: `PageHeader` owns slot 0, the
 * aggregate note slot 1, and each family a pair of slots so the four sections
 * read as four movements rather than one long stagger. Cards use the
 * tool hub's `data-enter` (above the fold), not a scroll reveal.
 */
const FAMILIES = toolRegistry.groups.map((group) => ({
  group,
  tools: toolRegistry.inGroup(group.id),
}));

export default async function ToolsPage() {
  await getWorkspaceAccess();

  return (
    <Container className="flex min-w-0 flex-col gap-6 py-6 md:gap-8 md:py-8">
      <PageHeader
        eyebrow="Tools"
        title="Tools"
        description="Every tool UniPilot is building, grouped by what you came to do."
      />

      {/* One note for the whole page instead of a warning on every card. Tied
          to the registry, so it disappears by itself the day a tool ships. */}
      {toolRegistry.hasLiveTool ? null : (
        <div
          data-enter
          style={motionIndex(1)}
          className="rounded-base border border-dashed border-secondary p-3"
        >
          <p className="text-label-sm text-muted-foreground">
            None of these are built yet. Every card describes what its tool will
            do — nothing here generates, converts or edits a file today.
          </p>
        </div>
      )}

      {FAMILIES.map(({ group, tools }, familyIndex) => (
        <section
          key={group.id}
          data-enter
          style={motionIndex(familyIndex * 2 + 2)}
          className="flex min-w-0 flex-col gap-3"
        >
          <header className="flex flex-col gap-1">
            <h2 className="text-body-lg font-semibold text-foreground">
              {group.label}
            </h2>
            <p className="text-label-sm text-muted-foreground">
              {group.tagline}
            </p>
          </header>
          <ul className="grid min-w-0 list-none gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tools.map((tool, position) => (
              <ToolCard
                key={tool.id}
                tool={tool}
                index={position}
                headingLevel={3}
                enter
                action={
                  <WorkspaceAction href={tool.href}>
                    {toolRegistry.actionLabel(tool)}
                  </WorkspaceAction>
                }
              />
            ))}
          </ul>
        </section>
      ))}
    </Container>
  );
}
