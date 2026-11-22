import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

import { gcalApi } from "./gcalClient";
import { gcalView, sortCalendars, type GcalSnapshot } from "./gcalValues";

export type GcalActionResult = {
  error: string | null;
  notice: string | null;
};

/**
 * The Google Calendar screen's one data hook: reads the snapshot on focus and
 * exposes every action. Optimistic updates only for the toggles the caller
 * can revert locally; Connect/Sync/Disconnect always re-read the snapshot.
 */
export function useGcal() {
  const [snapshot, setSnapshot] = useState<GcalSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await gcalApi.getSnapshot();
      setSnapshot(next);
      setLoadError(null);
    } catch {
      setLoadError("Couldn't load Google Calendar.");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const withBusy = useCallback(
    async (action: () => Promise<void>): Promise<GcalActionResult> => {
      if (busy) return { error: null, notice: null };
      setBusy(true);
      try {
        await action();
        return { error: null, notice: null };
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : null;
        return { error: message ?? "Something went wrong. Try again.", notice: null };
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const connect = useCallback(
    async (): Promise<{ authorizationUrl: string | null; error: string | null }> => {
      try {
        const { authorizationUrl } = await gcalApi.connect();
        return { authorizationUrl, error: null };
      } catch (caught) {
        return {
          authorizationUrl: null,
          error: caught instanceof Error ? caught.message : "Couldn't start the link.",
        };
      }
    },
    [],
  );

  const setCalendarActive = useCallback(
    async (calendarId: string, active: boolean): Promise<GcalActionResult> => {
      // Never flip the optimistic state when another action is in flight:
      // withBusy would skip the write and leave the screen lying.
      if (busy) return { error: null, notice: null };
      // Optimistic: flip locally, revert when the write refuses.
      setSnapshot((current) => {
        if (current === null) return current;
        return {
          ...current,
          calendars: current.calendars.map((calendar) =>
            calendar.id === calendarId ? { ...calendar, isActive: active } : calendar,
          ),
        };
      });
      const result = await withBusy(() => gcalApi.setCalendarActive(calendarId, active));
      if (result.error !== null) {
        setSnapshot((current) => {
          if (current === null) return current;
          return {
            ...current,
            calendars: current.calendars.map((calendar) =>
              calendar.id === calendarId ? { ...calendar, isActive: !active } : calendar,
            ),
          };
        });
      }
      return result;
    },
    [busy, withBusy],
  );

  const sync = useCallback(
    async (): Promise<{ outcome: string | null; error: string | null }> => {
      if (busy) return { outcome: null, error: null };
      setBusy(true);
      try {
        const outcome = await gcalApi.sync();
        if (outcome === "accepted") await refresh();
        return { outcome, error: null };
      } catch (caught) {
        return {
          outcome: null,
          error: caught instanceof Error ? caught.message : "Couldn't start the sync.",
        };
      } finally {
        setBusy(false);
      }
    },
    [busy, refresh],
  );

  const setAutoExport = useCallback(
    async (enabled: boolean): Promise<GcalActionResult> => {
      if (busy) return { error: null, notice: null };
      setSnapshot((current) =>
        current === null ? current : { ...current, autoExport: enabled },
      );
      const result = await withBusy(() => gcalApi.setAutoExport(enabled));
      if (result.error !== null) {
        setSnapshot((current) =>
          current === null ? current : { ...current, autoExport: !enabled },
        );
      }
      return result;
    },
    [busy, withBusy],
  );

  const disconnect = useCallback(
    async (): Promise<GcalActionResult> => {
      try {
        await gcalApi.disconnect();
        await refresh();
        return { error: null, notice: null };
      } catch (caught) {
        return {
          error: caught instanceof Error ? caught.message : "Couldn't disconnect. Try again.",
          notice: null,
        };
      }
    },
    [refresh],
  );

  return {
    snapshot,
    view: snapshot === null ? null : gcalView(snapshot),
    calendars: snapshot === null ? [] : sortCalendars(snapshot.calendars),
    loadError,
    busy,
    refresh,
    connect,
    setCalendarActive,
    sync,
    setAutoExport,
    disconnect,
  };
}
