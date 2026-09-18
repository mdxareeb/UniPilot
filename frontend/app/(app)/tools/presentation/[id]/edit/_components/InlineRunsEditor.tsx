"use client";

/**
 * The inline rich-text editor over one `text` element (Task D2, spec §6.4).
 *
 * The editor renders the element's runs as spans whose styles come from the
 * same `fontTextStyle` the stage uses, so what is typed looks like what is
 * displayed. The DOM is the source of truth while typing — React never renders
 * the contenteditable's children (a per-keystroke re-render would recreate the
 * text nodes and jump the caret), so a layout effect syncs the spans back only
 * when the runs signature changes externally (undo/redo, reload, formatting,
 * switching elements) and restores the stored selection after that rebuild.
 *
 * Selection offsets are **display offsets over the concatenated run text**
 * (LaTeX runs contribute their raw source), which is exactly the offset space
 * `lib/presentation/textRuns` operates in. Typing rebuilds the run array from
 * the DOM by mapping each run span back to the run model it was rendered from
 * (a WeakMap), so unedited runs keep their exact fonts; formatting goes
 * through the parent's run ops and never touches the DOM directly.
 */
import { useLayoutEffect, useRef } from "react";
import type {
  CSSProperties,
  FocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { fontTextStyle } from "@/components/presentation/style";
import { mergeRunFont } from "@/lib/presentation/elements";
import {
  fontOfRun,
  isLatexRun,
  runWithText,
  runsSignature,
  textOfRun,
  type RunFontKey,
  type TextRange,
} from "@/lib/presentation/textRuns";
import type { Font, TextRunValue } from "@/lib/presentation/types";

export type InlineRunsEditorProps = {
  runs: TextRunValue[];
  baseFont: Font | null;
  resolveFamily: (family: string) => string | null;
  style: CSSProperties;
  onChange: (runs: TextRunValue[]) => void;
  onSelectionChange: (range: TextRange | null) => void;
  onToggle: (key: RunFontKey, range: TextRange) => void;
  onTab: (delta: -1 | 1) => void;
  onFocus: () => void;
  onBlur: (event: FocusEvent<HTMLDivElement>) => void;
};

type RunStore = WeakMap<HTMLElement, TextRunValue>;

/** The Mod chords' run properties (spec §5.4: Mod+B/I/U). */
const RUN_KEY_CHORDS: Record<string, RunFontKey> = {
  b: "bold",
  i: "italic",
  u: "underline",
};

function renderRuns(
  root: HTMLDivElement,
  runs: TextRunValue[],
  baseFont: Font | null,
  resolveFamily: (family: string) => string | null,
  store: RunStore,
): void {
  const nodes = runs.map((run) => {
    const span = root.ownerDocument.createElement("span");
    span.setAttribute("data-editor-run", "");
    if (isLatexRun(run)) span.setAttribute("data-deck-latex", "true");
    Object.assign(
      span.style,
      fontTextStyle(mergeRunFont(baseFont, fontOfRun(run)), resolveFamily),
    );
    span.textContent = textOfRun(run);
    store.set(span, run);
    return span;
  });
  root.replaceChildren(...nodes);
}

/**
 * Rebuilds the run model from the live DOM. A marked span answers the run it
 * was rendered from (the WeakMap, with a text-only fallback); a raw text node
 * or a browser-created wrapper is plain text on the block font; `<br>` is a
 * newline. An emptied editor keeps one empty run carrying the first run's
 * font, so the wire never loses the element's style.
 */
function readRuns(
  root: HTMLDivElement,
  store: RunStore,
  fallback: TextRunValue | undefined,
): TextRunValue[] {
  const runs: TextRunValue[] = [];
  const readNode = (node: ChildNode): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue ?? "";
      if (text !== "") runs.push({ text });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (element.hasAttribute("data-editor-run")) {
      const stored = store.get(element);
      const text = element.textContent ?? "";
      if (text === "") return;
      if (stored === undefined) {
        runs.push({ text });
        return;
      }
      if (isLatexRun(stored)) {
        runs.push({ ...stored, latex: text });
        return;
      }
      runs.push(runWithText(stored, text));
      return;
    }
    if (element.tagName === "BR") {
      runs.push({ text: "\n" });
      return;
    }
    for (const child of Array.from(element.childNodes)) readNode(child);
  };
  for (const node of Array.from(root.childNodes)) readNode(node);
  if (runs.length > 0) return runs;
  const font = fontOfRun(fallback);
  return [font !== null ? { text: "", font } : { text: "" }];
}

/** The live selection as display offsets inside the editor, when it is ours. */
function captureRange(root: HTMLElement): TextRange | null {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return null;
  }
  const pre = root.ownerDocument.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  pre.setEnd(range.endContainer, range.endOffset);
  const end = pre.toString().length;
  return start <= end ? { start, end } : { start: end, end: start };
}

