/**
 * The element dispatcher (Task B3, extended in B5).
 *
 * Every element type renders natively: text, text-list, table, image, vector,
 * container/flex/grid/group, and — since B5 — real `chart` (Chart.js canvas)
 * and `infographic` (gauge, progress_bar, vertical_funnel; every other type
 * keeps the honest "Infographic type not yet rendered" placeholder, spec
 * §6.7).
 */
import type { SlideElement } from "@/lib/presentation/types";
import { ChartElement } from "./ChartElement";
import { ContainerElement, FlexElement, GridElement, GroupElement } from "./ContainerElement";
import { ImageElement } from "./ImageElement";
import { InfographicElement } from "./InfographicElement";
import { TableElement } from "./TableElement";
import { TextElement } from "./TextElement";
import { TextListElement } from "./TextListElement";
import { VectorElement } from "./VectorElement";
import type { RenderMode } from "./style";

export function SlideElementView({
  element,
  mode = "absolute",
}: {
  element: SlideElement;
  mode?: RenderMode;
}) {
  switch (element.type) {
    case "text":
      return <TextElement element={element} mode={mode} />;
    case "text-list":
      return <TextListElement element={element} mode={mode} />;
    case "table":
      return <TableElement element={element} mode={mode} />;
    case "image":
      return <ImageElement element={element} mode={mode} />;
    case "vector":
      return <VectorElement element={element} mode={mode} />;
    case "container":
      return <ContainerElement element={element} mode={mode} />;
    case "flex":
      return <FlexElement element={element} mode={mode} />;
    case "grid":
      return <GridElement element={element} mode={mode} />;
    case "group":
      return <GroupElement element={element} mode={mode} />;
    case "chart":
      return <ChartElement element={element} mode={mode} />;
    case "infographic":
      return <InfographicElement element={element} mode={mode} />;
    default:
      return null;
  }
}
