import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";

import type { QueryResult } from "./queries";

/**
 * Load a read-only list when its screen comes into focus (so a task added from
 * a WhatsApp suggestion shows up on return) and on demand. A late response from
 * an older load never overwrites a newer one.
 */
export function useLoad<T>(load: () => Promise<QueryResult<T>>) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++generation.current;
    setLoading(true);
    const result = await load();
    if (mine !== generation.current) return;
    setLoading(false);
    setError(result.error);
    if (result.error === null) setRows(result.rows);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { rows, error, loading, reload };
}
