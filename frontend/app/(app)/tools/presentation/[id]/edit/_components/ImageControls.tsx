"use client";

/**
 * The image element's inspector controls (Task D3, spec §5.4 images row,
 * §8.2 element toolbars).
 *
 * Every control maps to one wire field on the element and commits through the
 * editor's single-slide `slide_update` path with the same autosave + undo as
 * every other edit:
 *
 * - fit          → `fit` (contain | cover | fill — the wire enum);
 * - crop         → `focus_x`/`focus_y` (0..100) and `crop_scale` (1..6);
 * - corner radius→ `border_radius` (one control writes all four corners);
 * - flips        → `flip_h`/`flip_v`;
 * - opacity      → `opacity` (the wire is 0..1; the field is 0..100).
 *
 * Number fields keep their own text while typing and commit on blur/Enter, so
 * a half-typed value never lands on the wire; the pure `imageOps` helpers
 * clamp what is committed to exactly what the renderer draws.
 *
 * The current `data` is shown as the source line; "Choose image" opens the
 * picker modal (search/generate/library/upload), which replaces `data` only.
 */
import { useState } from "react";
import { FlipHorizontal2, FlipVertical2, Images } from "lucide-react";
import { useDeferredImageSource } from "@/components/presentation/useDeferredImageSource";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { ImageCropPatch } from "@/lib/presentation/imageOps";
import type { ImageElement, ImageFit } from "@/lib/presentation/types";

export type ImageControlsProps = {
  element: ImageElement;
  /** The proxy/passthrough URL for the element's current source, when known. */
  source: string | null;
  onOpenPicker: () => void;
  onFitChange: (fit: ImageFit) => void;
  onCropChange: (patch: ImageCropPatch) => void;
  onBorderRadiusChange: (radius: number) => void;
  onFlip: (axis: "h" | "v") => void;
  onOpacityChange: (opacity: number) => void;
  /** Opens the icon picker; renders the icon block when the element is one. */
  onOpenIconPicker?: () => void;
  /** Writes the icon's recolor color (null clears it); D4, spec §6.5. */
  onIconColorChange?: (color: string | null) => void;
};

const FIT_OPTIONS = [
  { value: "contain", label: "Fit — contain" },
  { value: "cover", label: "Fill frame — cover" },
  { value: "fill", label: "Stretch — fill" },
] as const;

/** The color shapes the recolor UI commits (same vocabulary as run colors). */
const ICON_COLOR_PATTERN =
  /^(?:#[0-9a-f]{3}|#[0-9a-f]{6}|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+\s*)?\))$/i;

/**
 * The icon color field: commits a valid color on change, clears on empty and
 * reverts malformed text on blur — the value is the element's stored `color`,
 * so undo and reload read back into the field.
 */
function IconColorField({
  value,
  onCommit,
}: {
  value: string | null | undefined;
  onCommit: (color: string | null) => void;
}) {
  const committed = value ?? "";
  const [text, setText] = useState(committed);
  const [lastCommitted, setLastCommitted] = useState(committed);
  if (lastCommitted !== committed) {
    setLastCommitted(committed);
    setText(committed);
  }

  return (
    <Input
      id="editor-icon-color"
      data-editor-icon-color=""
      size="sm"
      type="text"
      spellCheck={false}
      maxLength={40}
      placeholder="#111827"
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const trimmed = next.trim();
        if (trimmed === "") onCommit(null);
        else if (ICON_COLOR_PATTERN.test(trimmed)) onCommit(trimmed);
      }}
      onBlur={() => {
        const trimmed = text.trim();
        if (trimmed !== "" && !ICON_COLOR_PATTERN.test(trimmed)) {
          setText(committed);
        }
      }}
    />
  );
}

