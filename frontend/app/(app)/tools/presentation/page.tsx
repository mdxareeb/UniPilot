import { Container } from "@/components/ui/Container";
import { PageHeader } from "@/components/app/PageHeader";
import { getWorkspaceAccess } from "@/lib/onboarding/gate";
import { isPresentonConfigured } from "@/lib/integrations/presentonConfig";
import {
  listPresentationTemplates,
  type PresentonTemplate,
} from "@/lib/integrations/presenton";
import { listDocuments } from "@/lib/data/documents";
import { getLatestPresentation } from "@/lib/data/presentations";
import { PresentationWorkspace } from "./_components/PresentationWorkspace";

const SOURCE_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/**
 * Presentation generator (Task 31.x) — the registry tool's workspace.
 *
 * The server page owns access and reads, in that order: `getWorkspaceAccess`
 * first (guest-viewable like every workspace route, TASK.md 0.17), then the
 * caller's latest request and their PDF/DOCX documents through the
 * request-scoped, RLS-enforced client. Templates come from the Presenton
 * service when one is configured; an unreachable service degrades to the
 * built-in General template rather than failing the page. The client
 * workspace owns the form, the poll and the result card.
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
  let sourceDocuments: { id: string; name: string }[] = [];
  let templates: PresentonTemplate[] = [];
  let editHref: string | null = null;
  let viewerHref: string | null = null;

  if (user) {
    const [latestPresentation, documents] = await Promise.all([
      getLatestPresentation(user.id),
      listDocuments(user.id),
    ]);
    latest = latestPresentation;
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
      <PageHeader
        eyebrow="Presentation generator"
        title="Presentation generator"
        description="Describe a deck and generate it — the result is saved to your Documents."
      />
      <PresentationWorkspace
        guest={!user}
        configured={configured}
        initialPresentation={latest}
        templates={templates.map((template) => ({
          id: template.id,
          name: template.name,
        }))}
        sourceDocuments={sourceDocuments}
        editHref={editHref}
        viewerHref={viewerHref}
      />
    </Container>
  );
}
