"use client";

/**
 * The run-formatting toolbar (Task D2, spec §5.4 "Inline text", §8.2 "Element
 * toolbars": `MotionPopover` + `IconButton` + `Select` + `Input`).
 *
 * One trigger sits in the stage's control row; the panel is portalled with
 * fixed positioning computed from the trigger (the editor surface is itself a
 * `backdrop-blur` glass card, where a nested backdrop filter cannot sample the
 * page). Every run property the wire can carry per run is here — family, size,
 * bold, italic, underline, colour, opacity, letter spacing, line height — plus
 * the element-level alignment, labelled as such because the wire stores it on
 * the element, not on a run.
 *
 * Honest states: with no selection the run controls are disabled and the
 * reason is printed; a range entirely inside a LaTeX run is not formattable
 * (the run renders as raw source) and says so. Alignment stays available
 * without a selection because it is not a run property.
 *
 * The text/number fields are uncontrolled and remount on `resetKey` (the
 * selection identity), so a formatting commit never rewrites the field the
 * user is typing in while moving the selection still shows fresh values.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bold, Italic, Type, Underline } from "lucide-react";
import { MotionPopover } from "@/components/motion/MotionPopover";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { RunFontKey, RunFontPatch } from "@/lib/presentation/textRuns";
import type { Font, HorizontalAlignment } from "@/lib/presentation/types";

export type RunFormatToolbarProps = {
  /** The effective font at the selection (or the element's, when none). */
  font: Font;
  /** Whether a text element is selected at all (the trigger's own gate). */
  enabled: boolean;
  /** Whether the current range can receive run formatting. */
  canFormatRuns: boolean;
  /** The honest reason the run controls are disabled, when they are. */
  disabledReason: string | null;
  onPatchFont: (patch: RunFontPatch) => void;
  onToggle: (key: RunFontKey) => void;
  alignment: HorizontalAlignment;
  onAlignmentChange: (value: HorizontalAlignment) => void;
  familyOptions: Array<{ value: string; label: string }>;
  /** Changes only when the formatted target changes (element + selection). */
  resetKey: string;
};

const PANEL_WIDTH = 320;

const ALIGNMENT_OPTIONS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
  { value: "justify", label: "Justify" },
] as const;

/** `#rgb`, `#rrggbb` and `rgb()/rgba()` are the colours the wire carries. */
const COLOR_PATTERN =
  /^(?:#[0-9a-f]{3}|#[0-9a-f]{6}|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+\s*)?\))$/i;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-label-sm text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/**
 * Commits a numeric field's text: empty clears the property, a finite number
 * patches it, anything else is left alone (the honest invalid state).
 */
function commitNumber(
  value: string,
  apply: (parsed: number) => void,
  clear: () => void,
): void {
  if (value.trim() === "") {
    clear();
    return;
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed)) apply(parsed);
}

