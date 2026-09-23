"use server";

/**
 * The assistant action log's Server Actions (Task 27.x, R6's fixture path).
 *
 * The repo pattern of `taskActions.ts`/`assistantActions.ts`: the gate runs
 * first and outside the try block (`requireOnboardedUser("/assistant")` is the
 * same session + completion check the page runs, so an unfinished student
 * cannot use these as a side door), ids are parsed on the server, the log
 * service does the work, and only sanitized copy travels back to the client.
 *
 * These actions never execute an action by themselves (27.6): registration
 * only writes `proposed` rows, and `confirmAssistantActionAction` is the one
 * call through which a user's decision can run an action. `revalidatePath`
 * drops the assistant surface's cached render after every completed call, so
 * the confirmation UI and the log re-read the settled state.
 */
import { revalidatePath } from "next/cache";
import { requireOnboardedUser } from "@/lib/onboarding/gate";
import {
  confirmAssistantAction,
  registerAssistantProposals,
  rejectAssistantAction,
} from "./assistantActionLog";
import {
  ASSISTANT_ACTION_COPY,
  type AssistantActionItem,
  type AssistantActionMutationResult,
} from "./assistantValues";

/** Registration's answer: the content's proposals, or sanitized failure copy. */
export type AssistantProposalsResult = {
  error: string | null;
  actions: AssistantActionItem[];
};

/** Confirmation/rejection's answer; the settled row when one exists. */
export type AssistantMutationResult = AssistantActionMutationResult;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 27.9/27.11 — register one message's fenced actions (the stub/fixture path).
 *
 * `messageId` is the settled `done` frame's id (or null for live content).
 * Passing it is what makes the client-side registration of a stubbed turn use
 * the very key the turn pipeline used for the same message, so a turn that
 * both persisted and registered server-side is a no-op when the client
 * registers it again (T27-C's one-path-per-message hand-off).
 */
export async function registerAssistantProposalsAction(
  conversationId: unknown,
  content: unknown,
  messageId?: unknown,
): Promise<AssistantProposalsResult> {
  const user = await requireOnboardedUser("/assistant");

  const id = typeof conversationId === "string" ? conversationId.trim() : "";
  if (!UUID_PATTERN.test(id)) {
    return { error: ASSISTANT_ACTION_COPY.NOT_FOUND, actions: [] };
  }

  const rawMessageId = typeof messageId === "string" ? messageId.trim() : "";
  const message = rawMessageId === "" ? null : rawMessageId;

  let result: Awaited<ReturnType<typeof registerAssistantProposals>>;
  try {
    result = await registerAssistantProposals(user.id, {
      conversationId: id,
      messageId: message,
      content: typeof content === "string" ? content : "",
    });
  } catch {
    return { error: ASSISTANT_ACTION_COPY.FAILED, actions: [] };
  }

  if (result.status === "not-found") {
    return { error: ASSISTANT_ACTION_COPY.NOT_FOUND, actions: [] };
  }

  revalidatePath("/assistant");
  return { error: null, actions: result.items };
}

/** 27.6/27.13 — the user's confirmation: the only path that executes. */
export async function confirmAssistantActionAction(
  actionId: unknown,
): Promise<AssistantMutationResult> {
  const user = await requireOnboardedUser("/assistant");

  const id = typeof actionId === "string" ? actionId.trim() : "";
  if (!UUID_PATTERN.test(id)) {
    return { error: ASSISTANT_ACTION_COPY.NOT_FOUND, action: null };
  }

  try {
    const result = await confirmAssistantAction(user.id, id);
    revalidatePath("/assistant");
    /* A confirmation can create a task, an event or a presentation, so the
       board, the calendar and the presentations tool drop their cached
       renders too — the same posture as the assistant surface itself. All
       three are revalidated on every settled call: `revalidatePath` only marks
       the route for the next visit, and a confirmation that failed wrote
       nothing either way. */
    revalidatePath("/tasks");
    revalidatePath("/calendar");
    revalidatePath("/tools/presentation");
    return result;
  } catch {
    /* The confirm may have reached the executor before this response was
       lost, so the catch-all never claims "nothing was created". */
    return { error: ASSISTANT_ACTION_COPY.UNCERTAIN, action: null };
  }
}

/** 27.6 — rejection is terminal and idempotent; it executes nothing. */
export async function rejectAssistantActionAction(
  actionId: unknown,
): Promise<AssistantMutationResult> {
  const user = await requireOnboardedUser("/assistant");

  const id = typeof actionId === "string" ? actionId.trim() : "";
  if (!UUID_PATTERN.test(id)) {
    return { error: ASSISTANT_ACTION_COPY.NOT_FOUND, action: null };
  }

  try {
    const result = await rejectAssistantAction(user.id, id);
    revalidatePath("/assistant");
    return result;
  } catch {
    /* A rejection never creates a task or an event (the executor is not
       called), so `FAILED`'s "nothing was created" stays true here even when
       the log transition itself may have landed. */
    return { error: ASSISTANT_ACTION_COPY.FAILED, action: null };
  }
}
