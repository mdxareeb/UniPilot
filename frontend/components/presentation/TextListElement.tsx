/**
 * `text-list` elements (Task B3, spec §6.4).
 *
 * The fork's `renderTextList`: a native `<ol>`/`<ul>` with the element font on
 * the wrapper, 24px of native marker padding unless markers are hidden/none,
 * an item gap as `margin-top`, and a custom two-column grid (`marker_gap`)
 * when the wire asks for one. Items may be run arrays or plain strings.
 */
import { elementBox } from "@/lib/presentation/elements";
import type { TextListElement as TextListElementModel } from "@/lib/presentation/types";
import { TextRuns } from "./DeckText";
import { useDeckFontFamily } from "./StageContext";
import {
  fontTextStyle,
  frameStyle,
  textOverflowStyle,
  transformCss,
  type RenderMode,
} from "./style";

/** The fork's `readListRuns`, narrowed to run arrays and plain values. */
function normalizeListItems(item: unknown): unknown[] {
  if (Array.isArray(item)) return item;
  if (typeof item === "string") return [item];
  if (typeof item === "object" && item !== null) {
    const record = item as { runs?: unknown; text?: unknown };
    if (Array.isArray(record.runs)) return record.runs;
    if (typeof record.text === "string") return [item];
  }
  return [];
}

export function TextListElement({
  element,
  mode,
}: {
  element: TextListElementModel;
  mode: RenderMode;
}) {
  const resolveFamily = useDeckFontFamily();
  const box = elementBox(element);
  const font = element.font ?? null;
  const marker = element.marker ?? null;
  const items = Array.isArray(element.items) ? element.items : [];
  const itemGap = Math.max(0, element.gap ?? 0);
  const markerGap =
    element.marker_gap == null ? null : Math.max(0, element.marker_gap);
  const usesCustomMarkers = marker !== "none" && markerGap !== null;
  const hidesNativeMarkers = marker === "none" || usesCustomMarkers;
  const ordered = marker === "number";

  const entries = items.map((item, index) => {
    const gapStyle = index > 0 && itemGap > 0 ? { marginTop: itemGap } : undefined;
    const runs = normalizeListItems(item);
    if (usesCustomMarkers) {
      return (
        <li
          key={index}
          style={{
            ...gapStyle,
            display: "grid",
            gridTemplateColumns: "max-content minmax(0,1fr)",
            columnGap: markerGap ?? 0,
            ...textOverflowStyle(),
          }}
        >
          <span aria-hidden="true">{ordered ? `${index + 1}.` : "•"}</span>
          <span>
            <TextRuns runs={runs} baseFont={font} />
          </span>
        </li>
      );
    }
    return (
      <li key={index} style={{ ...gapStyle, ...textOverflowStyle() }}>
        <TextRuns runs={runs} baseFont={font} />
      </li>
    );
  });

  const listStyle = {
    margin: 0,
    paddingLeft: hidesNativeMarkers ? 0 : 24,
    ...(hidesNativeMarkers ? { listStyleType: "none" as const } : {}),
  };

  return (
    <div
      style={{
        ...frameStyle(box, mode),
        ...transformCss(element.rotation),
        ...fontTextStyle(font, resolveFamily, { includeTextDecoration: false }),
        ...textOverflowStyle(),
      }}
    >
      {ordered ? (
        <ol style={listStyle}>{entries}</ol>
      ) : (
        <ul style={listStyle}>{entries}</ul>
      )}
    </div>
  );
}
