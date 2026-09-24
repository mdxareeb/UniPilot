"use client";

import type { PresentationModels } from "@/lib/integrations/presenton";

/**
 * The presentation model display (generate redesign T2, spec §3.4).
 *
 * **Display-only in T2.** Every value rendered here comes from the T1 adapter
 * (`listPresentationModels()`): the engine's own settings report or the
 * operator's declaration. Nothing is selectable yet — T3 replaces the chip
 * with the live `Select` and wires the Server Action where the engine grants
 * it — so this component never renders a control that cannot act.
 *
 * Honesty rules (spec §2.5/§3.4):
 * - the chip names the model only when one is known, and otherwise says the
 *   model is set on the presentation service — never an invented id;
 * - `data-model-state` is `engine` (the engine's settings read answered),
 *   `declared` (operator declaration only) or `unknown` (nothing known);
 * - the note line below the prompt is rendered only when it is true, and a
 *   denied/dead engine still states where the model is configured.
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
 * The one honest sentence this deployment can say, or null when nothing is
 * known (no model name, no engine report) — in which case the chip alone
 * states that the service owns the model.
 */
export function modelNote(models: PresentationModels): string | null {
  if (
    models.engineManaged &&
    models.switchingDeclared &&
    models.providerModelKey !== null
  ) {
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

/**
 * The model chip: the model name when the engine or the operator names one,
 * "Model set on the presentation service." otherwise. A plain `<span>` on
 * purpose — nothing here is interactive in T2.
 */
export function ModelControl({ models }: { models: PresentationModels }) {
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
