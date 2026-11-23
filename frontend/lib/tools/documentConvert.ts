/**
 * The universal document converter (server-only).
 *
 * Inputs: PDF, DOCX, PPTX, TXT, MD, CSV, JSON.
 * Outputs: PDF, TXT, MD, DOCX.
 *
 * PDF text uses pdfjs-dist; a scanned/empty-text PDF falls back to Gemini
 * Vision through the same bounded OCR ledger as the dedicated OCR route.
 * DOCX uses mammoth; PPTX uses a bounded fflate reader; DOCX output is a
 * minimal valid OOXML package written with fflate. PDF output keeps the
 * existing deterministic A4 renderer. No HTML, macros or external references
 * are executed.
 */
import { strToU8, unzipSync, zipSync } from "fflate";
import mammoth from "mammoth";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { GeminiChatError } from "@/lib/ai/geminiChat";
import { extractPdfPageText } from "@/lib/ai/geminiVision";
import { OCR_COPY, OCR_MAX_PAGES } from "@/lib/ai/ocr";
import { checkOcrLimits, recordOcrUsage } from "@/lib/data/toolUsage";
import {
  PDF_TEXT_MIN_CHARS,
  extractPdfTextPages,
} from "./pdfText";

export const CONVERT_MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const CONVERT_MAX_TEXT_CHARS = 2_000_000;
const PPTX_MAX_ENTRIES = 5_000;
const PPTX_MAX_PART_BYTES = 8 * 1024 * 1024;
const PPTX_MAX_SLIDES = 500;

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const FONT_SIZE = 11;
const LINE_HEIGHT = 16;
const TEXT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export type ConvertInputKind =
  | "pdf"
  | "docx"
  | "pptx"
  | "txt"
  | "md"
  | "csv"
  | "json";

export type ConvertTarget = "pdf" | "txt" | "md" | "docx";

/** Backwards-compatible name used by the original PDF-only route. */
export type ConvertKind = ConvertInputKind;

export type ConvertErrorCode =
  | "unsupported"
  | "unreadable"
  | "empty"
  | "too_large"
  | "rate_limited"
  | "ocr_unconfigured"
  | "provider_unavailable"
  | "provider_rejected";

export class ConvertError extends Error {
  readonly code: ConvertErrorCode;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: ConvertErrorCode,
    message: string,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "ConvertError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const TARGET_MIME: Record<ConvertTarget, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const TARGET_EXTENSION: Record<ConvertTarget, string> = {
  pdf: "pdf",
  txt: "txt",
  md: "md",
  docx: "docx",
};

const ALLOWED_TARGETS: Record<ConvertInputKind, readonly ConvertTarget[]> = {
  pdf: ["txt", "md", "docx"],
  docx: ["pdf", "md", "txt"],
  pptx: ["pdf", "md", "txt"],
  txt: ["pdf", "md", "docx"],
  md: ["pdf", "docx", "txt"],
  csv: ["pdf", "md", "docx", "txt"],
  json: ["pdf", "md", "docx", "txt"],
};

export function targetMimeType(target: ConvertTarget): string {
  return TARGET_MIME[target];
}

export function targetExtension(target: ConvertTarget): string {
  return TARGET_EXTENSION[target];
}

export function isConvertTarget(value: unknown): value is ConvertTarget {
  return value === "pdf" || value === "txt" || value === "md" || value === "docx";
}

export function canConvert(
  kind: ConvertInputKind,
  target: ConvertTarget,
): boolean {
  return ALLOWED_TARGETS[kind].includes(target);
}

