/**
 * Gemini Vision for the mobile File Tools OCR route.
 *
 * It reuses the same env pair and REST shape as the tested chat client
 * (`GEMINI_API_KEY` + `GEMINI_MODEL`, `x-goog-api-key`, sanitized errors). The
 * model is deliberately env-only: Google retires model names and quotas are
 * per model. Both image OCR and PDF page extraction are bounded and never log
 * provider bodies.
 */
import {
  GeminiChatError,
  readGeminiChatConfig,
} from "./geminiChat";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const IMAGE_TIMEOUT_MS = 60_000;
const PDF_TIMEOUT_MS = 90_000;
const IMAGE_MAX_TOKENS = 4_096;
const PDF_MAX_TOKENS = 8_192;

const IMAGE_PROMPT = [
  "Transcribe every readable word from this page image.",
  "Return plain text only, preserving line breaks, lists and the reading order.",
  "Do not summarize, explain, translate or add commentary.",
  "If a word is unclear, write your best reading; if the page has no readable text, return an empty string.",
].join("\n");

const PDF_PROMPT = [
  "Transcribe every readable word from each page of this PDF.",
  "Return only JSON in the form {\"pages\":[{\"page\":1,\"text\":\"...\"}]}.",
  "Use 1-based page numbers in document order.",
  "Preserve line breaks and lists; do not summarize, explain or add commentary.",
  "If a page has no readable text, return an empty string for that page.",
].join("\n");

const PDF_SCHEMA = {
  type: "object",
  properties: {
    pages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          page: { type: "integer" },
          text: { type: "string" },
        },
        required: ["page", "text"],
      },
    },
  },
  required: ["pages"],
};

export type VisionUsage = { promptTokens: number; completionTokens: number };
export type OcrPageText = { page: number; text: string };

type GeminiBody = Record<string, unknown>;

function extractText(body: unknown): string | null {
  const candidate = (
    body as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] }
  )?.candidates?.[0];
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
  return text === "" ? null : text;
}

function readUsage(body: unknown): VisionUsage {
  const usage = (body as { usageMetadata?: Record<string, unknown> })
    ?.usageMetadata;
  return {
    promptTokens: Number(usage?.promptTokenCount) || 0,
    completionTokens: Number(usage?.candidatesTokenCount) || 0,
  };
}

function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text.trim());
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function mapStatus(status: number): GeminiChatError {
  if (status === 429) {
    return new GeminiChatError(
      "rate_limited",
      "The AI OCR service is busy. Try again in a moment.",
      true,
    );
  }
  if (status >= 500) {
    return new GeminiChatError(
      "unavailable",
      "The AI OCR service is temporarily unavailable.",
      true,
    );
  }
  return new GeminiChatError(
    "rejected",
    "The AI OCR service rejected the request.",
    false,
  );
}

async function post(
  body: GeminiBody,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Response> {
  const config = readGeminiChatConfig();
  if (config === null) {
    throw new GeminiChatError(
      "not_configured",
      "AI OCR isn't configured on this server.",
      false,
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(
      `${ENDPOINT}/${config.model}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": config.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
  } catch {
    throw new GeminiChatError(
      "unavailable",
      "The AI OCR service is temporarily unavailable.",
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function readBody(response: Response): Promise<unknown> {
  if (!response.ok) throw mapStatus(response.status);
  try {
    return await response.json();
  } catch {
    throw new GeminiChatError(
      "invalid_response",
      "The AI OCR service returned an unreadable response.",
      true,
    );
  }
}

function checkBlocked(body: unknown): void {
  if (
    (body as { promptFeedback?: { blockReason?: unknown } })?.promptFeedback
      ?.blockReason
  ) {
    throw new GeminiChatError(
      "blocked",
      "The AI OCR service declined to process this page.",
      false,
    );
  }
}

/** OCR one JPEG/PNG page. */
export async function extractImageText(options: {
  base64: string;
  mimeType: "image/jpeg" | "image/png";
  fetchImpl?: typeof fetch;
}): Promise<{ text: string; usage: VisionUsage }> {
  const response = await post(
    {
      systemInstruction: { parts: [{ text: IMAGE_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [
            { text: "Transcribe this page." },
            {
              inlineData: {
                mimeType: options.mimeType,
                data: options.base64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: IMAGE_MAX_TOKENS,
      },
    },
    options.fetchImpl ?? fetch,
    IMAGE_TIMEOUT_MS,
  );

  const body = await readBody(response);
  checkBlocked(body);
  const text = extractText(body);
  if (text === null) {
    throw new GeminiChatError(
      "invalid_response",
      "The AI OCR service returned no page text.",
      true,
    );
  }
  return { text, usage: readUsage(body) };
}

function parsePdfPages(value: unknown, pageCount: number): OcrPageText[] {
  const pages = (value as { pages?: unknown })?.pages;
  if (!Array.isArray(pages)) {
    throw new GeminiChatError(
      "invalid_response",
      "The AI OCR service returned no page text.",
      true,
    );
  }

  const byPage = new Map<number, string>();
  for (const entry of pages) {
    if (typeof entry !== "object" || entry === null) continue;
    const page = (entry as { page?: unknown }).page;
    const text = (entry as { text?: unknown }).text;
    if (
      typeof page !== "number" ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > pageCount ||
      typeof text !== "string"
    ) {
      continue;
    }
    byPage.set(page, text);
  }

  if (byPage.size === 0) {
    throw new GeminiChatError(
      "invalid_response",
      "The AI OCR service returned no usable pages.",
      true,
    );
  }

  return Array.from({ length: pageCount }, (_, index) => ({
    page: index + 1,
    text: byPage.get(index + 1) ?? "",
  }));
}

/** OCR a PDF that Gemini can accept as inline data. */
export async function extractPdfPageText(options: {
  base64: string;
  pageCount: number;
  fetchImpl?: typeof fetch;
}): Promise<{ pages: OcrPageText[]; usage: VisionUsage }> {
  const config = readGeminiChatConfig();
  if (config === null) {
    throw new GeminiChatError(
      "not_configured",
      "AI OCR isn't configured on this server.",
      false,
    );
  }

  const build = (withSchema: boolean): GeminiBody => ({
    systemInstruction: { parts: [{ text: PDF_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [
          { text: `Extract text from ${options.pageCount} pages.` },
          {
            inlineData: {
              mimeType: "application/pdf",
              data: options.base64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: PDF_MAX_TOKENS,
      responseMimeType: "application/json",
      ...(withSchema ? { responseJsonSchema: PDF_SCHEMA } : {}),
    },
  });

  let response = await post(
    build(true),
    options.fetchImpl ?? fetch,
    PDF_TIMEOUT_MS,
  );
  if (response.status === 400) {
    response = await post(
      build(false),
      options.fetchImpl ?? fetch,
      PDF_TIMEOUT_MS,
    );
  }

  const body = await readBody(response);
  checkBlocked(body);
  const text = extractText(body);
  if (text === null) {
    throw new GeminiChatError(
      "invalid_response",
      "The AI OCR service returned no page text.",
      true,
    );
  }
  const parsed = parseJsonLoose(text);
  if (parsed === null) {
    throw new GeminiChatError(
      "invalid_response",
      "The AI OCR service returned an unreadable page list.",
      true,
    );
  }
  return {
    pages: parsePdfPages(parsed, options.pageCount),
    usage: readUsage(body),
  };
}
