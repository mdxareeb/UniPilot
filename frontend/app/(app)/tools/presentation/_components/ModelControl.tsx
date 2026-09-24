"use client";

import { MotionNotice } from "@/components/motion/MotionNotice";
import { Select } from "@/components/ui/Select";
import type { PresentationModels } from "@/lib/integrations/presenton";

/**
 * The presentation model control (generate redesign T2 display, T3 wiring;
 * spec §2.5/§3.4).
 *
 * Every value rendered here comes from the T1 adapter
 * (`listPresentationModels()`): the engine's own settings report or the
 * operator's declaration. Nothing is invented, and nothing is selectable
 * unless the engine grants it.
 *
 * Honesty rules (spec §2.5/§3.4):
 * - the interactive `Select` renders only when the engine's settings read
 *   answered AND the operator declared options AND the provider has a write
 *   target AND there is more than one option to choose from; every other
 *   state keeps the read-only chip, which never implies a working switch;
 * - `data-model-state` is `engine` (the engine's settings read answered),
 *   `declared` (operator declaration only) or `unknown` (nothing known);
 * - the note line below the prompt is rendered only when it is true: the
 *   switch's note states its deployment-global nature, a denied/dead engine
 *   still states where the model is configured, and nothing is said at all
 *   when no model name is known;
 * - while applying, the `Select` is disabled and shows the server value
 *   (`models.current`, never a local guess); on failure the sanitized copy
 *   appears in a `MotionNotice` and the value never moves on its own — no
 *   phantom selection.
 */

/** `engine` = the engine's own report; `declared` = operator declaration only. */
export function modelControlState(
  models: PresentationModels,
): "engine" | "declared" | "unknown" {
  if (models.currentSource === "engine") return "engine";
  if (models.currentSource === "declared") return "declared";
  return "unknown";
}

/**
 * The one condition that makes the switch real: the engine's settings read
 * answered (so a mapped write target exists), the operator declared options,
 * and there is more than one option to choose from. Every other state renders
 * the chip — a denied/dead engine, an unmapped provider, or a declaration
 * with nothing to choose between.
 */
export function isModelSwitchable(models: PresentationModels): boolean {
  return (
    models.engineManaged &&
    models.switchingDeclared &&
    models.providerModelKey !== null &&
    models.options.length > 1
  );
}

/**
 * The one honest sentence this deployment can say, or null when nothing is
 * known (no model name, no engine report) — in which case the chip alone
 * states that the service owns the model.
 */
export function modelNote(models: PresentationModels): string | null {
  if (isModelSwitchable(models)) {
    return "Applies to this deployment's presentation service — every deck generated after the change. Decks already generating keep their model.";
  }
  if (
    models.engineManaged &&
    models.switchingDeclared &&
    models.providerModelKey !== null
  ) {
    // The switch is granted but the catalogue has nothing to choose between
    // (one option); the chip names the model without implying a chooser.
    return "Model in use on the presentation service.";
  }
  if (models.engineManaged) {
    return "Changing the model isn't enabled for this deployment.";
  }
  if (models.current !== null) {
    return "The model is configured on the presentation service.";
  }
  return null;
}

type ModelControlProps = {
  models: PresentationModels;
  /** The sanitized failure line from the last apply, or null. */
  error: string | null;
  /** True while the apply (and its re-read) is in flight; disabled then. */
  applying: boolean;
  /** The chosen value; the workspace calls the Server Action and refreshes. */
  onApply: (value: string) => void;
};

/**
 * The model control: the live `Select` when the engine grants a switch,
 * otherwise the read-only chip. The chip is a plain `<span>` on purpose —
 * nothing in the read-only states is interactive.
 */
export function ModelControl({
  models,
  error,
  applying,
  onApply,
}: ModelControlProps) {
  if (!isModelSwitchable(models)) {
    return (
      <span
        data-model-control=""
        data-model-state={modelControlState(models)}
        className="inline-flex min-w-0 max-w-full items-center rounded-pill border border-border bg-glass-subtle px-3 py-1.5 text-label-sm text-muted-foreground"
      >
        <span className="min-w-0 truncate">
          {models.current ?? "Model set on the presentation service."}
        </span>
      </span>
    );
  }

  return (
    <div
      data-model-control=""
      data-model-state={modelControlState(models)}
      data-model-apply={
        applying ? "applying" : error !== null ? "error" : "idle"
      }
      className="flex min-w-0 flex-col items-start gap-1.5"
    >
      <div className="w-48 max-w-full">
        <Select
          size="sm"
          value={models.current ?? ""}
          onChange={onApply}
          options={models.options.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
          disabled={applying}
          aria-label="Presentation model"
        />
      </div>
      {error !== null ? (
        <MotionNotice role="alert" className="text-label-sm text-destructive">
          {error}
        </MotionNotice>
      ) : null}
    </div>
  );
}

/** The note line, placed under the prompt box; renders nothing when untrue. */
export function ModelControlNote({ models }: { models: PresentationModels }) {
  const note = modelNote(models);
  if (note === null) return null;
  return (
    <p data-model-note="" className="text-label-sm text-muted-foreground">
      {note}
    </p>
  );
}
