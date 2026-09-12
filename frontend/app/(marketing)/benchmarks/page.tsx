import type { ComponentType } from "react";
import { BookOpen, Bot, CheckSquare, FileText, Search, Wrench } from "lucide-react";
import { motionIndex } from "@/components/motion/stagger";
import { MotionBar } from "@/components/motion/MotionBar";
import {
  MotionRevealGroup,
  MotionRevealItem,
} from "@/components/motion/MotionRevealGroup";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { BenchmarksClosingCTA } from "./_components/BenchmarksClosingCTA";

/* -------------------------------------------------------------------------- */
/*  Data. Every figure on this page is a placeholder carried over from the     */
/*  previous version — no measured benchmark data exists in the repo yet, so   */
/*  nothing here may be presented as a result. Categories without even a       */
/*  placeholder are rendered as a planned state instead of being given a       */
/*  made-up number.                                                            */
/* -------------------------------------------------------------------------- */

const processingRows = [
  { label: "Syllabus", meta: "PDF · 12 pages", value: "4s", width: "50%" },
  { label: "Assignment brief", meta: "PDF · 4 pages", value: "2s", width: "25%" },
  { label: "Lecture notes", meta: "PDF · 18 pages", value: "6s", width: "75%" },
];

const searchRows = [
  { label: "Deadline lookup", meta: "due date queries", value: "9/10", width: "90%" },
  { label: "Topic search", meta: "concept queries", value: "8/10", width: "80%" },
  { label: "Source citation", meta: "reference queries", value: "7/10", width: "70%" },
];

const aiRows = [
  { label: "Simple question", meta: "single answer", value: "0.8s", width: "25%" },
  { label: "Document question", meta: "one source", value: "1.6s", width: "50%" },
  { label: "Multi-document", meta: "several sources", value: "2.4s", width: "75%" },
];

/* -------------------------------------------------------------------------- */
/*  Bar chart — compact, reusable. Matches the established bar style from the  */
/*  earlier benchmarks page but sits in a tighter card.                       */
/* -------------------------------------------------------------------------- */

type BarRow = { label: string; meta: string; value: string; width: string };

