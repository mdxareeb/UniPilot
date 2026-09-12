import {
  ArrowLeftRight,
  Eraser,
  Film,
  FilePen,
  FilePlus,
  FileSpreadsheet,
  FileType,
  GraduationCap,
  Image as ImageIcon,
  Layers2,
  ListChecks,
  Network,
  PenLine,
  Presentation,
  QrCode,
  Replace,
  SquarePen,
  Table,
  Table2,
  Wand,
  type LucideIcon,
} from "lucide-react";

/**
 * The tool registry — the single source of truth for every tool UniPilot
 * intends to carry (TASK.md 0.11/0.12, Task 30.1).
 *
 * ── Field parity with TASK.md 0.11 ─────────────────────────────────────────
 *
 * | TASK.md 0.11 | this module   | meaning                                      |
 * | ------------ | ------------- | -------------------------------------------- |
 * | `id`         | `id`          | stable slug; `ToolId` is built from it       |
 * | `name`       | `name`        | display name every surface prints            |
 * | `family`     | `group`       | `ToolGroupId` → `ToolGroup` (label, icon, …) |
 * | `tier`       | `tier`        | 1 launch · 2 post-launch · 3 research-only   |
 * | `state`      | `status`      | `live` · `planned` · `disabled`              |
 * | `route`      | `href`        | card destination; a real route when `live`   |
 * | `icon`       | `icon`        | the `LucideIcon` every card renders          |
 * | `description`| `description` | one sentence, printed verbatim               |
 *
 * The names differ only where the implementation's word is already the clearer
 * one (`group`/`status`/`href`); this table is the mapping, so no surface or
 * reader has to guess. A surface never restates any field — it reads the entry.
 *
 * ── The state model ────────────────────────────────────────────────────────
 *
 * Registry states are exactly 0.11's three:
 *
 * - `live`     — usable today; `href` must be a real app route (enforced below)
 * - `planned`  — described here and not built; `href` points at the page that
 *                explains it, never at a `/tools/…` route invented to look done
 * - `disabled` — in the catalogue for reference only; never carded as a peer
 *
 * `processing` and `failed` appear in TASK.md §30's fuller list but are
 * **per-run job states** of a live tool's workspace, not registry states: they
 * change per job, not per product. Mixing them in would make "does this tool
 * exist?" depend on what someone last clicked, so they stay out and live with
 * the job that owns them.
 *
 * ── Tier rules ─────────────────────────────────────────────────────────────
 *
 * - Tier 1 — launch scope (Parts VIII–X).
 * - Tier 2 — post-launch.
 * - Tier 3 — research-only. Must be `disabled` (enforced below) so no surface
 *   can advertise it as a peer of the launch set.
 *
 * ── Integrity ──────────────────────────────────────────────────────────────
 *
 * `assertToolRegistry()` runs at module load and throws on a duplicate tool id,
 * a duplicate group id, an unknown group, an empty required string, a tier-3
 * tool that is not `disabled`, or a `live` tool whose `href` is not a known
 * real route. The arrays and their members are frozen. A bad edit therefore
 * fails the build/dev overlay immediately instead of shipping a card that lies.
 *
 * ── API ────────────────────────────────────────────────────────────────────
 *
 * `toolRegistry` is the canonical, clearly named API (tools, groups, lookups,
 * label helpers, `hasLiveTool`). The individual exports below are the same
 * functions and data, kept because existing surfaces import them.
 */

/** Registry state of a tool — TASK.md 0.11's three values, and only these. */
type ToolStatus = "live" | "planned" | "disabled";

/**
 * Build tier (TASK.md parts VIII–X). Tier 1 is launch scope, Tier 2 is
 * post-launch, Tier 3 is research-only and must not be advertised as normal
 * functionality — which is why surfaces read it: the dashboard hub excludes
 * Tier 3, and a surface that wants to mention research says so in its own
 * words rather than carding it as a peer of the rest.
 */
type ToolTier = 1 | 2 | 3;

