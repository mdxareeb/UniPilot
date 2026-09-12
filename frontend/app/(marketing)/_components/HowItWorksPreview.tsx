import { FileText, Upload } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusIndicator } from "@/components/ui/StatusIndicator";
import { MotionReveal } from "@/components/motion/MotionReveal";
import {
  MotionRevealGroup,
  MotionRevealItem,
} from "@/components/motion/MotionRevealGroup";
import { LearnMoreLink } from "./LearnMoreLink";

/* One preview per step, each showing only that step's output — the file that
   arrived, the facts pulled out of it, the answer, the list, the comparison.
   They are `aria-hidden`: the list is already an ordered list with a written
   description per step, so the sample data adds nothing to read aloud. */

const previewShell =
  "flex flex-col gap-1.5 rounded-base border border-border bg-glass-subtle p-2.5";
const previewRow =
  "flex items-center justify-between gap-2 rounded-base border border-border bg-card px-2.5 py-2";
const metaText = "shrink-0 font-mono text-label-caps text-muted-foreground";

function UploadStepPreview() {
  const files = ["Syllabus.pdf", "Assignment 2.docx"];

  return (
    <div aria-hidden="true" className={previewShell}>
      {files.map((file) => (
        <div key={file} className={previewRow}>
          <div className="flex min-w-0 items-center gap-2">
            <Upload className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-label-sm text-foreground">
              {file}
            </span>
          </div>
          <Badge size="sm" variant="outline" className="shrink-0">
            Uploaded
          </Badge>
        </div>
      ))}
    </div>
  );
}

