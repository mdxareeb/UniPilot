"use client";

/**
 * The editor's selection layer (Task D1, spec §8.2 "Slide/layer selection").
 *
 * A stage-coordinate overlay that, for every selected element, draws the
 * shared `MotionSelectionRing` around its live frame and — for the primary
 * selection — hosts `TransformHandles` and the inline text editor. Pointer
 * gestures are owned by the editor's stage box (a stable capture node):
 * unselected elements drag from their hit targets, the primary frame's
 * resize/rotate handles start their gestures here, and the stage routes every
 * move/up to the matching gesture.
 *
 * The layer renders inside the same `scale(fit)` box as `DeckStage`, so stage
 * coordinates map 1:1 with the stage's rendered pixels (spec §6.3).
 */
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { MotionSelectionRing } from "@/components/motion/MotionSelectionRing";
import type { ResizeHandle } from "@/lib/presentation/editorOps";
import type { SlideElement } from "@/lib/presentation/types";
import { TransformHandles } from "./TransformHandles";

export type SelectionOverlayFrame = {
  key: string;
  frame: { x: number; y: number; width: number; height: number };
  rotation: number;
  element: SlideElement;
  resizeEnabled: boolean;
};

export type SelectionLayerProps = {
  /** The fitted overlay's screen px per stage px. */
  scale: number;
  frames: SelectionOverlayFrame[];
  selection: string[];
  /** The primary (inspector-facing) selection key. */
  activeKey: string | null;
  /** True while a text element's inline editor is mounted for the primary frame. */
  editing: boolean;
  /** True while that editor actually holds focus (typing, not just selected). */
  typing: boolean;
  onResizeStart: (
    handle: ResizeHandle,
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  onRotateStart: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Starts the move gesture (frame surface or the labelled grab handle). */
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
  /** The inline text editor, when a text element is being edited. */
  children?: ReactNode;
};

export function SelectionLayer({
  scale,
  frames,
  selection,
  activeKey,
  editing,
  typing,
  onResizeStart,
  onRotateStart,
  onDragStart,
  children,
}: SelectionLayerProps) {
  const selected = new Set(selection);
  const visible = frames.filter((entry) => selected.has(entry.key));

  return (
    <div data-editor-selection-layer="" className="absolute inset-0">
      {visible.map((entry) => {
        const isActive = entry.key === activeKey;
        return (
          <div
            key={entry.key}
            data-editor-selection-frame={entry.key}
            style={{
              position: "absolute",
              left: entry.frame.x,
              top: entry.frame.y,
              width: entry.frame.width,
              height: entry.frame.height,
              pointerEvents: editing && isActive ? "auto" : "none",
            }}
          >
            <MotionSelectionRing
              layoutId={
                selection.length === 1
                  ? "deck-element-selection"
                  : `deck-element-selection-${entry.key}`
              }
              radiusClass="rounded-xs"
            />
            {isActive ? children : null}
            {/* The frame-body drag surface: an already-selected element stays
                draggable from anywhere inside its frame. Text elements are
                excluded while their inline editor owns the frame — their drag
                affordance is the labelled grab handle. */}
            {isActive && !editing ? (
              <div
                role="presentation"
                aria-label="Drag element"
                data-editor-frame-drag=""
                className="absolute inset-0"
                style={{
                  cursor: "move",
                  pointerEvents: "auto",
                  touchAction: "none",
                }}
                onPointerDown={(event) => onDragStart(event)}
              />
            ) : null}
            {isActive ? (
              <TransformHandles
                scale={scale}
                frameWidth={entry.frame.width}
                frameHeight={entry.frame.height}
                frameTop={entry.frame.y}
                rotation={entry.rotation}
                resizeEnabled={entry.resizeEnabled && !typing}
                /* Handles collapse to the grab affordance only while the
                   caret is live; a merely selected text element keeps its
                   full transform set. */
                editing={typing}
                onResizeStart={onResizeStart}
                onRotateStart={onRotateStart}
                onDragStart={onDragStart}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
