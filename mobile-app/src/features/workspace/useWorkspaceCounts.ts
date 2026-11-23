import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

import { supabase } from "@/lib/supabase";

export type WorkspaceCounts = {
  subjects: number | null;
  /** Tasks that came from a sync source, not typed by hand. */
  syncedTasks: number | null;
  indexedDocs: number | null;
  totalDocs: number | null;
};

const EMPTY: WorkspaceCounts = {
  subjects: null,
  syncedTasks: null,
  indexedDocs: null,
  totalDocs: null,
};

type CountQuery = PromiseLike<{ count: number | null; error: unknown }>;

async function readCount(query: CountQuery): Promise<number | null> {
  try {
    const { count, error } = await query;
    return error === null ? (count ?? 0) : null;
  } catch {
    return null;
  }
}

/**
 * The shared Home/More counts, read through the owner's RLS-scoped client.
 * A failed count stays `null` so the UI renders an em dash instead of a fake
 * zero; the next focus retries every count together.
 */
export function useWorkspaceCounts(): WorkspaceCounts {
  const [counts, setCounts] = useState<WorkspaceCounts>(EMPTY);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (supabase === null) {
        setCounts(EMPTY);
        return;
      }

      void Promise.all([
        readCount(
          supabase.from("subjects").select("id", { count: "exact", head: true }),
        ),
        readCount(
          supabase
            .from("tasks")
            .select("id", { count: "exact", head: true })
            .neq("source", "manual"),
        ),
        readCount(
          supabase
            .from("documents")
            .select("id", { count: "exact", head: true })
            .eq("status", "indexed"),
        ),
        readCount(
          supabase.from("documents").select("id", { count: "exact", head: true }),
        ),
      ]).then(([subjects, syncedTasks, indexedDocs, totalDocs]) => {
        if (!active) return;
        setCounts({ subjects, syncedTasks, indexedDocs, totalDocs });
      });

      return () => {
        active = false;
      };
    }, []),
  );

  return counts;
}
