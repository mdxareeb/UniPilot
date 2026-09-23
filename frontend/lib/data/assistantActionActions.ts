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
  ASSISTANT_ACTION_COPY,
  confirmAssistantAction,
  registerAssistantProposals,
  rejectAssistantAction,
  type AssistantActionItem,
  type AssistantActionMutationResult,
} from "./assistantActionLog";

/** Registration's answer: the content's proposals, or sanitized failure copy. */
export type AssistantProposalsResult = {
  error: string | null;
  actions: AssistantActionItem[];
};

/** Confirmation/rejection's answer; the settled row when one exists. */
export type AssistantMutationResult = AssistantActionMutationResult;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 27.9/27.11 — register one message's fenced actions (the stub/fixture path). */
export async function registerAssistantProposalsAction(
  conversationId: unknown,
  content: unknown,
): Promise<AssistantProposalsResult> {
  const user = await requireOnboardedUser("/assistant");

  const id = typeof conversationId === "string" ? conversationId.trim() : "";
  if (!UUID_PATTERN.test(id)) {
    return { error: ASSISTANT_ACTION_COPY.NOT_FOUND, actions: [] };
  }

  let result: Awaited<ReturnType<typeof registerAssistantProposals>>;
  try {
    result = await registerAssistantProposals(user.id, {
      conversationId: id,
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
    return result;
  } catch {
    return { error: ASSISTANT_ACTION_COPY.FAILED, action: null };
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
    return { error: ASSISTANT_ACTION_COPY.FAILED, action: null };
  }
}
