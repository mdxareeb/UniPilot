"use client";

/**
 * Task E2 — the native templates browser's client surface (spec §5.1 row 7,
 * §8.1–8.3).
 *
 * Built-in/Custom tabs over the engine's template list, rendered as cards:
 * thumbnail (through the session-gated template-asset route), name,
 * description, layout count `Badge`, and the link into the read-only preview
 * route. Motion is the shared system: the card grid is one
 * `MotionRevealGroup` with `MotionRevealItem variant="scale"` members, keyed
 * by tab so switching tabs plays the set arriving; each card keeps the
 * project's `hover-lift`; no new durations or easings.
 *
 * Custom template creation is deferred (spec §5.1 row 9); the Custom tab's
 * empty state says so instead of offering a dead action.
 */
import { useState } from "react";
import Link from "next/link";
import { Layers, Presentation } from "lucide-react";
import {
  MotionRevealGroup,
  MotionRevealItem,
} from "@/components/motion/MotionRevealGroup";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { TemplateThumb } from "../../_components/TemplateThumb";

/** One template as the browser needs it; a serializable slice of the adapter's item. */
export type TemplateCard = {
  id: string;
  name: string;
  description: string | null;
  layoutCount: number;
  thumbnail: string | null;
};

type TemplatesBrowserProps = {
  /** `is_default` templates. */
  builtIn: TemplateCard[];
  /** Custom templates (`is_default: false`). */
  custom: TemplateCard[];
  /** The engine's total across both kinds, for the honest count line. */
  total: number;
};

type TemplateTab = "built-in" | "custom";

/**
 * One card's art. The renderer is shared with the generator's Templates split
 * (T2, generate redesign): `TemplateThumb` owns the engine-servable markup and
 * the neutral placeholder, so both surfaces fall back identically.
 */
function TemplateGrid({ templates }: { templates: TemplateCard[] }) {
  return (
    <MotionRevealGroup
      as="ul"
      className="grid min-w-0 list-none gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      {templates.map((template) => (
        <MotionRevealItem
          as="li"
          key={template.id}
          variant="scale"
          className="min-w-0"
        >
          <Link
            href={`/tools/presentation/templates/${encodeURIComponent(template.id)}`}
            data-template-card={template.id}
            className="block h-full min-w-0 rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Card className="flex h-full min-w-0 flex-col gap-3 bg-glass p-3 backdrop-blur-md hover-lift hover:border-foreground">
              <TemplateThumb template={template} />
              <span className="flex min-w-0 flex-col gap-1.5">
                <span className="flex min-w-0 items-start justify-between gap-2">
                  <span className="min-w-0 truncate font-heading text-body-md font-semibold text-foreground">
                    {template.name}
                  </span>
                  <Badge variant="outline" size="sm" className="shrink-0">
                    <Layers aria-hidden="true" className="size-3" />
                    {template.layoutCount} layouts
                  </Badge>
                </span>
                <span className="line-clamp-2 min-w-0 text-label-sm text-muted-foreground">
                  {template.description ??
                    "No description on the service for this template."}
                </span>
              </span>
            </Card>
          </Link>
        </MotionRevealItem>
      ))}
    </MotionRevealGroup>
  );
}

export function TemplatesBrowser({
  builtIn,
  custom,
  total,
}: TemplatesBrowserProps) {
  const [tab, setTab] = useState<TemplateTab>(
    builtIn.length > 0 ? "built-in" : "custom",
  );
  const shown = tab === "built-in" ? builtIn : custom;
  const shownCount = builtIn.length + custom.length;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div
        role="group"
        aria-label="Template kind"
        className="flex min-w-0 flex-wrap items-center gap-1.5"
      >
        {(
          [
            ["built-in", "Built-in", builtIn.length],
            ["custom", "Custom", custom.length],
          ] as const
        ).map(([id, label, count]) => {
          const selected = tab === id;
          return (
            <button
              key={id}
              type="button"
              data-template-tab={id}
              aria-pressed={selected}
              onClick={() => setTab(id)}
              className={`min-w-0 rounded-pill border px-3 py-2 font-heading text-label-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                selected
                  ? "border-transparent bg-card font-semibold text-foreground shadow-subtle"
                  : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
              }`}
            >
              {label}
              <span className="ml-1.5 font-mono text-label-caps text-muted-foreground">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {shown.length > 0 ? (
        <TemplateGrid key={tab} templates={shown} />
      ) : (
        <Card className="bg-glass p-6 backdrop-blur-md md:p-8">
          {shownCount === 0 ? (
            <EmptyState
              icon={<Presentation aria-hidden="true" className="size-6" />}
              title="No templates to show"
              description="The presentation service returned no templates, so there's nothing to browse here. Nothing is faked in their place."
            />
          ) : (
            <EmptyState
              icon={<Presentation aria-hidden="true" className="size-6" />}
              title="No custom templates yet"
              description="Custom templates are created in Presenton's own studio. Once the service has one, it appears here with the same read-only preview."
            />
          )}
        </Card>
      )}

      {total > shownCount ? (
        <p className="text-label-sm text-muted-foreground">
          Showing {shownCount} of {total} templates.
        </p>
      ) : null}
    </div>
  );
}
