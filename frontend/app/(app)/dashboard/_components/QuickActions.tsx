import { Plus, Upload, Zap } from "lucide-react";
import { motionIndex } from "@/components/motion/stagger";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Card } from "@/components/ui/Card";
import { pickTools, type ToolId } from "@/components/tools/toolCatalog";
import { LOGIN_PATH, REDIRECT_PARAM } from "@/lib/auth/constants";

/**
 * The curated shortlist of the catalogue a quick action is offered for, in the
 * order the chips show. Ids are compile-checked against the catalogue, so a
 * renamed tool breaks the build instead of quietly dropping a chip.
 *
 * The chip's words are the registry's `shortName`, not a second copy of the
 * name: the row reads from `toolCatalog`, so it cannot drift from the tool hub,
 * the homepage marquee or the features catalogue. Status is read from the same
 * entry — a chip for a live tool stops carrying the planned styling and the
 * "coming soon" framing on the day it ships.
 */
const QUICK_TOOLS: readonly ToolId[] = [
  "presentation",
  "document-maker",
  "pdf-maker",
  "spreadsheet-maker",
  "quiz",
  "flashcards",
  "mind-map",
  "file-converters",
];

const CHIPS = pickTools(QUICK_TOOLS);
const HAS_PLANNED_CHIP = CHIPS.some((tool) => tool.status !== "live");

type QuickActionsProps = {
  /** Position in the page's entrance stagger. */
  index: number;
  guest?: boolean;
};

/**
 * The quick-actions card (Task 15.8): what you can start from here, live first.
 *
 * The hierarchy is the honesty (15.8 §9): the two actions with real
 * destinations today — uploading a document and creating a task, both of which
 * land in workspace routes that exist — render as the strongest pair in the
 * card. Everything else is a creation or study tool that is not built yet, so
 * it renders visibly quieter, carries one group label that says so, and each
 * chip opens the features section that explains how the tool will work — the
 * registry's own rule for a `planned` tool, applied here rather than invented:
 * a chip that pretended to create a PDF today would be the one lie this
 * dashboard must not tell.
 *
 * Destinations are real only: `ButtonLink`, never `router.push`, so the links
 * keep middle-click, open-in-new-tab and keyboard behaviour. The two live
 * actions are session-gated routes, so a guest is routed through login with a
 * return path — the project's existing answer for a gated destination — while
 * the planned chips go to public features sections for everyone. Both buttons
 * are `size="md"`: 44px, the touch target this card owes a thumb.
 *
 * This is not a second navigation. It is four square inches of "start here",
 * reading from the same catalogue as the tool hub below it and never
 * restating the workspace rail above it.
 *
 * Motion (15.8 §11/§12): the card rises, then the two live buttons arrive with
 * `scale` — the depth treatment the page reserves for the surfaces that
 * anchor their band, and the first buttons on the dashboard to take it — while
 * the planned chips rise together one slot later, softer, as befits things
 * that are coming. Press feedback on every control is the tactile layer. No
 * fade-only entrance, nothing bouncing, and no animation controls whether an
 * action exists: the entrances are the same CSS keyframes every other section
 * uses, and they end at `opacity: 1` by construction.
 *
 * `hover-lift` is on the `Card`, the entrances on the inner wrappers — the
 * same layering every other dashboard card uses, because an entrance's fill
 * mode would otherwise pin `transform: none` and cancel a hover transform on
 * the same element for good.
 */
export function QuickActions({ index, guest = false }: QuickActionsProps) {
  const documentsHref = guest
    ? `${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent("/documents")}`
    : "/documents";
  const tasksHref = guest
    ? `${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent("/tasks")}`
    : "/tasks";

  return (
    <div data-enter style={motionIndex(index)} className="min-w-0">
      <Card
        variant="compact"
        className="flex min-w-0 flex-col gap-3 bg-glass p-4 backdrop-blur-md hover-lift hover:border-foreground"
      >
        <div className="flex min-w-0 flex-col gap-2">
          <span className="flex items-center gap-1.5 font-mono text-label-caps uppercase text-muted-foreground">
            <Zap aria-hidden="true" className="size-3.5 shrink-0" />
            Quick actions
          </span>
          <h3 className="text-body-lg font-semibold text-foreground">
            Start something
          </h3>
        </div>

        {/* The live pair: the two actions whose destinations exist today.
            Primary for the first, outline for the second — the same pair
            weighting the guest callout uses — and `scale` on both, so the
            things you can actually do arrive with the most presence in the
            card. */}
        <div className="flex min-w-0 flex-wrap gap-2">
          <div data-enter="scale" style={motionIndex(index + 1)} className="min-w-0">
            <ButtonLink href={documentsHref} size="md">
              <Upload aria-hidden="true" className="size-4 shrink-0" />
              Upload document
            </ButtonLink>
          </div>
          <div data-enter="scale" style={motionIndex(index + 1)} className="min-w-0">
            <ButtonLink href={tasksHref} variant="outline" size="md">
              <Plus aria-hidden="true" className="size-4 shrink-0" />
              Create task
            </ButtonLink>
          </div>
        </div>

        {/* The coming tier: creation and study tools from the catalogue,
            quieter than the pair above, saying so once rather than eight
            times. Chips wrap and never squeeze below one per line at 320px.
            The framing disappears when no chip is planned any more. */}
        <div className="flex min-w-0 flex-col gap-2.5">
          {HAS_PLANNED_CHIP ? (
            <p className="font-mono text-label-caps uppercase text-muted-foreground">
              Create &amp; study — coming soon
            </p>
          ) : null}
          <ul
            data-enter
            style={motionIndex(index + 2)}
            className="flex min-w-0 list-none flex-wrap gap-2"
          >
            {CHIPS.map((tool) => (
              <li key={tool.id} className="min-w-0">
                <ButtonLink
                  href={tool.href}
                  variant="ghost"
                  size="md"
                  className={
                    tool.status === "live"
                      ? undefined
                      : "border border-dashed border-border bg-transparent"
                  }
                >
                  <tool.icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                  {tool.shortName}
                </ButtonLink>
              </li>
            ))}
          </ul>
          {HAS_PLANNED_CHIP ? (
            <p className="text-label-sm text-muted-foreground">
              None of these are built yet — each chip explains what its tool will
              do.
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
