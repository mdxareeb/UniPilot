import { Fragment } from "react";
import {
  Bot,
  CalendarDays,
  CheckSquare,
  FilePlus,
  FileText,
  Gauge,
  GraduationCap,
  Layers,
  Presentation,
  Replace,
  Search,
} from "lucide-react";
import { motionIndex } from "@/components/motion/stagger";
import { MotionRevealItem } from "@/components/motion/MotionRevealGroup";
import { getTool, TOOL_STATUS_LABEL } from "@/components/tools/toolCatalog";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import {
  FeatureDetailSection,
  type FeatureDetailSectionProps,
} from "./_components/FeatureDetailSection";
import {
  FeaturePartHeader,
  type FeaturePartHeaderProps,
} from "./_components/FeaturePartHeader";
import {
  AssistantPreview,
  CalendarPreview,
  CreationPreview,
  DocumentsPreview,
  EditingPreview,
  PresentationPreview,
  SearchPreview,
  StudyPreview,
  TasksPreview,
  WorkloadPreview,
  WorkspacePreview,
} from "./_components/FeaturePreviews";
import { FeaturesClosingCTA } from "./_components/FeaturesClosingCTA";
import { FileConvertersSection } from "./_components/FileConvertersSection";
import {
  ToolCatalogueSection,
  type ToolCatalogueSectionProps,
} from "./_components/ToolCatalogueSection";

/* One ordered list drives the jump links and the page, so the navigation can
   never advertise an anchor the page does not render.

   Five parts, each holding its own sections. A part is a kind of distance from
   the student's own material: the workspace reads what they upload, the makers
   produce something new from it, the editors change a file they already have,
   the study tools turn it into revision, and the assistant sits across all
   four. The numbering is that order, not decoration.

   Only the parts are in the jump row. Every anchor the rest of the site links
   to — `#documents`, `#search`, `#document-tools`, `#tasks`, `#calendar`,
   `#assistant`, `#workload`, `#workspace`, `#dashboard`, `#presentation` — is
   still rendered by the section that owns it; the row just stops being fourteen
   pills long. */
type PartEntry =
  | { kind: "detail"; section: FeatureDetailSectionProps }
  | { kind: "catalogue"; section: ToolCatalogueSectionProps }
  | { kind: "converters" };

type Part = Omit<FeaturePartHeaderProps, "number"> & {
  entries: PartEntry[];
};

