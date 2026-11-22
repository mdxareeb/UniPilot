/**
 * The original WhatsApp message behind an extracted task or event. Pure, so the
 * display rules are testable without a device. The row is read straight from
 * `raw_messages` under the owner's RLS policy; messages are purged after 30
 * days, so a missing row is an expected state, not an error.
 */
import { formatDay, formatTime } from "./agenda";

export type RawMessageRowInput = {
  sender_name: string;
  raw_text: string;
  sent_at: string;
  media_type: string;
};

export type OriginalMessage = {
  sender: string;
  text: string;
  sentLabel: string;
  hasMedia: boolean;
};

/** Shown when the message was purged (30-day retention) or never captured. */
export const ORIGINAL_GONE_COPY =
  "The original message is no longer available. WhatsApp messages are kept for 30 days.";

const MEDIA_ONLY_COPY = "Sent a file.";

export function toOriginalMessage(
  row: RawMessageRowInput,
  timeZone: string,
): OriginalMessage {
  const text = row.raw_text.trim();
  return {
    sender: row.sender_name.trim() !== "" ? row.sender_name.trim() : "Someone",
    text: text !== "" ? text : MEDIA_ONLY_COPY,
    sentLabel: `${formatDay(row.sent_at, timeZone)} · ${formatTime(row.sent_at, timeZone)}`,
    hasMedia: row.media_type !== "none",
  };
}
