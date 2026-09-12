import { Suspense } from "react";
import Link from "next/link";
import { Rocket } from "lucide-react";
import { Divider } from "@/components/ui/Divider";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { SidebarPlanPanel } from "./SidebarPlanPanel";
import { SidebarUser, SidebarUserFallback } from "./SidebarUser";
import { WorkspaceNavList } from "./WorkspaceNavList";
import { WorkspaceSetupLink } from "./WorkspaceSetupLink";

/**
 * The workspace's left rail: the wordmark, the five routes, the way back into
 * setup, the plan, and who is signed in.
 *
 * `sticky`, not `fixed`. The page scrolls the way a page scrolls and the main
 * column is a flex sibling, so nothing ever passes behind the rail — which is
 * what lets it be translucent without becoming a smear of the content beneath
 * it. It also keeps the shell clear of a `transform`, and a transform on any
 * ancestor of `bg-dotted-grid` would make that fixed canvas scroll with the
 * page.
 *
 * `h-dvh` with the column scrolling inside it: at 600px of viewport height the
 * nav and the user area cannot both fit, and the alternative to an inner scroll
 * is a sign-out button nobody can reach.
 *
 * `bg-glass` because the rail sits directly on the dotted canvas — the same
 * level as a card on the page, so the dots read through both.
 *
 * The user chip streams, and so does the plan panel now that it has a session to
 * read — and so does the setup link now that Task 14.10 reads completion for it.
 * No read can move up into `(app)/layout.tsx`: an awaited layout holds back
 * `(app)/loading.tsx`, which is why every gated page verifies the session itself.
 * Keeping the awaits behind Suspense boundaries means the rail and the page's
 * loading fallback both reach the browser immediately, and every boundary
 * resolves from the same memoized session round trip.
 */
export function WorkspaceSidebar() {
  return (
    <aside
      aria-label="Workspace sidebar"
      /* Task 3.13: the rail takes the Floating elevation level (a detached
         panel per the amended DESIGN.md §Elevation). Its geometry is
         unchanged — it is an edge-attached full-height panel, so it keeps
         `border-r` and no corner radius; a frame radius belongs to a
         freestanding panel, and reshaping the rail's edges is per-surface
         adoption work, not token adoption. */
      className="sticky top-0 z-10 hidden h-dvh w-[280px] shrink-0 border-r border-border bg-glass shadow-floating lg:block"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between gap-2 p-4">
          <Link
            href="/dashboard"
            className="flex w-fit items-center gap-2 rounded-base text-body-lg font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span className="flex items-center justify-center rounded-base bg-primary p-1.5 text-primary-foreground">
              <Rocket aria-hidden="true" className="size-4" />
            </span>
            UniPilot
          </Link>
          <div className="flex items-center gap-2">
            <GlobalSearch />
            <NotificationCenter />
            <ThemeToggle />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">

        {/* One group, so the rail's `gap-5` separates the navigation from the
            wordmark and the panel below rather than cutting through it. The
            setup link is a tier under the route list — 12px of air, muted, and
            inset to the rows' own left edge rather than to their labels, since
            it is an offer beside the navigation and not a sixth row of it. */}
        <div className="flex flex-col gap-3">
          <WorkspaceNavList />
          {/* `flex`, not a plain block: `WorkspaceAction` is `inline-flex`, so
              in a block it would sit on a line box and inherit the strut's
              leading — a few stray pixels of air above it that no gap value
              accounts for. As a flex item it measures exactly its own height.
              The link's completion read streams behind this boundary (14.10);
              `fallback={null}` because the link may simply not apply — an
              empty placeholder for a completed student would be a flash of the
              wrong state. */}
          <div className="flex px-2.5">
            <Suspense fallback={null}>
              <WorkspaceSetupLink />
            </Suspense>
          </div>
        </div>

        <div className="mt-auto flex flex-col gap-4">
          {/* `fallback={null}`, not a skeleton. This group is bottom-anchored by
              `mt-auto`, so the panel arriving above the account block pushes its
              own top edge upward and moves nothing else — whereas a placeholder
              that resolves to nothing for a guest would be a flash of a surface
              that was never theirs. */}
          <Suspense fallback={null}>
            <SidebarPlanPanel />
          </Suspense>
          <Divider />
          <Suspense fallback={<SidebarUserFallback />}>
            <SidebarUser />
          </Suspense>
        </div>
        </div>
      </div>
    </aside>
  );
}
