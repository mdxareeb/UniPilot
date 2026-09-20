"use client";

/**
 * Task E2 — the read-only template preview (spec §5.1 row 8, §8.1–8.3).
 *
 * The first layout renders through the existing `DeckStage` with the
 * template's own theme and fonts; the layout picker swaps which layout the
 * same stage shows. The stage is display-only (`interactive` off) and nothing
 * here writes: no editing surface, no persistence, no fake content.
 *
 * Motion is the shared system: the page shell (`PreviewShell`) owns the
 * entrance ladder (`PageHeader` slot 0, the preview section slot 1), and the
 * selected layout carries a `MotionSelectionRing`
 * (`layoutId="template-preview-layout"`) that travels between the picker's
 * rows. No new animation vocabulary.
 */
import { useMemo, useState } from "react";
import { DeckStage } from "@/components/presentation/DeckStage";
import { MotionSelectionRing } from "@/components/motion/MotionSelectionRing";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { templateAssetUrl } from "@/lib/presentation/assets";
import type { DeckTheme, TemplateLayout } from "@/lib/presentation/types";
import {
  buildTemplatePreviewDeck,
  templatePreviewDeckId,
} from "./templatePreviewModel";

export type TemplatePreviewProps = {
  templateId: string;
  name: string;
  layoutCount: number;
  layouts: TemplateLayout[];
  theme: DeckTheme | null;
  fonts: Record<string, string>;
};

export function TemplatePreview({
  templateId,
  name,
  layoutCount,
  layouts,
  theme,
  fonts,
}: TemplatePreviewProps) {
  const [selectedId, setSelectedId] = useState(layouts[0]?.id ?? "");
  const selectedIndex = Math.max(
    0,
    layouts.findIndex((layout) => layout.id === selectedId),
  );

  const deck = useMemo(
    () =>
      buildTemplatePreviewDeck({
        templateId,
        name,
        layouts,
        theme,
        fonts,
      }),
    [templateId, name, layouts, theme, fonts],
  );

  if (deck === null) {
    return (
      <Card
        data-template-preview-empty=""
        className="bg-glass p-6 backdrop-blur-md md:p-8"
      >
        <p className="text-label-sm text-muted-foreground">
          This template has no layouts to preview. Nothing is faked in their
          place.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card
        data-template-preview-stage=""
        className="min-w-0 self-start bg-glass p-3 backdrop-blur-md md:p-4"
      >
        <div className="flex min-w-0 items-center justify-between gap-3 px-1 pb-3">
          <p className="min-w-0 truncate font-mono text-label-caps uppercase text-muted-foreground">
            {layouts[selectedIndex]?.id ?? ""}
          </p>
          <p className="shrink-0 text-label-sm text-muted-foreground">
            {selectedIndex + 1} / {layouts.length}
          </p>
        </div>
        <DeckStage
          deck={deck}
          id={templatePreviewDeckId(templateId)}
          slideIndex={selectedIndex}
          assetUrl={templateAssetUrl}
        />
      </Card>

      <Card className="flex min-w-0 flex-col gap-3 bg-glass p-4 backdrop-blur-md">
        <header className="flex min-w-0 items-center justify-between gap-3">
          <h2 className="font-heading text-body-md font-semibold text-foreground">
            Layouts
          </h2>
          <Badge variant="outline" size="sm" className="shrink-0">
            {layoutCount} layouts
          </Badge>
        </header>
        <p className="text-label-sm text-muted-foreground">
          Read-only preview. Pick a layout to render it in the stage.
        </p>
        <ul className="flex min-w-0 list-none flex-col gap-1">
          {layouts.map((layout, index) => {
            const selected = index === selectedIndex;
            return (
              <li key={layout.id} className="min-w-0">
                <button
                  type="button"
                  data-template-layout={layout.id}
                  data-template-layout-selected={selected ? "true" : undefined}
                  aria-pressed={selected}
                  onClick={() => setSelectedId(layout.id)}
                  className={`relative flex w-full min-w-0 flex-col gap-0.5 rounded-base border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                    selected
                      ? "border-transparent bg-card text-foreground shadow-subtle"
                      : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                  }`}
                >
                  {selected ? (
                    <MotionSelectionRing
                      layoutId="template-preview-layout"
                      radiusClass="rounded-base"
                    />
                  ) : null}
                  <span className="min-w-0 truncate text-label-sm font-medium">
                    {layout.description || layout.id}
                  </span>
                  <span className="min-w-0 truncate font-mono text-label-sm text-muted-foreground">
                    {layout.id}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
