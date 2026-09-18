import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ExternalLink, Sparkles } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { getWorkspaceAccess } from "@/lib/onboarding/gate";
import { isPresentonConfigured } from "@/lib/integrations/presentonConfig";
import { getPresentationDeck } from "@/lib/integrations/presenton";
import { getPresentation } from "@/lib/data/presentations";
import {
  isPresentationInFlight,
  isPresentationUuid,
  type PresentationItem,
} from "@/lib/data/presentationValues";
import { isSmartDeck } from "@/lib/presentation/smart";
import type { PresentationDeck } from "@/lib/presentation/types";
import { DeckViewer } from "./_components/DeckViewer";

/**
 * View deck (Task B4) — the native viewer route.
 *
 * Server-rendered shell, owner-gated: `getWorkspaceAccess` first, then the
 * owner-RLS read through `getPresentation`; a guest, a malformed id and a row
 * that is not the caller's all answer the same `notFound()` (no existence
 * oracle, the /edit route's pattern). A row with no stored engine id renders
 * the honest not-ready state instead of an empty stage, and an engine that is
 * unconfigured or unreachable renders the honest unavailable panel with
 * sanitized copy. Smart HTML decks are not rendered natively (spec §5.7,
 * §6.10, D7): the shared `isSmartDeck` detector routes them to a labelled
 * panel (a "Smart HTML deck" badge and the plain not-rendered-natively copy)
 * that offers the wrapper editor both in place and in a new tab — HTML is
 * never faked into the stage.
 *
 * `notFound()` is the /edit route's exact pattern. Under the `(app)` shell it
 * renders Next's 404 page as a streamed soft 404 (the `loading.tsx` boundary
 * has flushed a 200 by then) — the same behavior every page-level guard in
 * this app has; a hard 404 for pages would take a `proxy.ts` rule.
 */
export default async function PresentationViewerPage({
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
      <ViewerShell deckName={deckName}>
        <Card
          data-viewer-not-ready=""
          className="bg-glass p-6 backdrop-blur-md md:p-8"
        >
          <EmptyState
            title="This deck isn't ready to view yet"
            description={notReadyCopy(presentation)}
            action={
              <ButtonLink href="/tools/presentation" variant="outline">
                Back to generator
              </ButtonLink>
            }
          />
        </Card>
      </ViewerShell>
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
      <ViewerShell deckName={deckName}>
        <Card
          data-viewer-unavailable=""
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
      </ViewerShell>
    );
  }

  if (isSmartDeck(deck)) {
    const editHref = `/tools/presentation/${presentation.id}/edit`;
    return (
      <ViewerShell deckName={deckName}>
        <Card
          data-smart-fallback=""
          className="bg-glass p-6 backdrop-blur-md md:p-8"
        >
          <div className="flex flex-col items-center gap-4">
            <Badge data-smart-label="" variant="outline" size="sm">
              Smart HTML deck
            </Badge>
            <EmptyState
              icon={<Sparkles aria-hidden="true" className="size-6" />}
              title="This deck isn't rendered natively"
              description="Smart HTML decks are freeform HTML that depends on Presenton's own browser runtime, so the native viewer doesn't render them — nothing is faked into the stage. Open it in the editor wrapper to view or edit the deck."
              action={
                <div className="flex flex-col items-center gap-3">
                  <ButtonLink href={editHref} variant="outline">
                    Open in the editor
                  </ButtonLink>
                  <a
                    href={editHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="action-arrow inline-flex w-fit items-center gap-1.5 rounded-base py-1 text-label-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    Open in a new tab
                    <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
                  </a>
                </div>
              }
            />
          </div>
        </Card>
      </ViewerShell>
    );
  }

  return (
    <ViewerShell deckName={deckName}>
      <DeckViewer deck={deck} id={presentation.id} title={deckName} />
    </ViewerShell>
  );
}

function ViewerShell({
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
        title="View deck"
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

/** The not-ready state's sanitized copy, by the request's own status. */
function notReadyCopy(presentation: PresentationItem): string {
  if (presentation.statusValue === "failed") {
    return (
      presentation.errorMessage ??
      "Generation didn't finish, so there's no deck to show."
    );
  }
  if (isPresentationInFlight(presentation.statusValue)) {
    return "This deck is still being generated. It will appear here once the service has stored it.";
  }
  return "This request has no stored deck on the presentation service, so there's nothing to render yet.";
}