export function detectConvertKind(
  name: string,
  mimeType: string | null,
): ConvertInputKind | null {
  const lower = name.trim().toLowerCase();
  if (lower.endsWith(".pdf") || mimeType === "application/pdf") return "pdf";
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    return "docx";
  }
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    lower.endsWith(".pptx")
  ) {
    return "pptx";
  }
  if (mimeType === "text/plain" || lower.endsWith(".txt")) return "txt";
  if (mimeType === "text/markdown" || lower.endsWith(".md")) return "md";
  if (mimeType === "text/csv" || lower.endsWith(".csv")) return "csv";
  if (mimeType === "application/json" || lower.endsWith(".json")) return "json";
  return null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCodePoint(Number.parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function slideXmlToText(xml: string): string {
  const paragraphs = xml.split(/<\/a:p>/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const runs = [
      ...paragraph.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g),
    ].map((match) => decodeEntities(match[1]));
    const line = runs.join("").replace(/\s+/g, " ").trim();
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

function extractPptx(bytes: Uint8Array): string[] {
  let entries = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        entries += 1;
        if (entries > PPTX_MAX_ENTRIES) {
          throw new Error("Too many archive entries.");
        }
        if (!/^ppt\/(slides|notesSlides)\//.test(file.name)) return false;
        if (file.originalSize > PPTX_MAX_PART_BYTES) {
          throw new Error("A slide part is too large.");
        }
        return true;
      },
    });
  } catch {
    throw new ConvertError(
      "unreadable",
      "The presentation couldn't be read.",
    );
  }

  const slides = new Map<number, string>();
  const notes = new Map<number, string>();
  const decoder = new TextDecoder("utf-8");
  for (const [name, part] of Object.entries(files)) {
    const slide = /^ppt\/slides\/slide(\d+)\.xml$/.exec(name);
    if (slide) {
      slides.set(Number(slide[1]), slideXmlToText(decoder.decode(part)));
      continue;
    }
    const note = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/.exec(name);
    if (note) notes.set(Number(note[1]), slideXmlToText(decoder.decode(part)));
  }

  if (slides.size === 0) {
    throw new ConvertError("unreadable", "The presentation has no slides.");
  }
  if (slides.size > PPTX_MAX_SLIDES) {
    throw new ConvertError("too_large", "The presentation has too many slides.");
  }

  return [...slides.keys()]
    .sort((a, b) => a - b)
    .map((number) => {
      const body = slides.get(number) ?? "";
      const note = notes.get(number);
      return note ? `${body}\n[notes] ${note}`.trim() : body;
    });
}

/** One source page per slide; DOCX/TXT are a single flowing unit. */
export async function extractConvertPages(
  bytes: Uint8Array,
  kind: ConvertInputKind,
): Promise<string[]> {
  if (kind === "docx") {
    let text: string;
    try {
      const result = await mammoth.extractRawText({
        buffer: Buffer.from(bytes),
      });
      text = result.value ?? "";
    } catch {
      throw new ConvertError("unreadable", "The document couldn't be read.");
    }
    return [text];
  }

  if (kind === "pptx") return extractPptx(bytes);

  if (kind === "pdf") {
    throw new ConvertError("unreadable", "PDF extraction uses the page reader.");
  }

  try {
    return [new TextDecoder("utf-8", { fatal: false }).decode(bytes)];
  } catch {
    throw new ConvertError("unreadable", "The text file couldn't be read.");
  }
}

function readableLength(pages: readonly string[]): number {
  return pages.join("").replace(/\s/g, "").length;
}

function normalizeInputText(text: string): string {
  return text.normalize("NFKC").replace(/\r\n?/g, "\n").trim();
}

function ocrFailure(error: unknown): ConvertError {
  if (error instanceof GeminiChatError) {
    if (error.code === "not_configured") {
      return new ConvertError("ocr_unconfigured", OCR_COPY.NOT_CONFIGURED);
    }
    if (error.code === "rate_limited") {
      return new ConvertError("rate_limited", OCR_COPY.RATE_LIMITED, 60);
    }
    if (error.code === "unavailable" || error.code === "invalid_response") {
      return new ConvertError("provider_unavailable", OCR_COPY.UNAVAILABLE);
    }
    return new ConvertError("provider_rejected", OCR_COPY.REJECTED);
  }
  return new ConvertError("provider_unavailable", OCR_COPY.FAILED);
}

async function extractPdfPages(
  bytes: Uint8Array,
  userId: string | undefined,
): Promise<string[]> {
  let extraction: Awaited<ReturnType<typeof extractPdfTextPages>>;
  try {
    extraction = await extractPdfTextPages(bytes);
  } catch {
    throw new ConvertError("unreadable", "The PDF couldn't be read.");
  }

  if (readableLength(extraction.pages) >= PDF_TEXT_MIN_CHARS) {
    return extraction.pages;
  }

  // Scanned or image-only PDF: OCR through the same bounded, ledgered path.
  if (extraction.pageCount < 1 || extraction.pageCount > OCR_MAX_PAGES) {
    throw new ConvertError(
      "too_large",
      `Scanned PDFs are limited to ${OCR_MAX_PAGES} pages.`,
    );
  }
  if (userId !== undefined) {
    const limits = await checkOcrLimits(userId, extraction.pageCount);
    if (!limits.ok) {
      throw new ConvertError(
        "rate_limited",
        limits.copy,
        limits.retryAfterSeconds,
      );
    }
  }

  try {
    const result = await extractPdfPageText({
      base64: Buffer.from(bytes).toString("base64"),
      pageCount: extraction.pageCount,
    });
    if (userId !== undefined) {
      await recordOcrUsage(userId, {
        pages: extraction.pageCount,
        tokens: result.usage.promptTokens + result.usage.completionTokens,
      });
    }
    return result.pages.map((page) => page.text);
  } catch (error) {
    throw ocrFailure(error);
  }
}

