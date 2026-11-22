import * as Linking from "expo-linking";

import { supabase } from "@/lib/supabase";

import type { QueryResult } from "../agenda/queries";
import { DOCUMENTS_BUCKET, type MaterialRowInput } from "./materials";

/**
 * The student's own documents under their JWT. Read-only; owner RLS scopes the
 * read. Signed URLs are created with the same session client the web uses, so
 * the private bucket's owner-folder policy is the only guard needed.
 */
const MATERIAL_LIMIT = 200;
const SIGNED_URL_TTL_SECONDS = 60;
const INLINE_MIME = new Set(["application/pdf", "image/png", "image/jpeg"]);

export async function fetchMaterials(): Promise<QueryResult<MaterialRowInput>> {
  if (supabase === null) return { rows: [], error: "This build isn't configured." };
  const { data, error } = await supabase
    .from("documents")
    .select(
      "id, name, storage_path, mime_type, size_bytes, status, created_at, ai_summary, topic_tags, source, subject_id, subject:subjects(name, color_tag)",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(MATERIAL_LIMIT);
  if (error) return { rows: [], error: "Couldn't load your materials. Try again." };
  return { rows: (data ?? []) as MaterialRowInput[], error: null };
}

export type OpenMaterialResult = { error: string | null };

/**
 * Open one file in the device's viewer through a short-lived signed URL. PDFs
 * and images open inline; other types download under their own name (the web's
 * exact rule). Nothing is cached or remembered.
 */
export async function openMaterialFile(item: {
  name: string;
  mimeType: string | null;
  storagePath: string | null;
}): Promise<OpenMaterialResult> {
  if (supabase === null) return { error: "This build isn't configured." };
  if (item.storagePath === null) {
    return { error: "That file isn't available." };
  }

  const inline = item.mimeType !== null && INLINE_MIME.has(item.mimeType);
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(
      item.storagePath,
      SIGNED_URL_TTL_SECONDS,
      inline ? { download: false } : { download: item.name },
    );

  if (error !== null || !data?.signedUrl) {
    return { error: "Couldn't open that file. Try again." };
  }

  try {
    await Linking.openURL(data.signedUrl);
    return { error: null };
  } catch {
    return { error: "Couldn't open that file. Try again." };
  }
}
