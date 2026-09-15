"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence } from "motion/react";
import { MotionListItem } from "@/components/motion/MotionListItem";
import {
  WHATSAPP_MESSAGE_CAP,
  type WhatsAppRunItem,
} from "@/lib/data/integrationValues";

const MODE_LABELS = { export: "Export", live: "Live" } as const;

/* The capped run's stored `error` is writer text and is never rendered; the
   truncation sentence stands in for it. */
const TRUNCATION_NOTE = `Only the first ${WHATSAPP_MESSAGE_CAP.toLocaleString(
  "en-US",
)} messages were scanned.`;

/* P9.1 — an upload only queues the job; the Task 29.1 worker scans it, so a
   queued run means the worker is not running. The exact copy keeps the status
   word "Queued" out of the sentence: existing selectors match it uniquely. */
const QUEUED_WORKER_NOTE =
  "Waiting for the background worker to pick this scan up.";

/**
 * The scans history (P5.1): one `MotionListItem` per run, newest first, showing
 * the date, the mode word, the status word (`Queued` / `Scanning` / `Done` /
 * `Failed`), the message/candidate counts and either the truncation sentence
 * (`capped`) or the sanitized stored error for a failure. Task 46.21 prefixes
 * the counts line with the run's review-mode word, so each scan is explicit
 * about whether it waited for review. The hidden live region announces status
 * changes the 3 s poll brings in, mirroring `DocumentsHub`'s announcement
 * channel — visible content never depends on it. P9.1 adds one static line
 * under the list while any run is still `queued`: the scan is waiting for the
 * worker, not for the app.
 */
export function RunHistory({ runs }: { runs: WhatsAppRunItem[] }) {
  const announcementRef = useRef<HTMLParagraphElement>(null);
  const statusesRef = useRef(
    new Map(runs.map((run) => [run.id, run.statusValue])),
  );
  const hasQueuedRun = runs.some((run) => run.statusValue === "queued");

  useEffect(() => {
    const messages: string[] = [];
    for (const run of runs) {
      const previous = statusesRef.current.get(run.id);
      if (previous !== undefined && previous !== run.statusValue) {
        if (run.statusValue === "running") messages.push("Scan started.");
        else if (run.statusValue === "succeeded") messages.push("Scan finished.");
        else if (run.statusValue === "failed") messages.push("Scan failed.");
      }
      statusesRef.current.set(run.id, run.statusValue);
    }
    if (messages.length > 0 && announcementRef.current) {
      announcementRef.current.textContent = messages.join(" ");
    }
  }, [runs]);

  return (
    <section aria-label="Scans" className="flex min-w-0 flex-col gap-2">
      <h3 className="font-mono text-label-caps uppercase text-muted-foreground">
        Scans
      </h3>

      {runs.length === 0 ? (
        <p className="rounded-base border border-dashed border-border bg-glass-subtle p-3 text-label-sm text-muted-foreground">
          No scans yet. Upload an export to scan your first chat.
        </p>
      ) : (
        <ul className="flex min-w-0 list-none flex-col gap-2">
          <AnimatePresence initial={false}>
            {runs.map((run) => (
              <MotionListItem
                key={run.id}
                className="flex min-w-0 flex-col gap-1 rounded-base border border-border bg-glass-subtle p-3"
              >
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="font-mono text-label-caps text-muted-foreground">
                    {run.dateLabel}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-label-caps uppercase text-muted-foreground">
                      {MODE_LABELS[run.mode]}
                    </span>
                    <span
                      className={`text-label-sm font-semibold ${
                        run.statusValue === "failed"
                          ? "text-destructive"
                          : "text-foreground"
                      }`}
                    >
                      {run.statusLabel}
                    </span>
                  </span>
                </div>
                <p className="text-label-sm text-muted-foreground">
                  {run.reviewModeLabel} · {run.messageCount} messages ·{" "}
                  {run.candidateCount} suggestions
                  {run.chatName ? ` · ${run.chatName}` : ""}
                </p>
                {run.capped ? (
                  <p className="text-label-sm text-muted-foreground">
                    {TRUNCATION_NOTE}
                  </p>
                ) : run.error ? (
                  <p className="text-label-sm text-destructive">{run.error}</p>
                ) : null}
              </MotionListItem>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {hasQueuedRun ? (
        <p className="font-mono text-label-caps text-muted-foreground">
          {QUEUED_WORKER_NOTE}
        </p>
      ) : null}

      <p
        ref={announcementRef}
        role="status"
        aria-live="polite"
        className="sr-only"
      />
    </section>
  );
}