export function RunFormatToolbar({
  font,
  enabled,
  canFormatRuns,
  disabledReason,
  onPatchFont,
  onToggle,
  alignment,
  onAlignmentChange,
  familyOptions,
  resetKey,
}: RunFormatToolbarProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties | null>(null);

  const computePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: Math.max(
        8,
        Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8),
      ),
      bottom: window.innerHeight - rect.top + 8,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const update = () => computePosition();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [computePosition, open]);

  const runControlDisabled = !canFormatRuns;

  return (
    <div className="relative">
      <IconButton
        ref={triggerRef}
        type="button"
        variant="outline"
        size="sm"
        aria-label="Format text"
        aria-expanded={open}
        data-editor-format-toggle=""
        disabled={!enabled}
        onClick={() => {
          if (!open) computePosition();
          setOpen((current) => !current);
        }}
      >
        <Type aria-hidden="true" className="size-4" />
      </IconButton>
      {typeof document === "undefined"
        ? null
        : createPortal(
            <MotionPopover
              open={open}
              direction="up"
              className="fixed z-50"
              style={position ?? { left: -9999, bottom: -9999 }}
            >
              <div
                key={resetKey}
                data-editor-run-toolbar=""
                role="toolbar"
                aria-label="Run formatting"
                className="flex w-80 flex-col gap-3 rounded-card border border-border bg-glass p-3 shadow-overlay backdrop-blur-md"
              >
                <div className="flex items-center gap-1">
                  <IconButton
                    type="button"
                    variant={font.bold === true ? "primary" : "outline"}
                    size="sm"
                    aria-label="Bold"
                    aria-pressed={font.bold === true}
                    data-editor-run-bold=""
                    disabled={runControlDisabled}
                    onClick={() => onToggle("bold")}
                  >
                    <Bold aria-hidden="true" className="size-4" />
                  </IconButton>
                  <IconButton
                    type="button"
                    variant={font.italic === true ? "primary" : "outline"}
                    size="sm"
                    aria-label="Italic"
                    aria-pressed={font.italic === true}
                    data-editor-run-italic=""
                    disabled={runControlDisabled}
                    onClick={() => onToggle("italic")}
                  >
                    <Italic aria-hidden="true" className="size-4" />
                  </IconButton>
                  <IconButton
                    type="button"
                    variant={font.underline === true ? "primary" : "outline"}
                    size="sm"
                    aria-label="Underline"
                    aria-pressed={font.underline === true}
                    data-editor-run-underline=""
                    disabled={runControlDisabled}
                    onClick={() => onToggle("underline")}
                  >
                    <Underline aria-hidden="true" className="size-4" />
                  </IconButton>
                </div>

                <div className="flex items-end gap-2">
                  <Field label="Font">
                    <div data-editor-run-family="">
                      <Select
                        size="sm"
                        value={font.family ?? ""}
                        onChange={(value) =>
                          onPatchFont({ family: value === "" ? null : value })
                        }
                        options={familyOptions}
                        disabled={runControlDisabled}
                        aria-label="Run font family"
                      />
                    </div>
                  </Field>
                  <Field label="Size">
                    <Input
                      type="number"
                      size="sm"
                      inputMode="decimal"
                      min={1}
                      step={1}
                      defaultValue={font.size != null ? String(font.size) : ""}
                      data-editor-run-size=""
                      aria-label="Run font size"
                      disabled={runControlDisabled}
                      onChange={(event) =>
                        commitNumber(
                          event.target.value,
                          (size) => onPatchFont({ size }),
                          () => onPatchFont({ size: null }),
                        )
                      }
                    />
                  </Field>
                </div>

                <div className="flex items-end gap-2">
                  <Field label="Colour">
                    <Input
                      type="text"
                      size="sm"
                      spellCheck={false}
                      placeholder="#111827"
                      defaultValue={font.color ?? ""}
                      data-editor-run-color=""
                      aria-label="Run font colour"
                      disabled={runControlDisabled}
                      onChange={(event) => {
                        const value = event.target.value.trim();
                        if (value === "") onPatchFont({ color: null });
                        else if (COLOR_PATTERN.test(value)) {
                          onPatchFont({ color: value });
                        }
                      }}
                    />
                  </Field>
                  <Field label="Opacity">
                    <Input
                      type="number"
                      size="sm"
                      inputMode="decimal"
                      min={0}
                      max={1}
                      step={0.05}
                      defaultValue={
                        font.opacity != null ? String(font.opacity) : ""
                      }
                      data-editor-run-opacity=""
                      aria-label="Run opacity"
                      disabled={runControlDisabled}
                      onChange={(event) =>
                        commitNumber(
                          event.target.value,
                          (opacity) =>
                            onPatchFont({
                              opacity: Math.max(0, Math.min(1, opacity)),
                            }),
                          () => onPatchFont({ opacity: null }),
                        )
                      }
                    />
                  </Field>
                </div>

                <div className="flex items-end gap-2">
                  <Field label="Letter spacing">
                    <Input
                      type="number"
                      size="sm"
                      inputMode="decimal"
                      step={0.5}
                      defaultValue={
                        font.letter_spacing != null
                          ? String(font.letter_spacing)
                          : ""
                      }
                      data-editor-run-letter-spacing=""
                      aria-label="Run letter spacing"
                      disabled={runControlDisabled}
                      onChange={(event) =>
                        commitNumber(
                          event.target.value,
                          (letterSpacing) =>
                            onPatchFont({ letter_spacing: letterSpacing }),
                          () => onPatchFont({ letter_spacing: null }),
                        )
                      }
                    />
                  </Field>
                  <Field label="Line height">
                    <Input
                      type="number"
                      size="sm"
                      inputMode="decimal"
                      min={0.1}
                      step={0.1}
                      defaultValue={
                        font.line_height != null
                          ? String(font.line_height)
                          : ""
                      }
                      data-editor-run-line-height=""
                      aria-label="Run line height"
                      disabled={runControlDisabled}
                      onChange={(event) =>
                        commitNumber(
                          event.target.value,
                          (lineHeight) =>
                            onPatchFont({ line_height: lineHeight }),
                          () => onPatchFont({ line_height: null }),
                        )
                      }
                    />
                  </Field>
                </div>

                <Field label="Alignment (whole box)">
                  <div data-editor-run-align="">
                    <Select
                      size="sm"
                      value={alignment}
                      onChange={(value) =>
                        onAlignmentChange(value as HorizontalAlignment)
                      }
                      options={[...ALIGNMENT_OPTIONS]}
                      disabled={!enabled}
                      aria-label="Text alignment"
                    />
                  </div>
                </Field>

                {disabledReason !== null ? (
                  <p
                    data-editor-run-note=""
                    className="text-label-sm text-muted-foreground"
                  >
                    [!] {disabledReason}
                  </p>
                ) : null}
              </div>
            </MotionPopover>,
            document.body,
          )}
    </div>
  );
}
