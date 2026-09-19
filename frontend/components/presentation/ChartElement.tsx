"use client";

/**
 * `chart` elements (Task B5, spec §6.6).
 *
 * A Chart.js canvas inside the element's frame. `chartConfig` (elements.ts,
 * pure) builds the configuration from the wire model; this component owns the
 * canvas lifecycle: registration, construction after mount and destruction on
 * cleanup.
 *
 * SSR: the canvas renders as a plain empty element on the server and during
 * the first hydration render — no chart exists until the effect runs, so
 * static markup (probes, thumbnails, tests) can never crash. `data-deck-chart`
 * and `data-deck-chart-state` make the lifecycle observable without test-only
 * behavior.
 *
 * Motion: Chart.js animations stay off (`animation: false` comes from
 * `chartConfig`). Deck charts are server-side *content*, not UniPilot UI
 * motion; animating them would add a second animation system next to the
 * shared Motion vocabulary (MOTION.md), which the prohibitions forbid. The
 * canvas is drawn once at the element frame's size and scales with the stage
 * transform, exactly like the fork's export renderer.
 *
 * Theme: the stage exposes the deck theme as CSS variables; here they are
 * resolved back into concrete colors (canvas cannot consume `var()`), so
 * charts without explicit `colors` use the theme's `graph_0…graph_9` roles.
 * The chart font stays the fork's stack (`Manrope, Arial, sans-serif`) — deck
 * fonts apply to stage text, not to canvas text, and no font is added to the
 * document.
 */
import { useEffect, useRef, useState } from "react";
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PieController,
  PointElement,
  PolarAreaController,
  RadarController,
  RadialLinearScale,
  ScatterController,
  Title,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { chartConfig, elementBox } from "@/lib/presentation/elements";
import type {
  ChartElement as ChartElementModel,
  DeckThemeColors,
} from "@/lib/presentation/types";
import { frameStyle, transformCss, type RenderMode } from "./style";

/**
 * Only the controllers, elements, scales and plugins the eleven wire chart
 * types use (spec §6.6). Registration is module-scope and idempotent; Chart.js
 * itself is DOM-free until an instance is constructed, which happens in the
 * effect below (never during SSR).
 */
Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  PieController,
  DoughnutController,
  PolarAreaController,
  RadarController,
  ScatterController,
  ArcElement,
  CategoryScale,
  LinearScale,
  RadialLinearScale,
  Filler,
  Legend,
  Title,
  ChartDataLabels,
);

/**
 * The deck theme's graph roles as concrete colors, read from the CSS variables
 * `DeckStage` sets on the stage container (`--deck-graph-0…9`). Returns `null`
 * when the stage carries no theme, letting `chartConfig` fall back to its
 * default palette.
 */
function stageGraphTheme(
  node: HTMLElement,
): { colors: Partial<DeckThemeColors> } | null {
  const styles = getComputedStyle(node);
  const read = (role: keyof DeckThemeColors): string | null =>
    styles.getPropertyValue(`--deck-${role.replace(/_/g, "-")}`).trim() || null;

  const graph = [
    read("graph_0"),
    read("graph_1"),
    read("graph_2"),
    read("graph_3"),
    read("graph_4"),
    read("graph_5"),
    read("graph_6"),
    read("graph_7"),
    read("graph_8"),
    read("graph_9"),
  ];
  if (graph.some((color) => color === null)) return null;

  const [
    graph_0,
    graph_1,
    graph_2,
    graph_3,
    graph_4,
    graph_5,
    graph_6,
    graph_7,
    graph_8,
    graph_9,
  ] = graph as string[];
  return {
    colors: {
      graph_0,
      graph_1,
      graph_2,
      graph_3,
      graph_4,
      graph_5,
      graph_6,
      graph_7,
      graph_8,
      graph_9,
    },
  };
}

export function ChartElement({
  element,
  mode,
}: {
  element: ChartElementModel;
  mode: RenderMode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);

  const box = elementBox(element);
  const width = Math.max(1, Math.round(box.width ?? 0));
  const height = Math.max(1, Math.round(box.height ?? 0));
  const chartType =
    typeof element.chart_type === "string" ? element.chart_type : "unknown";
  const chartName =
    typeof element.name === "string" && element.name !== ""
      ? element.name
      : undefined;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const chart = new Chart(canvas, chartConfig(element, stageGraphTheme(container)));
    setReady(true);
    return () => {
      chart.destroy();
      setReady(false);
    };
  }, [element, width, height]);

  return (
    <div
      ref={containerRef}
      data-deck-chart={chartType}
      data-deck-chart-name={chartName}
      data-deck-chart-state={ready ? "ready" : "pending"}
      style={{
        ...frameStyle(box, mode),
        ...transformCss(element.rotation),
        overflow: "hidden",
      }}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ display: "block", width: "100%", height: "100%" }}
      />
    </div>
  );
}
