import { Container } from "@/components/ui/Container";
import { MotionReveal } from "@/components/motion/MotionReveal";
import { PageSection } from "./PageSection";
import { PricingCards } from "./PricingCards";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { LearnMoreLink } from "./LearnMoreLink";

export function HomePricingSection() {
  return (
    <PageSection id="pricing">
      <Container className="mb-8">
        <MotionReveal repeat>
          <SectionHeader
            align="center"
            eyebrow="Pricing"
            title="Start free. Upgrade when you need more."
            description="One workspace for tasks, deadlines, documents and your AI assistant — with a plan for every stage of college."
            action={<LearnMoreLink href="/pricing" />}
            className="mb-0"
          />
        </MotionReveal>
      </Container>
      <PricingCards />
    </PageSection>
  );
}
