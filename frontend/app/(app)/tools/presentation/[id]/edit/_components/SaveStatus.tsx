"use client";

/**
 * The editor's save indicator (Task C4, spec §8.2: `MotionNotice` + inline
 * status word). Idle and saved are quiet inline words; a failure is a
 * `MotionNotice` with the sanitized copy and a retry control, so an error is
 * visible without ever stealing focus.
 */
import { RotateCcw } from "lucide-react";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { IconButton } from "@/components/ui/IconButton";
import type { SaveStatus as SaveStatusValue } from "./useDeckAutosave";

const LABELS: Record<SaveStatusValue, string> = {
  idle: "No changes yet",
  saving: "Saving…",
  saved: "Saved",
  error: "Couldn't save",
};

export function SaveStatus({
  status,
  error,
  onRetry,
}: {
  status: SaveStatusValue;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span
        data-save-status={status}
        aria-live="polite"
        className={`font-mono text-label-sm ${
          status === "error" ? "text-destructive" : "text-muted-foreground"
        }`}
      >
        {LABELS[status]}
      </span>
      {status === "error" && error !== null ? (
        <MotionNotice
          role="alert"
          className="flex max-w-[52ch] items-center gap-2 text-label-sm text-destructive"
        >
          <span className="min-w-0">{error}</span>
          <IconButton
            type="button"
            variant="ghost"
            size="xs"
            aria-label="Retry saving"
            onClick={onRetry}
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
          </IconButton>
        </MotionNotice>
      ) : null}
    </div>
  );
}

export type { SaveStatusValue };
