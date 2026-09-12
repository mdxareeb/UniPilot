import { Check } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { motionIndex } from "@/components/motion/stagger";
import { ClosingCTA } from "./_components/ClosingCTA";
import { FeatureGrid } from "./_components/FeatureGrid";
import { HeroActions } from "./_components/HeroActions";
import { HomeBenchmarksSection } from "./_components/HomeBenchmarksSection";
import { HomeDevsNoteSection } from "./_components/HomeDevsNoteSection";
import { HomeFaqSection } from "./_components/HomeFaqSection";
import { HomePricingSection } from "./_components/HomePricingSection";
import { HowItWorksPreview } from "./_components/HowItWorksPreview";

const trustItems = [
  "Free to start",
  "Upload PDFs",
  "AI deadline extraction",
  "Smart search",
  "No credit card",
];

export default function HomePage() {
  return (
    <>
      <Section id="home" className="scroll-mt-24">
        <Container className="text-center">
          {/* Hero entrance runs eyebrow → headline → description → actions →
              trust row. `data-enter` is CSS-only, so the first screen never
              waits on hydration to become visible. The badge scales in while
              the lines below rise — one coordinated entrance, not five copies
              of the same fade. */}
          <span
            data-enter="scale"
            style={motionIndex(0)}
            className="mb-6 inline-flex items-center gap-2 rounded-base border border-border bg-muted px-3 py-1.5"
          >
            <span
              aria-hidden="true"
              className="size-2 rounded-full bg-primary"
            />
            <span className="text-label-caps uppercase text-muted-foreground">
              Your college. Finally organized.
            </span>
          </span>
          <h1
            data-enter
            style={motionIndex(1)}
            className="mx-auto mb-4 max-w-4xl text-headline-lg-mobile tracking-tight text-foreground md:text-display"
          >
            Your entire college life.
            <br className="hidden md:block" /> Finally{" "}
            <span className="relative inline-block border-b-8 border-primary tracking-widest text-secondary italic font-extrabold">
              organized
            </span>
            .
          </h1>
          <p
            data-enter
            style={motionIndex(2)}
            className="mx-auto mb-8 max-w-2xl text-body-lg text-muted-foreground"
          >
            UniPilot brings your assignments, deadlines, timetable, notices,
            documents and academic plans together — then turns them into clear
            actions.
          </p>
          <HeroActions />
          {/* The entrance animates this wrapper, not the row itself: the row's
              `opacity-60` is part of the design, and a keyframe ending at
              opacity 1 would overwrite it. */}
          <div data-enter style={motionIndex(4)} className="mt-10">
            <div className="flex flex-wrap items-center justify-center gap-4 opacity-60 md:gap-8">
              {trustItems.map((item) => (
                <span
                  key={item}
                  className="flex items-center gap-1 text-sm font-medium"
                >
                  <Check aria-hidden="true" className="size-4" />
                  {item}
                </span>
              ))}
            </div>
          </div>
        </Container>
      </Section>
      <FeatureGrid id="features" />
      <HowItWorksPreview id="how-it-works" />
      <HomePricingSection />
      <HomeBenchmarksSection />
      <HomeFaqSection />
      <HomeDevsNoteSection />
      <ClosingCTA />
    </>
  );
}
