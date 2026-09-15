"use client";

import { useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { MotionListItem } from "@/components/motion/MotionListItem";
import { Button } from "@/components/ui/Button";
import { WHATSAPP_GOOGLE_PUSH_RETRY_NOTE } from "@/lib/data/integrationErrors";
import type { WhatsAppCandidateItem } from "@/lib/data/integrationValues";
import { RejectCandidateModal } from "./RejectCandidateModal";

/**
 * The review list (P5.1): only `pending` suggestions are rows, each titled by
 * the event itself with its profile-zone date/time, its sender in mono and the
 * message text clamped. `Add to calendar` confirms in place; `Dismiss` opens
 * the terminal confirmation. Reviewed rows settle out of the list through
 * `AnimatePresence`, and a mono summary counts what happened.
 *
 * P7.2 adds the settled half: a confirmed candidate stays visible as an
 * `Added` row with its push state — a mono `On Google Calendar` once the push
 * landed (real `pushed_at`), a mono `Syncing to Google Calendar` while the
 * confirm action's enqueue is still awaiting the refreshed render, or the
 * sanitized retry note when the last push failed. The raw provider text never
 * renders; only the constants own the copy.
 *
 * Focus discipline: a confirmed/dismissed row can disappear under the
 * keyboard, so after a successful action focus lands on the next pending
 * row's primary action (or the list itself when none remains). A failed
 * action leaves the row in place and focus untouched.
 */
export function CandidateList({
  candidates,
  onConfirm,
  onReject,
}: {
  candidates: WhatsAppCandidateItem[];
  onConfirm: (candidate: WhatsAppCandidateItem) => Promise<boolean>;
  onReject: (candidate: WhatsAppCandidateItem) => Promise<boolean>;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  /* The row a settlement removed, remembered until the dialog that owned the
     focus has actually closed (the native close restores focus itself, so the
     next-row focus has to land after it). */
  const removedFocusRef = useRef<string | null>(null);
  const [dismissing, setDismissing] =
    useState<WhatsAppCandidateItem | null>(null);
  const [busy, setBusy] = useState(false);

  const pending = candidates.filter(
    (candidate) => candidate.statusValue === "pending",
  );
  const confirmed = candidates.filter(
    (candidate) => candidate.statusValue === "confirmed",
  );
  const addedCount = confirmed.length;
  const dismissedCount = candidates.filter(
    (candidate) => candidate.statusValue === "rejected",
  ).length;

  function focusAfterRemoval(id: string) {
    /* Two frames: the first lets React commit the removal, the second lands
       after that paint. A failed action leaves the row in place, in which case
       the guard returns and focus is already where the user left it. */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const list = listRef.current;
        if (!list) return;
        if (list.querySelector(`[data-candidate-id="${id}"]`)) return;
        const next = list.querySelector<HTMLButtonElement>(
          '[data-candidate-action="add"]',
        );
        if (next) next.focus();
        else list.focus();
      });
    });
  }

  async function confirm(candidate: WhatsAppCandidateItem) {
    const ok = await onConfirm(candidate);
    if (ok) focusAfterRemoval(candidate.id);
  }

  async function dismiss() {
    if (!dismissing || busy) return;
    const candidate = dismissing;
    setBusy(true);
    const ok = await onReject(candidate);
    setBusy(false);
    if (ok) removedFocusRef.current = candidate.id;
    setDismissing(null);
  }

  if (pending.length === 0 && addedCount === 0 && dismissedCount === 0) {
    return null;
  }

  return (
    <section
      aria-label="Suggestions to review"
      className="flex min-w-0 flex-col gap-2"
    >
      <h3 className="font-mono text-label-caps uppercase text-muted-foreground">
        Review
      </h3>

      {pending.length === 0 ? (
        <p className="text-label-sm text-muted-foreground">
          Nothing left to review.
        </p>
      ) : (
        <ul
          ref={listRef}
          tabIndex={-1}
          className="flex min-w-0 list-none flex-col gap-2 outline-none"
        >
          <AnimatePresence initial={false}>
            {pending.map((candidate) => (
              <MotionListItem
                key={candidate.id}
                data-candidate-id={candidate.id}
                className="flex min-w-0 flex-col gap-2 rounded-base border border-border bg-glass-subtle p-3"
              >
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h4 className="min-w-0 text-label-sm font-semibold text-foreground">
                    {candidate.title}
                  </h4>
                  <span className="shrink-0 font-mono text-label-caps text-muted-foreground">
                    {candidate.dateLabel}
                    {candidate.timeLabel
                      ? ` · ${candidate.timeLabel}`
                      : " · All day"}
                  </span>
                </div>
                <p className="min-w-0 text-label-sm text-muted-foreground">
                  <span className="font-mono text-label-caps">
                    {candidate.messageSender}
                  </span>{" "}
                  <span className="line-clamp-2">{candidate.messageText}</span>
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-candidate-action="add"
                    onClick={() => void confirm(candidate)}
                  >
                    Add to calendar
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDismissing(candidate)}
                  >
                    Dismiss
                  </Button>
                </div>
              </MotionListItem>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {confirmed.length > 0 ? (
        <ul className="flex min-w-0 list-none flex-col gap-2">
          <AnimatePresence initial={false}>
            {confirmed.map((candidate) => (
              <MotionListItem
                key={candidate.id}
                data-confirmed-candidate-id={candidate.id}
                className="flex min-w-0 flex-col gap-1 rounded-base border border-border bg-glass-subtle p-3"
              >
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="min-w-0 text-label-sm font-semibold text-foreground">
                    {candidate.title}
                  </p>
                  <span className="shrink-0 font-mono text-label-caps text-muted-foreground">
                    {candidate.dateLabel}
                    {candidate.timeLabel
                      ? ` · ${candidate.timeLabel}`
                      : " · All day"}
                  </span>
                </div>
                <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 font-mono text-label-caps text-muted-foreground">
                  <span>{candidate.statusLabel}</span>
                  {candidate.pushed ? (
                    <span>· On Google Calendar</span>
                  ) : !candidate.pushFailed && candidate.pushing ? (
                    <span>· Syncing to Google Calendar</span>
                  ) : null}
                </p>
                {!candidate.pushed && candidate.pushFailed ? (
                  <p className="text-label-sm text-destructive">
                    {WHATSAPP_GOOGLE_PUSH_RETRY_NOTE}
                  </p>
                ) : null}
              </MotionListItem>
            ))}
          </AnimatePresence>
        </ul>
      ) : null}

      {addedCount > 0 || dismissedCount > 0 ? (
        <p className="font-mono text-label-caps text-muted-foreground">
          {addedCount} added · {dismissedCount} dismissed
        </p>
      ) : null}

      <RejectCandidateModal
        candidate={dismissing}
        busy={busy}
        onOpenChange={(open) => {
          if (open || busy) return;
          setDismissing(null);
          const id = removedFocusRef.current;
          removedFocusRef.current = null;
          if (id) focusAfterRemoval(id);
        }}
        onConfirm={() => void dismiss()}
      />
    </section>
  );
}
