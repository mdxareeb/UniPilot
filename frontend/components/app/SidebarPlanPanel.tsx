import { Card } from "@/components/ui/Card";
import { sessionViewer } from "@/lib/auth/viewer";
import { WorkspaceAction } from "./WorkspaceAction";

/**
 * The plan panel, deliberately without a single measurement in it.
 *
 * Billing does not exist yet — no subscription record, no usage table, no quota
 * to read — so "412 credits left", "resets in 12 days" and "1.2 GB of 5 GB"
 * would all be numbers this component made up. The one fact it can state is the
 * tier: with no billing, every account is on the free plan by definition. The
 * price is the real one from /pricing, and the sentence says plainly that usage
 * is not being shown rather than showing a zero and hoping it reads as empty.
 *
 * That one fact needs an account to be about, though, and since /dashboard went
 * public the rail can be looked at by someone who has none. "Free plan · $0/mo"
 * in front of a guest is not an honest minimum, it is a claim about a
 * subscription that does not exist — so there is nothing to render, and the
 * visitor is offered /pricing by the marketing site they just came from instead.
 *
 * Awaiting the session here rather than taking a prop: `WorkspaceSidebar` is
 * synchronous on purpose, and the read is the same memoized one the user chip
 * does, so this costs a Suspense boundary and no extra round trip.
 *
 * `bg-glass-subtle` because this is a shell nested inside the rail's `bg-glass`,
 * which composites to slightly more opaque than its surroundings — an inset
 * panel rather than a second card floating on the canvas.
 */
export async function SidebarPlanPanel() {
  const { signedIn } = await sessionViewer();

  if (!signedIn) return null;

  return (
    <Card
      variant="compact"
      className="flex flex-col gap-2 bg-glass-subtle p-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-label-sm font-medium text-foreground">
          Free plan
        </p>
        <span className="shrink-0 font-mono text-label-caps uppercase text-muted-foreground">
          $0/mo
        </span>
      </div>
      <p className="text-label-sm text-muted-foreground">
        Your plan and usage will appear here.
      </p>
      <WorkspaceAction href="/pricing">View plans</WorkspaceAction>
    </Card>
  );
}
