"use client";

import { useId, useState, type FormEvent } from "react";
import { MotionNotice } from "@/components/motion/MotionNotice";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import {
  WHATSAPP_LIVE_CHAT_MAX_LENGTH,
  type WhatsAppConnectionItem,
} from "@/lib/data/integrationValues";

export type LiveAccessPanelProps = {
  /** The owner's connection; `null` (guest or never linked) reads as disconnected. */
  connection: WhatsAppConnectionItem | null;
  /**
   * The polled login QR data-URL. Rendered only while pending and only when
   * the gated poll returned a real string — never a placeholder or a
   * generated code.
   */
  qr: string | null;
  /** True while a live action is in flight; every control disables. */
  busy: boolean;
  /** Upserts the connection pending and enqueues `whatsapp.connect`. */
  onConnect: () => void;
  /** Reserves a live run for the trimmed chat name; true when enqueued. */
  onScan: (chatName: string) => Promise<boolean>;
  /** Clears the QR/archive and marks the connection disconnected. */
  onDisconnect: () => Promise<boolean>;
};

/**
 * The live self-host panel (P6.1), rendered by the card only when this server
 * is the worker host (`UNIPILOT_WHATSAPP_LIVE=1`). Four honest states, no
 * dead controls:
 *
 * - disconnected (`null` too): the "Link live WhatsApp" button;
 * - pending: the waiting copy plus the QR image, which exists in the DOM only
 *   when the gated status poll actually returned a QR string — an absent QR
 *   renders nothing but the waiting line, and the QR is never a placeholder;
 * - connected: the chat-name field, "Scan this chat" and "Disconnect" behind
 *   the shared `Modal` confirm;
 * - error: the connection's sanitized writer text plus "Try again", which is
 *   the same link action.
 *
 * Every control sits behind the workspace's `requireAuth` first (the guest
 * gate lives there, so a guest click opens the prompt and never fetches).
 * Motion reuses the shared vocabulary only: `MotionNotice` for the waiting
 * and error lines, the shared `Modal` for the disconnect confirm. No new
 * presets, and no animation ever decides whether content exists.
 */
export function LiveAccessPanel({
  connection,
  qr,
  busy,
  onConnect,
  onScan,
  onDisconnect,
}: LiveAccessPanelProps) {
  const chatInputId = useId();
  const [chatName, setChatName] = useState("");
  const [confirming, setConfirming] = useState(false);

  const status = connection?.statusValue ?? "disconnected";

  async function submitScan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const started = await onScan(chatName);
    if (started) setChatName("");
  }

  async function confirmDisconnect() {
    if (busy) return;
    await onDisconnect();
    setConfirming(false);
  }

  return (
    <section
      data-live-enabled="true"
      aria-label="Live WhatsApp access"
      className="flex min-w-0 flex-col gap-2"
    >
      {status === "pending" ? (
        <div className="flex min-w-0 flex-col gap-2">
          <MotionNotice
            role="status"
            className="text-label-sm text-muted-foreground"
          >
            Waiting for the QR scan…
          </MotionNotice>
          {qr ? (
            /* eslint-disable-next-line @next/next/no-img-element -- a
               short-lived data-URL login credential: routing it through the
               image optimizer would copy the QR off this render for nothing. */
            <img
              src={qr}
              alt="WhatsApp login QR code"
              width={160}
              height={160}
              className="rounded-control border border-border bg-card object-contain"
            />
          ) : null}
        </div>
      ) : status === "connected" ? (
        <div className="flex min-w-0 flex-col gap-2">
          <form
            className="flex min-w-0 flex-wrap items-end gap-2"
            onSubmit={(event) => void submitScan(event)}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label
                htmlFor={chatInputId}
                className="text-label-sm text-muted-foreground"
              >
                Chat name
              </label>
              <Input
                id={chatInputId}
                size="sm"
                value={chatName}
                maxLength={WHATSAPP_LIVE_CHAT_MAX_LENGTH}
                placeholder="e.g. Trip"
                disabled={busy}
                onChange={(event) => setChatName(event.target.value)}
              />
            </div>
            <Button type="submit" variant="outline" size="sm" disabled={busy}>
              Scan this chat
            </Button>
          </form>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            Disconnect
          </Button>
        </div>
      ) : status === "error" ? (
        <div className="flex min-w-0 flex-col gap-2">
          {connection?.lastError ? (
            <MotionNotice
              role="alert"
              className="text-label-sm text-destructive"
            >
              {connection.lastError}
            </MotionNotice>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={busy}
            onClick={onConnect}
          >
            Try again
          </Button>
        </div>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 flex-1 text-label-sm text-muted-foreground">
            Scans read a chat from this server&apos;s own WhatsApp Web session.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onConnect}
          >
            Link live WhatsApp
          </Button>
        </div>
      )}

      <Modal
        open={confirming}
        onOpenChange={(open) => {
          if (busy) return;
          setConfirming(open);
        }}
        title="Disconnect WhatsApp?"
        description="Live scans stop until you link again."
      >
        <div className="flex flex-col gap-4">
          <p className="text-body-md text-muted-foreground">
            The server&apos;s browser profile is purged and the imported message
            archive for your account is deleted. Nothing is removed from
            WhatsApp itself.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Keep connected
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => void confirmDisconnect()}
            >
              Disconnect
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
