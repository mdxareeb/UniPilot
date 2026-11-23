import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

import { supabase } from "@/lib/supabase";

export type SubjectOption = { id: string; name: string };

export type SubjectsState = {
  subjects: SubjectOption[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

/** The owner's courses for the optional "save to Course Materials" picker. */
export function useSubjects(): SubjectsState {
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (supabase === null) {
      setError("This build isn't configured.");
      return;
    }
    setLoading(true);
    const { data, error: queryError } = await supabase
      .from("subjects")
      .select("id, name")
      .order("name", { ascending: true })
      .limit(200);
    setLoading(false);
    if (queryError) {
      setError("Couldn't load your courses.");
      setSubjects([]);
      return;
    }
    setError(null);
    setSubjects((data ?? []).map((row) => ({ id: row.id, name: row.name })));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { subjects, loading, error, reload };
}
