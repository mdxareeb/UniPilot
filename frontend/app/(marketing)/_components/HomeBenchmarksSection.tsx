import { Bot, FileText, Search } from "lucide-react";
import { MotionBar } from "@/components/motion/MotionBar";
import { MotionReveal } from "@/components/motion/MotionReveal";
import {
  MotionRevealGroup,
  MotionRevealItem,
} from "@/components/motion/MotionRevealGroup";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { LearnMoreLink } from "./LearnMoreLink";
import { PageSection } from "./PageSection";

/* A preview of three of the categories on /benchmarks, at the same values that
   page shows. Every figure is a placeholder — nothing has been measured yet —
   so the section is labelled as illustrative in three places: the badge above
   the cards, each card's own caption, and the note below them. The bars carry
   the numbers visually; the full charts, the remaining categories and the
   methodology stay on /benchmarks. */
const highlights = [
  {
    icon: FileText,
    label: "Document processing",
    value: "4s",
    caption: "Illustrative: a 12-page syllabus, read and structured.",
    width: "50%",
  },
  {
    icon: Search,
    label: "Search accuracy",
    value: "9/10",
    caption: "Illustrative: deadline lookups returning the right source.",
    width: "90%",
  },
  {
    icon: Bot,
    label: "AI response time",
    value: "1.6s",
    caption: "Illustrative: a question answered from one document.",
    width: "50%",
  },
];

export function HomeBenchmarksSection() {
  return (
    <PageSection id="benchmarks" className="border-t border-border">
      <Container>
        <MotionReveal repeat>
          <SectionHeader
            align="center"
            eyebrow="Benchmarks"
            title="Built to perform across your academic workflow."
            description="Processing, search and assistant latency are tracked as UniPilot is built. The figures below are illustrative placeholders, not measured results."
            action={<LearnMoreLink href="/benchmarks">Explore benchmarks</LearnMoreLink>}
            className="mb-6"
          />
        </MotionReveal>
        <MotionReveal repeat className="mb-4 flex justify-center">
          <Badge size="sm" variant="outline">
            Illustrative benchmarks
          </Badge>
        </MotionReveal>
        {/* Three cards, one composition: each arrives with depth, and its bar
            then fills from the left. The card places the surface, the bar
            carries the number — two stages rather than one fade. */}
        <MotionRevealGroup
          repeat
          className="grid grid-cols-1 gap-4 md:grid-cols-3"
        >
          {highlights.map((highlight, index) => {
            const Icon = highlight.icon;

            return (
              <MotionRevealItem
                key={highlight.label}
                variant="scale"
                className="min-w-0"
              >
                <Card
                  variant="compact"
                  className="flex h-full min-w-0 flex-col bg-glass p-4"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 text-label-caps uppercase text-muted-foreground">
                      {highlight.label}
                    </span>
                  </div>
                  <p className="mt-3 font-mono text-headline-md text-foreground">
                    {highlight.value}
                  </p>
                  <div className="mt-2.5">
                    <MotionBar width={highlight.width} index={index} />
                  </div>
                  <p className="mt-3 text-label-sm text-muted-foreground">
                    {highlight.caption}
                  </p>
                </Card>
              </MotionRevealItem>
            );
          })}
        </MotionRevealGroup>
        <MotionReveal
          repeat
          as="p"
          className="mt-5 text-center text-label-sm text-muted-foreground"
        >
          Illustrative values — measured benchmarks replace these before launch.
        </MotionReveal>
      </Container>
    </PageSection>
  );
}
