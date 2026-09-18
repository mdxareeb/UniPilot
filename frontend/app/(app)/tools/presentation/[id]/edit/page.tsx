import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Container } from "@/components/ui/Container";
import { PageHeader } from "@/components/app/PageHeader";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { getWorkspaceAccess } from "@/lib/onboarding/gate";
import { isPresentonConfigured } from "@/lib/integrations/presentonConfig";
import {
  getPresentationDeck,
  getPresentationTemplate,
  isStructuralEditingEnabled,
  listPresentationThemes,
  resolveEditorUrl,
} from "@/lib/integrations/presenton";
import {
  getPresentation,
  hasPendingPresentationExport,
} from "@/lib/data/presentations";
import { isPresentationUuid } from "@/lib/data/presentationValues";
import { isSmartDeck } from "@/lib/presentation/smart";
import type {
  DeckTheme,
  PresentationDeck,
  TemplateLayout,
} from "@/lib/presentation/types";
import { DeckEditor } from "./_components/DeckEditor";
import { EditDeckFrame } from "./_components/EditDeckFrame";

/**
 * Edit deck (Task C4) — the native editor route.
 *
 * Server-rendered shell, owner-gated exactly like the viewer (B4): a guest, a
 * malformed id and a row that is not the caller's all answer the same
 * `notFound()`. A row with no stored engine id, an unconfigured or unreachable
 * engine and a deck the native path cannot render each get their honest state
 * instead of a fake one:
 *
 * - standard (`v2-standard`, non-Smart) decks render the native `DeckEditor`
 *   with the loaded deck, the structural gate's flag, and the template theme /
 *   layouts the pickers need;
 * - Smart HTML decks (and the legacy v1 shape the native renderer does not
 *   model) keep the labelled wrapper frame — the same iframe fallback the
 *   route shipped before, shown only where it is honest;
 * - a failed engine read renders the honest unavailable panel with sanitized
 *   copy, and an engine that was never configured says so.
 *
 * `hasPendingPresentationExport` surfaces an export the worker has not picked
 * up yet (the mirror is worker-written), so the editor's Export control stays
 * honestly disabled across reloads while a job is queued.
 */
