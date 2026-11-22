"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "motion/react";
import { useSignInPrompt } from "@/components/auth/SignInPromptProvider";
import { MotionListItem } from "@/components/motion/MotionListItem";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";
import { Modal } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import {
  confirmGroupCandidateAction,
  getGroupSyncStatusAction,
  rejectGroupCandidateAction,
  requestGroupDisconnectAction,
  requestGroupLinkAction,
  setGroupActiveAction,
} from "@/lib/data/groupSyncActions";
import {
  GROUP_SYNC_STATE_LABELS,
  sortGroups,
  type GroupCandidateItem,
  type GroupSyncSnapshot,
  type MonitoredGroupItem,
} from "@/lib/data/groupSyncValues";
import {
  WHATSAPP_GENERIC_ERROR,
  WHATSAPP_GROUPS_BRIDGE_OFFLINE_NOTE,
  WHATSAPP_GROUPS_CAPTURE_NOTE,
  WHATSAPP_GROUPS_DISABLED_ERROR,
} from "@/lib/data/integrationErrors";
import { WhatsAppMark } from "./BrandMarks";
import { WHATSAPP_AUTH_REASON } from "./IntegrationsWorkspace";

export type WhatsAppGroupsCardProps = {
  /** The signed-in snapshot; `null` for a guest (no data call was made). */
  initial: GroupSyncSnapshot | null;
  guest: boolean;
  /** `UNIPILOT_WHATSAPP_BRIDGE=1` on this server. */
  enabled: boolean;
};

/** Poll cadence: fast while a transition is in flight, slow while linked. */
const FAST_POLL_MS = 3_000;
const SLOW_POLL_MS = 10_000;

const GUEST_SNAPSHOT: GroupSyncSnapshot = {
  state: "disconnected",
  lastError: null,
  qr: null,
  pairing: null,
  groups: [],
  review: [],
};

/**
 * WhatsApp group live sync (Stage 1): link WhatsApp once by QR, then switch on
 * the groups UniPilot may read.
 *
 * Every state is the honest one the database supports, derived by
 * `deriveGroupSyncState`: no bridge process means "Bridge not running", never a
 * fake QR or a fake "connected". The web app only writes the user's intent
 * (`desired_state`); a separate read-only bridge process acts on it, which is
 * why this panel polls the status rather than waiting on a request.
 *
 * Same conventions as the sibling panels: the shared sign-in prompt before any
 * action, `MotionNotice` for sanitized copy, the shared `Modal` for the
 * destructive confirm, `MotionListItem` rows inside `AnimatePresence`, and the
 * CSS-only `Switch`. Nothing here fades content in as a condition of its
 * existence. The status attribute `data-groups-status` is the test hook.
 */