type ToolGroupId = "create" | "edit" | "convert" | "study";

type ToolGroup = {
  id: ToolGroupId;
  label: string;
  /** One line naming what the group is for, not what is in it. */
  tagline: string;
  icon: LucideIcon;
  /** The features-page section that explains the group. */
  href: string;
};

type Tool = {
  id: string;
  name: string;
  /** The chip-sized form of the name, for rows of actions (Quick Actions). */
  shortName: string;
  /** What the tool does, in one sentence, from the reader's side of the screen. */
  description: string;
  icon: LucideIcon;
  group: ToolGroupId;
  status: ToolStatus;
  tier: ToolTier;
  /**
   * Where the card's action goes.
   *
   * For a `planned` tool this is the features-page section that explains it —
   * never a `/tools/…` route invented to make a card look finished. A card whose
   * action 404s is a worse lie than a card that says "Planned". For a `live`
   * tool it must be a real app route; the module-load invariant enforces that.
   */
  href: string;
};

/**
 * The four tool families, in the order they are shown everywhere.
 *
 * The fifth group in the product's information architecture — the academic
 * workspace itself: documents, tasks, calendar, assistant — is deliberately not
 * here. Those four already have a source of truth in
 * `components/app/workspaceNav.ts`, they are routes rather than tools, and
 * restating them would create the exact disagreement this file exists to
 * prevent.
 */
const TOOL_GROUPS: readonly ToolGroup[] = [
  {
    id: "create",
    label: "Create",
    tagline: "Make the thing you have to hand in.",
    icon: Wand,
    href: "/features#create",
  },
  {
    id: "edit",
    label: "Edit",
    tagline: "Change a file you already have.",
    icon: Replace,
    href: "/features#edit",
  },
  {
    id: "convert",
    label: "Convert",
    tagline: "Move a file between formats.",
    icon: ArrowLeftRight,
    href: "/features#document-tools",
  },
  {
    id: "study",
    label: "Study",
    tagline: "Revise from your own material.",
    icon: GraduationCap,
    href: "/features#study",
  },
];

/**
 * Every tool UniPilot intends to carry, with the one sentence each is described
 * by wherever it appears.
 *
 * Written once because it is shown on three surfaces: the dashboard's tool
 * sections, the homepage's tool marquee and the features catalogue all read
 * this array. A tool's name, its sentence and its state therefore cannot drift
 * between them, and adding a tool is one entry rather than three.
 */