/** A number input that commits on blur/Enter and reverts malformed text. */
function NumberField({
  id,
  value,
  min,
  max,
  step,
  onCommit,
  "data-editor-image-field": dataField,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (value: number) => void;
  "data-editor-image-field"?: string;
}) {
  const [text, setText] = useState(String(value));
  /* Adjust local text when the committed value changes externally (undo, a
     picker write): React's "derive state from props" render-time pattern, so
     no effect cascades a render. */
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setText(String(value));
  }

  /* Commit reads the input's live value, not the state from the last render:
     a blur can fire before React has flushed the change event's state update
     (Playwright fills focus-x then immediately focuses focus-y), and a stale
     `text` would write the old value back. */
  const commit = (raw: string) => {
    const parsed = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(parsed)) {
      setText(String(value));
      return;
    }
    const clamped = Math.min(Math.max(parsed, min), max);
    setText(String(clamped));
    onCommit(clamped);
  };

  return (
    <Input
      id={id}
      data-editor-image-field={dataField}
      size="sm"
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={(event) => commit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={htmlFor}
        className="text-label-sm font-medium text-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export function ImageControls({
  element,
  source,
  onOpenPicker,
  onFitChange,
  onCropChange,
  onBorderRadiusChange,
  onFlip,
  onOpacityChange,
  onOpenIconPicker,
  onIconColorChange,
}: ImageControlsProps) {
  const radius = element.border_radius?.tl ?? 0;
  const opacity = Math.round((element.opacity ?? 1) * 100);
  const isIcon = element.is_icon === true;
  /* The preview obeys the same insert quiet window as the stage images: a
     just-uploaded source is not requested before its slide save lands. */
  const previewDeferred = useDeferredImageSource(source, element.data);

  return (
    <div data-editor-image-controls="" className="flex flex-col gap-3">
      {isIcon && onOpenIconPicker !== undefined && onIconColorChange !== undefined ? (
        <div
          data-editor-icon-controls=""
          className="flex flex-col gap-3 rounded-nested border border-border bg-muted/40 p-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-label-sm font-medium text-foreground">
              Icon
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-editor-icon-picker-open=""
              onClick={onOpenIconPicker}
            >
              Choose icon
            </Button>
          </div>
          <Field label="Colour" htmlFor="editor-icon-color">
            <IconColorField
              value={element.color}
              onCommit={onIconColorChange}
            />
          </Field>
        </div>
      ) : null}
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-nested border border-border bg-muted"
        >
          {source !== null && !previewDeferred ? (
            /* eslint-disable-next-line @next/next/no-img-element -- engine bytes
               stream through the owner-gated asset proxy (spec §6.9). */
            <img
              alt=""
              src={source}
              className="size-full object-cover"
              draggable={false}
            />
          ) : (
            <Images aria-hidden="true" className="size-4 text-muted-foreground" />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p
            data-editor-image-source=""
            className="truncate font-mono text-label-sm text-muted-foreground"
            title={element.data}
          >
            {element.data}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-editor-image-picker-open=""
            onClick={onOpenPicker}
          >
            Choose image
          </Button>
        </div>
      </div>

      <Field label="Fit" htmlFor="editor-image-fit">
        <Select
          id="editor-image-fit"
          size="sm"
          value={element.fit ?? "contain"}
          onChange={(value) => onFitChange(value as ImageFit)}
          options={FIT_OPTIONS}
          aria-label="Image fit"
        />
      </Field>

      <div className="grid grid-cols-3 gap-1.5">
        <Field label="Focus X" htmlFor="editor-image-focus-x">
          <NumberField
            id="editor-image-focus-x"
            data-editor-image-field="focus-x"
            value={element.focus_x ?? 50}
            min={0}
            max={100}
            step={1}
            onCommit={(value) => onCropChange({ focusX: value })}
          />
        </Field>
        <Field label="Focus Y" htmlFor="editor-image-focus-y">
          <NumberField
            id="editor-image-focus-y"
            data-editor-image-field="focus-y"
            value={element.focus_y ?? 50}
            min={0}
            max={100}
            step={1}
            onCommit={(value) => onCropChange({ focusY: value })}
          />
        </Field>
        <Field label="Zoom" htmlFor="editor-image-crop-scale">
          <NumberField
            id="editor-image-crop-scale"
            data-editor-image-field="crop-scale"
            value={element.crop_scale ?? 1}
            min={1}
            max={6}
            step={0.5}
            onCommit={(value) => onCropChange({ cropScale: value })}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <Field label="Radius (all corners)" htmlFor="editor-image-radius">
          <NumberField
            id="editor-image-radius"
            data-editor-image-field="radius"
            value={radius}
            min={0}
            max={720}
            step={1}
            onCommit={onBorderRadiusChange}
          />
        </Field>
        <Field label="Opacity %" htmlFor="editor-image-opacity">
          <NumberField
            id="editor-image-opacity"
            data-editor-image-field="opacity"
            value={opacity}
            min={0}
            max={100}
            step={5}
            onCommit={(value) => onOpacityChange(value / 100)}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-label-sm font-medium text-foreground">
          Flip
        </span>
        <div className="flex items-center gap-1.5">
          <IconButton
            type="button"
            variant="outline"
            size="sm"
            aria-label="Flip horizontally"
            aria-pressed={element.flip_h === true}
            data-editor-image-flip-h=""
            onClick={() => onFlip("h")}
          >
            <FlipHorizontal2 aria-hidden="true" className="size-4" />
          </IconButton>
          <IconButton
            type="button"
            variant="outline"
            size="sm"
            aria-label="Flip vertically"
            aria-pressed={element.flip_v === true}
            data-editor-image-flip-v=""
            onClick={() => onFlip("v")}
          >
            <FlipVertical2 aria-hidden="true" className="size-4" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
