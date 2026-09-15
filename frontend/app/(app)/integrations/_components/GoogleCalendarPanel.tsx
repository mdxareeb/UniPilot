"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useSignInPrompt } from "@/components/auth/SignInPromptProvider";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import {
  connectGoogleCalendarAction,
  disconnectGoogleCalendarAction,
} from "@/lib/data/integrationActions";
import { WHATSAPP_GOOGLE_ERROR } from "@/lib/data/integrationErrors";
import type { GoogleConnectionStatus } from "@/lib/data/integrations";
import { WHATSAPP_AUTH_REASON } from "./IntegrationsWorkspace";

export type GoogleCalendarPanelProps = {
  /** Both OAuth env vars are present on this server. */
  configured: boolean;
  /** The caller's google row is `connected`. */
  connected: boolean;
  status: GoogleConnectionStatus["status"];
};

/** The status words the panel prints (P5.1's line, carried into the panel). */
const STATUS_COPY: Record<GoogleConnectionStatus["status"], string> = {
  connected: "Connected",
  not_connected: "Not connected",
  not_configured: "Not configured on this server",
  error: "Connection failed",
};

/**
 * The one-way promise: the push runs once per event, and later edits or
 * deletions on this side never travel back to Google Calendar.
 */
export const GOOGLE_ONE_WAY_NOTE =
  "Pushed once — editing or deleting an event here doesn't change Google Calendar.";

/**
 * The Google Calendar half of the WhatsApp card (P7.2), replacing P5.1's
 * read-only `GoogleStatusLine` with the real states:
 *
 * - not configured: the exact honest line plus one explanation, no control;
 * - not connected: "Connect Google Calendar" starts the OAuth action and
 *   navigates to the consent URL it returns;
 * - connected: the mono status, the one-way note and "Disconnect" behind the
 *   shared `Modal` confirm (destructive);
 * - error: the sanitized copy plus "Reconnect Google Calendar" (the same
 *   connect flow).
 *
 * The panel only renders for a signed-in caller (a guest has no status), but
 * every control still runs the workspace's `requireAuth` first, so a guest
 * click can never reach an action. No token or URL is ever rendered; only the
 * sanitized constants travel to the DOM.
 */
export function GoogleCalendarPanel({
  configured,
  connected,
  status,
}: GoogleCalendarPanelProps) {
  const { requireAuth } = useSignInPrompt();
  const router = useRouter();
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    if (!requireAuth(WHATSAPP_AUTH_REASON)) return;
    setActionError(null);
    setBusy(true);
    try {
      const result = await connectGoogleCalendarAction();
      if (result.error !== null) {
        setActionError(result.error);
        return;
      }
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      setActionError(WHATSAPP_GOOGLE_ERROR);
    } catch {
      setActionError(WHATSAPP_GOOGLE_ERROR);
    } finally {
      setBusy(false);
    }
  }, [requireAuth]);

  const disconnect = useCallback(async () => {
    if (!requireAuth(WHATSAPP_AUTH_REASON)) return;
    setActionError(null);
    setBusy(true);
    try {
      const result = await disconnectGoogleCalendarAction();
      if (result.error !== null) {
        setActionError(result.error);
        return;
      }
      setDisconnectOpen(false);
      router.refresh();
    } catch {
      setActionError(WHATSAPP_GOOGLE_ERROR);
    } finally {
      setBusy(false);
    }
  }, [requireAuth, router]);

  /* The env is the authority on "can this server offer the flow at all"; the
     two connection props must agree inside it, and a mismatch resolves to the
     honest not-connected state. */
  const resolved: GoogleConnectionStatus["status"] = !configured
    ? "not_configured"
    : status === "connected" && !connected
      ? "not_connected"
      : status;
  const error =
    actionError ?? (resolved === "error" ? WHATSAPP_GOOGLE_ERROR : null);

  return (
    <section
      aria-label="Google Calendar"
      data-google-status={resolved}
      className="flex min-w-0 flex-col gap-2"
    >
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-label-sm text-muted-foreground">
        <span>Google Calendar</span>
        <span className="font-mono text-label-caps">
          {STATUS_COPY[resolved]}
        </span>
      </p>

      {resolved === "not_configured" ? (
        <p className="text-label-sm text-muted-foreground">
          This server has no Google Calendar OAuth client, so events stay in
          UniPilot.
        </p>
      ) : resolved === "connected" ? (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 flex-1 font-mono text-label-caps leading-relaxed text-muted-foreground">
              {GOOGLE_ONE_WAY_NOTE}
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
      ) : resolved === "error" ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={busy}
            onClick={() => void connect()}
          >
            Reconnect Google Calendar
          </Button>
        </div>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 flex-1 text-label-sm text-muted-foreground">
            Push confirmed events to your Google Calendar.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={busy}
            onClick={() => void connect()}
          >
            Connect Google Calendar
          </Button>
        </div>
      )}

      {error ? (
        <MotionNotice
          role="alert"
          className="text-label-sm text-destructive"
        >
          {error}
        </MotionNotice>
      ) : null}

      <Modal
        open={disconnectOpen}
        onOpenChange={(open) => {
          if (busy) return;
          setDisconnectOpen(open);
        }}
        title="Disconnect Google Calendar?"
        description="Future additions stop syncing until you connect again."
      >
        <div className="flex flex-col gap-4">
          <p className="text-body-md text-muted-foreground">
            Events already on Google Calendar stay there. Nothing is removed
            from Google Calendar.
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
    </section>
  );
}