const parts: Part[] = [
  /* ---------------- 01 ---------------- */
  {
    id: "academic-workspace",
    label: "Academic workspace",
    title: "Your own material, read once.",
    description:
      "Upload the syllabi, briefs and notes a term arrives with. Documents, search, tasks, the calendar and the workload view all read the same index, so a deadline that lands once shows up everywhere it matters.",
    entries: [
      {
        kind: "detail",
        section: {
          id: "documents",
          icon: FileText,
          eyebrow: "Document processing & indexing",
          title: "Read once, useful everywhere.",
          description:
            "Upload the syllabi, briefs and lecture notes you already have. UniPilot reads each file and keeps what is inside it — courses, dates, topics — available to every other part of the workspace.",
          capabilities: [
            {
              term: "Uploading",
              detail:
                "PDF and DOCX, the formats coursework actually arrives in.",
            },
            {
              term: "Extraction",
              detail:
                "Courses, tasks, deadlines and topics pulled out of the file itself.",
            },
            {
              term: "Searchable information",
              detail:
                "Indexed content becomes text you can search, not just a filename.",
            },
            {
              term: "Document status",
              detail:
                "Every file shows where it is: uploaded, indexing, or indexed.",
            },
          ],
          meta: "PDF · DOCX",
          preview: <DocumentsPreview />,
        },
      },
      {
        kind: "detail",
        section: {
          id: "search",
          icon: Search,
          eyebrow: "Smart search",
          title: "Find the passage, not the folder.",
          description:
            "Search across everything you have uploaded and get the part that answers the question back, along with the document it came from.",
          capabilities: [
            {
              term: "Across your uploads",
              detail:
                "One search covers every indexed document in the workspace.",
            },
            {
              term: "Relevant context",
              detail:
                "Results return the passage that answers the query, not just a file hit.",
            },
            {
              term: "Source references",
              detail:
                "Each result names the document and page it was taken from.",
            },
            {
              term: "Your material only",
              detail:
                "Nothing outside your own workspace is searched or returned.",
            },
          ],
          meta: "Uploads",
          preview: <SearchPreview />,
        },
      },
      {
        kind: "detail",
        section: {
          id: "tasks",
          icon: CheckSquare,
          eyebrow: "Task & workload management",
          title: "Every deadline, already written down.",
          description:
            "Assignments, labs and submissions arrive as tasks taken from the documents that set them, so the list is built out of your own material instead of typed out a second time.",
          capabilities: [
            {
              term: "Task extraction",
              detail:
                "Work is created from the brief or syllabus that describes it.",
            },
            {
              term: "Due dates",
              detail:
                "Dates come from the document, and the source stays attached to them.",
            },
            {
              term: "Status",
              detail:
                "Planned, in progress, due soon, done — one glance per task.",
            },
            {
              term: "Workload awareness",
              detail:
                "Each task carries an effort estimate, so a week can be weighed.",
            },
          ],
          meta: "Due dates",
          preview: <TasksPreview />,
        },
      },
      {
        kind: "detail",
        section: {
          id: "calendar",
          icon: CalendarDays,
          eyebrow: "Academic calendar",
          title: "The term on one schedule.",
          description:
            "Classes, exams and assignment deadlines sit on the same calendar, so a due date always shows up next to everything else happening that week.",
          capabilities: [
            {
              term: "Classes",
              detail: "Your timetable, taken from the schedule you upload.",
            },
            {
              term: "Exams",
              detail: "Assessment dates marked alongside everyday classes.",
            },
            {
              term: "Assignment deadlines",
              detail: "Extracted due dates appear on the day they fall on.",
            },
            {
              term: "Calendar imports",
              detail: "Google Calendar and Canvas are not available yet.",
              status: TOOL_STATUS_LABEL.planned,
            },
          ],
          meta: "Timetable",
          preview: <CalendarPreview />,
        },
      },
      {
        kind: "detail",
        section: {
          id: "workload",
          icon: Gauge,
          eyebrow: "Workload intelligence",
          title: "See the week that doesn't fit.",
          description:
            "UniPilot weighs what is due against the time you have left, so a heavy week is visible before it starts instead of after.",
          capabilities: [
            {
              term: "Upcoming load",
              detail: "Everything due in the next stretch, added up.",
            },
            {
              term: "Deadline pressure",
              detail:
                "Weeks where the work outruns the time available stand out.",
            },
            {
              term: "Prioritization",
              detail: "The closest and heaviest deadline is surfaced first.",
            },
            {
              term: "Planning",
              detail:
                "UniPilot shows where to start. It does not schedule the week for you.",
            },
          ],
          meta: "Effort vs. time left",
          preview: <WorkloadPreview />,
        },
      },
      {
        kind: "detail",
        section: {
          id: "workspace",
          /* `/features#dashboard` is linked from the homepage's "Connected
             workspace" card. The dashboard is this workspace, so the alias
             keeps that link landing here instead of at the top of the page.
             (The homepage's Tasks card links to `/features#tasks`, its own
             section, not through this alias.) */
          aliasId: "dashboard",
          icon: Layers,
          eyebrow: "Connected academic workspace",
          title: "One index behind every surface.",
          description:
            "Documents, tasks, the calendar and the assistant all read the same indexed material, so a deadline that arrives once shows up everywhere it matters.",
          capabilities: [
            {
              term: "Documents",
              detail:
                "The source everything else in the workspace is built from.",
            },
            {
              term: "Tasks",
              detail: "Extracted work, kept next to the file that set it.",
            },
            {
              term: "Calendar",
              detail: "The same dates, on the day they land on.",
            },
            {
              term: "Assistant",
              detail: "Answers assembled from all three at once.",
            },
          ],
          meta: "One index",
          preview: <WorkspacePreview />,
        },
      },
    ],
  },

  /* ---------------- 02 ---------------- */
  {
    id: "create",
    label: "Create",
    title: "Make the thing you have to hand in.",
    description:
      "Organising a term is half the job. The other half is producing the slides, the report, the submission and the sheet — from a topic or a brief rather than a blank file. The presentation generator is live; every other tool in this part says what it will do.",
    entries: [
      {
        kind: "detail",
        section: {
          id: "presentation",
          icon: Presentation,
          /* The name comes from the registry, like every card's: this expanded
             section and the "Presentation generator" card on the dashboard and
             homepage cannot drift. */
          eyebrow: getTool("presentation").name,
          status:
            getTool("presentation").status === "planned"
              ? "Not yet available"
              : undefined,
          title: "Describe the deck. Get a structure back.",
          description:
            "Give UniPilot the topic, the length and the style you want, and it works out the deck: a title, the sections that carry the argument, and what belongs on each slide. You start editing from a structure instead of an empty file.",
          capabilities: [
            {
              term: "Generate from a topic or prompt",
              detail: "A subject and a rough length is enough to start from.",
              status: TOOL_STATUS_LABEL.live,
            },
            {
              term: "Automatic slide structure",
              detail:
                "UniPilot decides the sections and what goes on each slide.",
              status: TOOL_STATUS_LABEL.live,
            },
            {
              term: "Choose a style or theme",
              detail:
                "Pick the look before it generates, rather than restyling afterwards.",
              status: TOOL_STATUS_LABEL.live,
            },
            {
              term: "Recreate a presentation from a template",
              detail:
                "Uploading a department template and matching its structure is not available yet.",
              status: TOOL_STATUS_LABEL.planned,
            },
          ],
          meta: TOOL_STATUS_LABEL.live,
          preview: <PresentationPreview />,
          footnote: (
            <MotionRevealItem className="mt-3 rounded-base border border-dashed border-secondary p-3">
              <p className="text-label-sm text-muted-foreground">
                The generator works today: describe a topic, pick a template and
                a length, and the finished deck lands in Documents — open, edit
                and download it from there. Recreating a deck from an uploaded
                department template is the part still to come.
              </p>
            </MotionRevealItem>
          ),
        },
      },
      {
        kind: "catalogue",
        section: {
          icon: FilePlus,
          eyebrow: "Documents, PDFs & sheets",
          title: "Start from a brief, not a blank page.",
          description:
            "The written half of Create: a report or handout, a submission-ready PDF, a spreadsheet, or a table pulled out of a passage of notes. One suite rather than four products, because coursework usually moves between them.",
          group: "create",
          except: ["presentation"],
          meta: TOOL_STATUS_LABEL.planned,
          preview: <CreationPreview />,
        },
      },
    ],
  },

  /* ---------------- 03 ---------------- */
  {
    id: "edit",
    label: "Edit & convert",
    title: "Change a file you already have.",
    description:
      "The part of a submission that is not writing it: getting a PDF into the format you were asked for, pulling one section out of a long document, cropping an image for a slide. Useful tools for college work, kept beside the workspace rather than in front of it.",
    entries: [
      { kind: "converters" },
      {
        kind: "catalogue",
        section: {
          icon: Replace,
          eyebrow: "Editors & utilities",
          title: "Fix the file without leaving.",
          description:
            "Editors for the three formats coursework arrives in, and the small jobs that come up around them — an image straightened for a report, a background taken out for a poster, a link turned into a QR code for a handout.",
          group: "edit",
          except: ["file-converters"],
          meta: TOOL_STATUS_LABEL.planned,
          preview: <EditingPreview />,
        },
      },
    ],
  },

  /* ---------------- 04 ---------------- */
  {
    id: "study",
    label: "Study",
    title: "Revise from your own notes.",
    description:
      "Everything in this part starts from material you have already uploaded, so what you revise from is your course rather than someone else's summary of it.",
    entries: [
      {
        kind: "catalogue",
        section: {
          icon: GraduationCap,
          eyebrow: "Revision tools",
          title: "Four ways to study the same notes.",
          description:
            "Cards to test recall, a practice test to sit before the real one, handwritten-style notes to read, and a map that shows how the topics connect.",
          group: "study",
          meta: TOOL_STATUS_LABEL.planned,
          preview: <StudyPreview />,
        },
      },
    ],
  },

  /* ---------------- 05 ---------------- */
  {
    id: "ai-assistant",
    label: "AI assistant",
    title: "One assistant, across all of it.",
    description:
      "The assistant reads the same index every other part does, and every answer says which document it came from. Its launcher sits in the corner of every page, including this one — for now it opens the part of UniPilot an answer would come from, because it cannot hold a conversation yet.",
    entries: [
      {
        kind: "detail",
        section: {
          id: "assistant",
          icon: Bot,
          eyebrow: "AI assistant & action engine",
          title: "Ask about your own workspace.",
          description:
            "Questions are answered from the documents and deadlines you uploaded, and every answer says where it came from — so you can check it rather than take it on trust.",
          capabilities: [
            {
              term: "Questions across materials",
              detail: "Ask in plain language about any indexed document.",
            },
            {
              term: "Grounded context",
              detail:
                "Answers are drawn from your uploads, not from the open web.",
            },
            {
              term: "Source references",
              detail: "Each answer names the document and page behind it.",
            },
            {
              term: "Assistant actions",
              detail:
                "Creating and updating tasks on your behalf is not available yet.",
              status: TOOL_STATUS_LABEL.planned,
            },
          ],
          meta: "Cited answers",
          preview: <AssistantPreview />,
        },
      },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <>
      <Section>
        <Container className="flex flex-col items-center text-center">
          <span
            data-enter
            style={motionIndex(0)}
            className="text-label-caps uppercase text-muted-foreground"
          >
            Features
          </span>
          <h1
            data-enter
            style={motionIndex(1)}
            className="mt-4 max-w-4xl text-headline-lg-mobile tracking-tight text-foreground md:text-display"
          >
            Five parts. One workspace.
          </h1>
          <p
            data-enter
            style={motionIndex(2)}
            className="mt-4 max-w-2xl text-body-lg text-muted-foreground"
          >
            The workspace that reads your own material, the tools being built
            around it, and what each one is actually for. Anything that is not
            built yet is labeled on this page.
          </p>
          {/* Five pills for five parts. The sections inside them keep their own
              anchors — this row is for finding a part, not for indexing every
              section on the page. */}
          <nav
            aria-label="Jump to a part"
            data-enter
            style={motionIndex(3)}
            className="mt-8 flex flex-wrap justify-center gap-2"
          >
            {parts.map((part) => (
              <a
                key={part.id}
                href={`#${part.id}`}
                className="rounded-pill border border-border bg-glass px-3 py-1.5 text-label-sm text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {part.label}
              </a>
            ))}
          </nav>
        </Container>
      </Section>
      {parts.map((part, index) => (
        <Fragment key={part.id}>
          <FeaturePartHeader
            number={`0${index + 1}`}
            id={part.id}
            label={part.label}
            title={part.title}
            description={part.description}
          />
          {part.entries.map((entry) => {
            if (entry.kind === "converters") {
              return <FileConvertersSection key="document-tools" />;
            }

            if (entry.kind === "catalogue") {
              return (
                <ToolCatalogueSection
                  key={entry.section.eyebrow}
                  {...entry.section}
                />
              );
            }

            return (
              <FeatureDetailSection
                key={entry.section.id}
                {...entry.section}
              />
            );
          })}
        </Fragment>
      ))}
      <FeaturesClosingCTA />
    </>
  );
}
