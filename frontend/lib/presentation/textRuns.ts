/**
 * Rich text-run editing for the native deck editor (Task D2, spec §5.4
 * "Inline text", §6.4).
 *
 * The wire carries `TextRun` (`{text, font?}`) and `LatexTextRun`
 * (`{type:"latex", latex, font?}`) values. The inline editor works on
 * **display offsets over the concatenated run text** — a plain run contributes
 * its `text` and a LaTeX run its raw `latex` source (the renderer's honest
 * raw-run stance) — and this module turns a range plus a font patch into a new
 * run array:
 *
 * - splits plain runs at both selection boundaries so untouched bytes never
 *   change;
 * - applies the patch only to the runs the range actually covers;
 * - merges adjacent runs that end up with identical text styling after the
 *   edit, but never across the selection boundary into an unselected run.
 *
 * LaTeX runs have no native formatter: a boundary inside one snaps to its edge
 * and the run is passed through byte-for-byte (same object reference), which
 * the toolbar states honestly. Everything here is a pure function over the
 * wire JSON — no DOM, no React, no fetch. Unknown run fields (the wire is
 * stored unvalidated) survive every operation.
 */
import { isTextRun } from "./elements";
import type { Font, LatexTextRun, TextRun, TextRunValue } from "./types";

/** A selection over the element's concatenated run text (UTF-16 offsets). */
export type TextRange = { start: number; end: number };

/** The font properties the run toolbar edits. */
export type RunFontKey = "bold" | "italic" | "underline";

/**
 * A font patch over one run. `null` deletes the property, so a control's
 * "theme default" state is representable.
 */
export type RunFontPatch = Partial<
  Record<keyof Font, string | number | boolean | null>
>;

/** The raw LaTeX run shape (spec §6.4). */
export function isLatexRun(value: unknown): value is LatexTextRun {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { type?: unknown; latex?: unknown };
  return record.type === "latex" && typeof record.latex === "string";
}

/** A run the operations may split and format: a plain string or a text run. */
function isPlainRun(value: unknown): value is TextRun | string {
  return typeof value === "string" || isTextRun(value);
}

/** The run's own font declarations, or `null` when it carries none. */
export function fontOfRun(run: unknown): Font | null {
  if (typeof run !== "object" || run === null) return null;
  const font = (run as { font?: unknown }).font;
  return typeof font === "object" && font !== null ? (font as Font) : null;
}

/** The text a run contributes to display offsets (LaTeX contributes source). */
export function textOfRun(run: unknown): string {
  if (typeof run === "string") return run;
  if (typeof run !== "object" || run === null) return "";
  if (isTextRun(run)) return (run as { text: string }).text;
  if (isLatexRun(run)) return run.latex;
  return "";
}

function runLength(run: unknown): number {
  return textOfRun(run).length;
}

function totalLength(runs: readonly unknown[]): number {
  let total = 0;
  for (const run of runs) total += runLength(run);
  return total;
}

/**
 * A JSON-stable serialization used for run equality and the editor's DOM-sync
 * signature; object keys are sorted so structurally equal values compare equal.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify(
            (value as Record<string, unknown>)[key],
          )}`,
      );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function clampRange(
  runs: readonly unknown[],
  range: TextRange,
): { start: number; end: number } {
  const total = totalLength(runs);
  const rawStart = Number.isFinite(range.start) ? range.start : 0;
  const rawEnd = Number.isFinite(range.end) ? range.end : rawStart;
  const start = Math.max(0, Math.min(Math.min(rawStart, rawEnd), total));
  const end = Math.max(0, Math.min(Math.max(rawStart, rawEnd), total));
  return { start, end };
}

/** Every run's display text joined — the offset space the editor selects in. */
export function runsPlainText(runs: unknown): string {
  const list = Array.isArray(runs) ? runs : [];
  return list.map((run) => textOfRun(run)).join("");
}

