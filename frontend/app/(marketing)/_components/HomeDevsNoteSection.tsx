import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { SectionHeader } from "@/components/ui/SectionHeader";
import {
  MotionRevealGroup,
  MotionRevealItem,
} from "@/components/motion/MotionRevealGroup";
import { PageSection } from "./PageSection";

export function HomeDevsNoteSection() {
  return (
    <PageSection id="devs-note" className="border-t border-border">
      <Container>
        {/* Heading first, then the quote — the header rises and the card behind
            it arrives with depth, so the pull-quote reads as a surface being
            placed rather than another paragraph sliding up. */}
        <MotionRevealGroup repeat>
          <MotionRevealItem>
            <SectionHeader
              align="center"
              eyebrow="Dev's note"
              title="Built by a student, for students."
              description="UniPilot started as a personal workaround for a scattered college life. Read the full story behind it."
              className="mb-10"
            />
          </MotionRevealItem>
          <MotionRevealItem variant="scale">
            <Card className="mx-auto max-w-2xl bg-glass p-8 text-center">
              <p className="text-body-lg text-foreground">
                &quot;I built UniPilot because no tool connected my syllabi, my
                deadlines and my schedule the way college actually works.&quot;
              </p>
              <p className="mt-4 text-label-caps uppercase text-muted-foreground">
                Founder, UniPilot
              </p>
              <Link
                href="/devs-note"
                className="action-arrow mt-6 inline-flex items-center gap-1 rounded-base text-label-sm text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                Read the full note
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </Link>
            </Card>
          </MotionRevealItem>
        </MotionRevealGroup>
      </Container>
    </PageSection>
  );
}