function BarChart({
  rows,
  valueWidth = "w-10",
}: {
  rows: BarRow[];
  valueWidth?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, index) => (
        <div key={row.label} className="flex items-center gap-3">
          <div className="w-32 min-w-0 shrink-0 sm:w-36">
            <p className="text-label-sm font-medium text-foreground">
              {row.label}
            </p>
            <p className="font-mono text-label-caps text-muted-foreground">
              {row.meta}
            </p>
          </div>
          <MotionBar
            width={row.width}
            index={index}
            trackClassName="h-1.5 flex-1 overflow-hidden rounded-pill bg-muted"
          />
          <span
            className={`${valueWidth} shrink-0 text-right font-mono text-label-sm text-foreground`}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Illustrative disclaimer — reused inside every card that carries placeholder */
/*  numbers. Two lines: the note and a tighter repeat of the global stance.    */
/* -------------------------------------------------------------------------- */

function IllustrativeNote() {
  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="text-label-sm text-muted-foreground">
        Illustrative values — measured benchmarks replace these before launch.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Planned-state card — for categories where no measurement exists yet.       */
/* -------------------------------------------------------------------------- */

function PlannedCategory({
  icon: Icon,
  eyebrow,
  title,
  description,
  dimensions,
}: {
  icon: ComponentType<{ className?: string }>;
  eyebrow: string;
  title: string;
  description: string;
  dimensions: string[];
}) {
  return (
    <MotionRevealItem variant="scale" className="flex min-w-0">
      <Card
        variant="compact"
        className="flex min-w-0 flex-1 flex-col bg-glass p-5 md:p-6"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <div className="flex items-center gap-2">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-label-caps uppercase text-muted-foreground">
              {eyebrow}
            </span>
          </div>
          {/* The badge sits with the category label rather than under the chart,
              because here it replaces the chart. */}
          <Badge size="sm" variant="outline">
            Measurement planned
          </Badge>
        </div>
        <h2 className="mt-3 text-headline-md tracking-tight text-foreground">
          {title}
        </h2>
        <p className="mt-2 text-body-md text-muted-foreground">{description}</p>
        <p className="mt-5 text-label-caps uppercase text-muted-foreground">
          What will be measured
        </p>
        {/* Named dimensions, no values. The rows say what the benchmark will
            cover; inventing a percentage for any of them would be a claim. */}
        <ul className="mt-3 flex flex-col gap-1.5">
          {dimensions.map((dimension) => (
            <li
              key={dimension}
              className="rounded-base border border-border bg-card px-2.5 py-2"
            >
              <span className="min-w-0 text-label-sm text-muted-foreground">
                {dimension}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-label-sm text-muted-foreground">
            Measurement planned — real production data will be added before
            launch.
          </p>
        </div>
      </Card>
    </MotionRevealItem>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function BenchmarksPage() {
  return (
    <>
      {/* ---- Hero ---- */}
      <Section>
        <Container className="flex flex-col items-center text-center">
          <span
            data-enter
            style={motionIndex(0)}
            className="text-label-caps uppercase text-muted-foreground"
          >
            Benchmarks
          </span>
          <h1
            data-enter
            style={motionIndex(1)}
            className="mt-4 max-w-4xl text-headline-lg-mobile tracking-tight text-foreground md:text-display"
          >
            How UniPilot will be measured.
          </h1>
          <p
            data-enter
            style={motionIndex(2)}
            className="mt-4 max-w-2xl text-body-lg text-muted-foreground"
          >
            Processing time, retrieval quality, assistant latency and extraction
            accuracy — the categories UniPilot is being built against, and the
            method behind each one. The figures on this page are placeholders
            until the real measurements are run.
          </p>
        </Container>
      </Section>

      {/* ---- Row 1: Document Processing (full width) ---- */}
      <Section className="border-t border-border [--section-padding:40px] md:[--section-padding:64px]">
        <Container>
          {/* Label, headline, lede, then the chart surface arriving with depth
              — and only then do the bars fill, on `MotionBar`'s own timing. The
              three stages are the point: the section names itself, puts down a
              surface, and then draws on it. */}
          <MotionRevealGroup repeat>
            <MotionRevealItem className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
              <div className="flex items-center gap-2">
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="text-label-caps uppercase text-muted-foreground">
                  Document processing
                </span>
              </div>
            </MotionRevealItem>
            <MotionRevealItem
              as="h2"
              className="mt-3 max-w-2xl text-headline-md tracking-tight text-foreground"
            >
              From upload to structured information.
            </MotionRevealItem>
            <MotionRevealItem
              as="p"
              className="mt-2 max-w-2xl text-body-md text-muted-foreground"
            >
              How long it takes UniPilot to read a file and pull out the
              courses, tasks, deadlines and topics inside it.
            </MotionRevealItem>
            <MotionRevealItem variant="scale">
              <Card variant="compact" className="mt-5 bg-glass p-5 md:p-6">
                <div className="flex items-center justify-between">
                  <p className="text-label-caps uppercase text-muted-foreground">
                    Time to process
                  </p>
                  <p className="font-mono text-label-caps text-muted-foreground">
                    illustrative
                  </p>
                </div>
                <div className="mt-5">
                  <BarChart rows={processingRows} />
                </div>
                <IllustrativeNote />
              </Card>
            </MotionRevealItem>
          </MotionRevealGroup>
        </Container>
      </Section>

      {/* ---- Row 2: Search + AI Response (two columns) ---- */}
      <Section className="border-t border-border [--section-padding:40px] md:[--section-padding:64px]">
        <Container>
          {/* The two measured categories converge from opposite sides — the
              same directional pairing the how-it-works timeline uses, and the
              one treatment on this page reserved for charts that have data. */}
          <MotionRevealGroup
            repeat
            className="grid grid-cols-1 gap-5 lg:grid-cols-2"
          >
            {/* Search / Retrieval */}
            <MotionRevealItem variant="left" className="flex min-w-0">
              <Card
                variant="compact"
                className="flex min-w-0 flex-1 flex-col bg-glass p-5 md:p-6"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <div className="flex items-center gap-2">
                    <Search className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-label-caps uppercase text-muted-foreground">
                      Retrieval quality
                    </span>
                  </div>
                </div>
                <h2 className="mt-3 text-headline-md tracking-tight text-foreground">
                  Search accuracy
                </h2>
                <p className="mt-2 text-body-md text-muted-foreground">
                  How reliably UniPilot surfaces the right document and source
                  for your query.
                </p>
                <div className="mt-5 flex items-center justify-between">
                  <p className="text-label-caps uppercase text-muted-foreground">
                    Queries returning the right source
                  </p>
                  <p className="font-mono text-label-caps text-muted-foreground">
                    illustrative
                  </p>
                </div>
                <div className="mt-4">
                  <BarChart rows={searchRows} />
                </div>
                <IllustrativeNote />
              </Card>
            </MotionRevealItem>

            {/* AI Response Time */}
            <MotionRevealItem variant="right" className="flex min-w-0">
              <Card
                variant="compact"
                className="flex min-w-0 flex-1 flex-col bg-glass p-5 md:p-6"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <div className="flex items-center gap-2">
                    <Bot className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-label-caps uppercase text-muted-foreground">
                      AI response time
                    </span>
                  </div>
                </div>
                <h2 className="mt-3 text-headline-md tracking-tight text-foreground">
                  Assistant latency
                </h2>
                <p className="mt-2 text-body-md text-muted-foreground">
                  How quickly the assistant answers, from a simple factual
                  question to one spanning several documents.
                </p>
                <div className="mt-5 flex items-center justify-between">
                  <p className="text-label-caps uppercase text-muted-foreground">
                    Time to answer
                  </p>
                  <p className="font-mono text-label-caps text-muted-foreground">
                    illustrative
                  </p>
                </div>
                <div className="mt-4">
                  <BarChart rows={aiRows} valueWidth="w-8" />
                </div>
                <IllustrativeNote />
              </Card>
            </MotionRevealItem>
          </MotionRevealGroup>
        </Container>
      </Section>

      {/* ---- Row 3: Task Extraction + Academic Extraction (planned) ---- */}
      <Section className="border-t border-border [--section-padding:40px] md:[--section-padding:64px]">
        <Container>
          {/* These two carry no numbers, so they get the surface treatment
              rather than the chart one: both arrive with depth, then the note
              under them rises. The group wraps the grid and the note together so
              all three share one observer and one order. */}
          <MotionRevealGroup repeat>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <PlannedCategory
                icon={CheckSquare}
                eyebrow="Task extraction"
                title="Did it catch the assignment?"
                description="Whether assignment titles, due dates and priorities are correctly pulled from the documents that set them."
                dimensions={[
                  "Title extraction",
                  "Due-date extraction",
                  "Priority and status extraction",
                ]}
              />
              <PlannedCategory
                icon={BookOpen}
                eyebrow="Academic extraction"
                title="Did it read the term correctly?"
                description="How accurately UniPilot identifies exam dates, class schedules, course names and important readings in your uploaded material."
                dimensions={[
                  "Exam dates",
                  "Class schedules",
                  "Course names",
                  "Important readings",
                ]}
              />
            </div>
            <MotionRevealItem
              as="p"
              className="mt-5 max-w-2xl text-label-sm text-muted-foreground"
            >
              These categories measure how well UniPilot pulls structured
              information out of real academic files. Real production data will
              replace this placeholder before launch.
            </MotionRevealItem>
          </MotionRevealGroup>
        </Container>
      </Section>

      {/* ---- Converter measurement framework + Methodology ---- */}
      {/* Two notes, not two charts, so they share one section side by side
          rather than adding two more full-width rows to the stack. */}
      <Section className="border-t border-border [--section-padding:40px] md:[--section-padding:64px]">
        <Container>
          {/* Prose, not charts — so these two simply rise in order. The page has
              already used depth for surfaces and direction for data; a third
              distinct entrance here would be motion for its own sake. */}
          <MotionRevealGroup
            repeat
            className="grid grid-cols-1 gap-5 lg:grid-cols-5"
          >
            <MotionRevealItem className="flex min-w-0 lg:col-span-2">
              <Card
                variant="compact"
                className="flex min-w-0 flex-1 flex-col bg-glass p-5 md:p-6"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <div className="flex items-center gap-2">
                    <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-label-caps uppercase text-muted-foreground">
                      File converters
                    </span>
                  </div>
                  <Badge size="sm" variant="outline">
                    Not yet available
                  </Badge>
                </div>
                <h2 className="mt-3 text-headline-md tracking-tight text-foreground">
                  Measurement framework
                </h2>
                <p className="mt-2 text-body-md text-muted-foreground">
                  The file tools are not built yet, so there is nothing to
                  benchmark. Once they are, three things will be measured:
                </p>
                <ul className="mt-4 flex flex-col gap-1.5">
                  {[
                    "Conversion speed",
                    "Output fidelity",
                    "OCR quality, where supported",
                  ].map((dimension) => (
                    <li
                      key={dimension}
                      className="rounded-base border border-border bg-card px-2.5 py-2"
                    >
                      <span className="min-w-0 text-label-sm text-muted-foreground">
                        {dimension}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 border-t border-border pt-3">
                  <p className="text-label-sm text-muted-foreground">
                    No figures are shown for these until the tools exist and
                    have been measured.
                  </p>
                </div>
              </Card>
            </MotionRevealItem>

            <MotionRevealItem className="flex min-w-0 lg:col-span-3">
              <Card
                variant="compact"
                className="flex min-w-0 flex-1 flex-col bg-glass p-5 md:p-6"
              >
                <span className="text-label-caps uppercase text-muted-foreground">
                  Methodology
                </span>
                <h2 className="mt-3 text-headline-md tracking-tight text-foreground">
                  What has been measured, and what has not.
                </h2>
                <p className="mt-3 text-body-md text-foreground">
                  Nothing on this page is a measured result. Every figure above
                  is an illustrative placeholder.
                </p>
                <p className="mt-3 text-body-md text-muted-foreground">
                  Before launch, UniPilot will run these benchmarks end-to-end
                  against representative academic material and publish the
                  methodology alongside the results — the exact documents, query
                  sets and measurement conditions used. Depending on the
                  category, that means processing time, retrieval quality,
                  response latency, extraction quality, or conversion fidelity
                  where the tool applies. Categories marked{" "}
                  <span className="font-mono text-label-sm">
                    Measurement planned
                  </span>{" "}
                  have no dataset yet, and file conversion cannot be measured
                  until it is built. Until that work is done, no figure here
                  should be read as a production claim or compared against
                  another product.
                </p>
              </Card>
            </MotionRevealItem>
          </MotionRevealGroup>
        </Container>
      </Section>

      <BenchmarksClosingCTA />
    </>
  );
}
