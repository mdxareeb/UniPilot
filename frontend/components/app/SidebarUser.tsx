import { Skeleton } from "@/components/ui/Skeleton";
import { sessionViewer } from "@/lib/auth/viewer";
import { ProfileMenu } from "./ProfileMenu";

/**
 * Who is signed in, rendered as the account menu — or the guest's version of
 * it. One component, mounted once per breakpoint: in the rail and as the
 * mobile drawer's footer, so the two shells share a single account
 * architecture.
 *
 * Streams behind its own Suspense boundary in `WorkspaceSidebar` and
 * `(app)/layout.tsx`. The session read cannot move up into the layout: an
 * awaited layout holds back `(app)/loading.tsx`, which is why every gated page
 * verifies the session itself. Keeping the await down here means the rail, the
 * nav and the page's loading fallback all reach the browser immediately and
 * only the menu arrives late.
 *
 * `sessionViewer` rather than `requireUser` on purpose — this is chrome, not a
 * gate. It never throws and never redirects, so a Supabase outage renders the
 * guest menu instead of bouncing someone out of a page they are allowed to
 * see. The viewer is the whole of what the client side learns: a boolean and,
 * maybe, a sanitized first name.
 */
export async function SidebarUser() {
  const viewer = await sessionViewer();

  return <ProfileMenu viewer={viewer} />;
}

/**
 * The trigger's shape while the session resolves — the chip and nothing else,
 * because the actions live inside the menu now and add no height until it is
 * opened. `p-1.5` is the trigger's own padding and `size-8` its disc, so the
 * real control replaces this without moving anything.
 */
export function SidebarUserFallback() {
  return (
    <div aria-hidden="true" className="flex min-w-0 items-center gap-2.5 p-1.5">
      <Skeleton className="size-8 shrink-0 rounded-pill" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-2.5 w-20" />
      </div>
    </div>
  );
}