async function inputPages(
  bytes: Uint8Array,
  kind: ConvertInputKind,
  userId: string | undefined,
): Promise<string[]> {
  if (kind === "pdf") return extractPdfPages(bytes, userId);
  return extractConvertPages(bytes, kind);
}

const CHARACTER_REPLACEMENTS: Record<string, string> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201a": "'",
  "\u201b": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u201e": '"',
  "\u2013": "-",
  "\u2014": "-",
  "\u2212": "-",
  "\u2026": "...",
  "\u2022": "-",
  "\u00a0": " ",
  "\u00ad": "",
};

/** WinAnsi-safe text; unsupported scripts are replaced rather than thrown. */
export function sanitizeForPdf(text: string): string {
  const normalized = text.normalize("NFKC").replace(/\r\n?/g, "\n");
  let output = "";
  for (const char of normalized) {
    if (char === "\n") {
      output += "\n";
      continue;
    }
    if (char === "\t") {
      output += "    ";
      continue;
    }
    const replacement = CHARACTER_REPLACEMENTS[char];
    if (replacement !== undefined) {
      output += replacement;
      continue;
    }
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    output += code <= 0xff ? char : "?";
  }
  return output;
}

function wrapLine(
  text: string,
  font: { widthOfTextAtSize: (text: string, size: number) => number },
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, FONT_SIZE) <= TEXT_WIDTH) {
      current = candidate;
      continue;
    }
    if (current !== "") {
      lines.push(current);
      current = "";
    }
    if (font.widthOfTextAtSize(word, FONT_SIZE) <= TEXT_WIDTH) {
      current = word;
      continue;
    }
    let part = "";
    for (const char of word) {
      const next = part + char;
      if (font.widthOfTextAtSize(next, FONT_SIZE) > TEXT_WIDTH && part !== "") {
        lines.push(part);
        part = char;
      } else {
        part = next;
      }
    }
    current = part;
  }
  if (current !== "") lines.push(current);
  return lines;
}

/** Render source units to an A4 PDF with a real text layer. */
export async function renderTextPdf(
  units: readonly string[],
  title: string,
): Promise<Uint8Array> {
  const cleaned = units.map((unit) => sanitizeForPdf(unit));
  const joined = cleaned.join("\n");
  if (joined.replace(/\s/g, "") === "") {
    throw new ConvertError("empty", "The file has no readable text.");
  }
  if (joined.length > CONVERT_MAX_TEXT_CHARS) {
    throw new ConvertError(
      "too_large",
      "The converted text is too large for one PDF.",
    );
  }

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.setTitle(sanitizeForPdf(title).slice(0, 120) || "Converted document");
  pdf.setProducer("UniPilot");
  pdf.setCreator("UniPilot Document Converter");

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let cursorY = PAGE_HEIGHT - MARGIN;

  const newPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    cursorY = PAGE_HEIGHT - MARGIN;
  };

  const ensureLine = () => {
    if (cursorY - LINE_HEIGHT < MARGIN) newPage();
  };

  for (let unitIndex = 0; unitIndex < cleaned.length; unitIndex += 1) {
    if (unitIndex > 0) newPage();
    const lines = cleaned[unitIndex].split("\n");
    for (const rawLine of lines) {
      const trimmed = rawLine.trimEnd();
      if (trimmed === "") {
        ensureLine();
        cursorY -= LINE_HEIGHT * 0.55;
        continue;
      }
      for (const line of wrapLine(trimmed, font)) {
        ensureLine();
        page.drawText(line, {
          x: MARGIN,
          y: cursorY,
          size: FONT_SIZE,
          font,
          color: rgb(0, 0, 0),
        });
        cursorY -= LINE_HEIGHT;
      }
    }
  }

  return pdf.save();
}

