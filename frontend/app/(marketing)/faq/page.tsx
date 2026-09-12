import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { motionIndex } from "@/components/motion/stagger";
import {
  MotionRevealGroup,
  MotionRevealItem,
} from "@/components/motion/MotionRevealGroup";
import { FaqAccordion } from "./_components/FaqAccordion";

const faqs = [
  {
    question: "Is my data private and secure?",
    answer:
      "Your documents stay in your own workspace. Answers are generated only from materials you upload — nothing outside your workspace is searched.",
  },
  {
    question: "What file types can I upload?",
    answer:
      "PDFs and DOCX files are supported. Common academic files like syllabi, assignment briefs and lecture notes all work.",
  },
  {
    question: "How accurate is the OCR and document search?",
    answer:
      "UniPilot shows the source document and page for every extracted deadline and answer, so you can verify each result yourself. OCR and search accuracy aren't measured yet — accuracy figures will be published once the features are fully implemented and tested.",
  },
  {
    question: "Can I cancel my subscription anytime?",
    answer:
      "Yes — you'll be able to cancel anytime from your account. Subscriptions aren't live yet, so nothing is charged during the current stage.",
  },
  {
    question: "Does UniPilot integrate with Google Calendar or Canvas?",
    answer:
      "Not yet. Google Calendar and Canvas integrations are planned but not yet available. Until then, you can upload your schedule as a document and UniPilot will extract your classes and deadlines.",
  },
  {
    question: "Is there a free plan?",
    answer:
      "Yes. The free plan includes a basic dashboard, limited document uploads, task extraction, a basic AI assistant, a weekly overview and basic search.",
  },
];

export default function FaqPage() {
  return (
    <>
      <Section>
        <Container className="flex flex-col items-center text-center">
          <span
            data-enter
            style={motionIndex(0)}
            className="text-label-caps uppercase text-muted-foreground"
          >
            FAQ
          </span>
          <h1
            data-enter
            style={motionIndex(1)}
            className="mt-4 max-w-4xl text-headline-lg-mobile text-foreground md:text-display"
          >
            Questions about your academic OS.
          </h1>
          <p
            data-enter
            style={motionIndex(2)}
            className="mt-4 max-w-2xl text-body-lg text-muted-foreground"
          >
            Find clear answers about UniPilot, your workspace and how it fits
            into your college life.
          </p>
        </Container>
      </Section>
      <Section className="border-t border-border">
        <Container>
          {/* Two entrances rather than one fade of the whole page body. The
              panel is the page's only real surface, so it arrives with depth;
              the line under it rises after. Animating the `Container` itself
              meant transforming everything on the page at once for no gain —
              and the FAQ's characteristic motion is the expansion inside the
              panel, which `Collapsible` already owns. */}
          <MotionRevealGroup repeat>
            <MotionRevealItem variant="scale">
              <FaqAccordion items={faqs} />
            </MotionRevealItem>
            <MotionRevealItem
              as="p"
              className="mt-8 text-center text-body-md text-muted-foreground"
            >
              Still have questions? Reach out at{" "}
              <a
                href="mailto:support@unipilot.app"
                className="rounded-base text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                support@unipilot.app
              </a>
            </MotionRevealItem>
          </MotionRevealGroup>
        </Container>
      </Section>
    </>
  );
}
