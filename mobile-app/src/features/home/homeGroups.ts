import type { RegistryIcon } from "@/features/workspace/registries";

/** The Home hub routes that exist today; new tools extend this union. */
export type HomeRoute = "/materials" | "/ask";

export type HomeToolItem = {
  id: string;
  name: string;
  description: string;
  icon: RegistryIcon;
  status: "live" | "planned";
  /** Present only for live tools. */
  route?: HomeRoute;
  /** The honest reason a planned row is not tappable yet. */
  note: string;
  /** Which live count the row or vault badge shows. */
  badge?: "indexed";
};

type HomeGroupBase = {
  id: "file-tools" | "integrations" | "study-tools";
  title: string;
  subtitle: string;
  icon: RegistryIcon;
  defaultOpen: boolean;
};

export type HomeToolsGroup = HomeGroupBase & {
  kind: "tools";
  items: readonly HomeToolItem[];
};

export type HomeIntegrationsGroup = HomeGroupBase & {
  kind: "integrations";
};

export type HomeToolGroup = HomeToolsGroup | HomeIntegrationsGroup;

const FILE_TOOLS: HomeToolItem[] = [
  {
    id: "image-to-pdf",
    name: "Image to PDF",
    description: "Pick photos, order the pages and export one PDF.",
    icon: "image",
    status: "planned",
    note: "This tool lands with the file-tools phase.",
  },
  {
    id: "convert",
    name: "Document Converter",
    description: "Turn DOCX, PPTX or TXT into a text-clean PDF.",
    icon: "convert",
    status: "planned",
    note: "This tool lands with the file-tools phase.",
  },
  {
    id: "pdf-utils",
    name: "PDF Utilities",
    description: "Merge PDFs or keep only the pages you need.",
    icon: "pdf",
    status: "planned",
    note: "This tool lands with the file-tools phase.",
  },
  {
    id: "materials",
    name: "Course Materials",
    description: "Your indexed files, summaries and topic tags.",
    icon: "materials",
    status: "live",
    route: "/materials",
    note: "Open your course materials.",
    badge: "indexed",
  },
];

const STUDY_TOOLS: HomeToolItem[] = [
  {
    id: "ask-ai",
    name: "Ask AI",
    description: "Grounded answers from your own course materials.",
    icon: "sparkles",
    status: "live",
    route: "/ask",
    note: "Open the study assistant.",
  },
  {
    id: "focus",
    name: "Focus Workspace",
    description: "Pomodoro and the ESP32 desk companion.",
    icon: "focus",
    status: "planned",
    note: "Reserved for the focus workspace.",
  },
];

/**
 * The Home hub's one registry. Tools live in the group that owns them; the
 * integrations group renders the shared INTEGRATIONS_REGISTRY exactly as the
 * More panel does, so there is only one status resolver.
 */
export const HOME_TOOL_GROUPS = [
  {
    id: "file-tools",
    kind: "tools",
    title: "File Tools",
    subtitle: "Pick, convert and organise your files.",
    icon: "materials",
    defaultOpen: true,
    items: FILE_TOOLS,
  },
  {
    id: "integrations",
    kind: "integrations",
    title: "Integrations",
    subtitle: "Every connected account in one place.",
    icon: "integrations",
    defaultOpen: false,
  },
  {
    id: "study-tools",
    kind: "tools",
    title: "Study Tools",
    subtitle: "Ask questions, then settle into focus.",
    icon: "sparkles",
    defaultOpen: false,
    items: STUDY_TOOLS,
  },
] as const satisfies readonly HomeToolGroup[];

export const HOME_ROUTES: readonly HomeRoute[] = ["/materials", "/ask"];
