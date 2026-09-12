import { Upload } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { SignInAction } from "@/components/auth/SignInAction";
import { Container } from "@/components/ui/Container";
import { listDocuments } from "@/lib/data/documents";
import { getWorkspaceAccess } from "@/lib/onboarding/gate";
import { DocumentUploadButton } from "./_components/DocumentUploadButton";
import { DocumentsUploadProvider } from "./_components/DocumentsUploadProvider";
import { DocumentsUploadSurface } from "./_components/DocumentsUploadSurface";

/**
 * Documents (Task 23.x binding; the full 18.x hub is the next step).
 *
 * The server page owns access and the data read, in that order: the
 * `getWorkspaceAccess` gate runs first (`requireOnboardedUser("/documents")`
 * stays the Server Actions' hard fallback), then `listDocuments(user.id)`
 * loads the caller's newest row through the request-scoped, RLS-enforced
 * client. It feeds the upload provider as the settled document the surface's
 * rename/delete actions operate on; the full list, cards, filters and states
 * remain 18.x's work and are deliberately not rendered here yet.
 *
 * A visitor without a session renders the same header with the sign-in action
 * and the honest guest line, and no data call happens at all. The header's
 * `DocumentUploadButton` and the surface's drop target are one pipeline
 * (`DocumentsUploadProvider`): reserve → direct browser upload with real
 * progress → server-side finalize/rollback (23.2–23.8).
 */
export default async function DocumentsPage() {
  const user = await getWorkspaceAccess();
  const documents = user ? await listDocuments(user.id) : [];

  return (
    <Container className="flex min-w-0 flex-col gap-6 py-6 md:gap-8 md:py-8">
      <DocumentsUploadProvider initialDocument={documents[0] ?? null}>
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
        <DocumentsUploadSurface guest={!user} index={1} />
      </DocumentsUploadProvider>
    </Container>
  );
}
