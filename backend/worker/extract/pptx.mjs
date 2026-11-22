/**
 * The PPTX text boundary (WhatsApp group sync).
 *
 * A .pptx is a ZIP of XML parts. The slides live at `ppt/slides/slideN.xml`
 * and their text runs are `<a:t>…</a:t>` elements. This reads those runs in
 * slide order and nothing else: no media, no macros, no external references,
 * so there is nothing to execute.
 *
 *     extractPptx(buffer) -> { pages: string[], pageCount }
 *
 * Same shape as the PDF and DOCX extractors (one string per slide). Archive
 * hostility is bounded before anything is inflated: a part larger than
 * `MAX_PART_BYTES` or an archive with more than `MAX_ENTRIES` entries is
 * refused, so a crafted deck cannot exhaust memory.
 */
import { unzipSync } from "fflate";

export const MAX_ENTRIES = 5_000;
export const MAX_PART_BYTES = 8 * 1024 * 1024;
export const MAX_SLIDES = 500;

export class PptxUnreadableError extends Error {
  constructor(reason) {
    super(reason ?? "The presentation could not be read.");
    this.name = "PptxUnreadableError";
  }
}

const SLIDE = /^ppt\/slides\/slide(\d+)\.xml$/;
const NOTES = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/;

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Text of one slide part: paragraphs (`<a:p>`) become lines, runs concatenate. */
export function slideXmlToText(xml) {
  const paragraphs = xml.split(/<\/a:p>/);
  const lines = [];
  for (const paragraph of paragraphs) {
    const runs = [...paragraph.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((m) =>
      decodeEntities(m[1]),
    );
    const line = runs.join("").replace(/\s+/g, " ").trim();
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

export async function extractPptx(buffer) {
  let files;
  try {
    let entries = 0;
    files = unzipSync(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer), {
      filter: (file) => {
        entries += 1;
        if (entries > MAX_ENTRIES) throw new PptxUnreadableError("Too many entries.");
        if (!SLIDE.test(file.name) && !NOTES.test(file.name)) return false;
        if (file.originalSize > MAX_PART_BYTES) {
          throw new PptxUnreadableError("A slide is unreasonably large.");
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof PptxUnreadableError) throw error;
    throw new PptxUnreadableError();
  }

  const slides = new Map();
  const notes = new Map();
  const decoder = new TextDecoder("utf-8");
  for (const [name, bytes] of Object.entries(files)) {
    const slide = SLIDE.exec(name);
    if (slide) {
      slides.set(Number(slide[1]), slideXmlToText(decoder.decode(bytes)));
      continue;
    }
    const note = NOTES.exec(name);
    if (note) notes.set(Number(note[1]), slideXmlToText(decoder.decode(bytes)));
  }
  if (slides.size === 0) throw new PptxUnreadableError("No slides found.");
  if (slides.size > MAX_SLIDES) throw new PptxUnreadableError("Too many slides.");

  const pages = [...slides.keys()]
    .sort((a, b) => a - b)
    .map((n) => {
      const body = slides.get(n) ?? "";
      const note = notes.get(n);
      return note ? `${body}\n[notes] ${note}`.trim() : body;
    });
  return { pages, pageCount: pages.length };
}
