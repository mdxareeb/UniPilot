import { supabase } from "@/lib/supabase";

/**
 * Owner-scoped task completion. RLS is the authority; the UI updates
 * optimistically and reverts when this returns an error.
 */
export async function setTaskDone(
  taskId: string,
  done: boolean,
): Promise<{ error: string | null }> {
  if (supabase === null) return { error: "This build isn't configured." };
  const { data, error } = await supabase
    .from("tasks")
    .update({ status: done ? "done" : "todo" })
    .eq("id", taskId)
    .select("id")
    .maybeSingle();
  if (error) return { error: "Couldn't update that task. Try again." };
  if (data === null) return { error: "That task is no longer available." };
  return { error: null };
}
