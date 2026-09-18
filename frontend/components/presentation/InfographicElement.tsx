/**
 * `infographic` elements (Task B5, spec Â§6.7).
 *
 * Phase B renders exactly three types natively â€” `gauge`, `progress_bar` and
 * `vertical_funnel` â€” mirroring the fork's geometry and color semantics
 * (`presenton-ui/lib/template-v2-json-to-html.ts`, calibrated against the
 * served verdant template on 2026-09-16). Any other `data.type` keeps B3's
 * honest placeholder: the element frame stays, the copy says the type is not
 * rendered, and no fake chart is drawn. Nothing here touches the network or
 * the engine; values come from the wire and default rather than throw.
 *
 * Simplifications versus the fork, all recorded: the fork's legacy
 * `base_color`/`highlight_color`/`show_label` element-level fields are not
 * read (the engine's `Infographic` model does not carry them â€” verified in
 * `templates/v2/models/elements.py` and on the served template); the funnel's
 * fixed 720Ã—480 design surface is scaled through CSS (no per-icon offset
 * transforms, since the wire items we verified carry none).
 */
import {
  elementBox,
  gaugeArcPath,
  infographicBaseColor,
  infographicHighlightColor,
  infographicMetrics,
  infographicPalette,
  infographicRenderer,
  infographicTextColor,
  type ElementBox,
} from "@/lib/presentation/elements";
import type {
  GaugeInfographicData,
  InfographicElement as InfographicElementModel,
  ProgressBarInfographicData,
  VerticalFunnelInfographicData,
  VerticalFunnelItem,
} from "@/lib/presentation/types";
import { frameStyle, transformCss, type RenderMode } from "./style";

const INFOGRAPHIC_FONT_FAMILY = "Arial, Helvetica, sans-serif";

/** The fork's `readBox(item, fallbackSize)`: absent size reads as the design size. */
function frameBox(
  element: InfographicElementModel,
  fallback: { width: number; height: number },
): ElementBox {
  const box = elementBox(element);
  return {
    ...box,
    width: box.width ?? fallback.width,
    height: box.height ?? fallback.height,
  };
}

