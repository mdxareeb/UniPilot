"use client";

/**
 * Task D9 — the infographic insertion palette (spec §5.4 "Infographics", §6.7,
 * plan D9).
 *
 * The native renderer implements three infographic types (`gauge`,
 * `progress_bar`, `vertical_funnel`); every other type renders B3's honest
 * placeholder. This palette therefore offers exactly those three as add
 * actions and lists the remaining 24 **disabled** with the same honest note —
 * an unsupported type can never be inserted into a broken state. The full
 * inventory lives in `lib/presentation/infographicOps`
 * (`INFOGRAPHIC_CAPABILITIES`), which D10's capability checklist consumes.
 *
 * Rendered by both the rail's Add element popover and the inspector's "Add
 * element" section — same component, same behavior, distinguished only by
 * `source` for tests. Motion is the shared `Collapsible`; no new animation
 * vocabulary.
 */
import { useId, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { Collapsible } from "@/components/motion/Collapsible";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import {
  supportedInfographicCapabilities,
  UNSUPPORTED_INFOGRAPHIC_NOTE,
  unsupportedInfographicCapabilities,
  type SupportedInfographicCapability,
  type InsertableInfographicType,
} from "@/lib/presentation/infographicOps";

export type InfographicPaletteProps = {
  /** Distinguishes the rail popover and the inspector instances (tests). */
  source: "rail" | "inspector";
  onInsert: (type: InsertableInfographicType) => void;
  /** Why insertion is paused (the chat settle window), else null. */
  disabledReason?: string | null;
};

export function InfographicPalette({
  source,
  onInsert,
  disabledReason = null,
}: InfographicPaletteProps) {
  const idPrefix = useId();
  /* The three implemented types are the palette's point and start open; the
     24 disabled types stay behind one disclosure so the gap is visible without
     burying the working actions. */
  const [supportedOpen, setSupportedOpen] = useState(true);
  const [unsupportedOpen, setUnsupportedOpen] = useState(false);
  const supported = supportedInfographicCapabilities();
  const unsupported = unsupportedInfographicCapabilities();
  const supportedPanelId = `${idPrefix}-supported`;
  const unsupportedPanelId = `${idPrefix}-unsupported`;
  const disabled = disabledReason !== null && disabledReason !== undefined;

  return (
    <div data-infographic-palette={source} className="flex flex-col gap-1">
      {disabled ? (
        <p
          data-infographic-palette-note=""
          className="px-1 text-label-sm text-muted-foreground"
        >
          [!] {disabledReason}
        </p>
      ) : null}

      <section data-infographic-group="supported">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          aria-expanded={supportedOpen}
          aria-controls={supportedPanelId}
          data-infographic-group-toggle="supported"
          onClick={() => setSupportedOpen((open) => !open)}
        >
          <span className="flex w-full min-w-0 items-center justify-between gap-3">
            <span className="min-w-0 truncate text-left">Infographics</span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-label-caps text-muted-foreground">
                {supported.length}
              </span>
              <ChevronDown
                aria-hidden="true"
                className={`icon-turn size-4${supportedOpen ? " rotate-180" : ""}`}
              />
            </span>
          </span>
        </Button>
        <Collapsible id={supportedPanelId} open={supportedOpen} variant="fade">
          <ul className="mt-1 flex flex-col gap-0.5">
            {supported.map((capability) => (
              <SupportedEntry
                key={capability.type}
                capability={capability}
                source={source}
                disabled={disabled}
                disabledReason={disabledReason}
                onInsert={onInsert}
              />
            ))}
          </ul>
        </Collapsible>
      </section>

      <section data-infographic-group="unsupported">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          aria-expanded={unsupportedOpen}
          aria-controls={unsupportedPanelId}
          data-infographic-unsupported-toggle=""
          onClick={() => setUnsupportedOpen((open) => !open)}
        >
          <span className="flex w-full min-w-0 items-center justify-between gap-3">
            <span className="min-w-0 truncate text-left">
              Not rendered natively yet
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-label-caps text-muted-foreground">
                {unsupported.length}
              </span>
              <ChevronDown
                aria-hidden="true"
                className={`icon-turn size-4${unsupportedOpen ? " rotate-180" : ""}`}
              />
            </span>
          </span>
        </Button>
        <Collapsible id={unsupportedPanelId} open={unsupportedOpen} variant="fade">
          <p
            data-infographic-unsupported-note=""
            className="px-1 pt-1 text-label-sm text-muted-foreground"
          >
            These types aren&rsquo;t rendered natively yet — they stay listed so
            the gap is visible, and they can&rsquo;t be inserted.
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {unsupported.map((capability) => (
              <li
                key={capability.type}
                data-infographic-unsupported={capability.type}
                className="flex min-w-0 items-start justify-between gap-1 rounded-nested px-1 py-1"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="min-w-0 text-label-sm text-muted-foreground">
                    {capability.label}
                  </span>
                  <span
                    data-infographic-unsupported-note={capability.type}
                    className="min-w-0 text-label-sm text-muted-foreground/80"
                  >
                    {UNSUPPORTED_INFOGRAPHIC_NOTE}
                  </span>
                </span>
                <IconButton
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled
                  aria-label={`${capability.label} — ${UNSUPPORTED_INFOGRAPHIC_NOTE}`}
                  title={`${capability.label} — ${UNSUPPORTED_INFOGRAPHIC_NOTE}`}
                  data-infographic-unsupported-add={capability.type}
                >
                  <Plus aria-hidden="true" className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        </Collapsible>
      </section>
    </div>
  );
}

function SupportedEntry({
  capability,
  source,
  disabled,
  disabledReason,
  onInsert,
}: {
  capability: SupportedInfographicCapability;
  source: "rail" | "inspector";
  disabled: boolean;
  disabledReason: string | null | undefined;
  onInsert: (type: InsertableInfographicType) => void;
}) {
  const title = disabledReason ?? `Add ${capability.label} to this slide`;
  return (
    <li
      data-infographic-entry={capability.type}
      data-infographic-supported={capability.type}
      className="flex min-w-0 items-center justify-between gap-1 rounded-nested px-1 py-1 hover:bg-muted/60"
    >
      <span className="min-w-0 text-label-sm text-foreground">
        {capability.label}
      </span>
      <IconButton
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Add ${capability.label} to this slide`}
        title={title}
        disabled={disabled}
        data-infographic-add={capability.type}
        data-infographic-add-source={source}
        onClick={() => onInsert(capability.type)}
      >
        <Plus aria-hidden="true" className="size-4" />
      </IconButton>
    </li>
  );
}
