import { notFound } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { PageHeader } from "@/components/app/PageHeader";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { getWorkspaceAccess } from "@/lib/onboarding/gate";
import { isPresentonConfigured } from "@/lib/integrations/presentonConfig";
import { resolveEditorUrl } from "@/lib/integrations/presenton";
import { getPresentation } from "@/lib/data/presentations";
import { isPresentationUuid } from "@/lib/data/presentationValues";
import { EditDeckFrame } from "./_components/EditDeckFrame";

/**
 * Edit deck (Task 31.x, GATE 2) — UniPilot's chrome around Presenton's editor.
 *
 * The page owns access and the ownership read (`getPresentation` runs through
 * the owner-RLS client), then hands the frame Presenton's browser-reachable
 * edit URL (`{PRESENTON_PUBLIC_URL}/presentation?id=…`, built server-side from
 * the stored `presenton_presentation_id`). Guests and non-owners get the same
 * `notFound()`; a deck that was produced while no service was configured has
 * no editor to show and renders the honest unavailable state instead.
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

  const configured = isPresentonConfigured();
  let editUrl: string | null = null;
  if (configured && presentation.presentonPresentationId) {
    try {
      editUrl = await resolveEditorUrl(presentation.presentonPresentationId);
    } catch {
      editUrl = null;
    }
  }

  const deckName = presentation.document?.name ?? "Presentation";

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
      {editUrl !== null ? (
        <EditDeckFrame src={editUrl} title={`Edit ${deckName}`} />
      ) : (
        <Card className="bg-glass p-6 backdrop-blur-md md:p-8">
          <EmptyState
            title="Editing isn't available for this deck"
            description="This deck has no editor on a configured presentation service — either the service isn't connected in this environment or the deck wasn't generated through one."
            action={
              <ButtonLink href="/tools/presentation" variant="outline">
                Back to generator
              </ButtonLink>
            }
          />
        </Card>
      )}
    </Container>
  );
}
