"use server";

/**
 * WhatsApp group live sync (Stage 1): Server Actions.
 *
 * Same shape as `integrationActions.ts`: the onboarding gate first (outside
 * `try`, so its redirect propagates), the feature flag next, untrusted input
 * typed `unknown` and validated at the boundary, and a generic sanitized error
 * on any failure. The actions only write the user's intent; the bridge acts on
 * it.
 */
import { revalidatePath } from "next/cache";
import { requireOnboardedUser } from "@/lib/onboarding/gate";
import {
  confirmGroupCandidate,
  getGroupSyncSnapshot,
  isGroupSyncEnabled,
  requestGroupDisconnect,
  requestGroupLink,
  setGroupActive,
} from "./groupSync";
import { rejectCandidate } from "./integrations";
import {
  WHATSAPP_CANDIDATE_NOT_FOUND_ERROR,
  WHATSAPP_GENERIC_ERROR,
  WHATSAPP_GROUPS_DISABLED_ERROR,
  WHATSAPP_GROUPS_FORGOTTEN_NOTE,
  WHATSAPP_GROUPS_NOT_FOUND_ERROR,
} from "./integrationErrors";
import {
  EMPTY_GROUP_SYNC,
  type GroupSyncSnapshot,
} from "./groupSyncValues";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ActionResult = { error: string | null; notice?: string };

export async function getGroupSyncStatusAction(): Promise<
  { error: string | null } & GroupSyncSnapshot
> {
  const user = await requireOnboardedUser("/integrations");
  if (!isGroupSyncEnabled()) {
    return { error: WHATSAPP_GROUPS_DISABLED_ERROR, ...EMPTY_GROUP_SYNC };
  }
  try {
    return { error: null, ...(await getGroupSyncSnapshot(user.id)) };
  } catch {
    return { error: WHATSAPP_GENERIC_ERROR, ...EMPTY_GROUP_SYNC };
  }
}

export async function requestGroupLinkAction(): Promise<ActionResult> {
  const user = await requireOnboardedUser("/integrations");
  if (!isGroupSyncEnabled()) return { error: WHATSAPP_GROUPS_DISABLED_ERROR };
  try {
    await requestGroupLink(user.id);
    revalidatePath("/integrations");
    return { error: null };
  } catch {
    return { error: WHATSAPP_GENERIC_ERROR };
  }
}

export async function requestGroupDisconnectAction(): Promise<ActionResult> {
  const user = await requireOnboardedUser("/integrations");
  if (!isGroupSyncEnabled()) return { error: WHATSAPP_GROUPS_DISABLED_ERROR };
  try {
    const outcome = await requestGroupDisconnect(user.id);
    revalidatePath("/integrations");
    return outcome === "forgotten"
      ? { error: null, notice: WHATSAPP_GROUPS_FORGOTTEN_NOTE }
      : { error: null };
  } catch {
    return { error: WHATSAPP_GENERIC_ERROR };
  }
}

export async function setGroupActiveAction(
  groupId: unknown,
  active: unknown,
): Promise<ActionResult> {
  const user = await requireOnboardedUser("/integrations");
  if (!isGroupSyncEnabled()) return { error: WHATSAPP_GROUPS_DISABLED_ERROR };
  if (
    typeof groupId !== "string" ||
    !UUID_PATTERN.test(groupId) ||
    typeof active !== "boolean"
  ) {
    return { error: WHATSAPP_GROUPS_NOT_FOUND_ERROR };
  }
  try {
    const updated = await setGroupActive(user.id, groupId, active);
    if (!updated) return { error: WHATSAPP_GROUPS_NOT_FOUND_ERROR };
    revalidatePath("/integrations");
    return { error: null };
  } catch {
    return { error: WHATSAPP_GENERIC_ERROR };
  }
}

/** Add a pending group suggestion to the workspace (creating a proposed course). */
export async function confirmGroupCandidateAction(
  candidateId: unknown,
): Promise<ActionResult> {
  const user = await requireOnboardedUser("/integrations");
  if (!isGroupSyncEnabled()) return { error: WHATSAPP_GROUPS_DISABLED_ERROR };
  if (typeof candidateId !== "string" || !UUID_PATTERN.test(candidateId)) {
    return { error: WHATSAPP_CANDIDATE_NOT_FOUND_ERROR };
  }
  try {
    const result = await confirmGroupCandidate(user.id, candidateId);
    if (result.status === "not-found") {
      return { error: WHATSAPP_CANDIDATE_NOT_FOUND_ERROR };
    }
    revalidatePath("/integrations");
    revalidatePath("/tasks");
    revalidatePath("/calendar");
    return { error: null };
  } catch {
    return { error: WHATSAPP_GENERIC_ERROR };
  }
}

/** Dismiss a pending suggestion. Terminal: the same message is never suggested again. */
export async function rejectGroupCandidateAction(
  candidateId: unknown,
): Promise<ActionResult> {
  const user = await requireOnboardedUser("/integrations");
  if (!isGroupSyncEnabled()) return { error: WHATSAPP_GROUPS_DISABLED_ERROR };
  if (typeof candidateId !== "string" || !UUID_PATTERN.test(candidateId)) {
    return { error: WHATSAPP_CANDIDATE_NOT_FOUND_ERROR };
  }
  try {
    const rejected = await rejectCandidate(user.id, candidateId);
    if (!rejected) return { error: WHATSAPP_CANDIDATE_NOT_FOUND_ERROR };
    revalidatePath("/integrations");
    return { error: null };
  } catch {
    return { error: WHATSAPP_GENERIC_ERROR };
  }
}
