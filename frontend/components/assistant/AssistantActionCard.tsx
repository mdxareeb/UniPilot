"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  confirmAssistantActionAction,
  rejectAssistantActionAction,
} from "@/lib/data/assistantActionActions";
import {
  ASSISTANT_ACTION_COPY,
  ASSISTANT_ACTION_OUTCOME_HREFS,
  ASSISTANT_ACTION_OUTCOME_LINK_LABELS,
  ASSISTANT_ACTION_STATUS_LABELS,
  ASSISTANT_ACTION_TYPE_LABELS,
  type AssistantActionItem,
  type AssistantActionMutationResult,
} from "@/lib/data/assistantValues";

type AssistantActionCardProps = {
  /** The proposal/its settled row, as the server read (or registration) returned it. */
  action: AssistantActionItem;
  /**
   * Called after a confirm/reject call returns (whatever its outcome), so the
   * surface can reconcile: `/assistant` refreshes its server read, the launcher
   * panel updates its local proposals list.
   */
  onSettled?: (result: AssistantActionMutationResult) => void;
};

/**
 * Task 27.6/27.7 — the confirmation card for one proposed action.
 *
 * The card is the only place a user's decision can run an action: it calls the
 * committed Server Actions (`confirmAssistantActionAction` /
 * `rejectAssistantActionAction`), and nothing here ever writes directly or
 * fabricates a result. Every state is the log's own:
 *
 *   proposed  → the label + `summarizeAssistantAction` copy (which says
 *               "Create …", never "Created …") and the Confirm/Reject controls;
 *   busy      → the same controls disabled with `aria-busy` on the card;
 *   succeeded → the created row's real label and a link to the surface that
 *               owns it (`/tasks`, `/calendar`, the presentations tool);
 *   rejected  → the shared `ASSISTANT_ACTION_COPY.REJECTED` line — nothing was
 *               created, and the log says so;
 *   failed    → the stored sanitized copy only (never a raw database error).
 *
 * A succeeded row whose stored result is unreadable (an impossible state
 * through the app) renders the `UNCERTAIN` copy and no "Created" badge, the
 * same honesty the executor/confirm answer with (T27-C review).
 *
 * A confirm/reject that returns no readable row (a deleted proposal, a lost
 * transport) shows the action's sanitized copy and leaves the controls
 * available: confirming a settled proposal is a no-op by 27.13, so retrying is
 * safe, and the catch-all copy is `UNCERTAIN` — it never claims the write did
 * not happen.
 *
 * State handling: the returned row from a call is authoritative and is shown
 * immediately; the `action` prop wins whenever the server read has moved past
 * `proposed` (a refresh from this or another tab), while a locally settled
 * card is not clobbered by a stale in-flight prop. The polite live region
 * announces every outcome.
 *
 * Motion: no animation of its own — the card is part of the bubble it was
 * rendered into, and the one entrance (the failure copy) reuses the shared
 * `MotionNotice`, which honours reduced motion.
 */
