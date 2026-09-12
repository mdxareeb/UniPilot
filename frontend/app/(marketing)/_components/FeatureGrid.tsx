import {
  Bot,
  CalendarDays,
  CheckSquare,
  FileText,
  Gauge,
  Layers,
  Search,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { Divider } from "@/components/ui/Divider";
import { Section } from "@/components/ui/Section";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusIndicator } from "@/components/ui/StatusIndicator";
import { MotionReveal } from "@/components/motion/MotionReveal";
import { FeatureAction } from "@/components/marketing/FeatureAction";
import {
  HAS_LIVE_TOOL,
  OFFERABLE_TOOLS,
  TOOL_STATUS_LABEL,
  toolStatusLabel,
  type Tool,
} from "@/components/tools/toolCatalog";
import { LearnMoreLink } from "./LearnMoreLink";

/* Previews are deliberately small. Each one shows the shape of a feature —
   enough to recognize it — and nothing more; a full mock would push the next
   card off the screen, which is the opposite of what this section is for.
   All of them are `aria-hidden`: the card's own text already says what the
   feature does, so a screen reader gains nothing from reading sample data. */

const previewShell =
  "flex flex-col gap-1.5 rounded-base border border-border bg-glass-subtle p-2.5";
const previewRow =
  "flex items-center justify-between gap-2 rounded-base border border-border bg-card px-2.5 py-2";
const metaText = "shrink-0 font-mono text-label-caps text-muted-foreground";

function IndexingPreview() {
  const documents = [
    { name: "DBMS Syllabus.pdf", meta: "12 pages" },
    { name: "Assignment Brief.docx", meta: "4 pages" },
    { name: "Lecture Notes 06.pdf", meta: "9 pages" },
  ];

  return (
    <div aria-hidden="true" className={previewShell}>
      {documents.map((doc) => (
        <div key={doc.name} className={previewRow}>
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-label-sm text-foreground">
              {doc.name}
            </span>
            <span className={`hidden sm:inline ${metaText}`}>{doc.meta}</span>
          </div>
          <Badge size="sm" variant="outline" className="shrink-0">
            Indexed
          </Badge>
        </div>
      ))}
    </div>
  );
}

function SearchPreview() {
  return (
    <div aria-hidden="true" className={previewShell}>
      <div className={previewRow}>
        <div className="flex min-w-0 items-center gap-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-label-sm text-foreground">
            citation format
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 rounded-base border border-border bg-card px-2.5 py-2">
        <p className="text-label-sm text-foreground">
          Use IEEE style for all references.
        </p>
        <span className="truncate font-mono text-label-caps text-muted-foreground">
          IEEE Paper Guidelines.pdf
        </span>
      </div>
    </div>
  );
}

function TasksPreview() {
  const tasks = [
    { name: "DBMS Assignment", due: "Tomorrow", status: "warning" as const, label: "Due soon" },
    { name: "IEEE Report draft", due: "Friday", status: "active" as const, label: "In progress" },
    { name: "OS Lab submission", due: "Monday", status: "success" as const, label: "Done" },
  ];

  return (
    <div aria-hidden="true" className={previewShell}>
      {tasks.map((task) => (
        <div key={task.name} className={previewRow}>
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-label-sm text-foreground">
              {task.name}
            </span>
            {/* The due day is secondary to the status pill next to it, so it
                steps out at the narrowest width rather than truncating the
                task name — same trade as the page counts above. */}
            <span className={`hidden sm:inline ${metaText}`}>{task.due}</span>
          </div>
          <StatusIndicator
            size="sm"
            status={task.status}
            label={task.label}
            className="shrink-0"
          />
        </div>
      ))}
    </div>
  );
}