/** Puts a display-offset range back into the rebuilt DOM. */
function restoreRange(root: HTMLElement, range: TextRange): void {
  const textNodes: Text[] = [];
  const walk = (node: ChildNode): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      textNodes.push(node as Text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if ((node as HTMLElement).tagName === "BR") return;
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  for (const node of Array.from(root.childNodes)) walk(node);
  const resolve = (offset: number): { node: Text; offset: number } | null => {
    let at = 0;
    for (const node of textNodes) {
      const length = node.nodeValue?.length ?? 0;
      if (offset <= at + length) return { node, offset: offset - at };
      at += length;
    }
    const last = textNodes[textNodes.length - 1];
    return last ? { node: last, offset: last.nodeValue?.length ?? 0 } : null;
  };
  const start = resolve(range.start);
  const end = resolve(range.end);
  if (start === null || end === null) return;
  const selection = root.ownerDocument.getSelection();
  if (selection === null) return;
  const domRange = root.ownerDocument.createRange();
  domRange.setStart(start.node, start.offset);
  domRange.setEnd(end.node, end.offset);
  selection.removeAllRanges();
  selection.addRange(domRange);
}

function focusCaretEnd(node: HTMLDivElement): void {
  node.focus();
  const selection = window.getSelection();
  if (selection === null) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function InlineRunsEditor({
  runs,
  baseFont,
  resolveFamily,
  style,
  onChange,
  onSelectionChange,
  onToggle,
  onTab,
  onFocus,
  onBlur,
}: InlineRunsEditorProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const storeRef = useRef<RunStore | null>(null);
  const lastSignatureRef = useRef<string | null>(null);
  const selectionRef = useRef<TextRange | null>(null);
  const dragActiveRef = useRef(false);
  const autoFocusRef = useRef(true);

  const families = [
    baseFont?.family,
    ...runs.map((run) => fontOfRun(run)?.family),
  ].filter((family): family is string => typeof family === "string" && family !== "");
  const signature = `${runsSignature(runs)}|${JSON.stringify(baseFont ?? null)}|${families
    .map((family) => resolveFamily(family) ?? "")
    .join("\u0000")}`;

  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) return;
    if (storeRef.current === null) storeRef.current = new WeakMap();
    if (lastSignatureRef.current === signature) return;
    const active = node.ownerDocument.activeElement;
    const hadFocus = active !== null && node.contains(active);
    const previous = selectionRef.current;
    renderRuns(node, runs, baseFont, resolveFamily, storeRef.current);
    lastSignatureRef.current = signature;
    if (hadFocus && previous !== null) restoreRange(node, previous);
    // The signature is the DOM-sync trigger; the props it is built from are
    // read only when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const updateSelection = (node: HTMLDivElement): void => {
    const range = captureRange(node);
    selectionRef.current = range;
    onSelectionChange(range);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const key = event.key.toLowerCase();
    const mod = event.metaKey || event.ctrlKey;
    const runKey = RUN_KEY_CHORDS[key];
    if (mod && !event.altKey && runKey !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      const node = event.currentTarget;
      const range = captureRange(node) ?? selectionRef.current;
      if (range === null) return;
      selectionRef.current = range;
      onSelectionChange(range);
      onToggle(runKey, range);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (dragActiveRef.current) {
        dragActiveRef.current = false;
        return;
      }
      event.currentTarget.blur();
    } else if (event.key === "Tab") {
      event.preventDefault();
      onTab(event.shiftKey ? -1 : 1);
    }
  };

  return (
    <div
      ref={(node) => {
        ref.current = node;
        /* Focus lands during the commit (before the owning command's rAF), so
           a keyboard selection change that remounts this editor still leaves
           the stage as the keyboard owner. */
        if (node !== null && autoFocusRef.current) {
          autoFocusRef.current = false;
          focusCaretEnd(node);
        }
      }}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label="Edit slide text"
      spellCheck={false}
      data-editor-inline-text=""
      className="rounded-xs ring-2 ring-ring"
      style={style}
      onPointerDown={() => {
        dragActiveRef.current = true;
      }}
      onPointerUp={() => {
        dragActiveRef.current = false;
      }}
      onFocus={onFocus}
      onBlur={onBlur}
      onInput={(event) => {
        const node = event.currentTarget;
        const store = storeRef.current;
        if (store === null) return;
        const nextRuns = readRuns(node, store, runs[0]);
        const range = captureRange(node);
        selectionRef.current = range;
        onSelectionChange(range);
        onChange(nextRuns);
      }}
      onKeyDown={onKeyDown}
      onSelect={(event) => updateSelection(event.currentTarget)}
      onKeyUp={(event) => updateSelection(event.currentTarget)}
      onMouseUp={(event) => updateSelection(event.currentTarget)}
    />
  );
}
