/**
 * The subjects service's read half the calendar needs (17.9's course
 * control): the caller's subject ids and names, alphabetically ordered.
 *
 * Server-only and request-scoped like every data module: the authenticated
 * cookie identifies the caller, RLS scopes the read, and `user_id` narrows
 * it. No component queries a table.
 */
import { createClient } from "@/lib/supabase/server";

/** One subject the course control can link an event to. */
export type SubjectOption = {
  id: string;
  name: string;
};

/** The caller's subjects as selectable options. */
export async function listSubjects(userId: string): Promise<SubjectOption[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("subjects")
    .select("id, name")
    .eq("user_id", userId)
    .order("name", { ascending: true });

  if (error) throw new Error("Failed to load subjects.");
  return data ?? [];
}
