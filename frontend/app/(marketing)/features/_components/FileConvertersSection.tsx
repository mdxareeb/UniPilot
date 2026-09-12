import { ArrowLeftRight } from "lucide-react";
import {
  MotionRevealGroup,
  MotionRevealItem,
} from "@/components/motion/MotionRevealGroup";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { getTool, toolStatusLabel } from "@/components/tools/toolCatalog";
import {
  FeaturePreviewCard,
  FeatureSectionHeader,
} from "./FeatureDetailSection";
import { ToolkitConceptPreview } from "./FeaturePreviews";

/* Nine utilities is a list; three jobs is an idea. Grouping them by what a
   student is actually trying to do keeps the section from reading as a feature
   dump, and it makes the honesty consistent — the whole family is planned, so
   every group carries the same badge instead of nine repeated ones. */
const groups: { title: string; detail: string; utilities: string[] }[] = [
  {
    title: "Convert",
    detail:
      "Move a file between the format you were given and the one you have to hand in.",
    utilities: ["PDF → DOCX", "DOCX → PDF", "Image → PDF", "PDF → Image"],
  },
  {
    title: "Combine and split",
    detail:
      "Put a submission together from separate files, or pull one section out of a long PDF.",
    utilities: ["Merge PDFs", "Split PDFs", "Extract pages"],
  },
  {
    title: "Clean up",
    detail:
      "Get a file under an upload limit, or read text out of a scan or a photograph.",
    utilities: ["Compress PDF", "OCR — where supported"],
  },
];

/**
 * Every conversion in one section, rather than a card per direction.
 *
 * "PDF to DOCX" and "DOCX to PDF" are the same tool pointed two ways, and a grid
 * that carded each direction separately would turn one capability into nine and
 * make the page look like it does more than it does.
 *
 * `id="document-tools"` is kept from when this section was called the Document
 * Toolkit. Two homepage cards and the tool catalogue's `file-converters` entry
 * link to that anchor, and renaming it would break them to no one's benefit.
 */
export function FileConvertersSection() {
  /* The family's name, state and status word come from the registry entry, so
     this expanded section and the "File converters" card everywhere else move
     together. */
  const converters = getTool("file-converters");

  return (
    <Section
      id="document-tools"
      className="scroll-mt-24 border-t border-border [--section-padding:40px] md:[--section-padding:64px]"
    >
      <Container>
        <MotionRevealGroup
          repeat
          className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:gap-10"
        >
          <div className="min-w-0">
            <FeatureSectionHeader
              icon={ArrowLeftRight}
              eyebrow={converters.name}
              status={converters.status === "planned" ? "Not yet available" : undefined}
              title="Hand it in in the format they asked for."
              description="Coursework rarely arrives in the format you need to hand it back in. This is the one place UniPilot is intended to carry every conversion, so preparing a submission does not mean leaving for a free converter site and uploading your work to it."
            />
            <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {groups.map((group) => (
                <MotionRevealItem
                  as="li"
                  key={group.title}
                  variant="scale"
                  className="flex min-w-0"
                >
                  <Card
                    variant="compact"
                    className="flex min-w-0 flex-1 flex-col gap-3 bg-glass p-4 hover-lift hover:border-foreground"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                      <h4 className="text-body-md font-medium text-foreground">
                        {group.title}
                      </h4>
                      <Badge size="sm" variant="outline" className="shrink-0">
                        Planned
                      </Badge>
                    </div>
                    <p className="text-label-sm text-muted-foreground">
                      {group.detail}
                    </p>
                    {/* Dashed chips, not solid ones. Every other bordered row on
                        this page describes something that exists; the dash is
                        what separates these from those. */}
                    <ul className="mt-auto flex flex-wrap gap-1.5">
                      {group.utilities.map((utility) => (
                        <li
                          key={utility}
                          className="rounded-base border border-dashed border-secondary px-2 py-1 font-mono text-label-caps text-muted-foreground"
                        >
                          {utility}
                        </li>
                      ))}
                    </ul>
                  </Card>
                </MotionRevealItem>
              ))}
            </ul>
            <MotionRevealItem className="mt-3 rounded-base border border-dashed border-secondary p-3">
              <p className="text-label-sm text-muted-foreground">
                File conversion isn&rsquo;t built yet. These tools ship once
                they are implemented and tested — nothing shown here is live
                today.
              </p>
            </MotionRevealItem>
          </div>
          <FeaturePreviewCard meta={toolStatusLabel(converters)}>
            <ToolkitConceptPreview />
          </FeaturePreviewCard>
        </MotionRevealGroup>
      </Container>
    </Section>
  );
}
