import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

import { isGcalApiConfigured, gcalApi } from "@/features/googleCalendar/gcalClient";
import { isApiConfigured, whatsappApi } from "@/features/whatsappGroups/client";
import type {
  GoogleStatus,
  WhatsAppStatus,
} from "@/features/workspace/registries";

export type IntegrationStatuses = {
  whatsapp: WhatsAppStatus | null;
  google: GoogleStatus | null;
  /** One clock for every relative timestamp on the screen. */
  checkedAt: number;
};

/**
 * The shared Home/More integration read: WhatsApp and Google Calendar are
 * fetched on focus, each independently, and a failed read becomes the honest
 * unknown state rather than a stale Connected badge.
 */
export function useIntegrationStatuses(): IntegrationStatuses {
  const [whatsapp, setWhatsapp] = useState<WhatsAppStatus | null>(null);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [checkedAt, setCheckedAt] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const now = Date.now();
      setCheckedAt(now);

      if (!isApiConfigured) {
        setWhatsapp({
          configured: false,
          state: "unknown",
          pending: 0,
          lastSyncedAt: null,
          checkedAt: now,
        });
      } else {
        void whatsappApi
          .getSnapshot()
          .then((snapshot) => {
            if (!active) return;
            const stamps = snapshot.groups
              .map((group) => group.lastSyncedAt)
              .filter((value): value is string => value !== null)
              .sort();
            setWhatsapp({
              configured: true,
              state: snapshot.state,
              pending: snapshot.review.length,
              lastSyncedAt: stamps.length > 0 ? stamps[stamps.length - 1] : null,
              checkedAt: now,
            });
          })
          .catch(() => {
            if (!active) return;
            setWhatsapp({
              configured: true,
              state: "unknown",
              pending: 0,
              lastSyncedAt: null,
              checkedAt: now,
            });
          });
      }

      if (!isGcalApiConfigured) {
        setGoogle({ configured: false, status: "not_configured", lastSyncedAt: null });
      } else {
        void gcalApi
          .getSnapshot()
          .then((snapshot) => {
            if (!active) return;
            setGoogle({
              configured: snapshot.configured,
              status: snapshot.status,
              lastSyncedAt: snapshot.lastSyncedAt,
            });
          })
          .catch(() => {
            if (!active) return;
            setGoogle({ configured: true, status: "unknown", lastSyncedAt: null });
          });
      }

      return () => {
        active = false;
      };
    }, []),
  );

  return { whatsapp, google, checkedAt };
}