function infographicType(element: InfographicElementModel): string | null {
  const data: unknown = element.data;
  if (typeof data !== "object" || data === null) return null;
  const type = (data as { type?: unknown }).type;
  return typeof type === "string" ? type : null;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// ---------------------------------------------------------------------------
// gauge â€” the fork's `renderGaugeInfographic` (viewBox 120Ã—72)
// ---------------------------------------------------------------------------

const GAUGE_FALLBACK_SIZE = { width: 160, height: 96 };

function GaugeInfographic({
  element,
  mode,
}: {
  element: InfographicElementModel;
  mode: RenderMode;
}) {
  const data = element.data as GaugeInfographicData;
  const box = frameBox(element, GAUGE_FALLBACK_SIZE);
  const { ratio } = infographicMetrics(data);
  const base = infographicBaseColor(element);
  const highlight = infographicHighlightColor(element);

  return (
    <div
      data-deck-infographic="gauge"
      style={{
        ...frameStyle(box, mode),
        ...transformCss(element.rotation),
        overflow: "hidden",
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 120 72"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block" }}
      >
        <path
          d={gaugeArcPath(1)}
          fill="none"
          stroke={base}
          strokeWidth={12}
          strokeLinecap="round"
        />
        {ratio > 0 ? (
          <path
            d={gaugeArcPath(ratio)}
            fill="none"
            stroke={highlight}
            strokeWidth={12}
            strokeLinecap="round"
          />
        ) : null}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// progress_bar â€” the fork's `renderProgressBarInfographic`
// ---------------------------------------------------------------------------

const PROGRESS_BAR_FALLBACK_SIZE = { width: 180, height: 40 };

function ProgressBarInfographic({
  element,
  mode,
}: {
  element: InfographicElementModel;
  mode: RenderMode;
}) {
  const data = element.data as ProgressBarInfographicData;
  const box = frameBox(element, PROGRESS_BAR_FALLBACK_SIZE);
  const height = box.height ?? PROGRESS_BAR_FALLBACK_SIZE.height;
  const { ratio, label } = infographicMetrics(data);
  const base = infographicBaseColor(element);
  const highlight = infographicHighlightColor(element);
  const textColor = infographicTextColor(element, highlight);
  const barHeight = Math.max(6, Math.min(18, Math.round(height * 0.35)));
  const showLabel = height >= 28;

  return (
    <div
      data-deck-infographic="progress_bar"
      style={{
        ...frameStyle(box, mode),
        ...transformCss(element.rotation),
        display: "flex",
        flexDirection: "column",
        gap: 6,
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: barHeight,
          borderRadius: 999,
          background: base,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${ratio * 100}%`,
            borderRadius: "inherit",
            background: highlight,
          }}
        />
      </div>
      {showLabel ? (
        <div
          style={{
            color: textColor,
            fontSize: Math.max(10, Math.min(16, Math.round(height * 0.3))),
            fontWeight: 700,
            lineHeight: 1,
            textAlign: "right",
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// vertical_funnel â€” the fork's `renderVerticalFunnelInfographic`
// ---------------------------------------------------------------------------

/** The fork's `renderScaledInfographic` design surface. */
const FUNNEL_DESIGN = { width: 720, height: 480 };
const FUNNEL_TOP = 38;
const FUNNEL_BOTTOM = 38;
const FUNNEL_CENTER_X = 360;
const FUNNEL_MAX_WIDTH = 300;
const FUNNEL_MAX_STAGES = 8;

function funnelStageValue(stage: VerticalFunnelItem | undefined): number {
  return Math.min(100, Math.max(0, finiteNumber(stage?.value)));
}

function VerticalFunnelInfographic({
  element,
  mode,
}: {
  element: InfographicElementModel;
  mode: RenderMode;
}) {
  const data = element.data as VerticalFunnelInfographicData;
  const provided = Array.isArray(data.items)
    ? data.items.slice(0, FUNNEL_MAX_STAGES)
    : [];
  const stages: VerticalFunnelItem[] = provided.length
    ? provided
    : [{ value: 50, heading: "Stage" }];
  const box = frameBox(element, FUNNEL_DESIGN);
  const width = box.width ?? FUNNEL_DESIGN.width;
  const height = box.height ?? FUNNEL_DESIGN.height;
  const scale = Math.min(width / FUNNEL_DESIGN.width, height / FUNNEL_DESIGN.height);
  const offsetX = (width - FUNNEL_DESIGN.width * scale) / 2;
  const offsetY = (height - FUNNEL_DESIGN.height * scale) / 2;

  const palette = infographicPalette(element);
  const textColor = infographicTextColor(element, "#111111");
  const stageHeight =
    (FUNNEL_DESIGN.height - FUNNEL_TOP - FUNNEL_BOTTOM) / stages.length;
  const widthAt = (value: number) =>
    Math.max(4, (value / 100) * FUNNEL_MAX_WIDTH);
  const stageWidths = stages.map((stage) => widthAt(funnelStageValue(stage)));
  const bottomWidthAt = (index: number) =>
    stageWidths[Math.min(index + 1, stages.length - 1)];

  return (
    <div
      data-deck-infographic="vertical_funnel"
      style={{
        ...frameStyle(box, mode),
        ...transformCss(element.rotation),
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: offsetX,
          top: offsetY,
          width: FUNNEL_DESIGN.width,
          height: FUNNEL_DESIGN.height,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
        }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 720 480"
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, display: "block" }}
        >
          {stages.map((_, index) => {
            const y = FUNNEL_TOP + index * stageHeight;
            return (
              <line
                key={`guide-${index}`}
                x1={140}
                y1={y}
                x2={615}
                y2={y}
                stroke="#D1D5DB"
                strokeWidth={1}
              />
            );
          })}
          {stages.map((_, index) => {
            const y0 = FUNNEL_TOP + index * stageHeight;
            const y1 = y0 + stageHeight;
            const topWidth = stageWidths[index];
            const bottomWidth = bottomWidthAt(index);
            const points = [
              `${FUNNEL_CENTER_X - topWidth / 2},${y0}`,
              `${FUNNEL_CENTER_X + topWidth / 2},${y0}`,
              `${FUNNEL_CENTER_X + bottomWidth / 2},${y1}`,
              `${FUNNEL_CENTER_X - bottomWidth / 2},${y1}`,
            ].join(" ");
            return (
              <polygon
                key={`stage-${index}`}
                points={points}
                fill={palette[index % palette.length]}
              />
            );
          })}
        </svg>
        {stages.map((stage, index) => {
          const y = FUNNEL_TOP + index * stageHeight;
          const value = funnelStageValue(stage);
          return (
            <div key={`label-${index}`}>
              <div
                style={{
                  position: "absolute",
                  left: 18,
                  top: y - 12,
                  width: 185,
                  color: textColor,
                  fontFamily: INFOGRAPHIC_FONT_FAMILY,
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.1 }}>
                  {typeof stage.heading === "string" && stage.heading.trim()
                    ? stage.heading
                    : `Stage ${index + 1}`}
                </div>
                <div style={{ paddingTop: 5, fontSize: 10, lineHeight: 1.15 }}>
                  {typeof stage.description === "string" ? stage.description : ""}
                </div>
              </div>
              <div
                style={{
                  position: "absolute",
                  left: 628,
                  top: y - 12,
                  width: 74,
                  color: textColor,
                  fontFamily: INFOGRAPHIC_FONT_FAMILY,
                  fontSize: 15,
                  fontWeight: 700,
                  lineHeight: 1.1,
                }}
              >
                {`${value}%`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// honest placeholder â€” every other `data.type` (spec Â§6.7)
// ---------------------------------------------------------------------------

function InfographicPlaceholder({
  element,
  mode,
}: {
  element: InfographicElementModel;
  mode: RenderMode;
}) {
  return (
    <div
      data-deck-placeholder="infographic"
      data-infographic-type={infographicType(element) ?? "unknown"}
      style={{
        ...frameStyle(elementBox(element), mode),
        ...transformCss(element.rotation),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          fontFamily: INFOGRAPHIC_FONT_FAMILY,
          fontSize: 16,
          lineHeight: 1.3,
          color: "#6B7280",
          textAlign: "center",
          padding: "0 12px",
        }}
      >
        Infographic type not yet rendered
      </span>
    </div>
  );
}

export function InfographicElement({
  element,
  mode,
}: {
  element: InfographicElementModel;
  mode: RenderMode;
}) {
  const type = infographicType(element);
  switch (infographicRenderer(type ?? "")) {
    case "gauge":
      return <GaugeInfographic element={element} mode={mode} />;
    case "progress_bar":
      return <ProgressBarInfographic element={element} mode={mode} />;
    case "vertical_funnel":
      return <VerticalFunnelInfographic element={element} mode={mode} />;
    default:
      return <InfographicPlaceholder element={element} mode={mode} />;
  }
}
