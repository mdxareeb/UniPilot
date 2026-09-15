"use client";

import { useRef, useState, type DragEvent } from "react";
import { Upload } from "lucide-react";
import { useSignInPrompt } from "@/components/auth/SignInPromptProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  WHATSAPP_DATE_ORDER_LABELS,
  WHATSAPP_DATE_ORDERS,
  WHATSAPP_REVIEW_MODE_LABELS,
  WHATSAPP_REVIEW_MODES,
  type WhatsAppDateOrder,
  type WhatsAppReviewMode,
} from "@/lib/data/integrationValues";
import {
  WHATSAPP_AUTH_REASON,
  type WhatsAppUploadPhase,
} from "./IntegrationsWorkspace";

/* The one honest sentence each mode shows while it is selected. */
const REVIEW_MODE_SENTENCES: Record<WhatsAppReviewMode, string> = {
  manual: "Detected events wait for your review.",
  automatic:
    "Detected events are added to your calendar when the scan finishes.",
};

/* The helper the relative-dates checkbox explains itself with. */
const RELATIVE_DATES_HELP =
  "Only when the message also has a time or an academic keyword (submission, exam, deadline…).";

/**
 * The export drop target (P5.1; P5.2 pipeline states): a real button plus a
 * visually hidden file input, and the 18.x drag styling (`border-foreground`
 * while a file is over the card). The button and the drop both run the shared
 * guest gate before anything else, so a visitor without a session gets the
 * skippable prompt and no file dialog.
 *
 * Task 46.21 adds the review-mode choice: two native radios in an explicit
 * `radiogroup` (arrow-key selection comes free), defaulted by the workspace
 * from the connection's saved mode, with the selected mode's honest sentence
 * below. Task 46.26 adds the detection choices beside it: the same radiogroup
 * pattern for the ambiguous-date order and a native checkbox (with its
 * helper line) for the conservative weekday/relative detection. Every choice
 * travels with the upload payload; the server re-validates them at the
 * reserve boundary.
 *
 * The upload itself is `IntegrationsWorkspace`'s; this component renders the
 * pipeline's progress surface — the same "real byte progress" panel the
 * documents hub shows (`role="progressbar"` with `aria-valuenow`), with
 * `data-upload-phase` switching on the Card root.
 */
export function ExportDropzone({
  onUpload,
  phase,
  progress,
  pendingName,
  reviewMode,
  onReviewModeChange,
  dateOrder,
  onDateOrderChange,
  detectRelativeDates,
  onDetectRelativeDatesChange,
}: {
  onUpload: (file: File) => void;
  phase: WhatsAppUploadPhase;
  progress: number;
  pendingName: string | null;
  reviewMode: WhatsAppReviewMode;
  onReviewModeChange: (mode: WhatsAppReviewMode) => void;
  dateOrder: WhatsAppDateOrder;
  onDateOrderChange: (order: WhatsAppDateOrder) => void;
  detectRelativeDates: boolean;
  onDetectRelativeDatesChange: (value: boolean) => void;
}) {
  const { requireAuth } = useSignInPrompt();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function openPicker() {
    if (!requireAuth(WHATSAPP_AUTH_REASON)) return;
    inputRef.current?.click();
  }

  function receive(file: File | undefined) {
    if (!file) return;
    if (!requireAuth(WHATSAPP_AUTH_REASON)) return;
    onUpload(file);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    receive(event.dataTransfer.files?.[0]);
  }

  return (
    <Card
      variant="compact"
      data-upload-phase={phase}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`flex min-w-0 flex-col items-center gap-2 border border-dashed p-4 text-center transition-colors ${
        dragging ? "border-foreground bg-glass-strong" : "border-border bg-glass-subtle"
      }`}
    >
      <Upload aria-hidden="true" className="size-4 text-muted-foreground" />
      <Button type="button" variant="outline" size="sm" onClick={openPicker}>
        Upload a WhatsApp export
      </Button>
      <p className="text-label-sm text-muted-foreground">
        Drag a .txt export here, or use the button. Exports without media, up
        to 25 MB.
      </p>
      <div className="flex w-full min-w-0 flex-col gap-1.5 text-left">
        <p
          id="whatsapp-review-mode-label"
          className="text-label-sm font-medium text-foreground"
        >
          Review mode
        </p>
        <div
          role="radiogroup"
          aria-labelledby="whatsapp-review-mode-label"
          aria-describedby="whatsapp-review-mode-sentence"
          className="flex flex-col gap-2 sm:flex-row"
        >
          {WHATSAPP_REVIEW_MODES.map((mode) => (
            <label key={mode} className="min-w-0 sm:flex-1">
              <input
                type="radio"
                name="whatsapp-review-mode"
                value={mode}
                checked={reviewMode === mode}
                onChange={() => onReviewModeChange(mode)}
                className="peer sr-only"
              />
              <span className="flex min-h-9 cursor-pointer items-center justify-center rounded-base border border-border bg-card px-3 py-1.5 text-center text-label-sm text-foreground press-feedback hover:border-foreground hover:bg-muted peer-checked:border-foreground peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background">
                {WHATSAPP_REVIEW_MODE_LABELS[mode]}
              </span>
            </label>
          ))}
        </div>
        <p
          id="whatsapp-review-mode-sentence"
          className="text-label-sm text-muted-foreground"
        >
          {REVIEW_MODE_SENTENCES[reviewMode]}
        </p>
      </div>
      <div className="flex w-full min-w-0 flex-col gap-1.5 text-left">
        <p
          id="whatsapp-date-order-label"
          className="text-label-sm font-medium text-foreground"
        >
          Date order for ambiguous dates (9/10)
        </p>
        <div
          role="radiogroup"
          aria-labelledby="whatsapp-date-order-label"
          className="flex flex-col gap-2 sm:flex-row"
        >
          {WHATSAPP_DATE_ORDERS.map((order) => (
            <label key={order} className="min-w-0 sm:flex-1">
              <input
                type="radio"
                name="whatsapp-date-order"
                value={order}
                checked={dateOrder === order}
                onChange={() => onDateOrderChange(order)}
                className="peer sr-only"
              />
              <span className="flex min-h-9 cursor-pointer items-center justify-center rounded-base border border-border bg-card px-3 py-1.5 text-center text-label-sm text-foreground press-feedback hover:border-foreground hover:bg-muted peer-checked:border-foreground peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background">
                {WHATSAPP_DATE_ORDER_LABELS[order]}
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex w-full min-w-0 flex-col gap-2 text-left">
        <label className="flex items-center gap-2 text-label-sm text-foreground">
          <input
            type="checkbox"
            checked={detectRelativeDates}
            onChange={(event) =>
              onDetectRelativeDatesChange(event.target.checked)
            }
            aria-describedby="whatsapp-detect-relative-help"
            className="size-4 rounded-xs border-border accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
          Also detect weekday and relative dates
        </label>
        <p
          id="whatsapp-detect-relative-help"
          className="text-label-sm text-muted-foreground"
        >
          {RELATIVE_DATES_HELP}
        </p>
      </div>
      {phase === "uploading" ? (
        <div className="flex w-full min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-label-sm text-foreground">
              Uploading {pendingName ?? "export"}…
            </p>
            <span className="font-mono text-label-caps text-muted-foreground">
              {progress}%
            </span>
          </div>
          <div
            role="progressbar"
            aria-label={`Upload progress for ${pendingName ?? "export"}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            className="h-1 w-full overflow-hidden rounded-pill bg-muted"
          >
            <div
              className="h-1 rounded-pill bg-foreground transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept=".txt,text/plain"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          receive(file);
        }}
      />
    </Card>
  );
}
