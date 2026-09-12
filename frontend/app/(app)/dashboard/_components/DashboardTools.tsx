import { WorkspaceAction } from "@/components/app/WorkspaceAction";
import { motionIndex } from "@/components/motion/stagger";
import { ToolCard } from "@/components/tools/ToolCard";
import {
  HAS_LIVE_TOOL,
  TOOL_GROUPS,
  pickTools,
  toolActionLabel,
  type ToolGroupId,
  type ToolId,
} from "@/components/tools/toolCatalog";

/**
 * The curation of the hub: which tools each family row shows. Named ids rather
 * than `toolsInGroup`, because the hub is a shortlist — four or five cards a
 * family — rather than every tool the registry carries, and the day a family
 * outgrows a row is the day the row becomes a features-page link, not a longer
 * dashboard.
 *
 * Read from the registry by `pickTools`, so names, statuses and destinations
 * come from the catalogue and cannot drift from the homepage, the features
 * page or Quick Actions. Tier-3 tools are not named here, which is the
 * registry-tiers rule in practice: research-only tools are not advertised as
 * normal dashboard functionality.
 */
const FAMILY_TOOLS: Record<ToolGroupId, readonly ToolId[]> = {
  create: ["presentation", "document-maker", "spreadsheet-maker", "data-table"],
  edit: ["document-editor", "spreadsheet-editor", "background-remover"],
  convert: ["file-converters", "pdf-editor", "qr-code"],
  study: ["flashcards", "quiz", "mind-map"],
};

/* The four families in the order the hub shows them, with their tools resolved
   from the registry. Order comes from `TOOL_GROUPS` — the registry's own family
   order — so a family reordered there moves here too. */
const FAMILIES = TOOL_GROUPS.map((group) => ({
  group,
  tools: pickTools(FAMILY_TOOLS[group.id]),
}));

/**
 * The tool hub, "Create with UniPilot" (Task 15.11): what UniPilot can help you
 * make, change, move between formats, or revise — the answer to "what is this
 * product beyond a filing cabinet", one step past the workspace sections above
 * it.
 *
 * Four families, one grid shape. The split is by what someone came to do — make
 * something, change something, move something between formats, revise from
 * something — because that is the only question a person has when they open
 * this. Grouping by which engine will eventually power a tool would be a
 * description of the codebase, not of the work.
 *
 * Registry-driven throughout (§0.12): every card's name, icon, sentence,
 * status and destination come from `toolCatalog`, and the hub never restates
 * one of them. A tool flips from "How it will work" to "Open" by changing its
 * registry entry, and the homepage, the features page and this hub say the
 * same thing on the same day. Tier-3 tools are absent by curation, not hidden
 * by styling.
 *
 * The closing action goes to `/tools`, the full catalogue, which has every tool
 * in every family — the hub is a shortlist and says so by linking past itself.
 *
 * Motion: the section header rises, then each family arrives one ladder slot
 * after the last — a family row entering, not seventeen cards queueing: each
 * family's cards share the family's slot through `toolsInGroup`-style
 * per-position offsets that stay inside the family's window, so the hub
 * settles in four steps rather than fourteen. No card is ever behind an
 * observer — `data-enter` throughout, first paint without scroll, the lesson
 * of the old blank-dashboard bug.
 */
export function DashboardTools() {
  return (
    <section className="flex min-w-0 flex-col gap-6">
      <header data-enter className="flex flex-col gap-1.5">
        <h2 className="text-headline-md text-foreground">
          Create with UniPilot
        </h2>
        <p className="max-w-[56ch] text-body-md text-muted-foreground">
          Make coursework, revise from your notes, and handle the file jobs in
          between.
        </p>
      </header>

      {/* One note for the whole hub instead of a warning on every card. Tied to
          the catalogue, so it disappears by itself the day a tool ships. */}
      {HAS_LIVE_TOOL ? null : (
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
          className="flex min-w-0 flex-col gap-3"
          /* Each family arrives two ladder steps after the one above (its own
             header slot, then its cards), so four families read as four
             movements rather than one long stagger. The families rise; the
             cards inside each carry the `scale` depth. */
          data-enter
          style={motionIndex(familyIndex * 2 + 2)}
        >
          <header className="flex flex-col gap-1">
            <h3 className="text-body-lg font-semibold text-foreground">
              {group.label}
            </h3>
            <p className="text-label-sm text-muted-foreground">
              {group.tagline}
            </p>
          </header>
          <ul className="grid min-w-0 list-none gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {tools.map((tool, position) => (
              <ToolCard
                key={tool.id}
                tool={tool}
                index={position}
                enter
                action={
                  <WorkspaceAction href={tool.href}>
                    {toolActionLabel(tool)}
                  </WorkspaceAction>
                }
              />
            ))}
          </ul>
        </section>
      ))}

      <div data-enter>
        <WorkspaceAction href="/tools">See every tool</WorkspaceAction>
      </div>
    </section>
  );
}
