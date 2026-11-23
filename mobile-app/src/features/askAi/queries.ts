import { supabase } from "@/lib/supabase";
import { openMaterialFile } from "@/features/materials/queries";
import type { ScopeDocument, ScopeSubject } from "./scope";

/**
 * The Ask AI scope lists, read directly under the owner's RLS-scoped session:
 * every course, and only documents the indexer marked `indexed` (a chat cannot
 * cite a file the assistant cannot read).
 */
export type AskAiWorkspace = {
  subjects: ScopeSubject[];
  documents: ScopeDocument[];
  error: string | null;
};

const LIST_LIMIT = 500;

export async function fetchAskAiWorkspace(): Promise<AskAiWorkspace> {
  if (supabase === null) {
    return {
      subjects: [],
      documents: [],
      error: "This build isn't connected to the UniPilot server.",
    };
  }

  const [subjects, documents] = await Promise.all([
    supabase
      .from("subjects")
      .select("id, name")
      .order("name", { ascending: true })
      .limit(LIST_LIMIT),
    supabase
      .from("documents")
      .select("id, name")
      .eq("status", "indexed")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(LIST_LIMIT),
  ]);

  if (subjects.error !== null || documents.error !== null) {
    return {
      subjects: [],
      documents: [],
      error: "Couldn't load your courses and materials. Try again.",
    };
  }

  return {
    subjects: (subjects.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
    })),
    documents: (documents.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
    })),
    error: null,
  };
}

/**
 * Open a cited document through the same short-lived signed URL flow as
 * `/materials` (60 seconds, private bucket, owner policy). The citation only
 * carries the document id, so the row is read again before opening.
 */
export async function openCitedDocument(
  documentId: string,
): Promise<{ error: string | null }> {
  if (supabase === null) {
    return { error: "This build isn't connected to the UniPilot server." };
  }

  const { data, error } = await supabase
    .from("documents")
    .select("name, storage_path, mime_type")
    .eq("id", documentId)
    .maybeSingle();

  if (error !== null) {
    return { error: "Couldn't open that file. Try again." };
  }
  if (data === null || data.storage_path === null) {
    return { error: "That file isn't available." };
  }

  return openMaterialFile({
    name: data.name,
    mimeType: data.mime_type,
    storagePath: data.storage_path,
  });
}
