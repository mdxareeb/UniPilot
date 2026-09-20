import { Upload } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { SignInAction } from "@/components/auth/SignInAction";
import { Container } from "@/components/ui/Container";
import { listDocuments } from "@/lib/data/documents";
import { listPresentationDocumentLinks } from "@/lib/data/presentations";
import { getWorkspaceAccess } from "@/lib/onboarding/gate";
import { DocumentUploadButton } from "./_components/DocumentUploadButton";
import { DocumentsHub } from "./_components/DocumentsHub";
import { DocumentsWorkspace } from "./_components/DocumentsWorkspace";

/**
 * Documents (18.x hub; 23.x upload pipeline; 24.x processing; 31.x
 * provenance).
 *
 * The server page owns access and the data reads, in that order: the
 * `getWorkspaceAccess` gate runs first (`requireOnboardedUser("/documents")`
 * stays the Server Actions' hard fallback), then the caller's real documents
 * load through the request-scoped, RLS-enforced client, alongside the
 * `documentId → presentationId` links for their generated decks (Task F2,
 * spec §9 — the map that gives a presentation-sourced card its "Open deck"
 * action). The list feeds `DocumentsWorkspace`, the client boundary that owns
 * the live list and every mutation; `DocumentsHub` is the presentation over it
 * (cards, search, filters, preview, drop target).
 *
 * A visitor without a session renders the same header with the sign-in action
 * and the honest guest line, and no data call happens at all.
 */
export default async function DocumentsPage() {
  const user = await getWorkspaceAccess();
  const [documents, deckByDocumentId] = user
    ? await Promise.all([
        listDocuments(user.id),
        listPresentationDocumentLinks(user.id),
      ])
    : [[], {}];

  return (
    <Container className="flex min-w-0 flex-col gap-6 py-6 md:gap-8 md:py-8">
      <DocumentsWorkspace
        initialDocuments={documents}
        deckByDocumentId={deckByDocumentId}
        guest={!user}
      >
        <PageHeader
          eyebrow="Documents"
          title="Documents"
          description="Everything you've uploaded."
          primaryAction={
            user ? (
              <DocumentUploadButton />
            ) : (
              <SignInAction
                size="sm"
                aria-label="Upload document"
                reason="Sign in to upload documents."
                guest
              >
                <Upload aria-hidden="true" className="size-4" />
                Upload document
              </SignInAction>
            )
          }
        />
        <DocumentsHub guest={!user} index={1} />
      </DocumentsWorkspace>
    </Container>
  );
}