/** The stable signature the inline editor rebuilds its DOM from. */
export function runsSignature(runs: unknown): string {
  return stableStringify(Array.isArray(runs) ? runs : []);
}

/**
 * The run with new display text. A plain string becomes a text-run object
 * (the wire's untyped string shorthand only survives untouched); a text run
 * keeps every other field; a LaTeX run's `latex` source is the text.
 */
export function runWithText(run: unknown, text: string): TextRunValue {
  if (typeof run === "string") return { text };
  if (isLatexRun(run)) return { ...run, latex: text };
  return { ...(run as Record<string, unknown>), text } as unknown as TextRunValue;
}

/** The run with `font` replaced (`null` removes the field). */
function withFont(run: unknown, font: Font | null): TextRunValue {
  if (typeof run === "string") {
    return (font !== null ? { text: run, font } : { text: run }) as TextRun;
  }
  const next = { ...(run as Record<string, unknown>) };
  if (font !== null) next.font = font;
  else delete next.font;
  return next as unknown as TextRunValue;
}

/** The run minus its display text — the styling identity used for merging. */
function runShape(run: unknown): Record<string, unknown> {
  if (typeof run === "string") return {};
  if (typeof run !== "object" || run === null) return {};
  const shape = { ...(run as Record<string, unknown>) };
  delete shape.text;
  return shape;
}

function sameRunShape(a: unknown, b: unknown): boolean {
  return stableStringify(runShape(a)) === stableStringify(runShape(b));
}

/**
 * Splits the run containing `offset` into two runs with the offset as the
 * boundary. Boundaries (`offset <= 0`, `offset >= total`, or an existing run
 * edge) return the original array unchanged; an offset inside a LaTeX run
 * cannot split it and also returns the original array (the caller's range
 * snaps to the run's edge — recorded, not faked).
 */
export function splitRunsAt(
  runs: TextRunValue[],
  offset: number,
): TextRunValue[] {
  const list = Array.isArray(runs) ? runs : [];
  const out: unknown[] = [];
  let at = 0;
  let split = false;
  for (const run of list) {
    const length = runLength(run);
    const runEnd = at + length;
    if (!split && offset > at && offset < runEnd && isPlainRun(run)) {
      const text = textOfRun(run);
      out.push(runWithText(run, text.slice(0, offset - at)));
      out.push(runWithText(run, text.slice(offset - at)));
      split = true;
    } else {
      out.push(run);
    }
    at = runEnd;
  }
  return split ? (out as TextRunValue[]) : runs;
}

/**
 * Merges adjacent plain runs whose styling is identical (text is the only
 * difference), so a formatting pass produces one run per style span. With a
 * `range`, only pairs that both intersect the range merge — an unselected run
 * never absorbs the patched one across the selection boundary. Returns the
 * original array when nothing merged.
 */
export function mergeAdjacentRuns(
  runs: TextRunValue[],
  range?: TextRange,
): TextRunValue[] {
  const list = Array.isArray(runs) ? runs : [];
  const bounds = range !== undefined ? clampRange(list, range) : null;
  type Entry = { run: unknown; start: number; end: number };
  const entries: Entry[] = [];
  let at = 0;
  for (const run of list) {
    const length = runLength(run);
    entries.push({ run, start: at, end: at + length });
    at += length;
  }
  const overlaps = (entry: Entry) =>
    bounds !== null && entry.start < bounds.end && entry.end > bounds.start;
  const merged: Entry[] = [];
  for (const entry of entries) {
    const prev = merged[merged.length - 1];
    const bothInRange =
      bounds === null || (prev !== undefined && overlaps(prev) && overlaps(entry));
    if (
      prev !== undefined &&
      bothInRange &&
      isPlainRun(prev.run) &&
      isPlainRun(entry.run) &&
      sameRunShape(prev.run, entry.run)
    ) {
      merged[merged.length - 1] = {
        run: runWithText(prev.run, textOfRun(prev.run) + textOfRun(entry.run)),
        start: prev.start,
        end: entry.end,
      };
      continue;
    }
    merged.push({ ...entry });
  }
  if (merged.length === entries.length) return runs;
  return merged.map((entry) => entry.run as TextRunValue);
}

