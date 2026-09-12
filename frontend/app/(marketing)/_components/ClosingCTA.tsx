"use client";

import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import {
  MotionRevealGroup,
  MotionRevealItem,
} from "@/components/motion/MotionRevealGroup";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";

/**
 * The page's last section, and the one place on the marketing site where the
 * three elements are a single sentence being delivered: the headline lands, the
 * supporting line follows it, and the button arrives with depth (`scale`) rather
 * than rising like the text — the thing to click reads as a surface, not a line
 * of copy. One group, one observer, one timeline.
 */
export function ClosingCTA() {
  const router = useRouter();

  return (
    <Section className="bg-dotted-cta">
      <Container className="flex flex-col items-center text-center">
        <MotionRevealGroup repeat className="flex w-full flex-col items-center">
          <MotionRevealItem
            as="h2"
            className="mb-4 max-w-3xl text-headline-lg-mobile text-surface-cta-foreground md:text-headline-lg"
          >
            Stop searching through your college life. Know what to do next.
          </MotionRevealItem>
          <MotionRevealItem
            as="p"
            className="mb-8 max-w-2xl text-body-lg text-surface-cta-foreground/70"
          >
            Upload your first document and let UniPilot organize the rest.
          </MotionRevealItem>
          <MotionRevealItem variant="scale" className="w-full sm:w-auto">
            <Button
              variant="cta"
              size="lg"
              onClick={() => router.push("/signup")}
              className="w-full focus-visible:ring-surface-cta-foreground! focus-visible:ring-offset-surface-cta! sm:w-auto"
            >
              Start free — build my dashboard
              <ArrowRight aria-hidden="true" className="size-4" />
            </Button>
          </MotionRevealItem>
        </MotionRevealGroup>
      </Container>
    </Section>
  );
}
