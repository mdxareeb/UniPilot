import { Container } from "@/components/ui/Container";
import { getWorkspaceAccess } from "@/lib/onboarding/gate";
import { isPresentonConfigured } from "@/lib/integrations/presentonConfig";
import {
  listPresentationModels,
  listPresentationTemplates,
  type PresentationModels,
  type PresentonTemplate,
} from "@/lib/integrations/presenton";
import { listDocuments } from "@/lib/data/documents";
import {
  getLatestPresentation,
  listPresentations,
} from "@/lib/data/presentations";
import type { PresentationItem } from "@/lib/data/presentationValues";
import { DecksList } from "./_components/DecksList";
import {
  PresentationWorkspace,
  type WorkspaceTemplate,
} from "./_components/PresentationWorkspace";

const SOURCE_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/**
 * Guests never probe the engine's admin settings: the model control renders
 * from this constant safe shape (nothing known, nothing selectable), which is
 * the honest state for a reader whose page never performed the read.
 */
const GUEST_MODELS: PresentationModels = {
  current: null,
  currentSource: null,
  provider: null,
  providerModelKey: null,
  engineManaged: false,
  switchingDeclared: false,
  options: [],
  notice: "service-managed",
};

/**
 * Presentation generator (Task 31.x) — the registry tool's workspace.
 *
 * The server page owns access and reads, in that order: `getWorkspaceAccess`
 * first (guest-viewable like every workspace route, TASK.md 0.17), then the
 * caller's latest request, their deck history, their PDF/DOCX documents and
 * the model listing through the request-scoped, RLS-enforced client (F1 adds
 * the history read: the "My decks" section under the workspace). Templates
 * come from the Presenton service when one is configured; an unreachable
 * service degrades to the built-in General template rather than failing the
 * page, and the read's failure travels as `templatesFailed` so the T2 split
 * says "Templates couldn't be loaded" instead of an empty catalog.
 *
 * The model read (`listPresentationModels`, T1) runs for signed-in readers
 * only and never throws: a denied or dead engine degrades to the declaration
 * with its honest notice. Guests get the constant safe shape — no probe.
 *
 * The chrome is the T2 redesign: `PresentationWorkspace` leads with its own
 * centered hero (which replaces `PageHeader` on this route and owns the
 * page's single `<h1>`), followed by the run panel and the
 * Get-started/Templates split; `DecksList` stays the final section.
 *
 * Honesty posture (GATE 1): `isPresentonConfigured()` is read server-side, and
 * an unconfigured environment renders the honest blocked state — no form, no
 * faked deck. The registry stays `planned` until this page produces a real
 * deck in a configured environment.
 */
export default async function PresentationToolPage() {
  const user = await getWorkspaceAccess();
  const configured = isPresentonConfigured();

  let latest = null;
  let decks: PresentationItem[] = [];
  let sourceDocuments: { id: string; name: string }[] = [];
  let templates: PresentonTemplate[] = [];
  let templatesFailed = false;
  let models: PresentationModels = GUEST_MODELS;
  let editHref: string | null = null;
  let viewerHref: string | null = null;

  if (user) {
    const [latestPresentation, documents, recentDecks, modelList] =
      await Promise.all([
        getLatestPresentation(user.id),
        listDocuments(user.id),
        listPresentations(user.id),
        listPresentationModels(),
      ]);
    latest = latestPresentation;
    decks = recentDecks;
    models = modelList;
    sourceDocuments = documents
      .filter(
        (document) =>
          document.mimeType !== undefined &&
          SOURCE_MIME_TYPES.has(document.mimeType),
      )
      .map((document) => ({ id: document.id, name: document.name }));

    if (configured) {
      try {
        // The adapter returns a page ({items,total,page,pageSize}); the picker
        // renders the first page's items. Scope "all" (no `default` filter)
        // keeps built-ins and customs in the picker, so a "Use this template"
        // link from the templates browser's Custom tab can preselect.
        templates = (
          await listPresentationTemplates({ scope: "all" })
        ).items;
      } catch {
        // Unreachable service: the picker falls back to the built-in
        // General template; generating would answer the service's error
        // honestly, so nothing is invented here.
        templates = [];
        templatesFailed = true;
      }
    }

    if (configured && latest?.presentonPresentationId) {
      // The UniPilot wrapper route (chrome + embedded editor), never the raw
      // Presenton URL: the wrapper owns the frame, labels and fallbacks.
      editHref = `/tools/presentation/${latest.id}/edit`;
      // The native viewer (B4) reads the stored engine deck; it owns its own
      // not-ready/unavailable states, so the link only needs the row id.
      viewerHref = `/tools/presentation/${latest.id}`;
    }
  }

  return (
    <Container className="flex min-w-0 flex-col gap-6 py-6 md:gap-8 md:py-8">
      <PresentationWorkspace
        guest={!user}
        configured={configured}
        initialPresentation={latest}
        templates={templates.map(
          (template): WorkspaceTemplate => ({
            id: template.id,
            name: template.name,
            description: template.description,
            layoutCount: template.layoutCount,
            thumbnail: template.thumbnail,
            isDefault: template.isDefault,
          }),
        )}
        templatesFailed={templatesFailed}
        models={models}
        sourceDocuments={sourceDocuments}
        editHref={editHref}
        viewerHref={viewerHref}
      />
      {user ? <DecksList decks={decks} /> : null}
    </Container>
  );
}