function assertText(pages: readonly string[]): string[] {
  const normalized = pages.map((page) => normalizeInputText(page));
  const joined = normalized.join("\n");
  if (joined.replace(/\s/g, "") === "") {
    throw new ConvertError("empty", "The file has no readable text.");
  }
  if (joined.length > CONVERT_MAX_TEXT_CHARS) {
    throw new ConvertError(
      "too_large",
      "The converted text is too large for one file.",
    );
  }
  return normalized;
}

export function renderPlainText(
  pages: readonly string[],
  kind: ConvertInputKind,
): Uint8Array {
  const normalized = assertText(pages);
  const body =
    kind === "txt" || kind === "md" || kind === "csv" || kind === "json"
      ? normalized[0] ?? ""
      : normalized.filter(Boolean).join("\n\n");
  return strToU8(`${body.trim()}\n`);
}

export function renderMarkdown(
  pages: readonly string[],
  kind: ConvertInputKind,
): Uint8Array {
  const normalized = assertText(pages);
  if (kind === "csv" || kind === "json") {
    return strToU8(
      `\`\`\`${kind}\n${(normalized[0] ?? "").trim()}\n\`\`\`\n`,
    );
  }
  if (kind === "txt" || kind === "md") {
    return strToU8(`${(normalized[0] ?? "").trim()}\n`);
  }
  if (kind === "docx") {
    return strToU8(`${(normalized[0] ?? "").trim()}\n`);
  }

  const label = kind === "pdf" ? "Page" : "Slide";
  const body = normalized
    .map((text, index) =>
      text.trim() === ""
        ? ""
        : `## ${label} ${index + 1}\n\n${text.trim()}`,
    )
    .filter(Boolean)
    .join("\n\n");
  if (body === "") throw new ConvertError("empty", "The file has no readable text.");
  return strToU8(`${body}\n`);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Minimal valid WordprocessingML package, generated with fflate. */
export function renderDocx(
  pages: readonly string[],
): Uint8Array {
  const normalized = assertText(pages);
  const paragraphs: string[] = [];
  for (let unitIndex = 0; unitIndex < normalized.length; unitIndex += 1) {
    if (unitIndex > 0) {
      paragraphs.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    }
    for (const line of normalized[unitIndex].split("\n")) {
      paragraphs.push(
        `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`,
      );
    }
  }

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(relationships),
    "word/document.xml": strToU8(document),
  });
}

export type ConvertDocumentResult = {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
  targetFormat: ConvertTarget;
};

export async function convertDocument(options: {
  bytes: Uint8Array;
  name: string;
  mimeType: string | null;
  targetFormat?: ConvertTarget;
  userId?: string;
}): Promise<ConvertDocumentResult> {
  const kind = detectConvertKind(options.name, options.mimeType);
  if (kind === null) {
    throw new ConvertError("unsupported", "Choose a supported document.");
  }
  const target = options.targetFormat ?? "pdf";
  if (!canConvert(kind, target)) {
    throw new ConvertError(
      "unsupported",
      "That target isn't available for this file type.",
    );
  }

  const pages = await inputPages(options.bytes, kind, options.userId);
  const base =
    options.name.replace(/\.[^.]+$/, "").trim() || "Converted document";
  let bytes: Uint8Array;
  if (target === "pdf") {
    bytes = await renderTextPdf(pages, base);
  } else if (target === "txt") {
    bytes = renderPlainText(pages, kind);
  } else if (target === "md") {
    bytes = renderMarkdown(pages, kind);
  } else {
    bytes = renderDocx(pages);
  }

  return {
    bytes,
    mimeType: targetMimeType(target),
    fileName: convertedFileName(options.name, target),
    targetFormat: target,
  };
}

/** Backwards-compatible PDF-only entry point. */
export async function convertDocumentToPdf(options: {
  bytes: Uint8Array;
  name: string;
  mimeType: string | null;
  userId?: string;
}): Promise<Uint8Array> {
  const result = await convertDocument({
    ...options,
    targetFormat: "pdf",
  });
  return result.bytes;
}

function safeBase(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 100) || "converted-document"
  );
}

/** A response/download name that is safe and has the target extension. */
export function convertedFileName(
  name: string,
  target: ConvertTarget,
): string {
  return `${safeBase(name)}.${targetExtension(target)}`;
}

/** Backwards-compatible PDF response name. */
export function convertedPdfName(name: string): string {
  return convertedFileName(name, "pdf");
}