export function AssistantActionCard({
  action,
  onSettled,
}: AssistantActionCardProps) {
  const [current, setCurrent] = useState(action);
  const [snapshot, setSnapshot] = useState(action);
  const [busy, setBusy] = useState<"confirm" | "reject" | null>(null);
  /* A call that returned no readable row (NOT_FOUND / transport) shows its
     sanitized copy without inventing a status for the row. */
  const [failureCopy, setFailureCopy] = useState<string | null>(null);

  /* Derived-state adjustment (the repo's render-phase idiom): the server read
     is the authority once it carries a settled status; a stale `proposed` prop
     must not undo a local settle while the refresh is still landing. */
  if (action !== snapshot) {
    setSnapshot(action);
    if (action.status !== "proposed" || current.status === "proposed") {
      setCurrent(action);
    }
  }

  const run = async (decision: "confirm" | "reject") => {
    if (busy !== null) return;
    setBusy(decision);
    setFailureCopy(null);

    let result: AssistantActionMutationResult;
    try {
      result =
        decision === "confirm"
          ? await confirmAssistantActionAction(current.id)
          : await rejectAssistantActionAction(current.id);
    } catch {
      /* The call may have reached the executor before its response was lost. */
      result = { error: ASSISTANT_ACTION_COPY.UNCERTAIN, action: null };
    }

    if (result.action !== null) {
      setCurrent(result.action);
    } else if (result.error !== null) {
      setFailureCopy(result.error);
    }
    setBusy(null);
    onSettled?.(result);
  };

  const typeLabel = ASSISTANT_ACTION_TYPE_LABELS[current.type];
  const statusLabel = ASSISTANT_ACTION_STATUS_LABELS[current.status];
  const outcome = current.result;
  const createdCopy =
    outcome === null
      ? null
      : `Created ${
          outcome.kind === "task"
            ? "task"
            : outcome.kind === "event"
              ? "event"
              : "presentation"
        }: ${outcome.label}`;
  /* A succeeded row whose stored result is unreadable has no created block to
     render and no stored error to quote; the honest answer is the UNCERTAIN
     copy, and no "Created" badge may sit above it (T27-C review). */
  const unreadableOutcome = current.status === "succeeded" && outcome === null;
  const errorCopy =
    current.status === "failed"
      ? (current.error ?? failureCopy ?? ASSISTANT_ACTION_COPY.UNCERTAIN)
      : unreadableOutcome
        ? (failureCopy ?? ASSISTANT_ACTION_COPY.UNCERTAIN)
        : failureCopy;
  const showStatusBadge =
    current.status !== "proposed" && !unreadableOutcome;
  const announcement =
    createdCopy !== null
      ? createdCopy
      : current.status === "rejected"
        ? ASSISTANT_ACTION_COPY.REJECTED
        : (errorCopy ?? "");

  return (
    <div
      role="group"
      aria-label={typeLabel}
      data-assistant-action={current.id}
      data-assistant-action-type={current.type}
      data-assistant-action-status={current.status}
      aria-busy={busy !== null ? "true" : undefined}
      className="flex min-w-0 flex-col gap-2 rounded-base border border-border bg-card px-3 py-2.5"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span
          data-assistant-action-label=""
          className="font-mono text-label-caps uppercase text-muted-foreground"
        >
          {typeLabel}
        </span>
        {showStatusBadge ? (
          <Badge
            variant="outline"
            size="sm"
            className={
              current.status === "failed" ? "text-destructive" : undefined
            }
          >
            {statusLabel}
          </Badge>
        ) : null}
      </div>

      <p
        data-assistant-action-summary=""
        className="break-words text-label-sm text-foreground"
      >
        {current.summary}
      </p>

      {current.status === "proposed" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            data-assistant-action-confirm=""
            disabled={busy !== null}
            onClick={() => void run("confirm")}
          >
            {busy === "confirm" ? "Confirming…" : "Confirm"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-assistant-action-reject=""
            disabled={busy !== null}
            onClick={() => void run("reject")}
          >
            {busy === "reject" ? "Dismissing…" : "Reject"}
          </Button>
        </div>
      ) : null}

      {current.status === "succeeded" && outcome !== null ? (
        <div
          data-assistant-action-created=""
          className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1"
        >
          <p className="min-w-0 break-words text-label-sm text-foreground">
            {createdCopy}
          </p>
          <Link
            href={ASSISTANT_ACTION_OUTCOME_HREFS[outcome.kind]}
            prefetch={false}
            data-assistant-action-link=""
            className="inline-flex shrink-0 items-center gap-1 rounded-pill font-heading text-label-sm text-primary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {ASSISTANT_ACTION_OUTCOME_LINK_LABELS[outcome.kind]}
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </Link>
        </div>
      ) : null}

      {current.status === "rejected" ? (
        <p
          data-assistant-action-rejected=""
          className="text-label-sm text-muted-foreground"
        >
          {ASSISTANT_ACTION_COPY.REJECTED}
        </p>
      ) : null}

      {errorCopy !== null ? (
        <MotionNotice
          data-assistant-action-error=""
          className="break-words text-label-sm text-destructive"
        >
          {errorCopy}
        </MotionNotice>
      ) : null}

      <p
        role="status"
        aria-live="polite"
        data-assistant-action-live=""
        className="sr-only"
      >
        {announcement}
      </p>
    </div>
  );
}

export type { AssistantActionCardProps };
