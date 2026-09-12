import {
  ArrowRight,
  Bot,
  CalendarDays,
  CheckSquare,
  FilePlus,
  FileText,
  Layers,
  Presentation,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { StatusIndicator } from "@/components/ui/StatusIndicator";

/* Same preview language as the homepage feature grid: small, explanatory,
   `aria-hidden`, and never interactive. Each one shows the shape of a
   capability — the rows, the state, the reference — and stops there. The copy
   beside it already says what the feature does, so a screen reader gains
   nothing from reading sample data, and a full mock would push the next
   section off the screen.

   The class strings below are the established preview surfaces, copied from the
   homepage rather than re-derived: shell on `bg-glass-subtle`, rows on
   `bg-card`, metadata in tracked mono.

   The last three are the vocabulary for a tool that is not built. A solid row
   is something the workspace does today; a dashed one is something it is meant
   to produce, and it always arrives under a mono label and above a sentence
   saying nothing was generated. Written once so the six planned previews cannot
   drift into looking like finished output. */

const previewShell =
  "flex flex-col gap-1.5 rounded-base border border-border bg-glass-subtle p-2.5";
const previewRow =
  "flex items-center justify-between gap-2 rounded-base border border-border bg-card px-2.5 py-2";
const metaText = "shrink-0 font-mono text-label-caps text-muted-foreground";
const plannedRow =
  "flex items-center justify-between gap-2 rounded-base border border-dashed border-secondary px-2.5 py-2";
const plannedLabel = "px-0.5 font-mono text-label-caps text-muted-foreground";
const plannedNote = "px-0.5 text-label-sm text-muted-foreground";

export function DocumentsPreview() {
  /* The third row is still indexing on purpose — document status is one of the
     four things this section claims, so the preview shows two states. */
  const documents = [
    { name: "DBMS Syllabus.pdf", meta: "12 pages", state: "Indexed" },
    { name: "Assignment Brief.docx", meta: "4 pages", state: "Indexed" },
    { name: "Lecture Notes 06.pdf", meta: "9 pages", state: "Indexing" },
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
            {doc.state}
          </Badge>
        </div>
      ))}
    </div>
  );
}

export function SearchPreview() {
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
          IEEE Paper Guidelines.pdf · p. 4
        </span>
      </div>
    </div>
  );
}

/* A concept, not a conversion. The result sits behind a dashed border — the
   same mark the rest of the site uses for something that is not built — and
   the caption says so in words, so nothing here reads as a finished file. */
export function ToolkitConceptPreview() {
  return (
    <div aria-hidden="true" className={previewShell}>
      <span className={plannedLabel}>Intended result</span>
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-base border border-border bg-card px-2.5 py-2">
          <span className="font-mono text-label-caps text-muted-foreground">
            Before
          </span>
          <span className="truncate text-label-sm text-foreground">
            Assignment.pdf
          </span>
        </div>
        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-base border border-dashed border-secondary px-2.5 py-2">
          <span className="font-mono text-label-caps text-muted-foreground">
            After
          </span>
          <span className="truncate text-label-sm text-muted-foreground">
            Assignment.docx
          </span>
        </div>
      </div>
      <p className={plannedNote}>
        Nothing is converted here. This shows what the tool is meant to
        produce.
      </p>
    </div>
  );
}

/* The generator's output is an outline, so the preview is an outline. Slide
   numbers rather than thumbnails: a rendered slide would be a claim about
   visual design that the tool cannot make yet. */
export function PresentationPreview() {
  const slides = [
    { number: "01", title: "What the assignment asks" },
    { number: "02", title: "Method and data" },
    { number: "03", title: "What the results settle" },
  ];

  return (
    <div aria-hidden="true" className={previewShell}>
      <div className={previewRow}>
        <div className="flex min-w-0 items-center gap-2">
          <Presentation className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-label-sm text-foreground">
            Renewable energy — 10 min
          </span>
        </div>
      </div>
      <span className={plannedLabel}>Intended result</span>
      {slides.map((slide) => (
        <div key={slide.number} className={plannedRow}>
          <span className="truncate text-label-sm text-muted-foreground">
            {slide.title}
          </span>
          <span className={metaText}>{slide.number}</span>
        </div>
      ))}
      <p className={plannedNote}>
        No deck is generated here. This shows the structure the tool is meant to
        return.
      </p>
    </div>
  );
}

export function CreationPreview() {
  const outputs = [
    { name: "Lab report.docx", kind: "Document" },
    { name: "Submission.pdf", kind: "PDF" },
    { name: "Results.xlsx", kind: "Sheet" },
  ];

  return (
    <div aria-hidden="true" className={previewShell}>
      <div className={previewRow}>
        <div className="flex min-w-0 items-center gap-2">
          <FilePlus className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-label-sm text-foreground">
            Brief: Lab report, 1,200 words
          </span>
        </div>
      </div>
      <span className={plannedLabel}>Intended result</span>
      {outputs.map((output) => (
        <div key={output.name} className={plannedRow}>
          <span className="truncate text-label-sm text-muted-foreground">
            {output.name}
          </span>
          <span className={metaText}>{output.kind}</span>
        </div>
      ))}
      <p className={plannedNote}>
        Nothing is written here. This shows what the makers are meant to hand
        back.
      </p>
    </div>
  );
}

/* Chips rather than rows: the editors are a set of operations on one file you
   already have, not a set of files they produce. */
