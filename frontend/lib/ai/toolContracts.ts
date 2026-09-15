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
 */

export const STRUCTURED_ACTION_FENCE = "unipilot-action";

/** 27.x's closed vocabulary grows here; anything else is rejected. */
const ACTION_TYPE_PATTERN = /^[a-z][a-z0-9_.]{2,63}$/;

export type StructuredAction = {
  type: string;
  payload: Record<string, unknown>;
  /** Always true: the confirmation gate is not optional. */
  requiresConfirmation: true;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseStructuredAction(value: unknown): StructuredAction | null {
  if (!isRecord(value)) return null;
  const type = value.type;
  if (typeof type !== "string" || !ACTION_TYPE_PATTERN.test(type)) return null;
  if (!isRecord(value.payload)) return null;

  return {
    type,
    payload: value.payload,
    requiresConfirmation: true,
  };
}

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
 * contract and the prompt cannot drift). The reply text may still contain the
 * fence; `collectStructuredActions` strips nothing — 27.x decides how the UI
 * renders/suppresses the block.
 */
export const STRUCTURED_ACTION_INSTRUCTION =
  `To propose an action, emit a fenced ${STRUCTURED_ACTION_FENCE} block containing ` +
  `{"type": "<action.type>", "payload": { … }}. Every proposed action is shown ` +
  `to the user for confirmation; never claim you performed it.`;
