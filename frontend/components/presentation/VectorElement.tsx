/**
 * `vector` elements (Task B3, spec §6.5).
 *
 * The fork's `renderPolygon`/`renderEllipseVector`: the frame comes from the
 * sampled points (`vectorGeometry`), the SVG viewBox is that box in local
 * coordinates, closed shapes fill and stroke while open polylines only stroke
 * (defaulting to black like the reference), and `dash` becomes
 * `stroke-dasharray`. The element `shadow` renders as an SVG drop-shadow (the
 * fork ignores vector shadows — recorded), and markers are not implemented yet
 * (recorded as a gap; no fake arrows).
 */
import type { CSSProperties } from "react";
import { vectorGeometry } from "@/lib/presentation/elements";
import type { VectorElement as VectorElementModel } from "@/lib/presentation/types";
import {
  colorWithOpacity,
  frameStyle,
  transformCss,
  type RenderMode,
} from "./style";

function dropShadow(element: VectorElementModel): string | undefined {
  const shadow = element.shadow;
  if (typeof shadow !== "object" || shadow === null) return undefined;
  const opacity = shadow.opacity ?? 1;
  if (opacity <= 0) return undefined;
  const color = colorWithOpacity(shadow.color ?? "#000000", opacity);
  if (!color || color === "transparent") return undefined;
  return `drop-shadow(${shadow.offset_x ?? 0}px ${shadow.offset_y ?? 0}px ${
    shadow.blur ?? 0
  }px ${color})`;
}

export function VectorElement({
  element,
  mode,
}: {
  element: VectorElementModel;
  mode: RenderMode;
}) {
  const geometry = vectorGeometry(element);
  if (geometry.points.length < 2) return null;

  const { box, closed, shape, points } = geometry;
  const fillColor = closed
    ? colorWithOpacity(element.fill?.color, element.fill?.opacity)
    : undefined;
  const strokeColor = colorWithOpacity(
    element.stroke?.color ?? (closed ? null : "#000000"),
    element.stroke?.opacity,
  );
  const strokeWidth = Math.max(0, element.stroke?.width ?? 1);
  const hasStroke = Boolean(strokeColor && strokeWidth > 0);
  if (!fillColor && !hasStroke) return null;

  const dash = (Array.isArray(element.stroke?.dash) ? element.stroke?.dash : [])
    .filter((value) => typeof value === "number" && Number.isFinite(value))
    .join(" ");
  const localPoints = points
    .map((point) => `${point.x - box.x},${point.y - box.y}`)
    .join(" ");
  const shadow = dropShadow(element);
  const wrapperStyle: CSSProperties = {
    ...frameStyle(box, mode),
    ...transformCss(element.rotation),
    overflow: "visible",
    ...(element.opacity != null ? { opacity: element.opacity } : {}),
    ...(shadow ? { filter: shadow } : {}),
  };
  const shapeProps = {
    fill: fillColor ?? "none",
    stroke: hasStroke ? strokeColor : undefined,
    strokeWidth: hasStroke ? strokeWidth : undefined,
    strokeDasharray: dash || undefined,
  };

  return (
    <div style={wrapperStyle}>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${box.width} ${box.height}`}
        preserveAspectRatio="none"
        style={{ display: "block", overflow: "visible" }}
      >
        {shape === "ellipse" ? (
          <ellipse
            cx={box.width / 2}
            cy={box.height / 2}
            rx={box.width / 2}
            ry={box.height / 2}
            {...shapeProps}
          />
        ) : closed ? (
          <polygon points={localPoints} {...shapeProps} />
        ) : (
          <polyline points={localPoints} {...shapeProps} />
        )}
      </svg>
    </div>
  );
}
