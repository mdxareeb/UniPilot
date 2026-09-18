"use client";

/**
 * The native slide stage (Task B3, spec §6.3).
 *
 * A fixed 1280×720 absolutely-positioned tree. The wrapper owns the fitted
 * layout box (`fit-width` keeps a 16:9 box, `fit-screen` fills a sized parent,
 * a number is an explicit scale) and the stage applies `transform: scale(...)`.
 * Component frames are absolutely positioned at their `position`, elements
 * inside them per `elementBox` — the fork's coordinate model. Theme colors
 * become CSS variables and the theme text font becomes the stage's default
 * family; deck fonts load through `DeckFontFace` inside the stage only.
 *
 * Blank decks (`components: ""`) render the stage background and nothing else;
 * a missing slide renders the same honest blank.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  componentFrame,
  deckFontEntries,
  resolveDeckFontFamily,
  resolveDeckTheme,
} from "@/lib/presentation/elements";
import type {
  PresentationDeck,
  SlideComponent,
  SlideElement,
  SlideUi,
} from "@/lib/presentation/types";
import { DeckFontFace } from "./DeckFontFace";
import { SlideElementView } from "./SlideElementView";
import { DeckStageProvider } from "./StageContext";
import { cssFamilyName, frameStyle, themeCssVariables } from "./style";

export const DECK_STAGE_WIDTH = 1280;
export const DECK_STAGE_HEIGHT = 720;

export type DeckStageScale = "fit-width" | "fit-screen" | number;

type DeckStageProps = {
  deck: PresentationDeck;
  /** Presentation id for the owner-gated asset proxy. */
  id: string;
  slideIndex: number;
  scale?: DeckStageScale;
  /**
   * `false` (the default) renders a display-only stage: pointer events and
   * text selection pass through, which is what thumbnail rails want. `true`
   * leaves the stage interactive — text selectable, images draggable-not —
   * for the viewer/editor surfaces (C/D).
   */
  interactive?: boolean;
};

function slideUi(deck: PresentationDeck, slideIndex: number): SlideUi | null {
  const slides = Array.isArray(deck.slides) ? deck.slides : [];
  const ui = slides[slideIndex]?.ui;
  return typeof ui === "object" && ui !== null ? ui : null;
}

function ComponentFrame({ component }: { component: SlideComponent }) {
  const box = componentFrame(component);
  const elements = Array.isArray(component.elements) ? component.elements : [];
  return (
    <div style={{ ...frameStyle(box, "absolute"), overflow: "visible" }}>
      {elements.map((element, index) => (
        <SlideElementView key={index} element={element} mode="absolute" />
      ))}
    </div>
  );
}

export function DeckStage({
  deck,
  id,
  slideIndex,
  scale = "fit-width",
  interactive = false,
}: DeckStageProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [measuredScale, setMeasuredScale] = useState<number | null>(null);
  const isFit = typeof scale !== "number";
  const theme = useMemo(() => resolveDeckTheme(deck.theme), [deck.theme]);
  const fonts = useMemo(() => deckFontEntries(deck.fonts), [deck.fonts]);

  useEffect(() => {
    if (!isFit) return;
    const node = wrapperRef.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      const widthScale =
        rect.width > 0 ? rect.width / DECK_STAGE_WIDTH : null;
      const heightScale =
        rect.height > 0 ? rect.height / DECK_STAGE_HEIGHT : null;
      setMeasuredScale(
        scale === "fit-screen"
          ? Math.min(
              widthScale ?? heightScale ?? 1,
              heightScale ?? widthScale ?? 1,
            )
          : (widthScale ?? heightScale ?? 1),
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [isFit, scale]);

  const ui = slideUi(deck, slideIndex);
  const components = Array.isArray(ui?.components) ? ui.components : [];
  const rootElements = Array.isArray(ui?.elements)
    ? (ui.elements as SlideElement[])
    : [];
  const background =
    typeof ui?.background === "string" && ui.background.trim()
      ? ui.background
      : (theme?.colors.background ?? "#FFFFFF");
  const themeFont = resolveDeckFontFamily(
    theme && typeof theme.fonts?.textFont?.name === "string"
      ? theme.fonts.textFont.name
      : null,
    fonts,
  );

  const effectiveScale = isFit
    ? measuredScale
    : Math.max(0, scale as number);
  const wrapperStyle: CSSProperties = isFit
    ? scale === "fit-screen"
      ? { position: "relative", width: "100%", height: "100%", overflow: "hidden" }
      : {
          position: "relative",
          width: "100%",
          aspectRatio: "16 / 9",
          overflow: "hidden",
        }
    : {
        position: "relative",
        width: DECK_STAGE_WIDTH * (effectiveScale ?? 0),
        height: DECK_STAGE_HEIGHT * (effectiveScale ?? 0),
        overflow: "hidden",
      };
  const stageStyle = {
    position: "absolute",
    left: 0,
    top: 0,
    width: DECK_STAGE_WIDTH,
    height: DECK_STAGE_HEIGHT,
    overflow: "hidden",
    transform: `scale(${effectiveScale ?? 1})`,
    transformOrigin: "top left",
    background,
    fontFamily: themeFont
      ? `${cssFamilyName(themeFont)}, Arial, Helvetica, sans-serif`
      : "Arial, Helvetica, sans-serif",
    pointerEvents: interactive ? undefined : "none",
    userSelect: interactive ? undefined : "none",
    visibility: isFit && effectiveScale === null ? "hidden" : "visible",
    ...themeCssVariables(theme),
  } as CSSProperties;

  return (
    <div ref={wrapperRef} data-deck-stage-wrapper="true" style={wrapperStyle}>
      <div
        role="group"
        aria-label={`Slide ${slideIndex + 1}`}
        data-deck-stage="true"
        data-slide-index={slideIndex}
        style={stageStyle}
      >
        <DeckFontFace id={id} fonts={deck.fonts} />
        <DeckStageProvider id={id} fonts={fonts}>
          {rootElements.map((element, index) => (
            <SlideElementView key={`root-${index}`} element={element} mode="absolute" />
          ))}
          {components.map((component, index) => (
            <ComponentFrame
              key={typeof component.id === "string" ? component.id : index}
              component={component}
            />
          ))}
        </DeckStageProvider>
      </div>
    </div>
  );
}
