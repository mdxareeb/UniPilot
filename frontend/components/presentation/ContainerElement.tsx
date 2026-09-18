/**
 * Container-family elements (Task B3): `container`, `flex`, `grid` and `group`.
 *
 * All four are absolutely positioned frames; inside them:
 * - `container` is a flex frame for one child (absolute when the child carries
 *   a position, flow otherwise) with the fork's image-overflow rule;
 * - `flex` and `grid` position children with real CSS layout — direction,
 *   gap, align/justify and (for grid) the fork's column/row templates —
 *   children render in flow mode;
 * - `group` children position absolutely inside the group's frame.
 *
 * Chrome-free: fills/strokes/radii come from the wire only.
 */
import type { CSSProperties, ReactNode } from "react";
import {
  elementBox,
  flexFrameSize,
  gridColumnTemplate,
  gridRowTemplate,
} from "@/lib/presentation/elements";
import type {
  ContainerElement as ContainerElementModel,
  FlexElement as FlexElementModel,
  GridElement as GridElementModel,
  GroupElement as GroupElementModel,
  SlideElement,
} from "@/lib/presentation/types";
import { SlideElementView } from "./SlideElementView";
import {
  boxStyle,
  frameStyle,
  layoutAlignment,
  paddingCss,
  horizontalAlign,
  transformCss,
  verticalAlign,
  type RenderMode,
} from "./style";

type ElementProps<T> = { element: T; mode: RenderMode };

/** The fork's `containerOverflowStyle` default path (no `overflow` on the wire). */
function containerOverflow(
  container: ContainerElementModel,
  child: SlideElement | null,
): CSSProperties["overflow"] {
  if (!child || child.type !== "image") return "visible";
  if (child.position == null) return "visible";
  if (child.clip_path) return "hidden";
  const containerBox = elementBox(container);
  const childBox = elementBox(child);
  if (containerBox.width == null || containerBox.height == null) {
    return "visible";
  }
  const epsilon = 0.01;
  const overflows =
    childBox.x < -epsilon ||
    childBox.y < -epsilon ||
    (childBox.width != null &&
      childBox.x + childBox.width > containerBox.width + epsilon) ||
    (childBox.height != null &&
      childBox.y + childBox.height > containerBox.height + epsilon);
  return overflows ? "hidden" : "visible";
}

export function ContainerElement({ element, mode }: ElementProps<ContainerElementModel>) {
  const box = elementBox(element);
  const child = element.child ?? null;
  const positioned = child != null && child.position != null;
  return (
    <div
      style={{
        ...frameStyle(box, mode),
        ...boxStyle(element),
        ...(element.padding ? { padding: paddingCss(element.padding) } : {}),
        display: "flex",
        alignItems: verticalAlign(element.alignment?.vertical),
        justifyContent: horizontalAlign(element.alignment?.horizontal),
        overflow: containerOverflow(element, child),
      }}
    >
      {child ? (
        <SlideElementView element={child} mode={positioned ? "absolute" : "flow"} />
      ) : null}
    </div>
  );
}

export function FlexElement({ element, mode }: ElementProps<FlexElementModel>) {
  const box = { ...elementBox(element), ...flexFrameSize(element) };
  const gap = element.gap ?? 0;
  const rowGap = element.row_gap ?? gap;
  const columnGap = element.column_gap ?? gap;
  return (
    <div
      style={{
        ...frameStyle(box, mode),
        ...transformCss(element.rotation),
        display: "flex",
        flexDirection: element.direction === "row" ? "row" : "column",
        flexWrap: element.wrap ? "wrap" : "nowrap",
        alignItems: layoutAlignment(element.align_items, "stretch"),
        justifyContent: layoutAlignment(element.justify_content, "flex-start"),
        columnGap,
        rowGap,
        overflow: "visible",
      }}
    >
      {(Array.isArray(element.children) ? element.children : []).map(
        (child, index) => (
          <SlideElementView key={index} element={child} mode="flow" />
        ),
      )}
    </div>
  );
}

export function GridElement({ element, mode }: ElementProps<GridElementModel>) {
  const box = elementBox(element);
  const gap = element.gap ?? 0;
  const rowGap = element.row_gap ?? gap;
  const columnGap = element.column_gap ?? gap;
  return (
    <div
      style={{
        ...frameStyle(box, mode),
        ...transformCss(element.rotation),
        display: "grid",
        gridTemplateColumns: gridColumnTemplate(element),
        gridTemplateRows: gridRowTemplate(element) ?? undefined,
        alignItems: layoutAlignment(element.align_items, "stretch"),
        justifyItems: layoutAlignment(element.justify_items, "stretch"),
        columnGap,
        rowGap,
        overflow: "visible",
      }}
    >
      {(Array.isArray(element.children) ? element.children : []).map(
        (child, index) => (
          <SlideElementView key={index} element={child} mode="flow" />
        ),
      )}
    </div>
  );
}

export function GroupElement({ element, mode }: ElementProps<GroupElementModel>) {
  const box = elementBox(element);
  const children: ReactNode[] = (Array.isArray(element.children)
    ? element.children
    : []
  ).map((child, index) => (
    <SlideElementView key={index} element={child} mode="absolute" />
  ));
  return (
    <div
      style={{
        ...frameStyle(box, mode),
        ...transformCss(element.rotation),
        overflow: "visible",
      }}
    >
      {children}
    </div>
  );
}
