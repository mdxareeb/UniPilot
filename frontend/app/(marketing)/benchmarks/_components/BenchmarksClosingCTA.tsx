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

/** Coordinated closing entrance — see the homepage `ClosingCTA` for the shape. */
export function BenchmarksClosingCTA() {
  const router = useRouter();

  return (
    <Section className="bg-dotted-cta">
      <Container className="flex flex-col items-center text-center">
        <MotionRevealGroup repeat className="flex w-full flex-col items-center">
          <MotionRevealItem
            as="h2"
            className="max-w-3xl text-headline-lg-mobile text-surface-cta-foreground md:text-headline-lg"
          >
            Ready to put your academic workspace to work?
          </MotionRevealItem>
          <MotionRevealItem
            as="p"
            className="mt-4 max-w-2xl text-body-lg text-surface-cta-foreground/70"
          >
            Bring your documents, tasks and deadlines together in one clear
            workspace.
          </MotionRevealItem>
          <MotionRevealItem variant="scale" className="mt-8 w-full sm:w-auto">
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
