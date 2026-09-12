import { CalendarDays, FileText } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { StatusIndicator } from "@/components/ui/StatusIndicator";

/* Step previews. Same surfaces as the homepage workflow previews — shell on
   `bg-glass-subtle`, rows on `bg-card`, metadata in tracked mono — and the same
   rule: `aria-hidden`, never interactive, sized to sit beside the text rather
   than replace it. Each one shows what the step leaves behind, so read top to
   bottom they trace a file from upload to a plan. */

const previewShell =
  "flex flex-col gap-1.5 rounded-base border border-border bg-glass-subtle p-2.5";
const previewRow =
  "flex items-center justify-between gap-2 rounded-base border border-border bg-card px-2.5 py-2";
const metaText = "shrink-0 font-mono text-label-caps text-muted-foreground";

export function UploadStepPreview() {
  const files = [
    { name: "DBMS Syllabus.pdf", kind: "PDF" },
    { name: "Assignment Brief.docx", kind: "DOCX" },
    { name: "Lecture Notes 06.pdf", kind: "PDF" },
  ];

  return (
    <div aria-hidden="true" className={previewShell}>
      {files.map((file) => (
        <div key={file.name} className={previewRow}>
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-label-sm text-foreground">
              {file.name}
            </span>
          </div>
          <span className={metaText}>{file.kind}</span>
        </div>
      ))}
    </div>
  );
}

export function IndexStepPreview() {
  /* The rows underneath the file are what indexing produces: named fields
     pulled out of one document, with that document still credited. */
  const extracted = [
    { field: "Course", value: "Database Systems" },
    { field: "Task", value: "Assignment 2" },
    { field: "Deadline", value: "Wed 11" },
    { field: "Source", value: "DBMS Syllabus.pdf · p. 3" },
  ];

  return (
    <div aria-hidden="true" className={previewShell}>
      <div className={previewRow}>
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-label-sm text-foreground">
            DBMS Syllabus.pdf
          </span>
        </div>
        <Badge size="sm" variant="outline" className="shrink-0">
          Indexed
        </Badge>
      </div>
      <div className="flex flex-col divide-y divide-border rounded-base border border-border bg-card px-2.5">
        {extracted.map((entry) => (
          <div
            key={entry.field}
            className="flex items-center justify-between gap-2 py-1.5"
          >
            <span className="shrink-0 text-label-sm text-muted-foreground">
              {entry.field}
            </span>
            <span className="truncate font-mono text-label-caps text-foreground">
              {entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AskStepPreview() {
  return (
    <div aria-hidden="true" className={previewShell}>
      <div className="flex justify-end">
        <p className="max-w-[88%] rounded-base bg-primary px-2.5 py-1.5 text-label-sm text-primary-foreground">
          When is Assignment 2 due?
        </p>
      </div>
      <div className="flex flex-col gap-1.5 rounded-base border border-border bg-card px-2.5 py-2">
        <p className="text-label-sm text-foreground">
          Wednesday the 11th, submitted through the course portal.
        </p>
        <span className="truncate font-mono text-label-caps text-muted-foreground">
          From: DBMS Syllabus.pdf · p. 3
        </span>
      </div>
    </div>
  );
}

export function TrackStepPreview() {
  const tasks = [
    { name: "Assignment 2", status: "warning" as const, label: "Due soon" },
    { name: "OS Lab report", status: "active" as const, label: "In progress" },
  ];

  return (
    <div aria-hidden="true" className={previewShell}>
      {tasks.map((task) => (
        <div key={task.name} className={previewRow}>
          <span className="truncate text-label-sm text-foreground">
            {task.name}
          </span>
          <StatusIndicator
            size="sm"
            status={task.status}
            label={task.label}
            className="shrink-0"
          />
        </div>
      ))}
      {/* The same deadline, seen from the calendar. This row is the whole point
          of the step: one extracted date, two places to meet it. */}
      <div className={previewRow}>
        <div className="flex min-w-0 items-center gap-2">
          <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-label-sm text-foreground">
            On your calendar
          </span>
        </div>
        <span className={metaText}>Wed 11</span>
      </div>
    </div>
  );
}

export function PlanStepPreview() {
  /* Same figures as the workload previews on the homepage and /features, so one
     illustration does not contradict another. */
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
      <div className={previewRow}>
        <span className="truncate text-label-sm text-foreground">
          Start with Assignment 2
        </span>
        <span className={metaText}>~2.5h</span>
      </div>
    </div>
  );
}