export function WhatsAppGroupsCard({
  initial,
  guest,
  enabled,
}: WhatsAppGroupsCardProps) {
  const { requireAuth } = useSignInPrompt();
  const router = useRouter();

  const [serverSnapshot, setServerSnapshot] = useState(initial);
  const [snapshot, setSnapshot] = useState<GroupSyncSnapshot>(
    initial ?? GUEST_SNAPSHOT,
  );
  // Adjust local state when the server re-renders with a new snapshot
  // (router.refresh after an action), the same pattern IntegrationsWorkspace uses.
  if (initial !== serverSnapshot) {
    setServerSnapshot(initial);
    setSnapshot(initial ?? GUEST_SNAPSHOT);
  }

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  /** The suggestion being decided right now (its buttons are disabled). */
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);
  /** The suggestion the student is about to dismiss (terminal). */
  const [dismissing, setDismissing] = useState<GroupCandidateItem | null>(null);
  /** Ids with a toggle write in flight: a poll must not overwrite them. */
  const togglingRef = useRef(new Set<string>());

  const state = enabled ? snapshot.state : "not_enabled";

  useEffect(() => {
    if (guest || !enabled) return;
    const transitional =
      state === "starting" ||
      state === "qr_ready" ||
      state === "code_ready" ||
      state === "disconnecting";
    const steady = state === "connected" || state === "bridge_offline";
    if (!transitional && !steady) return;

    let cancelled = false;
    const timer = window.setInterval(
      () => {
        if (document.visibilityState === "hidden") return;
        void (async () => {
          try {
            const result = await getGroupSyncStatusAction();
            if (cancelled || result.error !== null) return;
            setSnapshot((current) => ({
              state: result.state,
              lastError: result.lastError,
              qr: result.qr,
              pairing: result.pairing,
              review: result.review,
              // Keep the optimistic value of any group mid-toggle.
              groups: result.groups.map((group) =>
                togglingRef.current.has(group.id)
                  ? (current.groups.find((g) => g.id === group.id) ?? group)
                  : group,
              ),
            }));
          } catch {
            /* best-effort: the next tick tries again */
          }
        })();
      },
      transitional ? FAST_POLL_MS : SLOW_POLL_MS,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [guest, enabled, state]);

  const link = useCallback(async () => {
    if (!requireAuth(WHATSAPP_AUTH_REASON)) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await requestGroupLinkAction();
      if (result.error !== null) {
        setError(result.error);
        return;
      }
      setSnapshot((current) => ({
        ...current,
        state: "starting",
        lastError: null,
        qr: null,
      }));
      router.refresh();
    } catch {
      setError(WHATSAPP_GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }, [requireAuth, router]);

  const disconnect = useCallback(async () => {
    if (!requireAuth(WHATSAPP_AUTH_REASON)) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await requestGroupDisconnectAction();
      if (result.error !== null) {
        setError(result.error);
        return;
      }
      setDisconnectOpen(false);
      if (result.notice) setNotice(result.notice);
      setSnapshot((current) => ({
        ...current,
        state: result.notice ? "disconnected" : "disconnecting",
        qr: null,
      }));
      router.refresh();
    } catch {
      setError(WHATSAPP_GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }, [requireAuth, router]);

  const toggleGroup = useCallback(
    async (group: MonitoredGroupItem, active: boolean) => {
      if (!requireAuth(WHATSAPP_AUTH_REASON)) return;
      setError(null);
      togglingRef.current.add(group.id);
      const apply = (value: boolean) =>
        setSnapshot((current) => ({
          ...current,
          groups: sortGroups(
            current.groups.map((g) =>
              g.id === group.id ? { ...g, active: value } : g,
            ),
          ),
        }));
      apply(active);
      try {
        const result = await setGroupActiveAction(group.id, active);
        if (result.error !== null) {
          apply(!active);
          setError(result.error);
        }
      } catch {
        apply(!active);
        setError(WHATSAPP_GENERIC_ERROR);
      } finally {
        togglingRef.current.delete(group.id);
      }
    },
    [requireAuth],
  );

  const confirmCandidate = useCallback(
    async (candidate: GroupCandidateItem) => {
      if (!requireAuth(WHATSAPP_AUTH_REASON)) return;
      setError(null);
      setReviewBusyId(candidate.id);
      try {
        const result = await confirmGroupCandidateAction(candidate.id);
        if (result.error !== null) {
          setError(result.error);
        } else {
          setSnapshot((current) => ({
            ...current,
            review: current.review.filter((c) => c.id !== candidate.id),
          }));
        }
        router.refresh();
      } catch {
        setError(WHATSAPP_GENERIC_ERROR);
      } finally {
        setReviewBusyId(null);
      }
    },
    [requireAuth, router],
  );

  const dismissCandidate = useCallback(async () => {
    const candidate = dismissing;
    if (!candidate) return;
    if (!requireAuth(WHATSAPP_AUTH_REASON)) return;
    setError(null);
    setReviewBusyId(candidate.id);
    try {
      const result = await rejectGroupCandidateAction(candidate.id);
      if (result.error !== null) {
        setError(result.error);
      } else {
        setSnapshot((current) => ({
          ...current,
          review: current.review.filter((c) => c.id !== candidate.id),
        }));
      }
      router.refresh();
    } catch {
      setError(WHATSAPP_GENERIC_ERROR);
    } finally {
      setReviewBusyId(null);
      setDismissing(null);
    }
  }, [dismissing, requireAuth, router]);

  const activeCount = snapshot.groups.filter((g) => g.active).length;
  const showGroups =
    state === "connected" ||
    state === "bridge_offline" ||
    (state === "disconnecting" && snapshot.groups.length > 0);
  const linked = state === "connected" || state === "bridge_offline";

  return (
    <Card
      variant="compact"
      className="flex h-full min-w-0 flex-col gap-4 bg-glass p-4 backdrop-blur-md"
    >
      <section
        aria-label="WhatsApp groups"
        data-groups-status={state}
        data-groups-enabled={enabled ? "true" : "false"}
        className="flex min-w-0 flex-1 flex-col gap-4"
      >
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-control border border-border bg-glass-subtle">
            <WhatsAppMark className="size-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h2 className="min-w-0 text-body-lg font-semibold text-foreground">
              WhatsApp groups
            </h2>
            <span className="shrink-0 font-mono text-label-caps text-muted-foreground">
              {GROUP_SYNC_STATE_LABELS[state]}
            </span>
          </div>
        </div>

        <p className="text-label-sm text-muted-foreground">
          Link WhatsApp once and choose your college groups. UniPilot reads only
          the groups you switch on, keeps course files, ignores chatter and
          turns deadlines into dated tasks sorted by subject. It never sends
          anything.
        </p>

        {state === "not_enabled" ? (
          <p className="text-label-sm text-muted-foreground">
            {WHATSAPP_GROUPS_DISABLED_ERROR}
          </p>
        ) : null}

        {state === "disconnected" || state === "error" ? (
          <div className="flex min-w-0 flex-col gap-3">
            <p className="font-mono text-label-caps leading-relaxed text-muted-foreground">
              This uses an unofficial linked-device connection. UniPilot never
              sends messages or read receipts, but WhatsApp can restrict
              accounts that use tools like this. Use a number you are
              comfortable risking.
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={busy}
                onClick={() => void link()}
              >
                {state === "error" ? "Try linking again" : "Link WhatsApp"}
              </Button>
            </div>
          </div>
        ) : null}

        {state === "starting" ? (
          <MotionNotice
            role="status"
            className="text-label-sm text-muted-foreground"
          >
            Starting the link. The QR code appears in a few seconds.
          </MotionNotice>
        ) : null}

        {state === "qr_ready" ? (
          <div className="flex min-w-0 flex-col gap-3">
            {snapshot.qr ? (
              /* A data URL, exactly like the live panel's QR: no remote image. */
              /* eslint-disable-next-line @next/next/no-img-element -- generated data URL */
              <img
                src={snapshot.qr}
                alt="WhatsApp link QR code"
                width={192}
                height={192}
                data-groups-qr="true"
                className="self-start rounded-control border border-border bg-white object-contain"
              />
            ) : (
              <MotionNotice
                role="status"
                className="text-label-sm text-muted-foreground"
              >
                Preparing the QR code…
              </MotionNotice>
            )}
            <p className="text-label-sm text-muted-foreground">
              On your phone open WhatsApp, then Linked devices, then Link a
              device, and scan this code. It refreshes every minute.
            </p>
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void disconnect()}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {state === "code_ready" ? (
          <div className="flex min-w-0 flex-col gap-3">
            <MotionNotice
              role="status"
              className="text-label-sm text-muted-foreground"
            >
              A link was started from the UniPilot mobile app. Finish it there:
              enter the code it shows under WhatsApp, Linked devices.
            </MotionNotice>
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void disconnect()}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {state === "disconnecting" ? (
          <MotionNotice
            role="status"
            className="text-label-sm text-muted-foreground"
          >
            Disconnecting and forgetting this link…
          </MotionNotice>
        ) : null}

        {state === "bridge_offline" ? (
          <MotionNotice
            role="status"
            className="text-label-sm text-muted-foreground"
          >
            {WHATSAPP_GROUPS_BRIDGE_OFFLINE_NOTE}
          </MotionNotice>
        ) : null}

        {showGroups ? (
          <section
            aria-label="Groups to read"
            data-groups-list="true"
            className="flex min-w-0 flex-col gap-2"
          >
            <div className="flex min-w-0 items-baseline justify-between gap-3">
              <h3 className="font-mono text-label-caps uppercase text-muted-foreground">
                Groups
              </h3>
              <span className="font-mono text-label-caps text-muted-foreground">
                {snapshot.groups.length === 0
                  ? "None yet"
                  : `${activeCount} of ${snapshot.groups.length} on`}
              </span>
            </div>

            {snapshot.groups.length === 0 ? (
              <p className="text-label-sm text-muted-foreground">
                Your groups appear here a moment after the link finishes.
              </p>
            ) : (
              <ul className="flex min-w-0 list-none flex-col gap-2">
                <AnimatePresence initial={false}>
                  {snapshot.groups.map((group) => (
                    <MotionListItem
                      key={group.id}
                      data-group-id={group.id}
                      data-group-active={group.active ? "true" : "false"}
                      className="flex min-w-0 items-center justify-between gap-3 rounded-base border border-border bg-glass-subtle p-3"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="min-w-0 truncate text-label-sm font-semibold text-foreground">
                          {group.name}
                        </span>
                        <span className="font-mono text-label-caps leading-relaxed text-muted-foreground">
                          {group.active
                            ? "Capturing messages from this group."
                            : WHATSAPP_GROUPS_CAPTURE_NOTE}
                        </span>
                      </div>
                      <Switch
                        checked={group.active}
                        label={`Read ${group.name}`}
                        onCheckedChange={(next) => void toggleGroup(group, next)}
                      />
                    </MotionListItem>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </section>
        ) : null}

        {snapshot.review.length > 0 ? (
          <section
            aria-label="Suggestions to review"
            data-groups-review="true"
            className="flex min-w-0 flex-col gap-2"
          >
            <div className="flex min-w-0 items-baseline justify-between gap-3">
              <h3 className="font-mono text-label-caps uppercase text-muted-foreground">
                Review
              </h3>
              <span className="font-mono text-label-caps text-muted-foreground">
                {snapshot.review.length} waiting
              </span>
            </div>
            <ul className="flex min-w-0 list-none flex-col gap-2">
              <AnimatePresence initial={false}>
                {snapshot.review.map((candidate) => (
                  <MotionListItem
                    key={candidate.id}
                    data-candidate-id={candidate.id}
                    data-candidate-kind={candidate.kind}
                    className="flex min-w-0 flex-col gap-2 rounded-base border border-border bg-glass-subtle p-3"
                  >
                    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <h4 className="min-w-0 text-label-sm font-semibold text-foreground">
                        {candidate.title}
                      </h4>
                      <span className="shrink-0 font-mono text-label-caps text-muted-foreground">
                        {candidate.whenLabel ?? "No date"}
                      </span>
                    </div>
                    <p className="font-mono text-label-caps leading-relaxed text-muted-foreground">
                      {[
                        candidate.typeLabel,
                        candidate.subjectName ??
                          (candidate.proposedSubjectName
                            ? `New course: ${candidate.proposedSubjectName}`
                            : "Unsorted"),
                        candidate.confidencePercent === null
                          ? null
                          : `${candidate.confidencePercent}% sure`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="min-w-0 text-label-sm text-muted-foreground">
                      <span className="font-mono text-label-caps">
                        {candidate.sender}
                      </span>{" "}
                      <span className="line-clamp-2">{candidate.messageText}</span>
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        data-candidate-action="add"
                        disabled={reviewBusyId === candidate.id}
                        onClick={() => void confirmCandidate(candidate)}
                      >
                        {candidate.proposedSubjectName
                          ? `Add and create ${candidate.proposedSubjectName}`
                          : candidate.kind === "task"
                            ? "Add to tasks"
                            : "Add to calendar"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        data-candidate-action="dismiss"
                        disabled={reviewBusyId === candidate.id}
                        onClick={() => setDismissing(candidate)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </MotionListItem>
                ))}
              </AnimatePresence>
            </ul>
          </section>
        ) : null}

        {error ? (
          <MotionNotice role="alert" className="text-label-sm text-destructive">
            {error}
          </MotionNotice>
        ) : state === "error" && snapshot.lastError ? (
          <MotionNotice role="alert" className="text-label-sm text-destructive">
            {snapshot.lastError}
          </MotionNotice>
        ) : null}

        {notice ? (
          <MotionNotice
            role="status"
            className="text-label-sm text-muted-foreground"
          >
            {notice}
          </MotionNotice>
        ) : null}

        {linked ? (
          <div className="mt-auto flex flex-col gap-2.5 pt-3">
            <Divider />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 flex-1 text-label-sm text-muted-foreground">
                UniPilot is linked as a device on your WhatsApp account.
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                disabled={busy}
                onClick={() => setDisconnectOpen(true)}
              >
                Disconnect
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <Modal
        open={dismissing !== null}
        onOpenChange={(open) => {
          if (reviewBusyId !== null) return;
          if (!open) setDismissing(null);
        }}
        title="Dismiss this suggestion?"
        description="It will not be suggested again."
      >
        <div className="flex flex-col gap-4">
          <p className="text-body-md text-muted-foreground">
            {dismissing?.title}. Dismissing is final for this message: UniPilot
            will not bring it back.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={reviewBusyId !== null}
              onClick={() => setDismissing(null)}
            >
              Keep it
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={reviewBusyId !== null}
              onClick={() => void dismissCandidate()}
            >
              Dismiss
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={disconnectOpen}
        onOpenChange={(open) => {
          if (busy) return;
          setDisconnectOpen(open);
        }}
        title="Disconnect WhatsApp?"
        description="UniPilot stops reading your groups."
      >
        <div className="flex flex-col gap-4">
          <p className="text-body-md text-muted-foreground">
            This logs UniPilot out of your WhatsApp account and deletes the
            captured message text now. Tasks, events and files already saved to
            your workspace stay. Your group choices are kept for next time.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setDisconnectOpen(false)}
            >
              Keep connected
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => void disconnect()}
            >
              Disconnect
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