function patchFont(font: Font | null, patch: RunFontPatch): Font | null {
  const next: Record<string, unknown> = { ...(font ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
  }
  return Object.keys(next).length > 0 ? (next as Font) : null;
}

/**
 * Applies a font patch to the range. The plain runs the range covers are
 * split at both boundaries first, patched, and then merged where the patch
 * made them identical; LaTeX runs and everything outside the range pass
 * through byte-for-byte. Returns the original array when no run changed.
 */
export function applyRunFont(
  runs: TextRunValue[],
  range: TextRange,
  patch: RunFontPatch,
): TextRunValue[] {
  const list = Array.isArray(runs) ? runs : [];
  const bounds = clampRange(list, range);
  if (bounds.start === bounds.end) return runs;
  const split = splitRunsAt(splitRunsAt(list, bounds.start), bounds.end);
  let changed = false;
  const next: unknown[] = [];
  let at = 0;
  for (const run of split) {
    const start = at;
    at += runLength(run);
    if (isPlainRun(run) && start < bounds.end && at > bounds.start) {
      const before = fontOfRun(run);
      const patched = patchFont(before, patch);
      if (stableStringify(patched) !== stableStringify(before)) {
        changed = true;
        next.push(withFont(run, patched));
        continue;
      }
    }
    next.push(run);
  }
  if (!changed) return runs;
  return mergeAdjacentRuns(next as TextRunValue[], bounds);
}

/**
 * The effective font at one offset — the run that owns the character starting
 * there over the block font, exactly how the renderer stacks them. An
 * internal boundary reads the run that starts there (the editor's caret
 * convention); an offset past the end reads the last run; no runs read the
 * base font alone.
 */
export function fontAtOffset(
  runs: TextRunValue[],
  baseFont: Font | null | undefined,
  offset: number,
): Font {
  const list = Array.isArray(runs) ? runs : [];
  const total = totalLength(list);
  const position = Number.isFinite(offset)
    ? Math.max(0, Math.min(offset, total))
    : 0;
  let at = 0;
  let found: Font | null = null;
  for (const run of list) {
    const end = at + runLength(run);
    if (position < end || (end === total && position === total)) {
      found = fontOfRun(run);
      break;
    }
    at = end;
  }
  return { ...(baseFont ?? {}), ...(found ?? {}) };
}

/**
 * Whether the range covers at least one character of a plain text run — the
 * honest gate for enabling the run controls. A collapsed range and a range
 * entirely inside LaTeX are not formattable.
 */
export function rangeSupportsRunFormatting(
  runs: TextRunValue[],
  range: TextRange,
): boolean {
  const list = Array.isArray(runs) ? runs : [];
  const bounds = clampRange(list, range);
  if (bounds.start === bounds.end) return false;
  let at = 0;
  for (const run of list) {
    const start = at;
    at += runLength(run);
    if (isPlainRun(run) && start < bounds.end && at > bounds.start) return true;
  }
  return false;
}

/**
 * Flips one boolean font property over the range, starting from the effective
 * value at the selection start (so a run inheriting bold from the block font
 * toggles off with an explicit `false`).
 */
export function toggleRunFont(
  runs: TextRunValue[],
  range: TextRange,
  baseFont: Font | null | undefined,
  key: RunFontKey,
): TextRunValue[] {
  const list = Array.isArray(runs) ? runs : [];
  const bounds = clampRange(list, range);
  if (bounds.start === bounds.end) return runs;
  const current = fontAtOffset(list, baseFont, bounds.start);
  return applyRunFont(list, bounds, {
    [key]: current[key] === true ? false : true,
  });
}

export type { LatexTextRun };
