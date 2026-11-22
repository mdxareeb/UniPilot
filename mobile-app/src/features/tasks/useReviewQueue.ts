import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

import {
  decideCandidate,
  type DecisionOutcome,
} from "@/features/whatsappGroups/reviewActions";
import type { GroupCandidateItem } from "@/features/whatsappGroups/types";
import { isApiConfigured, whatsappApi } from "@/features/whatsappGroups/client";

/**
 * The pending live-group suggestions, read through the Bearer API once per
 * focus. Empty (not an error) when the API is not configured or the server is
 * unreachable: the Tasks screen simply has no review queue then.
 */
export function useReviewQueue() {
  const [items, setItems] = useState<GroupCandidateItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isApiConfigured) {
      setItems([]);
      setError(null);
      return;
    }
    try {
      const snapshot = await whatsappApi.getSnapshot();
      setItems(snapshot.review);
      setError(null);
    } catch {
      setItems([]);
      setError("Couldn't load WhatsApp suggestions.");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const decide = useCallback(
    async (id: string, decision: "confirm" | "reject"): Promise<DecisionOutcome> => {
      const current = items ?? [];
      const outcome = await decideCandidate(whatsappApi, current, id, decision);
      setItems(outcome.review);
      return outcome;
    },
    [items],
  );

  return {
    items,
    count: items?.length ?? 0,
    error,
    refresh,
    decide,
  };
}
