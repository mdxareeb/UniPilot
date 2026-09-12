import { motionIndex } from "@/components/motion/stagger";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { HowItWorksClosingCTA } from "./_components/HowItWorksClosingCTA";
import { WorkflowTimeline } from "./_components/WorkflowTimeline";

export default function HowItWorksPage() {
  return (
    <>
      <Section>
        <Container className="flex flex-col items-center text-center">
          <span
            data-enter
            style={motionIndex(0)}
            className="text-label-caps uppercase text-muted-foreground"
          >
            How it works
          </span>
          <h1
            data-enter
            style={motionIndex(1)}
            className="mt-4 max-w-4xl text-headline-lg-mobile text-foreground md:text-display"
          >
            Upload. Index. Ask.
          </h1>
          <p
            data-enter
            style={motionIndex(2)}
            className="mt-4 max-w-2xl text-body-lg text-muted-foreground"
          >
            Five steps from a folder of PDFs to a plan for the week. Everything
            after the first upload runs on material you already have.
          </p>

          {/* Five markers for five steps. The timeline below turns this on its
              side and fills it in.

              `scale` rather than the default rise: the three lines above it
              have already risen, and a rail is the one thing in this hero that
              is a shape rather than a sentence — it should grow into place. */}
          <div
            aria-hidden="true"
            data-enter="scale"
            style={motionIndex(3)}
            className="mt-8 hidden w-full max-w-md items-center md:flex"
          >
            <span className="size-2.5 shrink-0 rounded-full border border-border bg-card" />
            <span className="h-px flex-1 bg-border" />
            <span className="size-2.5 shrink-0 rounded-full border border-border bg-card" />
            <span className="h-px flex-1 bg-border" />
            <span className="size-2.5 shrink-0 rounded-full border border-border bg-card" />
            <span className="h-px flex-1 bg-border" />
            <span className="size-2.5 shrink-0 rounded-full border border-border bg-card" />
            <span className="h-px flex-1 bg-border" />
            <span className="size-2.5 shrink-0 rounded-full border border-border bg-card" />
          </div>
        </Container>
      </Section>

      <WorkflowTimeline />

      <HowItWorksClosingCTA />
    </>
  );
}