const CATALOGUE = [
  /* --- Create ---------------------------------------------------------- */
  {
    id: "presentation",
    name: "Presentation generator",
    shortName: "Presentation",
    description:
      "Give UniPilot a topic and get a structured deck back, in a style you pick.",
    icon: Presentation,
    group: "create",
    status: "planned",
    tier: 2,
    href: "/features#presentation",
  },
  {
    id: "document-maker",
    name: "Document maker",
    shortName: "Document",
    description: "Start a report, essay or handout from a brief you already have.",
    icon: FilePlus,
    group: "create",
    status: "planned",
    tier: 2,
    href: "/features#create",
  },
  {
    id: "pdf-maker",
    name: "PDF maker",
    shortName: "PDF",
    description: "Assemble a submission-ready PDF out of your own material.",
    icon: FileType,
    group: "create",
    status: "planned",
    tier: 2,
    href: "/features#create",
  },
  {
    id: "spreadsheet-maker",
    name: "Spreadsheet maker",
    shortName: "Spreadsheet",
    description: "Build a sheet from figures you have collected or been given.",
    icon: FileSpreadsheet,
    group: "create",
    status: "planned",
    tier: 2,
    href: "/features#create",
  },
  {
    id: "data-table",
    name: "Data table generator",
    shortName: "Data table",
    description: "Turn a topic or a passage of notes into a structured table.",
    icon: Table,
    group: "create",
    status: "planned",
    tier: 1,
    href: "/features#create",
  },
  {
    id: "qr-code",
    name: "QR code generator",
    shortName: "QR code",
    description: "Turn a link into a QR code for a handout, poster or slide.",
    icon: QrCode,
    group: "create",
    status: "planned",
    tier: 1,
    href: "/features#edit",
  },

  /* --- Edit ------------------------------------------------------------ */
  {
    id: "document-editor",
    name: "Document editor",
    shortName: "Doc editor",
    description: "Open a document, work on it, and export it back out.",
    icon: SquarePen,
    group: "edit",
    status: "planned",
    tier: 2,
    href: "/features#edit",
  },
  {
    id: "spreadsheet-editor",
    name: "Spreadsheet editor",
    shortName: "Sheet editor",
    description: "Edit a sheet and export it in the format you were asked for.",
    icon: Table2,
    group: "edit",
    status: "planned",
    tier: 2,
    href: "/features#edit",
  },
  {
    id: "background-remover",
    name: "Background remover",
    shortName: "Background",
    description: "Take the background out of a photo for a slide or a poster.",
    icon: Eraser,
    group: "edit",
    status: "planned",
    tier: 2,
    href: "/features#edit",
  },

  /* --- Convert --------------------------------------------------------- */
  {
    id: "file-converters",
    name: "File converters",
    shortName: "Converters",
    description:
      "One place for PDF to DOCX, DOCX to PDF, image to PDF and back again.",
    icon: ArrowLeftRight,
    group: "convert",
    status: "planned",
    tier: 2,
    href: "/features#document-tools",
  },
  {
    id: "pdf-editor",
    name: "PDF tools",
    shortName: "PDF tools",
    description: "Merge, split, reorder and compress a PDF without leaving UniPilot.",
    icon: FilePen,
    group: "convert",
    status: "planned",
    tier: 2,
    href: "/features#edit",
  },

  /* --- Study ----------------------------------------------------------- */
  {
    id: "flashcards",
    name: "Flashcards",
    shortName: "Flashcards",
    description: "Turn your notes into revision cards.",
    icon: Layers2,
    group: "study",
    status: "planned",
    tier: 1,
    href: "/features#study",
  },
  {
    id: "quiz",
    name: "Quiz generator",
    shortName: "Quiz",
    description:
      "Give UniPilot a topic or upload notes and generate a practice test.",
    icon: ListChecks,
    group: "study",
    status: "planned",
    tier: 1,
    href: "/features#study",
  },
  {
    id: "mind-map",
    name: "Mind maps",
    shortName: "Mind map",
    description: "Turn a topic or a set of notes into a structured visual map.",
    icon: Network,
    group: "study",
    status: "planned",
    tier: 2,
    href: "/features#study",
  },

  /* --- Research-only (Tier 3). In the catalogue so a surface can explain
         the roadmap, but `disabled`: carded nowhere as a peer of the tools
         above, and never advertised as launch functionality. --------------- */
  {
    id: "photo-editor",
    name: "Photo editor",
    shortName: "Photo",
    description: "Crop, straighten and clean up an image for a report or a slide.",
    icon: ImageIcon,
    group: "edit",
    status: "disabled",
    tier: 3,
    href: "/features#edit",
  },
  {
    id: "video-editor",
    name: "Video editor",
    shortName: "Video",
    description: "Trim and caption a clip for a presentation or a submission.",
    icon: Film,
    group: "edit",
    status: "disabled",
    tier: 3,
    href: "/features#edit",
  },
  {
    id: "handwritten-notes",
    name: "Handwritten notes",
    shortName: "Handwriting",
    description: "Turn concepts into handwritten-style revision notes.",
    icon: PenLine,
    group: "study",
    status: "disabled",
    tier: 3,
    href: "/features#study",
  },
] as const satisfies readonly Tool[];

/**
 * `as const` above is what makes `ToolId` a union of the real ids, so a surface
 * that names a tool is checked at compile time. Everything downstream reads the
 * widened view instead: with the literal `status` types, a check like
 * `status === "live"` would be an impossible comparison rather than a check
 * that starts passing the day one ships.
 */
