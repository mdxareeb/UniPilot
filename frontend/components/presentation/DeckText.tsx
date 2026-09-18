"use client";

/**
 * Text runs (Task B3, spec §6.4): one inline span per run with the run's own
 * font merged over its block font. Plain strings in run lists are text; LaTeX
 * runs have no renderer here, so the raw source is shown honestly rather than
 * faking math.
 */
import { mergeRunFont } from "@/lib/presentation/elements";
import { useDeckFontFamily } from "./StageContext";
import { fontTextStyle } from "./style";
import type { Font } from "@/lib/presentation/types";

type NormalizedRun =
  | { kind: "text"; text: string; font: Font | null }
  | { kind: "latex"; latex: string; font: Font | null };

/** The fork's run normalization, narrowed to what the wire can carry. */
export function normalizeTextRun(value: unknown): NormalizedRun | null {
  if (typeof value === "string") {
    return { kind: "text", text: value, font: null };
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as {
    type?: unknown;
    text?: unknown;
    latex?: unknown;
    font?: unknown;
  };
  const font = (record.font ?? null) as Font | null;
  if (record.type === "latex") {
    return {
      kind: "latex",
      latex: typeof record.latex === "string" ? record.latex : "",
      font,
    };
  }
  if (typeof record.text === "string") {
    return { kind: "text", text: record.text, font };
  }
  return null;
}

export function TextRuns({
  runs,
  baseFont,
}: {
  runs: unknown;
  baseFont: Font | null | undefined;
}) {
  const resolveFamily = useDeckFontFamily();
  const list = Array.isArray(runs) ? runs : [];
  return (
    <>
      {list.map((value, index) => {
        const run = normalizeTextRun(value);
        if (!run) return null;
        const font: Font = mergeRunFont(baseFont, run.font);
        if (run.kind === "latex") {
          return (
            <span
              key={index}
              data-deck-latex="true"
              style={{ ...fontTextStyle(font, resolveFamily), whiteSpace: "pre-wrap" }}
            >
              {run.latex}
            </span>
          );
        }
        return (
          <span key={index} style={fontTextStyle(font, resolveFamily)}>
            {run.text}
          </span>
        );
      })}
    </>
  );
}
