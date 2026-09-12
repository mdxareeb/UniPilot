/**
 * The long date the dashboard greeting leads with — "Saturday, August 29, 2026".
 *
 * Formatted once per request, server-side, and passed down as a string. No
 * client ever formats this value: the string in the server render is the string
 * the browser hydrates, so there is no clock or locale mismatch to reconcile,
 * and nothing here can cause a hydration warning.
 *
 * `en-US` and `dateStyle: "full"` are pinned so the output does not depend on
 * the host's default locale — the same instant formats identically in dev, CI
 * and production.
 *
 * Limitation: the instant is read in the server's timezone. A user timezone is
 * a persisted preference, which is a later database task (20.6) — one is not
 * invented here. Until then, a student far enough from the server's timezone
 * can see the neighbouring day near midnight. The date is orientation for the
 * workspace, not a deadline, and refreshes to the correct day on the next
 * request.
 */
const formatter = new Intl.DateTimeFormat("en-US", { dateStyle: "full" });

export function formatDashboardDate(date: Date): string {
  return formatter.format(date);
}
