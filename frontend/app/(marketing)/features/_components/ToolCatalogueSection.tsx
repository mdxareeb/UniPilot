import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import {
  MotionRevealGroup,
  MotionRevealItem,
} from "@/components/motion/MotionRevealGroup";
import { FeatureAction } from "@/components/marketing/FeatureAction";
import { ToolCard } from "@/components/tools/ToolCard";
import {
  toolActionLabel,
  toolsInGroup,
  type ToolGroupId,
  type ToolId,
} from "@/components/tools/toolCatalog";
import {
  FeaturePreviewCard,
  FeatureSectionHeader,
} from "./FeatureDetailSection";

export type ToolCatalogueSectionProps = {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  group: ToolGroupId;
  /* Tools this part has already given a section of its own. */
  except?: readonly ToolId[];
  meta: string;
  preview: ReactNode;
};

/**
 * One family of tools as a grid of cards, in the same two-column shape as every
 * other section on this page.
 *
 * No `id`: the numbered part above owns the anchor, and a section with an
 * unadvertised anchor is an invitation for the jump nav and the page to disagree
 * about what exists.
 *
 * `lg:items-start` rather than the stretched grid the capability sections use. A
 * family can run to eight cards, and a preview card stretched to four rows of
 * them would be a mostly empty rectangle with a word at the bottom.
 *
 * The status badge is computed from the tools themselves rather than passed in,
 * so it disappears on its own the day one of them ships instead of the day
 * someone remembers to delete the prop.
 */
export function ToolCatalogueSection({
  icon,
  eyebrow,
  title,
  description,
  group,
  except,
  meta,
  preview,
}: ToolCatalogueSectionProps) {
  const tools = toolsInGroup(group, except);
  const allPlanned = tools.every((tool) => tool.status === "planned");

  return (
    <Section className="border-t border-border [--section-padding:40px] md:[--section-padding:64px]">
      <Container>
        <MotionRevealGroup
          repeat
          className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:items-start lg:gap-10"
        >
          <div className="min-w-0">
            <FeatureSectionHeader
              icon={icon}
              eyebrow={eyebrow}
              status={allPlanned ? "Not yet available" : undefined}
              title={title}
              description={description}
            />
            {/* Header, then each card with depth, then the scope note, then the
                figure from the right — one order for the whole section, held by
                the group above rather than by an index on each card. */}
            <ul className="mt-6 grid min-w-0 list-none grid-cols-1 gap-4 sm:grid-cols-2">
              {tools.map((tool) => (
                <ToolCard
                  key={tool.id}
                  tool={tool}
                  action={
                    <FeatureAction href={tool.href}>
                      {toolActionLabel(tool)}
                    </FeatureAction>
                  }
                />
              ))}
            </ul>
            {allPlanned ? (
              <MotionRevealItem className="mt-3 rounded-base border border-dashed border-secondary p-3">
                <p className="text-label-sm text-muted-foreground">
                  None of these are built yet. Each one ships when it actually
                  works — nothing in this section generates, converts or edits a
                  file today.
                </p>
              </MotionRevealItem>
            ) : null}
          </div>
          <FeaturePreviewCard meta={meta}>{preview}</FeaturePreviewCard>
        </MotionRevealGroup>
      </Container>
    </Section>
  );
}
