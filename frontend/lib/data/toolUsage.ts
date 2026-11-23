/**
 * The OCR ledger guards.
 *
 * OCR is the one File Tools action that spends provider money, so it gets a
 * documented per-minute page window and a monthly page ceiling, both read from
 * the same append-only `usage_events` table as assistant turns. The kinds are
 * open-taxonomy values: `ocr_page` (pages sent) and `ocr_tokens` (provider
 * usage, observability only).
 */
import { createServiceClient } from "@/lib/supabase/service";
import { OCR_COPY } from "@/lib/ai/ocr";

export const OCR_PAGES_PER_MINUTE = 20;
export const OCR_PAGES_PER_MONTH = 500;

export type OcrLimitResult =
  | { ok: true }
  | { ok: false; copy: string; retryAfterSeconds: number };

export async function checkOcrLimits(
  userId: string,
  pages: number,
): Promise<OcrLimitResult> {
  const service = createServiceClient();
  const now = Date.now();
  const minuteAgo = new Date(now - 60_000).toISOString();
  const monthStart = new Date(
    Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1),
  ).toISOString();

  const [minuteRows, monthRows] = await Promise.all([
    service
      .from("usage_events")
      .select("quantity")
      .eq("user_id", userId)
      .eq("kind", "ocr_page")
      .gte("occurred_at", minuteAgo),
    service
      .from("usage_events")
      .select("quantity")
      .eq("user_id", userId)
      .eq("kind", "ocr_page")
      .gte("occurred_at", monthStart),
  ]);

  if (minuteRows.error || monthRows.error) {
    return {
      ok: false,
      copy: OCR_COPY.FAILED,
      retryAfterSeconds: 60,
    };
  }

  const usedThisMinute = sum(minuteRows.data);
  const usedThisMonth = sum(monthRows.data);

  if (usedThisMinute + pages > OCR_PAGES_PER_MINUTE) {
    return {
      ok: false,
      copy: OCR_COPY.RATE_LIMITED,
      retryAfterSeconds: 60,
    };
  }
  if (usedThisMonth + pages > OCR_PAGES_PER_MONTH) {
    return {
      ok: false,
      copy: "The monthly OCR page limit for this account has been reached.",
      retryAfterSeconds: 86_400,
    };
  }

  return { ok: true };
}

function sum(rows: { quantity: number }[] | null): number {
  return (rows ?? []).reduce((total, row) => total + (row.quantity ?? 0), 0);
}

export async function recordOcrUsage(
  userId: string,
  input: { pages: number; tokens: number },
): Promise<void> {
  const entries = [
    { user_id: userId, kind: "ocr_page", quantity: input.pages },
    ...(input.tokens > 0
      ? [{ user_id: userId, kind: "ocr_tokens", quantity: input.tokens }]
      : []),
  ];
  if (entries.every((entry) => entry.quantity <= 0)) return;

  const service = createServiceClient();
  const { error } = await service.from("usage_events").insert(entries);
  if (error) console.error("OCR usage write failed");
}
