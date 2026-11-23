/**
 * Ask AI's lightweight block formatter.
 *
 * The assistant answers in plain text with a small, predictable Markdown
 * subset. This module turns that text into render-ready blocks without a
 * Markdown dependency:
 *
 * - paragraphs separated by blank lines;
 * - `**bold**` emphasis and `` `inline code` ``;
 * - consecutive `-`/`*`/`•` bullets and `1.`/`1)` numbered items;
 * - fenced code blocks (an unclosed fence is shown as code, never swallowed).
 *
 * Pure by design: every branch is a direct Jest case, and the renderer owns no
 * parsing rules of its own.
 */

export type InlineSpan = {
  text: string;
  bold: boolean;
  code: boolean;
};

export type FormattedBlock =
  | { type: "paragraph"; spans: InlineSpan[] }
  | {
      type: "list";
      ordered: boolean;
      start: number;
      items: InlineSpan[][];
    }
  | { type: "code"; text: string; language: string | null };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const FENCE = /^\s*```(.*)$/;

function pushSpan(spans: InlineSpan[], span: InlineSpan): void {
  if (span.text === "") return;
  const last = spans.at(-1);
  if (last && last.bold === span.bold && last.code === span.code) {
    last.text += span.text;
    return;
  }
  spans.push(span);
}

/**
 * Tokenize one paragraph/line group. Bold and code spans are non-overlapping;
 * an unmatched marker stays literal text.
 */
export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let buffer = "";
  let index = 0;

  const flush = () => {
    if (buffer !== "") {
      pushSpan(spans, { text: buffer, bold: false, code: false });
      buffer = "";
    }
  };

  while (index < text.length) {
    if (text.startsWith("**", index)) {
      const close = text.indexOf("**", index + 2);
      if (close === -1) {
        buffer += "**";
        index += 2;
        continue;
      }
      const inner = text.slice(index + 2, close);
      if (inner === "") {
        index = close + 2;
        continue;
      }
      flush();
      pushSpan(spans, { text: inner, bold: true, code: false });
      index = close + 2;
      continue;
    }

    if (text[index] === "`") {
      const close = text.indexOf("`", index + 1);
      if (close === -1) {
        buffer += "`";
        index += 1;
        continue;
      }
      const inner = text.slice(index + 1, close);
      if (inner === "") {
        index = close + 1;
        continue;
      }
      flush();
      pushSpan(spans, { text: inner, bold: false, code: true });
      index = close + 1;
      continue;
    }

    buffer += text[index];
    index += 1;
  }

  flush();
  return spans;
}

function isBlockStarter(line: string): boolean {
  return (
    line.trim() === "" ||
    FENCE.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line)
  );
}

/** Parse the assistant's small Markdown subset into render-ready blocks. */
export function formatMessage(input: string): FormattedBlock[] {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const blocks: FormattedBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const language = fence[1].trim().split(/\s+/)[0] ?? "";
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1; // closing fence
      blocks.push({
        type: "code",
        text: code.join("\n"),
        language: language === "" ? null : language,
      });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      const items: InlineSpan[][] = [];
      while (index < lines.length) {
        const match = BULLET.exec(lines[index]);
        if (!match) break;
        items.push(parseInline(match[1].trim()));
        index += 1;
      }
      blocks.push({ type: "list", ordered: false, start: 1, items });
      continue;
    }

    const numbered = NUMBERED.exec(line);
    if (numbered) {
      const start = Number.parseInt(numbered[1], 10);
      const items: InlineSpan[][] = [];
      while (index < lines.length) {
        const match = NUMBERED.exec(lines[index]);
        if (!match) break;
        items.push(parseInline(match[2].trim()));
        index += 1;
      }
      blocks.push({
        type: "list",
        ordered: true,
        start: Number.isFinite(start) && start > 0 ? start : 1,
        items,
      });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && !isBlockStarter(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    if (paragraph.length > 0) {
      blocks.push({
        type: "paragraph",
        spans: parseInline(paragraph.join("\n")),
      });
    }
  }

  return blocks;
}
