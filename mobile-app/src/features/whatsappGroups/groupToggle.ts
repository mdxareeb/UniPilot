import type { MonitoredGroupItem } from "./types";

/**
 * Switching a group on or off. The write is one `is_active` update on the
 * student's own `monitored_groups` row, authorised by RLS and the column grant
 * (the same path the web's Server Action uses, minus the server hop).
 *
 * The caller flips the switch optimistically; `toggleGroup` returns the list to
 * show next, with the change reverted when the write fails, so a switch never
 * stays on after the database refused it.
 */
export type GroupWriter = (
  id: string,
  active: boolean,
) => Promise<"ok" | "missing" | "error">;

export type ToggleOutcome = {
  groups: MonitoredGroupItem[];
  error: string | null;
};

export const TOGGLE_COPY = {
  FAILED: "Couldn't update that group. Try again.",
  MISSING: "That group is no longer available.",
} as const;

export function applyToggle(
  groups: MonitoredGroupItem[],
  id: string,
  active: boolean,
): MonitoredGroupItem[] {
  return groups.map((group) =>
    group.id === id
      ? {
          ...group,
          active,
          activatedAt: active ? new Date().toISOString() : group.activatedAt,
        }
      : group,
  );
}

export async function toggleGroup(
  write: GroupWriter,
  groups: MonitoredGroupItem[],
  id: string,
  active: boolean,
): Promise<ToggleOutcome> {
  const result = await write(id, active).catch(() => "error" as const);
  if (result === "ok") return { groups: applyToggle(groups, id, active), error: null };
  return {
    groups,
    error: result === "missing" ? TOGGLE_COPY.MISSING : TOGGLE_COPY.FAILED,
  };
}

/** Active groups first, then A to Z, so what is being captured is on top. */
export function sortGroups(groups: MonitoredGroupItem[]): MonitoredGroupItem[] {
  return [...groups].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
