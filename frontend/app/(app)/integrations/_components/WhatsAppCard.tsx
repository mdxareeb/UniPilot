"use client";

import { MotionNotice } from "@/components/motion/MotionNotice";
import { Card } from "@/components/ui/Card";
import { Divider } from "@/components/ui/Divider";
import { WHATSAPP_LIVE_DISABLED_ERROR } from "@/lib/data/integrationErrors";
import { WHATSAPP_CONNECTION_STATUS_LABELS } from "@/lib/data/integrationValues";
import type {
  GoogleConnectionStatus,
  WhatsAppOverview,
} from "@/lib/data/integrations";
import { WhatsAppMark } from "./BrandMarks";
import { CandidateList } from "./CandidateList";
import { ExportDropzone } from "./ExportDropzone";
import { GoogleCalendarPanel } from "./GoogleCalendarPanel";
import { IntegrationsWorkspace, useIntegrations } from "./IntegrationsWorkspace";
import { LiveAccessPanel } from "./LiveAccessPanel";
import { RunHistory } from "./RunHistory";

export type WhatsAppCardProps = {
  /** The signed-in overview; `null` for a guest (no data call was made). */
  initial: WhatsAppOverview | null;
  guest: boolean;
  liveEnabled: boolean;
  googleStatus: GoogleConnectionStatus | null;
};

/**
 * The WhatsApp integration card (P5.1): the props boundary the page renders,
 * wrapping `IntegrationsWorkspace`'s state and composing the status header,
 * the export dropzone, the scans history and the pending review list. The
 * official brand mark stays on this surface only; the card is monochrome
 * everywhere else.
 *
 * P6.1: the footer renders the gated `LiveAccessPanel` only when the server
 * flag is on; on every other server the same spot keeps the honest
 * self-host-required line, so the flag-off card never grows a dead control.
 * P7.2 replaces the read-only Google line with `GoogleCalendarPanel`, which
 * owns the connect/disconnect controls for the configured server states.
 *
 * Motion reuses the shared vocabulary only: `MotionListItem` rows inside
 * `AnimatePresence`, `MotionNotice` for the sanitized notice/error lines and
 * the shared `Modal` for dismissal. Nothing here fades content in as a
 * condition of its existence.
 */
export function WhatsAppCard({
  initial,
  guest,
  liveEnabled,
  googleStatus,
}: WhatsAppCardProps) {
  return (
    <IntegrationsWorkspace
      initial={initial}
      guest={guest}
      liveEnabled={liveEnabled}
      googleStatus={googleStatus}
    >
      <WhatsAppCardBody />
    </IntegrationsWorkspace>
  );
}

function WhatsAppCardBody() {
  const {
    runs,
    candidates,
    connection,
    liveEnabled,
    qr,
    liveBusy,
    googleStatus,
    notice,
    error,
    phase,
    progress,
    pendingName,
    reviewMode,
    setReviewMode,
    dateOrder,
    setDateOrder,
    detectRelativeDates,
    setDetectRelativeDates,
    upload,
    connectLive,
    scanLive,
    disconnectLive,
    confirm,
    reject,
  } = useIntegrations();

  const connectionLabel = connection
    ? connection.statusLabel
    : WHATSAPP_CONNECTION_STATUS_LABELS.disconnected;

  return (
    <Card
      variant="compact"
      className="flex h-full min-w-0 flex-col gap-4 bg-glass p-4 backdrop-blur-md"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-control border border-border bg-glass-subtle">
          <WhatsAppMark className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 className="min-w-0 text-body-lg font-semibold text-foreground">
            WhatsApp
          </h2>
          <span
            data-whatsapp-connection={connection?.statusValue ?? "disconnected"}
            className="shrink-0 font-mono text-label-caps text-muted-foreground"
          >
            {connectionLabel}
          </span>
        </div>
      </div>

      <p className="text-label-sm text-muted-foreground">
        Import events from your exported chats. You choose whether each event
        waits for review or is added automatically.
      </p>

      <ExportDropzone
        onUpload={upload}
        phase={phase}
        progress={progress}
        pendingName={pendingName}
        reviewMode={reviewMode}
        onReviewModeChange={setReviewMode}
        dateOrder={dateOrder}
        onDateOrderChange={setDateOrder}
        detectRelativeDates={detectRelativeDates}
        onDetectRelativeDatesChange={setDetectRelativeDates}
      />

      {error ? (
        <MotionNotice role="alert" className="text-label-sm text-destructive">
          {error}
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

      <RunHistory runs={runs} />

      <CandidateList
        candidates={candidates}
        onConfirm={confirm}
        onReject={reject}
      />

      <div className="mt-auto flex flex-col gap-2.5 pt-3">
        <Divider />
        {googleStatus ? (
          <GoogleCalendarPanel
            configured={googleStatus.configured}
            connected={googleStatus.connected}
            status={googleStatus.status}
          />
        ) : null}
        {liveEnabled ? (
          <LiveAccessPanel
            connection={connection}
            qr={qr}
            busy={liveBusy}
            onConnect={() => void connectLive()}
            onScan={scanLive}
            onDisconnect={disconnectLive}
          />
        ) : (
          <p className="text-label-sm text-muted-foreground">
            {WHATSAPP_LIVE_DISABLED_ERROR}
          </p>
        )}
      </div>
    </Card>
  );
}
