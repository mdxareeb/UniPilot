/**
 * Task 26.9 — the structured-output contract for the AI action engine (27.x).
 *
 * This module defines *shape*, never execution. A provider that wants to
 * propose an action emits a fenced JSON block:
 *
 *     ```unipilot-action
 *     { "type": "task.create", "payload": { "title": "…" } }
 *     ```
 *
 * `collectStructuredActions` extracts and validates those blocks; the 27.x
 * engine consumes the resulting `StructuredAction`s, and `requiresConfirmation`
 * is forced to `true` by the parser — there is deliberately no way to emit an
 * action that skips the user's confirmation (27.6). Nothing here imports a
 * client, touches the database or runs a tool.
 *
 * Task 27.1 layered the typed action vocabulary on top in `actionSchema.ts`
 * (`parseAssistantAction`, `summarizeAssistantAction`,
 * `normalizeAssistantActionForExecution`). The envelope parser moved there so
 * the typed layer can build on it without an import cycle; this module keeps
 * the 26.9 API intact and re-exports the whole contract, so `toolContracts` is
 * still the one import surface for the action engine.
 */
import {
  ASSISTANT_ACTION_TYPES,
  parseStructuredAction,
  type StructuredAction,
} from "./actionSchema";

export const STRUCTURED_ACTION_FENCE = "unipilot-action";

const FENCE_PATTERN = new RegExp(
  "```" + STRUCTURED_ACTION_FENCE + "\\s*\\n([\\s\\S]*?)```",
  "g",
);

/** Every valid fenced action in one provider message, in order. */
export function collectStructuredActions(text: string): StructuredAction[] {
  const actions: StructuredAction[] = [];
  let match: RegExpExecArray | null;

  while ((match = FENCE_PATTERN.exec(text)) !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      continue;
    }
    const action = parseStructuredAction(parsed);
    if (action !== null) actions.push(action);
  }

  return actions;
}

/**
 * The provider-facing instruction for emitting actions (kept here so the
 * contract and the prompt cannot drift). The supported types come from the
 * 27.1 union itself, so the prompt can never advertise a type the parser
 * rejects. The reply text may still contain the fence;
 * `collectStructuredActions` strips nothing — 27.x decides how the UI
 * renders/suppresses the block.
 */
export const STRUCTURED_ACTION_INSTRUCTION =
  `To propose an action, emit a fenced ${STRUCTURED_ACTION_FENCE} block containing ` +
  `{"type": "<action.type>", "payload": { … }}. The supported types are ` +
  `${ASSISTANT_ACTION_TYPES.join(", ")}; anything else is rejected. Every ` +
  `proposed action is shown to the user for confirmation — never claim you ` +
  `performed it.`;

// ---------------------------------------------------------------------------
// The full 26.9 + 27.1 contract, re-exported for a single import surface.
// ---------------------------------------------------------------------------

export { parseStructuredAction } from "./actionSchema";
export type { StructuredAction } from "./actionSchema";
export {
  ASSISTANT_ACTION_STATUSES,
  ASSISTANT_ACTION_TYPES,
  isAssistantActionType,
  normalizeAssistantActionForExecution,
  parseAssistantAction,
  summarizeAssistantAction,
} from "./actionSchema";
export type {
  AssistantAction,
  AssistantActionExecution,
  AssistantActionStatus,
  AssistantActionType,
  EventCreatePayload,
  PresentationCreatePayload,
  ReminderCreatePayload,
  TaskCreatePayload,
} from "./actionSchema";