type ToolId = (typeof CATALOGUE)[number]["id"];

/**
 * Routes that exist today and that a `live` tool may point at. This is a
 * validation allowlist, not a routing source: the routes themselves are owned
 * by `proxy.ts` / `components/app/workspaceNav.ts`. The day a tool ships at a
 * new route, that route is added here (and, if it is gated, to the proxy) in
 * the same change — which is the point of the invariant: a `live` status
 * cannot be flipped in the registry without a real destination beside it.
 */
const LIVE_TOOL_ROUTE_PREFIXES: readonly string[] = [
  "/dashboard",
  "/tasks",
  "/calendar",
  "/documents",
  "/assistant",
];

function isRealToolRoute(href: string): boolean {
  return LIVE_TOOL_ROUTE_PREFIXES.some(
    (prefix) => href === prefix || href.startsWith(`${prefix}/`),
  );
}

/**
 * The module-load guard. Throws on any registry edit that would let a surface
 * render something untrue. Deliberately cheap — it is a few dozen string
 * compares, once per process.
 */
function assertToolRegistry(): void {
  const groupIds = new Set<string>();
  for (const group of TOOL_GROUPS) {
    if (groupIds.has(group.id)) {
      throw new Error(`[toolCatalog] duplicate group id "${group.id}"`);
    }
    groupIds.add(group.id);
    for (const [field, value] of Object.entries({
      id: group.id,
      label: group.label,
      tagline: group.tagline,
      href: group.href,
    })) {
      if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`[toolCatalog] group "${group.id}": empty ${field}`);
      }
    }
    if (!group.href.startsWith("/")) {
      throw new Error(
        `[toolCatalog] group "${group.id}": href "${group.href}" is not an app path`,
      );
    }
  }

  const toolIds = new Set<string>();
  for (const tool of TOOLS) {
    if (toolIds.has(tool.id)) {
      throw new Error(`[toolCatalog] duplicate tool id "${tool.id}"`);
    }
    toolIds.add(tool.id);
    for (const [field, value] of Object.entries({
      id: tool.id,
      name: tool.name,
      shortName: tool.shortName,
      description: tool.description,
      href: tool.href,
    })) {
      if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`[toolCatalog] tool "${tool.id}": empty ${field}`);
      }
    }
    if (!groupIds.has(tool.group)) {
      throw new Error(
        `[toolCatalog] tool "${tool.id}": unknown group "${tool.group}"`,
      );
    }
    if (tool.tier === 3 && tool.status !== "disabled") {
      throw new Error(
        `[toolCatalog] tool "${tool.id}": tier 3 must be disabled`,
      );
    }
    if (tool.status === "live" && !isRealToolRoute(tool.href)) {
      throw new Error(
        `[toolCatalog] tool "${tool.id}": live route "${tool.href}" is not a real app route`,
      );
    }
  }
}

/* Freeze the data and its members: the registry is read-only by contract, not
   only by `as const`. A surface that tries to mutate an entry at runtime fails
   loudly instead of silently drifting from every other surface. */
TOOL_GROUPS.forEach((group) => Object.freeze(group));
Object.freeze(TOOL_GROUPS);
CATALOGUE.forEach((tool) => Object.freeze(tool));
const TOOLS: readonly Tool[] = Object.freeze(CATALOGUE);
Object.freeze(TOOLS);

assertToolRegistry();

const TOOLS_BY_ID = Object.freeze(
  Object.fromEntries(TOOLS.map((tool) => [tool.id, tool])),
) as Readonly<Record<ToolId, Tool>>;

function getTool(id: ToolId): Tool {
  return TOOLS_BY_ID[id];
}

/**
 * Named tools in the order asked for, for a surface whose row is a curated
 * selection rather than a whole group — the dashboard's hub rows and quick
 * actions, mainly. The ids are checked at compile time, so a renamed tool
 * breaks the build instead of quietly dropping a card.
 *
 * `disabled` entries resolve like any other — a curated surface names ids it
 * has chosen to show, and a Tier-3 tool is excluded by not naming it.
 */
