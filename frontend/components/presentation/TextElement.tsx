/**
 * `text` elements (Task B3, spec §6.4).
 *
 * The element frame is a flex box that places the run block horizontally and
 * vertically per `alignment`, while `text-align` justifies the lines inside
 * it — the fork's `renderText` layout. Runs render through `TextRuns`, so
 * per-run font/color/size/weight/style/line-height/letter-spacing all apply.
 * The element `shadow` becomes `text-shadow`; `fill`/`stroke` are not applied
 * to text by the reference converter either (recorded as a gap).
 */
import { elementBox } from "@/lib/presentation/elements";
import type { TextElement as TextElementModel } from "@/lib/presentation/types";
import { TextRuns } from "./DeckText";
import { useDeckFontFamily } from "./StageContext";
import {
  fontTextStyle,
  frameStyle,
  horizontalAlign,
  shadowCss,
  textAlign,
  textOverflowStyle,
  transformCss,
  verticalAlign,
  type RenderMode,
} from "./style";

export function TextElement({
  element,
  mode,
}: {
  element: TextElementModel;
  mode: RenderMode;
}) {
  const resolveFamily = useDeckFontFamily();
  const box = elementBox(element);
  const font = element.font ?? null;
  const shadow = shadowCss(element.shadow);
  const style = {
    ...frameStyle(box, mode),
    ...transformCss(element.rotation),
    ...fontTextStyle(font, resolveFamily, {
      includeLineHeight: false,
      includeTextDecoration: false,
    }),
    ...(shadow ? { textShadow: shadow } : {}),
    display: "flex",
    alignItems: verticalAlign(element.alignment?.vertical),
    justifyContent: horizontalAlign(element.alignment?.horizontal),
    lineHeight: font?.line_height ?? 1.1,
    ...textOverflowStyle(),
    textAlign: textAlign(element.alignment?.horizontal),
  };

  return (
    <div style={style}>
      <span style={{ display: "block", width: "100%" }}>
        <TextRuns runs={element.runs} baseFont={font} />
      </span>
    </div>
  );
}
