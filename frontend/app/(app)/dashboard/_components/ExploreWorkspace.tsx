import {
  Bot,
  CalendarDays,
  CheckSquare,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { motionIndex } from "@/components/motion/stagger";
import { WorkspaceAction } from "@/components/app/WorkspaceAction";
import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";
import { LOGIN_PATH, REDIRECT_PARAM } from "@/lib/auth/constants";

type ExploreCard = {
  icon: LucideIcon;
  title: string;
  description: string;
  action: { label: string; href: string };
};

/**
 * The four places the workspace goes. Descriptions are written in the future
 * tense where the thing does not exist yet, which is all of them — every route
 * behind these links is still a stub.
 */
const EXPLORE_CARDS: readonly ExploreCard[] = [
  {
    icon: FileText,
    title: "Documents",
    description: "Where your syllabi, briefs and lecture notes will live.",
    action: { label: "Open documents", href: "/documents" },
  },
  {
    icon: CheckSquare,
    title: "Tasks",
    description: "Assignments, labs and submissions with their due dates.",
    action: { label: "Open tasks", href: "/tasks" },
  },
  {
    icon: CalendarDays,
    title: "Calendar",
    description: "Classes, exams and deadlines on one schedule.",
    action: { label: "Open calendar", href: "/calendar" },
  },
  {
    icon: Bot,
    title: "Assistant",
    description: "Answers drawn from the materials you add.",
    action: { label: "Open assistant", href: "/assistant" },
  },
];

/**
 * The bottom of the page: what is here, in four small cards.
 *
 * Deliberately the least prominent section on the dashboard. It exists because a
 * workspace with nothing in it has to explain itself once, and once is here —
 * below the primary action, not instead of it.
 *
 * Four across at `lg`, two at `sm`, one below that. `sm:grid-cols-2` rather than
 * `grid-cols-2` at 320px: two 130px columns would break every title onto three
 * lines.
 */
export function ExploreWorkspace({ guest = false }: { guest?: boolean }) {
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <header data-enter className="flex flex-col gap-1.5">
        <h2 className="text-headline-md text-foreground">
          Explore your workspace
        </h2>
        <p className="max-w-[56ch] text-body-md text-muted-foreground">
          Everything you need to organize, understand and plan your academic
          work.
        </p>
      </header>

      <ul className="grid min-w-0 list-none gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {EXPLORE_CARDS.map((card, position) => (
          <li
            key={card.title}
            /* Cards arrive with depth (scale variant) while the header above
               rose — the section reads as header first, then a set of tiles
               settling into place, not one repeated fade. */
            data-enter="scale"
            style={motionIndex(position)}
            className="min-w-0"
          >
            <Card
              variant="compact"
              className="flex h-full min-w-0 flex-col gap-2 bg-glass p-4 hover-lift hover:border-foreground"
            >
              <card.icon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
              <h3 className="text-body-lg font-semibold text-foreground">
                {card.title}
              </h3>
              <p className="text-label-sm text-muted-foreground">
                {card.description}
              </p>
              <div className="mt-auto flex flex-col gap-2.5 pt-3">
                <Divider />
                <WorkspaceAction
                  href={
                    guest
                      ? `${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent(card.action.href)}`
                      : card.action.href
                  }
                >
                  {card.action.label}
                </WorkspaceAction>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
