/**
 * Style builders for the native presentation renderer (Task B3).
 *
 * The React counterparts of the fork's inline-style string builders
 * (`presenton-ui/lib/template-v2-json-to-html.ts`): same fields, same
 * defaults, but as `CSSProperties` for a React tree. Nothing here fetches or
 * measures; `elements.ts` owns the geometry math and these functions only
 * translate it (and the wire's style fields) into CSS.
 *
 * Chrome-free by design (spec §6.11): every rule produced here styles deck
 * content inside the fixed stage only.
 */
import type { CSSProperties } from "react";
import type { ElementBox } from "@/lib/presentation/elements";
import type {
  BorderRadius,
  DeckTheme,
  Fill,
  Font,
  HorizontalAlignment,
  LayoutAlignment,
  Padding,
  Shadow,
  Stroke,
  VerticalAlignment,
} from "@/lib/presentation/types";

/** Absolute element inside a component frame, or a flex/grid flow child. */
export type RenderMode = "absolute" | "flow";

/** The fork's `frameStyleFromBox`: absolute (`left/top`) or flow positioning. */
export function frameStyle(box: ElementBox, mode: RenderMode): CSSProperties {
  const style: CSSProperties = {
    boxSizing: "border-box",
    minWidth: 0,
    minHeight: 0,
    position: mode === "absolute" ? "absolute" : "relative",
  };
  if (mode === "flow") style.flexShrink = 0;
  if (mode === "absolute") {
    style.left = box.x;
    style.top = box.y;
  }
  if (box.width !== undefined) style.width = box.width;
  if (box.height !== undefined) style.height = box.height;
  return style;
}