function CalendarPreview() {
  /* Dates and indicator dots only. Weekday initials were the first thing to
     go: at 320px seven three-letter labels either truncate or force the cells
     narrower than the dates, and the deadline row below already names the day
     in words, so nothing is lost. */
  const days = [
    { date: "9", mark: "none" },
    { date: "10", mark: "none" },
    { date: "11", mark: "due" },
    { date: "12", mark: "none" },
    { date: "13", mark: "class" },
    { date: "14", mark: "none" },
    { date: "15", mark: "none" },
  ];

  return (
    <div aria-hidden="true" className={previewShell}>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => (
          <div
            key={day.date}
            className={[
              "flex min-w-0 flex-col items-center gap-1 rounded-base border py-1.5",
              day.mark === "due"
                ? "border-primary bg-card"
                : "border-border bg-card",
            ].join(" ")}
          >
            <span className="text-label-sm text-foreground">{day.date}</span>
            <span
              className={[
                "size-1 rounded-full",
                day.mark === "none" ? "bg-border" : "bg-primary",
              ].join(" ")}
            />
          </div>
        ))}
      </div>
      <div className={previewRow}>
        <div className="flex min-w-0 items-center gap-2">
          <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-label-sm text-foreground">
            DBMS Assignment due
          </span>
        </div>
        <span className={metaText}>Wed</span>
      </div>
    </div>
  );
}

function AssistantPreview() {
  return (
    <div aria-hidden="true" className={previewShell}>
      <div className="flex justify-end">
        <p className="max-w-[88%] rounded-base bg-primary px-2.5 py-1.5 text-label-sm text-primary-foreground">
          What do I need to finish this week?
        </p>
      </div>
      <div className="flex flex-col gap-1.5 rounded-base border border-border bg-card px-2.5 py-2">
        <p className="text-label-sm text-foreground">
          The DBMS assignment is due Wednesday. Start it before the Friday
          assessment.
        </p>
        <span className="truncate font-mono text-label-caps text-muted-foreground">
          From: DBMS Assignment Brief.pdf
        </span>
      </div>
    </div>
  );
}

function WorkloadPreview() {
  /* Same figures as the workload section on /features, so the two pages do not
     quietly disagree about the same illustration. */
  const tasks = [
    { name: "DBMS Assignment", effort: "~2.5h" },
    { name: "IEEE Report draft", effort: "~3h" },
  ];

  return (
    <div aria-hidden="true" className={previewShell}>
      <div className="flex flex-col gap-2 rounded-base border border-border bg-card px-2.5 py-2">
        {/* Label and figures stack rather than sitting on one line: at 320px
            the row is ~198px wide and "7.5h due · 4h free" in tracked mono is
            most of that on its own, which would wrap the label instead. */}
        <div className="flex flex-col gap-1">
          <span className="text-label-sm text-foreground">This week</span>
          <span className="font-mono text-label-caps text-muted-foreground">
            7.5h due · 4h free
          </span>
        </div>
        <span className="h-1 w-full overflow-hidden rounded-pill bg-border">
          <span className="block h-full w-[78%] rounded-pill bg-primary" />
        </span>
      </div>
      {tasks.map((task) => (
        <div key={task.name} className={previewRow}>
          <span className="truncate text-label-sm text-foreground">
            {task.name}
          </span>
          <span className={metaText}>{task.effort}</span>
        </div>
      ))}
    </div>
  );
}