function IndexStepPreview() {
  const facts = [
    { label: "Task", value: "Assignment 2" },
    { label: "Deadline", value: "Wednesday" },
  ];

  return (
    <div aria-hidden="true" className={previewShell}>
      <div className="flex items-center gap-2 px-0.5">
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-label-caps text-muted-foreground">
          DBMS Assignment Brief.pdf
        </span>
      </div>
      {facts.map((fact) => (
        <div key={fact.label} className={previewRow}>
          <Badge size="sm" variant="outline" className="shrink-0">
            {fact.label}
          </Badge>
          <span className="truncate text-label-sm font-medium text-foreground">
            {fact.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function AskStepPreview() {
  return (
    <div aria-hidden="true" className={previewShell}>
      <div className="flex justify-end">
        <p className="max-w-[88%] rounded-base bg-primary px-2.5 py-1.5 text-label-sm text-primary-foreground">
          When is my next deadline?
        </p>
      </div>
      <div className="flex flex-col gap-1.5 rounded-base border border-border bg-card px-2.5 py-2">
        <p className="text-label-sm text-foreground">
          Wednesday — DBMS Assignment 2.
        </p>
        <span className="truncate font-mono text-label-caps text-muted-foreground">
          From: DBMS Assignment Brief.pdf
        </span>
      </div>
    </div>
  );
}

function TrackStepPreview() {
  const deadlines = [
    {
      date: "Wed 11",
      name: "DBMS Assignment 2",
      status: "warning" as const,
      label: "Due soon",
    },
    {
      date: "Fri 13",
      name: "IEEE Report draft",
      status: "neutral" as const,
      label: "Planned",
    },
  ];

  return (
    <div aria-hidden="true" className={previewShell}>
      {deadlines.map((deadline) => (
        <div key={deadline.date} className={previewRow}>
          <div className="flex min-w-0 items-baseline gap-2">
            <span className={metaText}>{deadline.date}</span>
            <span className="truncate text-label-sm text-foreground">
              {deadline.name}
            </span>
          </div>
          <StatusIndicator
            size="sm"
            status={deadline.status}
            label={deadline.label}
            className="shrink-0"
          />
        </div>
      ))}
    </div>
  );
}

function PlanStepPreview() {
  /* A comparison, not a generated timetable. UniPilot weighs what is due
     against the time left; it does not schedule the week for you, so the
     preview does not imply that it does. */
  const rows = [
    { label: "Due this week", value: "7.5h" },
    { label: "Time available", value: "4h" },
  ];

  return (
    <div aria-hidden="true" className={previewShell}>
      {rows.map((row) => (
        <div key={row.label} className={previewRow}>
          <span className="truncate text-label-sm text-foreground">
            {row.label}
          </span>
          <span className={metaText}>{row.value}</span>
        </div>
      ))}
      <p className="px-0.5 text-label-sm text-muted-foreground">
        Assignment 2 first — closest deadline.
      </p>
    </div>
  );
}

const steps = [
  {
    number: "01",
    title: "Upload materials",
    description:
      "Bring in the syllabi, briefs and lecture notes you already have. PDF and DOCX.",
    preview: UploadStepPreview,
  },
  {
    number: "02",
    title: "Index materials",
    description:
      "UniPilot reads each file and pulls out the courses, tasks and dates inside it.",
    preview: IndexStepPreview,
  },
  {
    number: "03",
    title: "Ask the assistant",
    description:
      "Ask about your own workspace. Every answer names the document it came from.",
    preview: AskStepPreview,
  },
  {
    number: "04",
    title: "Track tasks and deadlines",
    description:
      "Extracted work becomes a list you can act on, ordered by what is due next.",
    preview: TrackStepPreview,
  },
  {
    number: "05",
    title: "Plan what comes next",
    description:
      "UniPilot compares the work ahead with the time you have and shows where to start.",
    preview: PlanStepPreview,
  },
];

export function HowItWorksPreview({ id }: { id?: string }) {
  return (
    <Section
      id={id}
      className="scroll-mt-24 border-t border-border [--section-padding:40px] md:[--section-padding:72px]"
    >
      <Container>
        <MotionReveal repeat>
          <SectionHeader
            align="center"
            eyebrow="How it works"
            title="From a folder of PDFs to a plan."
            description="Set it up once. Everything after that runs on the material you have already uploaded."
            action={<LearnMoreLink href="/how-it-works" />}
            className="mb-8"
          />
        </MotionReveal>
        {/* A real ordered list: the steps only make sense in this order, and
            the numbering is the content rather than decoration. The visible
            badges are aria-hidden — the list already conveys the sequence. */}
        <ol className="mx-auto max-w-3xl">
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1;

            return (
              /* One group per step, so a step is one observer and one
                 timeline: badge, then copy, then preview. Three independent
                 reveals agreeing on delays would be fifteen observers on this
                 page and no guarantee the badge actually leads. */
              <MotionRevealGroup
                as="li"
                repeat
                key={step.number}
                className="relative flex gap-4 md:gap-6"
              >
                {/* The spine is drawn once per step and never animates. It is
                    part of the page's structure, like the dotted background:
                    content reveals against it, it does not reveal itself.
                    Absolutely positioned so the badge's reveal transform can
                    never drag it out of alignment. Left plain on purpose —
                    a child with no variants of its own sits out the group's
                    timeline entirely. */}
                {!isLast && (
                  <span
                    aria-hidden="true"
                    className="absolute top-10 bottom-0 left-4 w-px -translate-x-1/2 bg-border md:top-12 md:left-5"
                  />
                )}
                <MotionRevealItem
                  as="span"
                  aria-hidden="true"
                  className="relative flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-card font-mono text-label-sm font-semibold text-foreground md:size-10"
                >
                  {step.number}
                </MotionRevealItem>
                <div
                  className={`flex min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-start lg:gap-8${
                    isLast ? "" : " pb-8 md:pb-10"
                  }`}
                >
                  {/* Directional timeline motion: the copy slides in from the
                      spine side, the preview from the outer edge, so each step
                      converges onto the timeline instead of repeating the
                      header's rise. Both are members of the step's group —
                      the plain wrapper between them and it does not interrupt
                      Motion's variant propagation. */}
                  <MotionRevealItem
                    variant="left"
                    className="min-w-0 lg:flex-1"
                  >
                    <h3 className="text-headline-md text-foreground">
                      {step.title}
                    </h3>
                    <p className="mt-2 text-body-md text-muted-foreground">
                      {step.description}
                    </p>
                  </MotionRevealItem>
                  <MotionRevealItem
                    variant="right"
                    className="min-w-0 lg:w-[19rem] lg:shrink-0"
                  >
                    <step.preview />
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