function pickTools(ids: readonly ToolId[]): Tool[] {
  return ids.map((id) => getTool(id));
}

/**
 * Every tool a surface may show in a family, in catalogue order.
 *
 * `disabled` tools are filtered here rather than at each call site: a disabled
 * tool is not "coming soon" — it must not appear as a peer of the rest, and
 * the one place that rule lives is the registry itself. `except` is for a
 * surface that has already given one of them a section of its own — the
 * presentation generator and the converters both get expanded treatment on the
 * features page, and carding them again two inches below their own section
 * would read as a stutter.
 */
function toolsInGroup(
  group: ToolGroupId,
  except: readonly ToolId[] = [],
): Tool[] {
  return TOOLS.filter(
    (tool) =>
      tool.group === group &&
      tool.status !== "disabled" &&
      !except.some((excluded) => excluded === tool.id),
  );
}

function toolGroup(id: ToolGroupId): ToolGroup {
  const group = TOOL_GROUPS.find((candidate) => candidate.id === id);
  if (!group) throw new Error(`Unknown tool group: ${id}`);
  return group;
}

/** Whether anything in the catalogue is usable yet. Drives the honesty notes. */
const HAS_LIVE_TOOL: boolean = TOOLS.some((tool) => tool.status === "live");

/**
 * Every tool a surface may offer. `disabled` entries stay in the catalogue so
 * a surface can explain the roadmap, but they are never offered as a peer of
 * the rest (TASK.md Part X: Tier 3 "must NOT be advertised as launch
 * functionality"). The registry owns that rule, so no single surface decides
 * it: the homepage marquee, the features catalogue and the dashboard hub all
 * read an entry's absence here rather than filtering for themselves.
 */
const OFFERABLE_TOOLS: readonly Tool[] = Object.freeze(
  TOOLS.filter((tool) => tool.status !== "disabled"),
);

/**
 * What a tool card's action says. Here rather than at each call site so a card on
 * the dashboard and the same card on the features page cannot promise different
 * things — and so no card says "Open" for something that does not open.
 */
function toolActionLabel(tool: Tool): string {
  return tool.status === "live" ? "Open" : "How it will work";
}

/**
 * The word a surface prints for a tool's state. `live` never prints — an
 * unlabelled card reads as shipped — so surfaces skip it; the mapping lives
 * here so "Planned" and "Research" cannot drift between the homepage marquee,
 * the features catalogue and the dashboard hub.
 */
const TOOL_STATUS_LABEL: Record<ToolStatus, string> = {
  live: "Available",
  planned: "Planned",
  disabled: "Research",
};

function toolStatusLabel(tool: Tool): string {
  return TOOL_STATUS_LABEL[tool.status];
}

/**
 * The canonical registry API. New code should read from this object; the
 * individual exports below remain for the surfaces that already import them.
 */
const toolRegistry = Object.freeze({
  tools: TOOLS,
  offerable: OFFERABLE_TOOLS,
  groups: TOOL_GROUPS,
  byId: TOOLS_BY_ID,
  get: getTool,
  pick: pickTools,
  inGroup: toolsInGroup,
  group: toolGroup,
  actionLabel: toolActionLabel,
  statusLabel: toolStatusLabel,
  statuses: TOOL_STATUS_LABEL,
  hasLiveTool: HAS_LIVE_TOOL,
});

export {
  HAS_LIVE_TOOL,
  OFFERABLE_TOOLS,
  TOOL_GROUPS,
  TOOLS,
  TOOL_STATUS_LABEL,
  getTool,
  pickTools,
  toolActionLabel,
  toolGroup,
  toolRegistry,
  toolStatusLabel,
  toolsInGroup,
};
export type { Tool, ToolGroup, ToolGroupId, ToolId, ToolStatus, ToolTier };