function ConnectedPreview() {
  const surfaces = [
    { label: "Documents", icon: FileText },
    { label: "Tasks", icon: CheckSquare },
    { label: "Calendar", icon: CalendarDays },
    { label: "Assistant", icon: Bot },
  ];

  /* Four surfaces, no caption. The card's own meta line already says they read
     one index; printing it here too was the same sentence twice. */
  return (
    <div aria-hidden="true" className={previewShell}>
      <div className="grid grid-cols-2 gap-1.5">
        {surfaces.map((surface) => (
          <div
            key={surface.label}
            className="flex min-w-0 items-center gap-2 rounded-base border border-border bg-card px-2.5 py-2"
          >
            <surface.icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-label-sm text-foreground">
              {surface.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* The "What's inside" rows. Every offered catalogue tool — the registry's
   `OFFERABLE_TOOLS`, which excludes the Tier-3 `disabled` entries (TASK.md
   Part X) — split across two rows that loop in opposite directions, read from
   the shared catalogue so the homepage cannot name a tool the features page
   has renamed or claim one works that it lists as planned.

   The marquee itself is the shared CSS behaviour in `app/globals.css`
   (`marquee-viewport` / `marquee-track`): a constant slow speed, a seamless
   -50% wrap of a track that holds its set twice, pause on hover (fine
   pointers only) and on focus-within, edge fades on both sides, and a
   static scrollable list instead of an animated loop under reduced motion.
   The duplicated set is `inert` decoration — painted so the loop has
   something to reveal, but out of the tab order, the accessibility tree and
   pointer targeting. The two sets must stay identical, so the row renders
   one array twice rather than maintaining two.

   Status words come from the catalogue's own treatment: a `planned` tool
   says "Planned" and never reads as shipped; a `live` tool says nothing,
   because an unlabelled card reads as shipped. Tier-3 tools are not here at
   all — they are research-only and must not be advertised as launch
   functionality, which is why the registry filters them out rather than
   labelling them as peers. */

const CARD_WIDTH = 224; /* w-56 */
const CARD_GAP = 12; /* gap-3 */
const MARQUEE_SPEED = 24; /* px per second — a card roughly every ten seconds */

function marqueeStyle(count: number): CSSProperties {
  return {
    "--marquee-duration": `${(
      (count * (CARD_WIDTH + CARD_GAP) - CARD_GAP) /
      MARQUEE_SPEED
    ).toFixed(2)}s`,
  } as CSSProperties;
}

function MarqueeCard({ tool, ghost }: { tool: Tool; ghost?: boolean }) {
  return (
    <li
      className={`w-[224px] shrink-0 list-none${ghost ? " marquee-ghost" : ""}`}
      {...(ghost ? { "aria-hidden": true, inert: true } : {})}
    >
      <Link
        href={tool.href}
        tabIndex={ghost ? -1 : undefined}
        className="flex w-full items-center gap-3 rounded-base border border-border bg-glass p-3 transition-[border-color] hover:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-base border border-border bg-card text-muted-foreground">
          <tool.icon aria-hidden="true" className="size-4" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-label-sm font-semibold text-foreground">
            {tool.name}
          </span>
          {/* An unlabelled card reads as shipped, so only the unbuilt ones
              carry a word — the registry's own wording for the state. */}
          <span className="font-mono text-label-caps text-muted-foreground">
            {tool.status === "live" ? null : toolStatusLabel(tool)}
          </span>
        </span>
      </Link>
    </li>
  );
}

function MarqueeRow({ tools, reverse }: { tools: Tool[]; reverse?: boolean }) {
  return (
    <div className="marquee-viewport">
      <ul
        className={`marquee-track${reverse ? " [animation-direction:reverse]" : ""}`}
        style={marqueeStyle(tools.length)}
      >
        {tools.map((tool) => (
          <MarqueeCard key={tool.id} tool={tool} />
        ))}
        {/* The seamless loop's second copy: identical content, painted so
            the wrap has something to reveal, and inert so none of it is
            tabbable, announced, or hoverable in its own right. */}
        {tools.map((tool) => (
          <MarqueeCard key={`${tool.id}-ghost`} tool={tool} ghost />
        ))}
      </ul>
    </div>
  );
}

function ToolMarquee() {
  /* Split the offered set evenly; the second row runs in reverse so the two
     loops read as one band rather than two queues. */
  const half = Math.ceil(OFFERABLE_TOOLS.length / 2);
  return (
    <div className="flex flex-col gap-3">
      <MarqueeRow tools={OFFERABLE_TOOLS.slice(0, half)} />
      <MarqueeRow tools={OFFERABLE_TOOLS.slice(half)} reverse />
    </div>
  );
}

type Feature = {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  meta: string;
  action: { label: string; href: string };
  preview: () => React.ReactNode;
  /* Span at the two grid breakpoints. Mobile is always one column. */
  span: string;
  /* Position within its own row, so each row staggers left to right instead of
     delays piling up down the page. */
  stagger: number;
};

const rowOne: Feature[] = [
  {
    eyebrow: "Document indexing",
    title: "Everything you've uploaded",
    description:
      "Syllabi, briefs and lecture notes are read when you upload them, so the dates, courses and topics inside them are available everywhere else.",
    icon: FileText,
    meta: "PDF · DOCX",
    action: { label: "Explore documents", href: "/features#documents" },
    preview: IndexingPreview,
    span: "md:col-span-7",
    stagger: 0,
  },
  {
    eyebrow: "Search",
    title: "Find what matters",
    description:
      "Search your own material and get the passage back, not a folder to open.",
    icon: Search,
    meta: "Uploads",
    action: { label: "How search works", href: "/features#documents" },
    preview: SearchPreview,
    span: "md:col-span-5",
    stagger: 1,
  },
];

const rowThree: Feature[] = [
  {
    eyebrow: "Tasks",
    title: "What's due next",
    description:
      "Assignments, labs and submissions in one list, with the due dates taken from the documents they came from.",
    icon: CheckSquare,
    meta: "Due dates",
    action: { label: "See tasks in context", href: "/features#tasks" },
    preview: TasksPreview,
    span: "md:col-span-6 lg:col-span-4",
    stagger: 0,
  },
  {
    eyebrow: "Calendar",
    title: "The weeks ahead",
    description:
      "Classes, exams and deadlines on one schedule, so a due date never arrives on its own.",
    icon: CalendarDays,
    meta: "Timetable",
    action: { label: "Explore the calendar", href: "/features#calendar" },
    preview: CalendarPreview,
    span: "md:col-span-6 lg:col-span-4",
    stagger: 1,
  },
  {
    eyebrow: "AI assistant",
    title: "Ask across your workspace",
    description:
      "Ask about your own deadlines and documents. Answers cite the file they came from.",
    icon: Bot,
    meta: "Cited answers",
    action: { label: "See the assistant", href: "/features#assistant" },
    preview: AssistantPreview,
    span: "md:col-span-12 lg:col-span-4",
    stagger: 2,
  },
];

const rowFour: Feature[] = [
  {
    eyebrow: "Workload",
    title: "Know what's building up",
    description:
      "UniPilot compares what's due with the time you have left and flags the weeks that don't fit.",
    icon: Gauge,
    meta: "Effort vs. time left",
    action: { label: "Explore workload", href: "/features#workload" },
    preview: WorkloadPreview,
    span: "md:col-span-7",
    stagger: 0,
  },
  {
    eyebrow: "Connected workspace",
    title: "Keep everything in one place",
    description:
      "Documents, tasks, calendar and assistant all read the same indexed material, so nothing is entered twice.",
    icon: Layers,
    meta: "One index",
    action: { label: "See the workspace", href: "/features#dashboard" },
    preview: ConnectedPreview,
    span: "md:col-span-5",
    stagger: 1,
  },
];

function FeatureCard({ feature }: { feature: Feature }) {
  return (
    /* Reveal and hover live on separate elements on purpose. The reveal's
       transform and the `hover-lift` utility's transition would fight over the
       same element — the lift would run for 380ms and the border would snap.
       Wrapper reveals, card hovers, neither overwrites the other.

       `variant="scale"`: cards arrive with depth while the section header
       above rose — the grid reads as surfaces settling in, not one repeated
       fade-up. */
    <MotionReveal
      repeat
      variant="scale"
      index={feature.stagger}
      className={`flex min-w-0 ${feature.span}`}
    >
      <Card
        variant="compact"
        className="flex min-w-0 flex-1 flex-col bg-glass p-5 hover-lift hover:border-foreground"
      >
        <div className="flex items-center gap-2">
          <feature.icon
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span className="text-label-caps uppercase text-muted-foreground">
            {feature.eyebrow}
          </span>
        </div>
        <h3 className="mt-3 text-headline-md text-foreground">
          {feature.title}
        </h3>
        <p className="mt-2 max-w-prose text-body-md text-muted-foreground">
          {feature.description}
        </p>
        <div className="mt-4">
          <feature.preview />
        </div>
        {/* Every card ends on the same rule and the same two-item row. It is
            what holds an asymmetric grid together: the cards are different
            sizes, but they all sign off the same way. The row wraps rather
            than squeezing — at 320px the action would otherwise break across
            three lines mid-label. The row gap leaves room for the action's
            focus ring, which sits 4px outside its box; at 6px the ring
            grazed the meta line above it once the footer wrapped. */}
        <div className="mt-auto flex flex-col gap-2.5 pt-4">
          <Divider />
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5">
            <span className={metaText}>{feature.meta}</span>
            <FeatureAction href={feature.action.href}>
              {feature.action.label}
            </FeatureAction>
          </div>
        </div>
      </Card>
    </MotionReveal>
  );
}

export function FeatureGrid({ id }: { id?: string }) {
  return (
    <Section
      id={id}
      className="scroll-mt-24 border-t border-border [--section-padding:40px] md:[--section-padding:72px]"
    >
      <Container>
        <MotionReveal repeat>
          <SectionHeader
            align="center"
            eyebrow="What's inside"
            title="A workspace, not a folder."
            description="Your documents, deadlines, tasks and questions all draw on the same indexed material — so nothing has to be re-entered or looked up twice."
            action={<LearnMoreLink href="/features" />}
            className="mb-8"
          />
        </MotionReveal>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-12 md:gap-5">
          {rowOne.map((feature) => (
            <FeatureCard key={feature.eyebrow} feature={feature} />
          ))}

          {/* One card, three families, seventeen tools nested inside them. The
              alternative — a card per tool — would turn a page about a workspace
              into a directory, and it is the only thing here that does not exist
              yet, so it carries the page's only status badge.

              No `hover-lift`: the card holds four separate actions, and lifting a
              surface that is not itself a link suggests the whole thing is
              clickable. */}
          <MotionReveal repeat variant="scale" className="flex min-w-0 md:col-span-12">
            <Card
              variant="compact"
              className="flex min-w-0 flex-1 flex-col bg-glass p-5"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="flex items-center gap-2">
                  <Wrench
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="text-label-caps uppercase text-muted-foreground">
                    Create, edit &amp; study
                  </span>
                </div>
                {HAS_LIVE_TOOL ? null : (
                  <Badge size="sm" variant="outline">
                    Not yet available
                  </Badge>
                )}
              </div>
              <div className="mt-3 flex flex-col gap-2 lg:max-w-[46rem]">
                <h3 className="text-headline-md text-foreground">
                  The coursework itself, not just the plan.
                </h3>
                <p className="text-body-md text-muted-foreground">
                  Organising what you already have is half the job. The other half
                  is making the slides, documents and revision material — and
                  fixing the files in between. That is what UniPilot is being
                  built to do next.
                </p>
              </div>
              <ToolMarquee />
              {/* The aggregate honesty note reads the registry, like the
                  dashboard hub's: the day one tool ships it disappears by
                  itself instead of claiming nothing works. */}
              {HAS_LIVE_TOOL ? null : (
                <div className="mt-4 rounded-base border border-dashed border-secondary p-3">
                  <p className="text-label-sm text-foreground">
                    None of these tools are built yet. Each one ships when it
                    actually works — nothing listed here generates, converts or
                    edits a file today.
                  </p>
                </div>
              )}
              <div className="mt-auto flex flex-col gap-2.5 pt-4">
                <Divider />
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5">
                  {HAS_LIVE_TOOL ? null : (
                    <span className={metaText}>{TOOL_STATUS_LABEL.planned}</span>
                  )}
                  <FeatureAction href="/features">See every tool</FeatureAction>
                </div>
              </div>
            </Card>
          </MotionReveal>

          {rowThree.map((feature) => (
            <FeatureCard key={feature.eyebrow} feature={feature} />
          ))}
          {rowFour.map((feature) => (
            <FeatureCard key={feature.eyebrow} feature={feature} />
          ))}
        </div>
      </Container>
    </Section>
  );
}