export function EditingPreview() {
  const operations = [
    "Merge",
    "Split",
    "Compress",
    "Convert",
    "Crop",
    "Remove background",
  ];

  return (
    <div aria-hidden="true" className={previewShell}>
      <div className={previewRow}>
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-label-sm text-foreground">
            Group report.pdf
          </span>
        </div>
        <span className={metaText}>18 pages</span>
      </div>
      <span className={plannedLabel}>Intended actions</span>
      <div className="flex flex-wrap gap-1.5">
        {operations.map((operation) => (
          <span
            key={operation}
            className="rounded-base border border-dashed border-secondary px-2 py-1 font-mono text-label-caps text-muted-foreground"
          >
            {operation}
          </span>
        ))}
      </div>
      <p className={plannedNote}>
        Nothing is edited here. These are the operations the editors are meant
        to carry.
      </p>
    </div>
  );
}

export function StudyPreview() {
  const outputs = [
    { name: "24 revision cards", kind: "Cards" },
    { name: "10-question practice test", kind: "Quiz" },
    { name: "One-page concept map", kind: "Map" },
  ];

  return (
    <div aria-hidden="true" className={previewShell}>
      <div className={previewRow}>
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-label-sm text-foreground">
            Lecture Notes 06.pdf
          </span>
        </div>
        <span className={metaText}>9 pages</span>
      </div>
      <span className={plannedLabel}>Intended result</span>
      {outputs.map((output) => (
        <div key={output.name} className={plannedRow}>
          <span className="truncate text-label-sm text-muted-foreground">
            {output.name}
          </span>
          <span className={metaText}>{output.kind}</span>
        </div>
      ))}
      <p className={plannedNote}>
        Nothing is generated here. This shows what the study tools are meant to
        make from your own notes.
      </p>
    </div>
  );
}

export function TasksPreview() {
  const tasks = [
    {
      name: "DBMS Assignment",
      due: "Tomorrow",
      status: "warning" as const,
      label: "Due soon",
    },
    {
      name: "IEEE Report draft",
      due: "Friday",
      status: "active" as const,
      label: "In progress",
    },
    {
      name: "OS Lab submission",
      due: "Monday",
      status: "success" as const,
      label: "Done",
    },
  ];

  return (
    <div aria-hidden="true" className={previewShell}>
      {tasks.map((task) => (
        <div key={task.name} className={previewRow}>
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-label-sm text-foreground">
              {task.name}
            </span>
            {/* The due day is secondary to the status pill beside it, so it
                steps out at the narrowest width rather than truncating the
                task name. */}
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

export function CalendarPreview() {
  /* Dates and marks only. Seven weekday initials either truncate or squeeze
     the cells narrower than the dates at 320px, and the rows underneath name
     the day in words anyway. */
  const days = [
    { date: "9", marked: false },
    { date: "10", marked: false },
    { date: "11", marked: true },
    { date: "12", marked: false },
    { date: "13", marked: true },
    { date: "14", marked: false },
    { date: "15", marked: false },
  ];

  const entries = [
    { name: "DBMS Assignment due", day: "Wed" },
    { name: "Operating Systems midterm", day: "Fri" },
  ];

  return (
    <div aria-hidden="true" className={previewShell}>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => (
          <div
            key={day.date}
            className={[
              "flex min-w-0 flex-col items-center gap-1 rounded-base border bg-card py-1.5",
              day.marked ? "border-primary" : "border-border",
            ].join(" ")}
          >
            <span className="text-label-sm text-foreground">{day.date}</span>
            <span
              className={[
                "size-1 rounded-full",
                day.marked ? "bg-primary" : "bg-border",
              ].join(" ")}
            />
          </div>
        ))}
      </div>
      {entries.map((entry) => (
        <div key={entry.name} className={previewRow}>
          <div className="flex min-w-0 items-center gap-2">
            <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-label-sm text-foreground">
              {entry.name}
            </span>
          </div>
          <span className={metaText}>{entry.day}</span>
        </div>
      ))}
    </div>
  );
}

export function AssistantPreview() {
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
      {/* The action row is dashed and badged. An assistant that writes to your
          tasks is the part of this section that does not exist yet, so it is
          the one row that does not look like the others. */}
      <div className="flex items-center justify-between gap-2 rounded-base border border-dashed border-secondary px-2.5 py-2">
        <span className="truncate text-label-sm text-muted-foreground">
          Add “Draft outline” to tasks
        </span>
        <Badge size="sm" variant="outline" className="shrink-0">
          Planned
        </Badge>
      </div>
    </div>
  );
}

export function WorkloadPreview() {
  /* Same figures as the homepage workload card, so the two pages never quietly
     disagree about the same illustration. */
  const tasks = [
    { name: "DBMS Assignment", effort: "~2.5h" },
    { name: "IEEE Report draft", effort: "~3h" },
  ];

  return (
    <div aria-hidden="true" className={previewShell}>
      <div className="flex flex-col gap-2 rounded-base border border-border bg-card px-2.5 py-2">
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

/* One source, four surfaces. The hairline under the index row is the whole
   relationship: everything below it reads the row above it. */
export function WorkspacePreview() {
  const surfaces = [
    { label: "Documents", icon: FileText },
    { label: "Tasks", icon: CheckSquare },
    { label: "Calendar", icon: CalendarDays },
    { label: "Assistant", icon: Bot },
  ];

  return (
    <div aria-hidden="true" className={previewShell}>
      <div className={previewRow}>
        <div className="flex min-w-0 items-center gap-2">
          <Layers className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-label-sm text-foreground">
            Indexed material
          </span>
        </div>
        <span className={metaText}>One index</span>
      </div>
      <div className="flex justify-center">
        <span className="h-3 w-px bg-border" />
      </div>
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
