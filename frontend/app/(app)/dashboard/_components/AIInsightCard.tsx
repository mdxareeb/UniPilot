import { Sparkles } from "lucide-react";
import { motionIndex } from "@/components/motion/stagger";
import { WorkspaceAction } from "@/components/app/WorkspaceAction";
import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";
import { LOGIN_PATH, REDIRECT_PARAM } from "@/lib/auth/constants";

/**
 * One prepared insight, the whole of what a future recommendation service may
 * send (15.7 §4). Nothing supplies these today — no retrieval, no workload
 * engine, no action engine — so nothing renders an insight and the shape is
 * the whole of this task's data work.
 *
 * This card never calls a provider. An insight arrives fully formed — title,
 * summary, and display-ready metadata — because the service that computed it
 * owns the reasoning, the sources and the formatting, exactly as
 * `dashboardDate` owns the clock. `type` is the five buckets the AI phases
 * (20/21/26/27) are planned to produce; it is metadata text here, never a
 * badge. `action` is a link the service vouches for — the card renders it as
 * the same quiet arrow action every other card uses, and no action is invented
 * on the service's behalf.
 */
export type DashboardInsight = {
  /** The insight's own headline, e.g. "Two deadlines land on Thursday". */
  title: string;
  /** One or two sentences of what to do about it. */
  summary: string;
  /** What kind of recommendation this is. */
  type?: "workload" | "deadline" | "study" | "document" | "general";
  /** Display-ready context line, e.g. "Based on this week's deadlines". */
  source?: string;
  /** A real destination the recommendation leads to. */
  action?: { label: string; href: string };
  /** Display-ready generation time, e.g. "Today". Service-formatted. */
  generatedAt?: string;
};

type AIInsightCardProps = {
  /** Position in the page's entrance stagger. */
  index: number;
  /** A real prepared insight. Absent renders the intentional no-data state. */
  insight?: DashboardInsight;
  guest?: boolean;
};

/**
 * The AI insight card (Task 15.7): one recommendation, when there is one worth
 * making — and an honest placeholder until there is.
 *
 * This is not a second Assistant. It renders at most one insight as prose and
 * at most one link; there is no chat, no history, no bubbles, and no model
 * call — the global AssistantLauncher is and remains the conversation surface.
 * The card's own action, "Ask UniPilot", goes to the existing `/assistant`
 * route: the same entry point the launcher's own starters use, so the card
 * feeds the one assistant rather than standing beside it (15.7 §8).
 *
 * The no-data state is the honest one today: no retrieval, workload or action
 * engine exists, so the card says what will fill it — in the same
 * "No X yet. What will come." shape every other dashboard card uses — and
 * never implies analysis has occurred. No confidence scores, no citations, no
 * "UniPilot analyzed your week": a fabricated insight is worse than none, and
 * the empty state is the product telling the truth about itself.
 *
 * Visual identity is typography, not effects (15.7 §7): the Sparkles eyebrow is
 * the same icon the assistant launcher wears, so the card reads as part of
 * the same feature family; everything else is the standard card language —
 * glass, thin border, mono metadata, one Bricolage line for a real insight's
 * title. No glow, no gradient, no robot.
 *
 * Motion (15.7 §11): the card arrives with `scale` — the depth entrance the
 * system reserves for the surfaces that anchor their band, which a
 * recommendation merits: it is the one card on the page whose job is to be
 * read. Its band-mates all differ (stats assemble from their ends, documents
 * arrive from the left, the shortcuts slide in from their sides), so the
 * dimensional entrance also keeps the second band as varied as the first. A
 * dynamically inserted insight later is a `MotionNotice` concern — feedback
 * arriving must never make anyone wait — and is deliberately not built here:
 * animating fake content to demonstrate Motion is the one thing §11 forbids.
 *
 * `hover-lift` is on the `Card`, the entrance on the wrapper — the same
 * layering every other dashboard card uses, because the entrance's fill mode
 * would otherwise pin `transform: none` and cancel the lift for good.
 */
export function AIInsightCard({ index, insight, guest = false }: AIInsightCardProps) {
  const assistantHref = guest
    ? `${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent("/assistant")}`
    : "/assistant";

  return (
    <div data-enter="scale" style={motionIndex(index)} className="min-w-0">
      <Card
        variant="compact"
        className="flex min-w-0 flex-col gap-2 bg-glass p-4 backdrop-blur-md hover-lift hover:border-foreground"
      >
        <span className="flex items-center gap-1.5 font-mono text-label-caps uppercase text-muted-foreground">
          <Sparkles aria-hidden="true" className="size-3.5 shrink-0" />
          AI insight
        </span>
        <h3 className="text-body-lg font-semibold text-foreground">
          Something useful for you
        </h3>

        {insight ? (
          /* The prepared-insight path a future recommendation service fills
             in. One headline, one summary, one source line, one action — a
             paragraph, not a chat. */
          <div className="flex min-w-0 flex-col gap-2.5 pt-1">
            <h4 className="wrap-anywhere font-heading text-body-lg font-semibold leading-snug text-foreground">
              {insight.title}
            </h4>
            <p className="max-w-[56ch] text-label-sm text-muted-foreground">
              {insight.summary}
            </p>
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 font-mono text-label-caps text-muted-foreground">
              {insight.type ? (
                <span className="shrink-0 uppercase">{insight.type}</span>
              ) : null}
              {insight.source ? (
                <span className="min-w-0 truncate uppercase">{insight.source}</span>
              ) : null}
              {insight.generatedAt ? (
                <span className="shrink-0 uppercase">{insight.generatedAt}</span>
              ) : null}
            </p>
            {insight.action ? (
              <WorkspaceAction href={insight.action.href}>
                {insight.action.label}
              </WorkspaceAction>
            ) : null}
          </div>
        ) : (
          <p className="text-label-sm text-muted-foreground">
            No insights yet. UniPilot will surface useful recommendations as
            your workspace fills with tasks, deadlines and materials.
          </p>
        )}

        <div className="mt-auto flex flex-col gap-2.5 pt-3">
          <Divider />
          <WorkspaceAction href={assistantHref}>Ask UniPilot</WorkspaceAction>
        </div>
      </Card>
    </div>
  );
}
