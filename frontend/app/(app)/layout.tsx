import { Suspense } from "react";
import type { Metadata } from "next";
import { AssistantLauncher } from "@/components/assistant/AssistantLauncher";
import { SidebarUser, SidebarUserFallback } from "@/components/app/SidebarUser";
import { WorkspaceMobileNav } from "@/components/app/WorkspaceMobileNav";
import { WorkspaceSetupLink } from "@/components/app/WorkspaceSetupLink";
import { WorkspaceSidebar } from "@/components/app/WorkspaceSidebar";
import { SignInPromptProvider } from "@/components/auth/SignInPromptProvider";
import { SignInPromptSession } from "@/components/auth/SignInPromptSession";
import { RouteTransition } from "@/components/motion/RouteTransition";

/**
 * The same shape `(marketing)/layout.tsx` uses, so a route group owns the titles
 * of the routes inside it. Without this the workspace routes inherit the
 * root layout's create-next-app defaults and every workspace tab reads
 * "Create Next App"; none of the pages under `(app)` sets a title of its own
 * yet. `default` is what a page without a `title` gets, and the template is
 * already in place for the ones that will set one.
 *
 * No `robots` directive: every workspace route is guest-viewable now (0.17
 * extended to the app routes), so a crawler can be served the guest state.
 * Whether any of them should be indexed alongside the landing page belongs to
 * the site-wide robots configuration in Task 43.6.
 */
export const metadata: Metadata = {
  title: {
    default: "Workspace | UniPilot",
    template: "%s | UniPilot",
  },
  description: "Your UniPilot workspace.",
};

/**
 * The workspace shell: a rail from `lg` up, a bar and drawer below it, and the
 * page in a column beside them.
 *
 * Deliberately synchronous. Every gated page verifies the session itself because
 * runtime data read in a layout blocks navigation instead of streaming
 * `(app)/loading.tsx` — see that file. The pieces of chrome that need the session
 * are the user chip and the plan panel, and they stream behind their own
 * boundaries instead of holding the shell back. That is also what lets /dashboard
 * be public without the shell knowing anything about it.
 *
 * That chip is rendered here, once per breakpoint, and handed to the drawer as
 * a node: `WorkspaceMobileNav` is a client component, so a server component
 * cannot be nested inside it, but an already-created element can be passed in.
 * The session read behind both is memoized per request.
 *
 * `bg-dotted-grid` goes on the flex container holding both columns. Its canvas
 * is a fixed `::before`, so it must not sit under a `transform`, `filter` or
 * `backdrop-filter` — anything of that kind on an ancestor would make the
 * element the containing block and turn the fixed canvas back into a scrolling
 * one. Nothing between `<body>` and here carries any of them; the rail is
 * `sticky` rather than transformed, and the reveal and hover transforms are all
 * on descendants, which is harmless.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SignInPromptProvider>
      {/* The guest flag streams from its own server boundary (the same shape
          SidebarUser uses) so the layout itself stays synchronous: the flag
          reaches the provider just after the shell, and a guest who tries to
          use a surface gets the skippable prompt rather than a redirect. */}
      <Suspense fallback={null}>
        <SignInPromptSession />
      </Suspense>
      {/* Scroll reveals start hidden and are shown by Motion once their target
          enters the viewport; the route transition starts hidden and animates
          in on mount. Without a script there is nothing to show either, so opt
          out entirely rather than leave content invisible. */}
      <noscript>
        <style>{`[data-reveal]{opacity:1!important;transform:none!important}[data-route-transition]{opacity:1!important;transform:none!important}`}</style>
      </noscript>
      <div className="flex min-h-screen flex-1 bg-dotted-grid">
        <WorkspaceSidebar />
        {/* `min-w-0` so a wide child in the page cannot push the column past the
            viewport and hand the whole document a horizontal scrollbar. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <WorkspaceMobileNav
            footer={
              <Suspense fallback={<SidebarUserFallback />}>
                <SidebarUser />
              </Suspense>
            }
            /* The drawer's copy of the setup link reads completion (14.10);
               it streams inside this boundary so the layout itself stays
               synchronous, exactly like the user chip above. */
            setupLink={
              <Suspense fallback={null}>
                <WorkspaceSetupLink />
              </Suspense>
            }
          />
          <main className="flex min-w-0 flex-1 flex-col">
            <RouteTransition>{children}</RouteTransition>
          </main>
        </div>
        {/* Inside the dotted container so it shares that stacking context: at
            `z-20` it sits over the page and the `z-10` rail, and under the
            `z-30` mobile bar. It reads no session itself — the prompt it
            guards with is answered by the provider's streamed flag. */}
        <AssistantLauncher />
      </div>
    </SignInPromptProvider>
  );
}
