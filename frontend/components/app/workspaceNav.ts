import {
  Bot,
  CalendarDays,
  CheckSquare,
  FileText,
  LayoutDashboard,
  Plug,
  Wrench,
  type LucideIcon,
} from "lucide-react";

type WorkspaceNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

/**
 * The workspace surfaces, in the order they appear in the sidebar and the
 * mobile menu. One list so the two navigations can never disagree.
 *
 * Every `href` is a route that exists in `app/(app)`, so nothing here can point
 * at a destination Next.js would 404. All of them are guest-viewable (0.17
 * extended to the workspace): a visitor without a session renders the same
 * surface with honest empty states and no data read, `/onboarding` is the only
 * protected route left, and using a surface is what opens the shared skippable
 * sign-in prompt. The rows stay plain links on purpose — the prompt, not a
 * per-row redirect, is the project's answer for a gated action.
 *
 * `/tools` is the registry-driven catalogue of every tool the product intends
 * to carry (0.11/0.12) and `/integrations` is the honest coming-soon page for
 * the services that are not wired yet; neither claims more than the registry
 * or the page itself can back. The nav's job is to say where they are, not to
 * imply they are finished.
 */
const WORKSPACE_NAV: readonly WorkspaceNavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Tasks", href: "/tasks", icon: CheckSquare },
  { label: "Calendar", href: "/calendar", icon: CalendarDays },
  { label: "Documents", href: "/documents", icon: FileText },
  { label: "Assistant", href: "/assistant", icon: Bot },
  { label: "Tools", href: "/tools", icon: Wrench },
  { label: "Integrations", href: "/integrations", icon: Plug },
];

/**
 * Whether a nav item owns the current path. Prefix-matched on a segment
 * boundary so a future `/documents/[id]` keeps Documents lit, while `/tasks`
 * never matches a hypothetical `/tasks-archive`.
 */
function isActiveNavPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export { WORKSPACE_NAV, isActiveNavPath };
export type { WorkspaceNavItem };
