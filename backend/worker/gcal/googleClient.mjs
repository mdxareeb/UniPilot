/**
 * Google Calendar sync: a small REST client (the gemini.mjs pattern).
 *
 * Safety mirrors the rest of the worker:
 *  - the client id/secret are read from env once and never logged;
 *  - error messages are fixed sanitized strings; Google response bodies are
 *    never logged or surfaced (they can echo request data);
 *  - 401/403 (revoked or expired grant) are non-retryable and the caller
 *    marks the connection `error` ("Reconnect Google Calendar.");
 *  - 429 and 5xx are retryable so the runner's backoff handles the delay;
 *  - ids-only payloads everywhere; no event body or token in logs.
 */
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CAL_BASE = "https://www.googleapis.com/calendar/v3";

export const GCAL_MESSAGES = {
  not_configured: "Google Calendar sync isn't configured on this server.",
  revoked: "Google authorization expired; reconnect Google Calendar.",
  unavailable: "Google Calendar is temporarily unavailable. This will be retried.",
  rejected: "Google Calendar refused the request.",
  invalid_response: "Google Calendar returned an unusable response.",
};

export class GcalError extends Error {
  /**
   * @param {"not_configured"|"revoked"|"unavailable"|"rejected"|"invalid_response"} code
   * @param {string} message sanitized, safe to store
   * @param {boolean} retryable
   */
  constructor(code, message, retryable) {
    super(message);
    this.name = "GcalError";
    this.code = code;
    this.retryable = retryable;
  }
}

/** `{ clientId, clientSecret }`, or null when the pair is absent. */
export function readGcalConfig(env = process.env) {
  const clientId = (env.GOOGLE_OAUTH_CLIENT_ID ?? "").trim();
  const clientSecret = (env.GOOGLE_OAUTH_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function statusError(status) {
  if (status === 401 || status === 403) {
    return new GcalError("revoked", GCAL_MESSAGES.revoked, false);
  }
  if (status === 429 || status >= 500) {
    return new GcalError("unavailable", GCAL_MESSAGES.unavailable, true);
  }
  return new GcalError("rejected", GCAL_MESSAGES.rejected, false);
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Mint an in-memory access token from the stored refresh token. The token is
 * never persisted; the caller keeps it for the length of one job.
 * @returns {Promise<string>} the access token
 */
export async function refreshAccessToken(config, refreshToken, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
  } catch {
    throw new GcalError("unavailable", GCAL_MESSAGES.unavailable, true);
  }
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    throw new GcalError("revoked", GCAL_MESSAGES.revoked, false);
  }
  if (!response.ok) throw statusError(response.status);
  const body = await readJson(response);
  if (typeof body?.access_token !== "string" || body.access_token === "") {
    throw new GcalError("invalid_response", GCAL_MESSAGES.invalid_response, true);
  }
  return body.access_token;
}

async function get(accessToken, path, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${CAL_BASE}${path}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new GcalError("unavailable", GCAL_MESSAGES.unavailable, true);
  }
  if (!response.ok) throw statusError(response.status);
  return readJson(response);
}

async function send(accessToken, path, method, body, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${CAL_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new GcalError("unavailable", GCAL_MESSAGES.unavailable, true);
  }
  if (!response.ok) throw statusError(response.status);
  return readJson(response);
}

/** The user's calendar list (`calendarList.list`). */
export async function listCalendars(accessToken, fetchImpl = globalThis.fetch) {
  const body = await get(accessToken, "/users/me/calendarList?maxResults=100", fetchImpl);
  return Array.isArray(body?.items) ? body.items : [];
}

/**
 * One calendar's events. First run: a bounded forward window and no cursor.
 * Later runs: the stored `syncToken` (incremental, includes deleted). A gone
 * cursor (410) is reported so the caller resets it and re-syncs fully.
 * @returns {Promise<{events: object[], nextSyncToken: string|null, cursorGone: boolean}>}
 */
export async function listEvents(
  accessToken,
  calendarId,
  { syncToken, timeMin },
  fetchImpl = globalThis.fetch,
) {
  const params = new URLSearchParams({ maxResults: "250" });
  if (syncToken) params.set("syncToken", syncToken);
  if (!syncToken && timeMin) params.set("timeMin", timeMin);
  if (syncToken) {
    params.set("showDeleted", "true");
    params.set("singleEvents", "false");
  }

  let response;
  try {
    response = await fetchImpl(
      `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
  } catch {
    throw new GcalError("unavailable", GCAL_MESSAGES.unavailable, true);
  }
  if (response.status === 410) return { events: [], nextSyncToken: null, cursorGone: true };
  if (!response.ok) throw statusError(response.status);
  const body = await readJson(response);
  return {
    events: Array.isArray(body?.items) ? body.items : [],
    nextSyncToken: typeof body?.nextSyncToken === "string" ? body.nextSyncToken : null,
    cursorGone: false,
  };
}

/** Find-or-create the dedicated export calendar; returns its google id. */
export async function ensureExportCalendar(
  accessToken,
  knownCalendarId,
  fetchImpl = globalThis.fetch,
) {
  const summary = "UniPilot";
  const calendars = await listCalendars(accessToken, fetchImpl);
  const known = calendars.find((item) => item.id === knownCalendarId);
  if (known) return known.id;
  const match = calendars.find(
    (item) => item.summaryOverride === summary || item.summary === summary,
  );
  if (match) return match.id;
  const created = await send(
    accessToken,
    "/calendars",
    "POST",
    { summary },
    fetchImpl,
  );
  if (typeof created?.id !== "string" || created.id === "") {
    throw new GcalError("invalid_response", GCAL_MESSAGES.invalid_response, true);
  }
  return created.id;
}

/** Insert one exported event; returns Google's event id. */
export async function insertExportedEvent(
  accessToken,
  calendarId,
  body,
  fetchImpl = globalThis.fetch,
) {
  const created = await send(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    "POST",
    body,
    fetchImpl,
  );
  if (typeof created?.id !== "string" || created.id === "") {
    throw new GcalError("invalid_response", GCAL_MESSAGES.invalid_response, true);
  }
  return created.id;
}

/** Patch one exported event in place (a deadline edit updates, never duplicates). */
export async function patchExportedEvent(
  accessToken,
  calendarId,
  googleEventId,
  body,
  fetchImpl = globalThis.fetch,
) {
  await send(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
    "PATCH",
    body,
    fetchImpl,
  );
}
