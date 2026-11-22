import type { Logger } from "pino";
import { safeError } from "../log.ts";
import type { ReadOnlySocket } from "../socket/readOnly.ts";
import type { GroupInfo, SessionStore } from "../store/types.ts";

/** WhatsApp group JIDs end in `@g.us`; DMs, broadcasts and channels do not. */
export function isGroupJid(jid: string | null | undefined): jid is string {
  return typeof jid === "string" && jid.endsWith("@g.us");
}

/**
 * Called when the link opens: list every group the account participates in and
 * record it so the student can switch the college ones on.
 *
 * Privacy rule: discovery only records that a group EXISTS (its JID and name).
 * New groups start off, an existing group keeps its owner-chosen state, and
 * nothing is read from any group until the owner switches it on.
 */
export async function discoverGroups(
  userId: string,
  sock: ReadOnlySocket,
  store: SessionStore,
  logger: Logger,
): Promise<number> {
  let fetched: Record<string, { id: string; subject?: string }>;
  try {
    fetched = await sock.groupFetchAllParticipating();
  } catch (error) {
    // A failed listing must not break the link; the next open tries again.
    logger.warn(safeError(error), "group discovery failed");
    return 0;
  }

  const groups: GroupInfo[] = [];
  for (const [key, meta] of Object.entries(fetched)) {
    const jid = meta.id || key;
    if (!isGroupJid(jid)) continue;
    groups.push({ jid, name: (meta.subject ?? "").trim() });
  }

  await store.upsertGroups(userId, groups);
  logger.info({ groups: groups.length }, "groups discovered");
  return groups.length;
}
