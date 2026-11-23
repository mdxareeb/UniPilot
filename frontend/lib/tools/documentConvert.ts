/**
 * Text-preserving DOCX / PPTX / TXT → PDF conversion (server-only).
 *
 * The extractors mirror the worker's tested boundaries:
 * - DOCX uses mammoth's raw text;
 * - PPTX reads `ppt/slides/slideN.xml` text runs with fflate, bounded before
 *   inflating;
 * - TXT is UTF-8.
 *
 * Layout is deterministic and dependency-light: A4, Helvetica, 56pt margins,
 * paragraph wrapping and page breaks. A source unit that represents a fixed
 * page (a slide) starts a PDF page; DOCX/TXT flow continuously. The standard
 * font is WinAnsi, so common typographic characters are normalized and
 * characters outside that repertoire are replaced with `?` rather than
 * throwing mid-document. No HTML, macros, images or external references are
 * ever executed.
 */
import { unzipSync } from "fflate";
import mammoth from "mammoth";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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

export type ConvertKind = "docx" | "pptx" | "txt";

export class ConvertError extends Error {
  readonly code: "unsupported" | "unreadable" | "empty" | "too_large";

  constructor(
    code: ConvertError["code"],
    message: string,
  ) {
    super(message);
    this.name = "ConvertError";
    this.code = code;
  }
}

export function detectConvertKind(
  name: string,
  mimeType: string | null,
): ConvertKind | null {
  const lower = name.trim().toLowerCase();
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
  kind: ConvertKind,
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

  try {
    return [new TextDecoder("utf-8", { fatal: false }).decode(bytes)];
  } catch {
    throw new ConvertError("unreadable", "The text file couldn't be read.");
  }
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
    // A single unbroken token: split at the last fitting character.
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

export async function convertDocumentToPdf(options: {
  bytes: Uint8Array;
  name: string;
  mimeType: string | null;
}): Promise<Uint8Array> {
  const kind = detectConvertKind(options.name, options.mimeType);
  if (kind === null) {
    throw new ConvertError(
      "unsupported",
      "Choose a DOCX, PPTX or TXT file.",
    );
  }
  const pages = await extractConvertPages(options.bytes, kind);
  const base = options.name.replace(/\.[^.]+$/, "").trim() || "Converted document";
  return renderTextPdf(pages, base);
}

/** A response/download name that is safe and always ends in `.pdf`. */
export function convertedPdfName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").trim() || "converted-document";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100) || "converted-document";
  return `${cleaned}.pdf`;
}