export default async function EditPresentationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getWorkspaceAccess();
  if (!user || !isPresentationUuid(id)) notFound();

  const presentation = await getPresentation(user.id, id.trim());
  if (presentation === null) notFound();

  const deckName = presentation.document?.name ?? "Presentation";
  const engineDeckId = presentation.presentonPresentationId;

  if (engineDeckId === undefined) {
    return (
      <EditorShell deckName={deckName}>
        <Card
          data-editor-unavailable=""
          className="bg-glass p-6 backdrop-blur-md md:p-8"
        >
          <EmptyState
            title="Editing isn't available for this deck"
            description="This deck has no stored deck on the presentation service — either the service isn't connected in this environment or the deck wasn't generated through one."
            action={
              <ButtonLink href="/tools/presentation" variant="outline">
                Back to generator
              </ButtonLink>
            }
          />
        </Card>
      </EditorShell>
    );
  }

  const configured = isPresentonConfigured();
  let deck: PresentationDeck | null = null;
  if (configured) {
    try {
      deck = await getPresentationDeck(engineDeckId);
    } catch {
      deck = null;
    }
  }

  if (deck === null) {
    const unavailable = configured
      ? {
          title: "This deck couldn't be loaded",
          description:
            "The presentation service didn't answer for this deck. It may be temporarily unavailable — try again in a moment.",
        }
      : {
          title: "The presentation service isn't connected",
          description:
            "This environment has no presentation service configured, so the stored deck can't be read here. Nothing is faked in its place.",
        };
    return (
      <EditorShell deckName={deckName}>
        <Card
          data-editor-unavailable=""
          className="bg-glass p-6 backdrop-blur-md md:p-8"
        >
          <EmptyState
            title={unavailable.title}
            description={unavailable.description}
            action={
              <ButtonLink href="/tools/presentation" variant="outline">
                Back to generator
              </ButtonLink>
            }
          />
        </Card>
      </EditorShell>
    );
  }

  /* Smart decks (and the legacy v1 shape the native renderer does not model)
     keep the labelled wrapper frame: the editor is Presenton's own themed UI,
     opened with the same honest caveat the route has always carried. */
  if (isSmartDeck(deck) || deck.version !== "v2-standard") {
    let editUrl: string | null = null;
    try {
      editUrl = await resolveEditorUrl(engineDeckId);
    } catch {
      editUrl = null;
    }
    return (
      <EditorShell deckName={deckName}>
        {editUrl !== null ? (
          <div data-editor-fallback="">
            {isSmartDeck(deck) ? (
              <p className="mb-3 text-label-sm text-muted-foreground">
                This is a Smart HTML deck — it isn&rsquo;t rendered natively, so
                the wrapper editor opens instead (recorded, not faked).
              </p>
            ) : null}
            <EditDeckFrame src={editUrl} title={`Edit ${deckName}`} />
          </div>
        ) : (
          <Card
            data-editor-unavailable=""
            className="bg-glass p-6 backdrop-blur-md md:p-8"
          >
            <EmptyState
              title="This deck couldn't be loaded"
              description="The presentation service didn't answer for this deck. It may be temporarily unavailable — try again in a moment."
              action={
                <ButtonLink href="/tools/presentation" variant="outline">
                  Back to generator
                </ButtonLink>
              }
            />
          </Card>
        )}
      </EditorShell>
    );
  }

  const structuralEditsEnabled = isStructuralEditingEnabled();

  /* The deck's own template: its theme powers the theme picker's template
     option, and (only behind the structural gate) its layouts power hydration
     for add/relayout. A template read that fails degrades honestly — the
     editor then offers just the deck's stored theme and no layout choice. */
  const templateId = deck.slides[0]?.layout_group ?? null;
  let templateTheme: DeckTheme | null = null;
  let templateLayouts: TemplateLayout[] | null = null;
  let templateName: string | null = null;
  if (templateId !== null && templateId !== "" && templateId !== "blank") {
    try {
      const template = await getPresentationTemplate(templateId);
      templateTheme = template.theme ?? null;
      templateName = template.name;
      templateLayouts = template.layouts?.layouts ?? null;
    } catch {
      templateTheme = null;
      templateLayouts = null;
      templateName = null;
    }
  }

  /* The theme picker's custom list (`GET /themes/all`): a best-effort read —
     an unreachable themes route must not take the whole editor down, it just
     leaves the stored/template choices. Entries travel verbatim. */
  let customThemes: Array<{ id: string; name: string | null; theme: unknown }> =
    [];
  try {
    customThemes = await listPresentationThemes();
  } catch {
    customThemes = [];
  }

  const exportInFlight =
    presentation.exportStatus === "queued" ||
    presentation.exportStatus === "running" ||
    (await hasPendingPresentationExport(user.id, presentation.id));

  return (
    <EditorShell deckName={deckName}>
      <DeckEditor
        presentationId={presentation.id}
        deck={deck}
        title={deckName}
        structuralEditsEnabled={structuralEditsEnabled}
        templateTheme={templateTheme}
        templateLayouts={structuralEditsEnabled ? templateLayouts : null}
        templateName={templateName}
        customThemes={customThemes}
        exportStatus={presentation.exportStatus ?? null}
        exportErrorMessage={presentation.exportErrorMessage ?? null}
        exportedAt={presentation.exportedAt ?? null}
        exportInFlight={exportInFlight}
      />
    </EditorShell>
  );
}

function EditorShell({
  deckName,
  children,
}: {
  deckName: string;
  children: ReactNode;
}) {
  return (
    <Container className="flex min-w-0 flex-col gap-6 py-6 md:gap-8 md:py-8">
      <PageHeader
        eyebrow="Presentation generator"
        title="Edit deck"
        description={deckName}
        primaryAction={
          <ButtonLink href="/tools/presentation" variant="outline">
            Back to generator
          </ButtonLink>
        }
      />
      {children}
    </Container>
  );
}
