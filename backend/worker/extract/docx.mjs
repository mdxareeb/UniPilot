/**
 * Task 24.4 — DOCX text extraction (mammoth, the maintained OOXML reader).
 *
 * DOCX has no fixed pages until layout, so the whole document is one text
 * unit and `pageCount` stays null (the schema allows it; a later phase may
 * add layout-aware page detection). 24.8's section detection can split this
 * single unit on blank-line runs when 25.x needs more granular chunks.
 */
import mammoth from "mammoth";

export async function extractDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return { pages: [result.value ?? ""], pageCount: null };
}
