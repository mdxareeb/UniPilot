import { Container } from "@/components/ui/Container";
import { PageHeader } from "@/components/app/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Shown while a page under `(app)` reads the session and renders. The read lives
 * in each page rather than in `(app)/layout.tsx` on purpose: runtime data read in
 * a layout blocks navigation instead of streaming this fallback.
 *
 * Refined to match the workspace PageHeader visual language: a lightweight
 * header skeleton + a couple of card skeletons, no fake data, no large spinner,
 * shell (sidebar, dotted canvas, Assistant) stays stable, and
 * `motion-safe:animate-pulse` respects reduced motion.
 */
export default function AppLoading() {
  return (
    <Container
      className="flex min-w-0 flex-col gap-6 py-6 md:gap-8 md:py-8"
      aria-busy="true"
      aria-label="Loading workspace"
    >
      <PageHeader
        eyebrow="Workspace"
        title="Loading"
        description="Loading your workspace"
        primaryAction={<span aria-hidden="true" />}
        isLoading
      />
      <div className="flex flex-col gap-4">
        <Skeleton
          aria-hidden="true"
          className="h-32 rounded-card md:h-36"
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton aria-hidden="true" className="h-28 rounded-card" />
          <Skeleton aria-hidden="true" className="h-28 rounded-card" />
        </div>
      </div>
      <span className="sr-only">Loading</span>
    </Container>
  );
}
