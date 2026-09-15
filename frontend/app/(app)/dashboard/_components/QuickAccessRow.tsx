import { Bot, FileText, type LucideIcon } from "lucide-react";
import { motionIndex } from "@/components/motion/stagger";
import { WorkspaceAction } from "@/components/app/WorkspaceAction";
import { Card } from "@/components/ui/Card";
import { LOGIN_PATH, REDIRECT_PARAM } from "@/lib/auth/constants";

type QuickAccessItem = {
  icon: LucideIcon;
  title: string;
  /** One line of true state. Never a count, never an activity summary. */
  state: string;
  action: { label: string; href: string };
};

const QUICK_ACCESS: readonly QuickAccessItem[] = [
  {
    icon: FileText,
    title: "Your academic materials",
    state: "No documents yet.",
    action: { label: "Open documents", href: "/documents" },
  },
  {
    icon: Bot,
    title: "Ask about your workspace",
    state: "Your assistant is ready — add materials to get started.",
    action: { label: "Open assistant", href: "/assistant" },
  },
];

/**
 * Two rows that are shortcuts, not summaries.
 *
 * The reference puts a compact strip under the main cards, and the temptation
 * there is a number: documents stored, questions asked, files processed. There is
 * no store and no assistant backend, so each row states the one thing that is
 * true and then gets out of the way.
 *
 * Laid out as a row — icon, two lines, action — so the pair reads as lighter than
 * the panels above them, with `p-3` and a smaller icon chip doing the rest of the
 * work of looking subordinate.
 *
 * `flex-wrap` with `ml-auto` on the action instead of a breakpoint: at 320px the
 * label, the state and an arrow link cannot share a line, so the action drops to
 * its own line and stays right-aligned. Nothing truncates, because truncating the
 * sentence that says what is true would be the one thing worth reading.
 *
 * Below-the-fold on a phone, but the dashboard must not require scrolling to
 * reveal its core workspace shortcuts. `data-enter` ensures the row is visible
 * on first paint with a soft entrance, rather than staying at `opacity:0`
 * until scrolled. The wrapper still carries the entrance and the `Card` the
 * lift, for the same layering reason as before.
 */
export function QuickAccessRow({ guest = false }: { guest?: boolean }) {
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      {QUICK_ACCESS.map((item, position) => (
        <div
          key={item.title}
          /* The pair slides in from its own side — the one compact directional
             entrance on the page, so the shortcut row reads as arriving from
             the edges rather than repeating the cards' rise. On a phone the
             two stack and each still keeps its own direction. */
          data-enter={position === 0 ? "left" : "right"}
          style={motionIndex(position)}
          className="min-w-0"
        >
          <Card
            variant="compact"
            className="flex h-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2 bg-glass p-3 backdrop-blur-md hover-lift hover:border-foreground"
          >
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-base border border-border bg-glass-subtle text-foreground"
            >
              <item.icon className="size-4" />
            </span>
            <div className="flex min-w-[10rem] flex-1 flex-col">
              <h3 className="text-label-sm font-semibold text-foreground">
                {item.title}
              </h3>
              <p className="text-label-sm text-muted-foreground">
                {item.state}
              </p>
            </div>
            <div className="ml-auto">
              <WorkspaceAction
                href={
                  guest
                    ? `${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent(item.action.href)}`
                    : item.action.href
                }
              >
                {item.action.label}
              </WorkspaceAction>
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
}
