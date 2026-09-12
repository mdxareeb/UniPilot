import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { MotionReveal } from "@/components/motion/MotionReveal";
import {
  MotionRevealGroup,
  MotionRevealItem,
} from "@/components/motion/MotionRevealGroup";
import { PageSection } from "./PageSection";
import { LearnMoreLink } from "./LearnMoreLink";

const faqs = [
  {
    question: "Is my data private?",
    answer:
      "Your documents stay in your own workspace. Nothing outside your uploaded materials is searched or used for answers.",
  },
  {
    question: "What file types can I upload?",
    answer:
      "PDFs and other common academic documents like assignment briefs, syllabi and lecture notes.",
  },
  {
    question: "How accurate is the task extraction?",
    answer:
      "UniPilot extracts deadlines and tasks from your documents and shows the source, so you can always verify.",
  },
  {
    question: "Can I cancel anytime?",
    answer:
      "Yes. You can start on the free plan and upgrade or cancel whenever you want.",
  },
  {
    question: "Is there really a free plan?",
    answer:
      "Yes. The free plan includes the core workspace — upgrade to Pro only when you need more.",
  },
  {
    question: "Where can I get support?",
    answer:
      "Reach out through the site and we'll help you get your workspace set up.",
  },
];

export function HomeFaqSection() {
  return (
    <PageSection id="faq" className="border-t border-border">
      <Container>
        <MotionReveal repeat>
          <SectionHeader
            align="center"
            eyebrow="FAQ"
            title="Questions, answered simply."
            description="A quick overview. The full FAQ covers privacy, file types, accuracy, plans and more."
            action={<LearnMoreLink href="/faq" />}
            className="mb-10"
          />
        </MotionReveal>
        {/* Two columns converging: the left column's cards arrive from the left,
            the right column's from the right, in reading order. The pairing is
            what the animation says — a question and its answer meeting in the
            middle of the page — and it is deliberately not the rise used by the
            section header above it. */}
        <MotionRevealGroup
          repeat
          className="mx-auto grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-2"
        >
          {faqs.map((item, index) => (
            <MotionRevealItem
              key={item.question}
              variant={index % 2 === 0 ? "left" : "right"}
              className="min-w-0"
            >
              <Card className="flex h-full min-w-0 flex-col gap-2 bg-glass p-6">
                <h3 className="text-body-lg font-semibold text-foreground">
                  {item.question}
                </h3>
                <p className="text-body-md text-muted-foreground">
                  {item.answer}
                </p>
              </Card>
            </MotionRevealItem>
          ))}
        </MotionRevealGroup>
      </Container>
    </PageSection>
  );
}