/** The fork's `colorWithOpacity`: hex colors gain an `rgba` alpha below 1. */
export function colorWithOpacity(
  color: string | null | undefined,
  opacity?: number | null,
): string | undefined {
  if (typeof color !== "string" || color.trim() === "") return undefined;
  const normalized = color.trim();
  if (opacity == null || opacity >= 1 || normalized.toLowerCase() === "transparent") {
    return normalized;
  }
  const hex = normalized.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return normalized;
  const value = Number.parseInt(hex, 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${Math.max(0, opacity)})`;
}

/** The fork's `borderRadiusStyle`: each corner defaults to the top-left one. */
export function borderRadiusCss(
  radius: BorderRadius | null | undefined,
): string | undefined {
  if (typeof radius !== "object" || radius === null) return undefined;
  const tl = radius.tl ?? 0;
  const tr = radius.tr ?? tl;
  const br = radius.br ?? tl;
  const bl = radius.bl ?? tl;
  return tl || tr || br || bl
    ? `${tl}px ${tr}px ${br}px ${bl}px`
    : undefined;
}

/** The fork's `shadowCssValue`: `x y blur color`, or nothing at opacity 0. */
export function shadowCss(shadow: Shadow | null | undefined): string | undefined {
  if (typeof shadow !== "object" || shadow === null) return undefined;
  if (Object.keys(shadow).length === 0) return undefined;
  const opacity = shadow.opacity ?? 1;
  if (opacity <= 0) return undefined;
  const color = colorWithOpacity(shadow.color ?? "#000000", opacity);
  if (!color || color === "transparent") return undefined;
  return `${shadow.offset_x ?? 0}px ${shadow.offset_y ?? 0}px ${shadow.blur ?? 0}px ${color}`;
}

/** The fork's `transformStyle`: rotation and flips about the center. */
export function transformCss(
  rotation?: number | null,
  flipH?: boolean | null,
  flipV?: boolean | null,
): CSSProperties {
  const transforms: string[] = [];
  if (rotation) transforms.push(`rotate(${rotation}deg)`);
  if (flipH) transforms.push("scaleX(-1)");
  if (flipV) transforms.push("scaleY(-1)");
  return transforms.length
    ? { transform: transforms.join(" "), transformOrigin: "center" }
    : {};
}

type BoxStyledElement = {
  fill?: Fill | null;
  stroke?: Stroke | null;
  border_radius?: BorderRadius | null;
  shadow?: Shadow | null;
  opacity?: number | null;
  rotation?: number | null;
  flip_h?: boolean | null;
  flip_v?: boolean | null;
};

/** The fork's `boxStyle`: fill, border, radius, shadow, opacity, transform. */
export function boxStyle(element: BoxStyledElement): CSSProperties {
  const style: CSSProperties = {};
  const fillColor = colorWithOpacity(element.fill?.color, element.fill?.opacity);
  if (fillColor) style.backgroundColor = fillColor;
  const strokeColor = element.stroke?.color;
  const strokeWidth = element.stroke?.width;
  if (strokeColor != null || strokeWidth != null) {
    style.border = `${strokeWidth ?? 1}px solid ${
      colorWithOpacity(strokeColor, element.stroke?.opacity) ?? "transparent"
    }`;
  }
  const radius = borderRadiusCss(element.border_radius);
  if (radius) style.borderRadius = radius;
  const shadow = shadowCss(element.shadow);
  if (shadow) style.boxShadow = shadow;
  if (element.opacity != null) style.opacity = element.opacity;
  return {
    ...style,
    ...transformCss(element.rotation, element.flip_h, element.flip_v),
  };
}

export function paddingCss(padding: Padding | null | undefined): string | undefined {
  if (typeof padding !== "object" || padding === null) return undefined;
  return `${padding.top ?? 0}px ${padding.right ?? 0}px ${padding.bottom ?? 0}px ${padding.left ?? 0}px`;
}

/** One CSS font-family name, quoted (the fork's `escapeCssFont`). */
export function cssFamilyName(name: string): string {
  return `'${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

type FontStyleOptions = {
  includeLineHeight?: boolean;
  includeTextDecoration?: boolean;
};

/**
 * The fork's `fontStyle` for one run/block: colour (default `#111827`),
 * family (resolved through the deck font map), size, weight/style, line
 * height, letter spacing and underline. `resolveFamily` maps a wire family
 * name to its stage-scoped one; unmapped names pass through unchanged.
 */
export function fontTextStyle(
  font: Font | null | undefined,
  resolveFamily: (family: string) => string | null,
  options: FontStyleOptions = {},
): CSSProperties {
  const style: CSSProperties = {
    color: colorWithOpacity(font?.color ?? "#111827", font?.opacity) ?? "#111827",
  };
  const family = typeof font?.family === "string" ? font.family.trim() : "";
  if (family) style.fontFamily = cssFamilyName(resolveFamily(family) ?? family);
  if (font?.size != null) style.fontSize = font.size;
  if (font?.italic != null) style.fontStyle = font.italic ? "italic" : "normal";
  if (font?.bold != null) style.fontWeight = font.bold ? 700 : 400;
  if (options.includeLineHeight !== false && font?.line_height != null) {
    style.lineHeight = font.line_height;
  }
  if (font?.letter_spacing != null) style.letterSpacing = font.letter_spacing;
  if (options.includeTextDecoration !== false && font?.underline != null) {
    style.textDecoration = font.underline ? "underline" : "none";
  }
  return style;
}

export function textOverflowStyle(): CSSProperties {
  return {
    overflow: "visible",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };
}

/** The fork's `horizontalAlign` (a text box's flex justification). */
export function horizontalAlign(
  value: HorizontalAlignment | null | undefined,
): string {
  if (value === "center") return "center";
  if (value === "right") return "flex-end";
  return "flex-start";
}

/** The fork's `verticalAlign` (accepts the runtime-only `"center"` alias). */
export function verticalAlign(
  value: VerticalAlignment | "center" | null | undefined,
): string {
  if (value === "middle" || value === "center") return "center";
  if (value === "bottom") return "flex-end";
  return "flex-start";
}

/** The fork's `textAlign`. */
export function textAlign(
  value: HorizontalAlignment | null | undefined,
): "left" | "center" | "right" | "justify" {
  return value === "center" || value === "right" || value === "justify"
    ? value
    : "left";
}

/** The fork's `cssAlignment` for flex/grid alignment keywords. */
export function layoutAlignment(
  value: LayoutAlignment | null | undefined,
  fallback: string,
): string {
  return value === "flex-start" ||
    value === "flex-end" ||
    value === "center" ||
    value === "stretch"
    ? value
    : fallback;
}

/**
 * The fork's `normalizeCssClipPath`: accept only the five shape functions the
 * wire uses, normalize a double-quoted `path()` to single quotes and reject
 * anything that could not be a clip path.
 */
export function clipPathCss(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  let normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.toLowerCase() === "none") return undefined;
  const doubleQuoted = normalized.match(/^path\("([^"]*)"\)$/i);
  if (doubleQuoted) normalized = `path('${doubleQuoted[1]}')`;
  if (/[";{}<>\\]/.test(normalized)) return undefined;
  if (!/^[a-zA-Z0-9\s.,%()+\-_' ]+$/.test(normalized)) return undefined;
  const functionName = normalized.match(/^([a-z-]+)\(/i)?.[1]?.toLowerCase();
  if (
    !functionName ||
    !["path", "polygon", "circle", "ellipse", "inset"].includes(functionName) ||
    !normalized.endsWith(")")
  ) {
    return undefined;
  }
  if (functionName === "path" && !/^path\('[^']*'\)$/i.test(normalized)) {
    return undefined;
  }
  return normalized;
}

/**
 * The resolved theme as stage-scoped CSS variables (spec §6.8). Applied on the
 * stage container only; never on page chrome.
 */
export function themeCssVariables(theme: DeckTheme | null): Record<string, string> {
  if (!theme) return {};
  const colors = theme.colors;
  return {
    "--deck-primary": colors.primary,
    "--deck-background": colors.background,
    "--deck-card": colors.card,
    "--deck-stroke": colors.stroke,
    "--deck-background-text": colors.background_text,
    "--deck-primary-text": colors.primary_text,
    "--deck-graph-0": colors.graph_0,
    "--deck-graph-1": colors.graph_1,
    "--deck-graph-2": colors.graph_2,
    "--deck-graph-3": colors.graph_3,
    "--deck-graph-4": colors.graph_4,
    "--deck-graph-5": colors.graph_5,
    "--deck-graph-6": colors.graph_6,
    "--deck-graph-7": colors.graph_7,
    "--deck-graph-8": colors.graph_8,
    "--deck-graph-9": colors.graph_9,
  };
}
