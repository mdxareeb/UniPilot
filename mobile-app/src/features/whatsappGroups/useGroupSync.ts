import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { WhatsAppApiError } from "./api";
import { isApiConfigured, whatsappApi, writeGroupActive } from "./client";
import { toggleGroup } from "./groupToggle";
import { decideCandidate, type DecisionOutcome } from "./reviewActions";
import { pollDelayMs } from "./stateView";
import type { GroupSyncSnapshot } from "./types";

export type ActionResult = { error: string | null; notice?: string | null };

/**
 * The group-sync screen's one data hook: reads the snapshot, keeps it fresh
 * (about every 3 s while a link is in flight, slower otherwise, and not at all
 * while the app is in the background) and exposes the actions. All real
 * decisions live in the pure modules next to it; this only wires them to React.
 */
export function useGroupSync() {
  const [snapshot, setSnapshot] = useState<GroupSyncSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const latest = useRef<GroupSyncSnapshot | null>(null);

  const refresh = useCallback(async () => {
    if (!isApiConfigured) return;
    try {
      const next = await whatsappApi.getSnapshot();
      if (!alive.current) return;
      latest.current = next;
      setSnapshot(next);
      setLoadError(null);
    } catch (error) {
      if (!alive.current) return;
      setLoadError(
        error instanceof WhatsAppApiError ? error.message : "Couldn't load WhatsApp groups.",
      );
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    if (!isApiConfigured) return undefined;

    const schedule = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      if (AppState.currentState !== "active") return;
      timer.current = setTimeout(
        () => void tick(),
        pollDelayMs(latest.current?.state ?? "disconnected"),
      );
    };
    const tick = async () => {
      await refresh();
      if (alive.current) schedule();
    };

    void tick();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void tick();
      else if (timer.current !== null) clearTimeout(timer.current);
    });
    return () => {
      alive.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
      subscription.remove();
    };
  }, [refresh]);

  const link = useCallback(
    async (digits: string): Promise<ActionResult> => {
      try {
        await whatsappApi.link(digits);
        await refresh();
        return { error: null };
      } catch (error) {
        // A 429/409 means the server's state already changed: show it.
        if (error instanceof WhatsAppApiError) {
          if (error.kind === "throttled" || error.kind === "already_linked") {
            void refresh();
          }
          return { error: error.message };
        }
        return { error: "Couldn't start the link. Try again." };
      }
    },
    [refresh],
  );

  const disconnect = useCallback(async (): Promise<ActionResult> => {
    try {
      const { notice } = await whatsappApi.disconnect();
      await refresh();
      return { error: null, notice };
    } catch (error) {
      return {
        error:
          error instanceof WhatsAppApiError
            ? error.message
            : "Couldn't disconnect. Try again.",
      };
    }
  }, [refresh]);

  const setGroup = useCallback(
    async (id: string, active: boolean): Promise<ActionResult> => {
      const current = latest.current;
      if (current === null) return { error: null };
      const outcome = await toggleGroup(writeGroupActive, current.groups, id, active);
      const next = { ...current, groups: outcome.groups };
      latest.current = next;
      setSnapshot(next);
      return { error: outcome.error };
    },
    [],
  );

  const decide = useCallback(
    async (id: string, decision: "confirm" | "reject"): Promise<DecisionOutcome> => {
      const current = latest.current;
      if (current === null) return { review: [], message: null, tone: null };
      const outcome = await decideCandidate(whatsappApi, current.review, id, decision);
      const next = { ...current, review: outcome.review };
      latest.current = next;
      setSnapshot(next);
      return outcome;
    },
    [],
  );

  return {
    configured: isApiConfigured,
    snapshot,
    loadError,
    refresh,
    link,
    disconnect,
    setGroup,
    decide,
  };
}
