/**
 * The OCR orchestration behind `POST /api/mobile/tools/ocr`.
 *
 * It verifies the owner's reserved row, guards the page ledger, asks Gemini
 * Vision for clean page text, replaces the document's chunks (page provenance
 * intact), and only then marks it `indexed`. An unconfigured or failed
 * provider leaves an honest `failed` row instead of a silently empty
 * "searchable" document.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  GeminiChatError,
  readGeminiChatConfig,
} from "@/lib/ai/geminiChat";
import {
  extractImageText,
  extractPdfPageText,
  type VisionUsage,
} from "@/lib/ai/geminiVision";
import {
  OCR_COPY,
  buildOcrChunks,
  type OcrPage,
} from "@/lib/ai/ocr";
import { loadOcrDocument, markDocumentOcrFailed } from "@/lib/data/mobileDocuments";
import { checkOcrLimits, recordOcrUsage } from "@/lib/data/toolUsage";

type Client = SupabaseClient<Database>;

export type OcrImagesInput = {
  kind: "images";
  images: {
    base64: string;
    mimeType: "image/jpeg" | "image/png";
    page: number;
  }[];
};

export type OcrPdfInput = {
  kind: "pdf";
  base64: string;
  pageCount: number;
};

export type OcrRunResult =
  | {
      status: "ok";
      configured: true;
      pages: number;
      characters: number;
      tokens: number;
      alreadyIndexed: boolean;
    }
  | {
      status: "ok";
      configured: false;
      pages: 0;
      characters: 0;
      tokens: 0;
      alreadyIndexed: false;
      error: string;
    }
  | { status: "not_found" }
  | { status: "limited"; error: string; retryAfterSeconds: number }
  | { status: "too_large" | "empty"; error: string }
  | { status: "provider_error"; error: string; retryable: boolean };

export async function runDocumentOcr(options: {
  client: Client;
  userId: string;
  documentId: string;
  input: OcrImagesInput | OcrPdfInput;
}): Promise<OcrRunResult> {
  const { client, userId, documentId, input } = options;
  const document = await loadOcrDocument(client, userId, documentId);
  if (document === null) return { status: "not_found" };
  if (document.status === "indexed") {
    return {
      status: "ok",
      configured: true,
      pages: 0,
      characters: 0,
      tokens: 0,
      alreadyIndexed: true,
    };
  }

  const pageCount =
    input.kind === "images" ? input.images.length : input.pageCount;
  if (pageCount < 1 || pageCount > 20) {
    return { status: "too_large", error: OCR_COPY.TOO_LARGE };
  }

  const limits = await checkOcrLimits(userId, pageCount);
  if (!limits.ok) {
    return {
      status: "limited",
      error: limits.copy,
      retryAfterSeconds: limits.retryAfterSeconds,
    };
  }

  if (readGeminiChatConfig() === null) {
    await markDocumentOcrFailed(
      client,
      userId,
      documentId,
      OCR_COPY.NOT_CONFIGURED,
    );
    return {
      status: "ok",
      configured: false,
      pages: 0,
      characters: 0,
      tokens: 0,
      alreadyIndexed: false,
      error: OCR_COPY.NOT_CONFIGURED,
    };
  }

  let pages: OcrPage[];
  let usage: VisionUsage;
  try {
    if (input.kind === "images") {
      const results: OcrPage[] = [];
      let promptTokens = 0;
      let completionTokens = 0;
      for (const image of [...input.images].sort((a, b) => a.page - b.page)) {
        const result = await extractImageText({
          base64: image.base64,
          mimeType: image.mimeType,
        });
        results.push({ page: image.page, text: result.text });
        promptTokens += result.usage.promptTokens;
        completionTokens += result.usage.completionTokens;
      }
      pages = results;
      usage = { promptTokens, completionTokens };
    } else {
      const result = await extractPdfPageText({
        base64: input.base64,
        pageCount: input.pageCount,
      });
      pages = result.pages;
      usage = result.usage;
    }
  } catch (error) {
    const provider =
      error instanceof GeminiChatError
        ? error
        : new GeminiChatError(
            "unavailable",
            OCR_COPY.UNAVAILABLE,
            true,
          );
    const copy =
      provider.code === "not_configured"
        ? OCR_COPY.NOT_CONFIGURED
        : provider.code === "rate_limited"
          ? OCR_COPY.RATE_LIMITED
          : provider.code === "unavailable" || provider.code === "invalid_response"
            ? OCR_COPY.UNAVAILABLE
            : OCR_COPY.REJECTED;
    await markDocumentOcrFailed(client, userId, documentId, copy);
    return {
      status: "provider_error",
      error: copy,
      retryable: provider.retryable,
    };
  }

  let chunks: ReturnType<typeof buildOcrChunks>;
  try {
    chunks = buildOcrChunks(pages);
  } catch {
    await markDocumentOcrFailed(client, userId, documentId, OCR_COPY.TOO_LARGE);
    return { status: "too_large", error: OCR_COPY.TOO_LARGE };
  }
  if (chunks.length === 0) {
    await markDocumentOcrFailed(client, userId, documentId, OCR_COPY.EMPTY);
    return { status: "empty", error: OCR_COPY.EMPTY };
  }

  const cleared = await client
    .from("document_chunks")
    .delete()
    .eq("document_id", documentId);
  if (cleared.error) throw new Error("Failed to replace OCR chunks.");

  const inserted = await client.from("document_chunks").insert(
    chunks.map((chunk) => ({
      document_id: documentId,
      chunk_index: chunk.chunk_index,
      page: chunk.page,
      content: chunk.content,
    })),
  );
  if (inserted.error) throw new Error("Failed to store OCR chunks.");

  const settled = await client
    .from("documents")
    .update({
      status: "indexed",
      error_message: null,
      page_count: pageCount,
    })
    .eq("id", documentId)
    .eq("user_id", userId);
  if (settled.error) throw new Error("Failed to settle the OCR document.");

  const characters = chunks.reduce(
    (total, chunk) => total + chunk.content.length,
    0,
  );
  const tokens = usage.promptTokens + usage.completionTokens;
  await recordOcrUsage(userId, { pages: pageCount, tokens });

  return {
    status: "ok",
    configured: true,
    pages: pageCount,
    characters,
    tokens,
    alreadyIndexed: false,
  };
}
