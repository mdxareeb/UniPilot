import type { ReactNode } from "react";
import {
  MotionRevealGroup,
  MotionRevealItem,
} from "@/components/motion/MotionRevealGroup";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import {
  AskStepPreview,
  IndexStepPreview,
  PlanStepPreview,
  TrackStepPreview,
  UploadStepPreview,
} from "./StepPreviews";

type Detail = {
  text: string;
  /* Set only where the step describes something that is not built. */
  status?: string;
};

type Step = {
  number: string;
  label: string;
  title: string;
  description: string;
  details: Detail[];
  preview: ReactNode;
};

/* The same five steps, in the same order, as the workflow on the homepage. That
   page states each step in one line; this one gives each its own detail rows and
   a preview of what it leaves behind. Numbering is honest here — the steps are a
   real sequence, and step 03 cannot happen before step 02. */
const steps: Step[] = [
  {
    number: "01",
    label: "Bring it in",
    title: "Upload materials",
    description:
      "Start with the documents you already have. Nothing needs rewriting or re-entering by hand.",
    details: [
      { text: "Syllabus and course outline" },
      { text: "Assignment briefs" },
      { text: "Lecture notes and handouts" },
      { text: "Supported formats: PDF and DOCX" },
    ],
    preview: <UploadStepPreview />,
  },
  {
    number: "02",
    label: "Read and structure",
    title: "Index your workspace",
    description:
      "UniPilot reads each file, pulls out what matters and turns it into information the rest of the workspace can use.",
    details: [
      { text: "Parsing — text is read out of the file" },
      { text: "Extraction — courses, tasks and dates are identified" },
      { text: "Indexing — that content becomes searchable" },
      { text: "Status — each file shows uploaded, indexing or indexed" },
    ],
    preview: <IndexStepPreview />,
  },
  {
    number: "03",
    label: "Ask",
    title: "Ask the assistant",
    description:
      "Ask questions across everything you uploaded. Answers come from your own material and say where they came from.",
    details: [
      { text: "Questions in plain language, across every indexed document" },
      { text: "Grounded in your uploads, not the open web" },
      { text: "Each answer names its source document and page" },
      { text: "Creating or updating tasks for you", status: "Planned" },
    ],
    preview: <AskStepPreview />,
  },
  {
    number: "04",
    label: "Track",
    title: "Track tasks & deadlines",
    description:
      "Extracted work becomes a list you can act on, ordered by what is due next and carried onto the calendar.",
    details: [
      { text: "Tasks taken from the documents that set them" },
      { text: "Due dates carried across from the source" },
      { text: "Status: planned, in progress, due soon, done" },
      { text: "The same dates appear on your academic calendar" },
    ],
    preview: <TrackStepPreview />,
  },
  {
    number: "05",
    label: "Plan",
    title: "Plan what comes next",
    description:
      "UniPilot weighs the work ahead against the time you have left, then shows where to start.",
    details: [
      { text: "Upcoming deadlines, added up" },
      { text: "Weeks where the work outruns the time available stand out" },
      { text: "The closest and heaviest deadline is surfaced first" },
      { text: "You choose the order — UniPilot does not schedule your week" },
    ],
    preview: <PlanStepPreview />,
  },
];

export function WorkflowTimeline() {
  return (
    <Section
      id="workflow"
      className="scroll-mt-24 border-t border-border [--section-padding:40px] md:[--section-padding:64px]"
    >
      <Container>
        <ol className="mx-auto max-w-4xl">
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1;

            return (
              /* One step, one composition: the marker lands with depth, the
                 copy comes in from the spine side, and the detail card follows
                 from the right — the same directional pairing the homepage
                 workflow preview uses, so the two pages read as one product.
                 Grouping also means one observer per step rather than three. */
              <MotionRevealGroup
                as="li"
                repeat
                key={step.number}
                className="relative flex gap-4 md:gap-6"
              >
                {/* The spine. One hairline in the existing border colour, drawn
                    from under the badge to the bottom of the step, and never
                    animated. Absolutely positioned so the badge's reveal
                    transform cannot drag it out of alignment. It sits outside
                    the group's members for the same reason. */}
                {!isLast ? (
                  <span
                    aria-hidden="true"
                    className="absolute top-10 bottom-0 left-4 w-px -translate-x-1/2 bg-border md:top-12 md:left-5"
                  />
                ) : null}
                <MotionRevealItem
                  as="span"
                  variant="scale"
                  aria-hidden="true"
                  className="relative flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-card font-mono text-label-sm font-semibold text-foreground md:size-10"
                >
                  {step.number}
                </MotionRevealItem>
                <div
                  className={`flex min-w-0 flex-1 flex-col${
                    isLast ? "" : " pb-10 md:pb-14"
                  }`}
                >
                  <MotionRevealItem variant="left" className="min-w-0">
                    <span className="text-label-caps uppercase text-muted-foreground">
                      {step.label}
                    </span>
                    <h2 className="mt-2 text-headline-md tracking-tight text-foreground md:text-headline-lg-mobile">
                      {step.title}
                    </h2>
                    <p className="mt-2 max-w-prose text-body-lg text-muted-foreground">
                      {step.description}
                    </p>
                  </MotionRevealItem>
                  <MotionRevealItem
                    variant="right"
                    className="mt-5 flex min-w-0"
                  >
                    {/* Same translucent surface as the homepage and pricing
                        cards. No hover treatment: a step is not a control. */}
                    <Card
                      variant="compact"
                      className="flex min-w-0 flex-1 flex-col gap-4 bg-glass p-4 lg:flex-row lg:items-start lg:gap-6"
                    >
                      <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
                        {step.details.map((detail) => (
                          <li
                            key={detail.text}
                            className="flex items-center justify-between gap-2 rounded-base border border-border bg-card px-2.5 py-2"
                          >
                            <span className="min-w-0 text-label-sm text-muted-foreground">
                              {detail.text}
                            </span>
                            {detail.status ? (
                              <Badge
                                size="sm"
                                variant="outline"
                                className="shrink-0"
                              >
                                {detail.status}
                              </Badge>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      <div className="min-w-0 lg:w-[17rem] lg:shrink-0">
                        {step.preview}
                      </div>
                    </Card>
                  </MotionRevealItem>
                </div>
              </MotionRevealGroup>
            );
          })}
        </ol>
      </Container>
    </Section>
  );
}
