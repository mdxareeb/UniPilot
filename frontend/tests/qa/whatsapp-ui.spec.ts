/**
 * tests/qa/whatsapp-ui.spec.ts — the WhatsApp surface's contract tests.
 *
 * The pure half (Task P4.1): the vocabulary, validation and row → display
 * mapping in `lib/data/integrationValues.ts`, exercised with no browser, no
 * server data and no database. The rendered half (Task P5.1): the
 * `/integrations` card's static contract — the real upload control, the Gmail
 * coming-soon card, the guest gate, the flag-off live line and the Google
 * Calendar panel. The upload pipeline's flow tests live in P5.2's
 * `whatsapp-export.spec.ts`; nothing below depends on a working upload.
 * P6.1 extends the rendered half: on this committed server the live flag is
 * off, so the panel is absent, the honest self-host line stands alone, no QR
 * can render, and a guest sees no live control at all — the flag-on gate and
 * panel honesty are the controller's probe, never faked here.
 * P7.2 replaces the read-only Google line with `GoogleCalendarPanel`: on this
 * committed server the OAuth pair is absent, so the panel must show the exact
 * "Not configured on this server" line with its explanation and no control,
 * and a guest must never see an active Google control.
 * P9.1 adds the queued-state honesty check: one service-role seeded `queued`
 * run must render the line naming the missing worker, and the row is deleted
 * by id under the shared worker lock (`workerLock.ts`) so it cannot race the
 * export spec's residue check in the same project.
 */
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  WHATSAPP_EXPORT_MAX_BYTES,
  WHATSAPP_REVIEW_MODE_LABELS,
  activeRunCount,
  connectionRowToItem,
  integrationCandidateRowToItem,
  integrationRunRowToItem,
  isWhatsAppRunActive,
  parseWhatsAppExport,
  type WhatsAppCandidateRow,
  type WhatsAppConnectionRow,
  type WhatsAppRunRow,
} from "../../lib/data/integrationValues";
import { acquireWorkerLock } from "./workerLock";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CANDIDATE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const CONNECTION_ID = "44444444-4444-4444-8444-444444444444";

const SAMPLE = path.join(
  path.resolve(process.cwd(), ".."),
  "whatsapp",
  "tests",
  "fixtures",
  "sample_chat.txt",
);

function runRow(overrides: Partial<WhatsAppRunRow> = {}): WhatsAppRunRow {
  return {
    id: RUN_ID,
    user_id: USER_ID,
    mode: "export",
    review_mode: "manual",
    status: "succeeded",
    storage_path: `${USER_ID}/${RUN_ID}/export.txt`,
    chat_name: null,
    connection_id: null,
    message_count: 12,
    candidate_count: 3,
    error: null,
    // Deliberately a different calendar day than `created_at`: the row's
    // displayed date must come from the creation instant.
    started_at: "2026-09-01T23:30:00.000Z",
    completed_at: "2026-09-02T09:00:10.000Z",
    created_at: "2026-09-02T09:00:00.000Z",
    updated_at: "2026-09-02T09:00:10.000Z",
    ...overrides,
  };
}

function candidateRow(
  overrides: Partial<WhatsAppCandidateRow> = {},
): WhatsAppCandidateRow {
  return {
    id: CANDIDATE_ID,
    user_id: USER_ID,
    run_id: RUN_ID,
    fingerprint: "fp-1",
    title: "Birthday party",
    start_at: "2026-09-02T13:00:00.000Z",
    end_at: null,
    all_day: false,
    message_id: null,
    message_sender: "Areeb",
    message_text: "Birthday party on Sep 2 at 9am",
    status: "pending",
    event_id: null,
    provider_event_id: null,
    pushed_at: null,
    push_error: null,
    created_at: "2026-09-02T09:00:10.000Z",
    updated_at: "2026-09-02T09:00:10.000Z",
    ...overrides,
  };
}

function connectionRow(
  overrides: Partial<WhatsAppConnectionRow> = {},
): WhatsAppConnectionRow {
  return {
    id: CONNECTION_ID,
    user_id: USER_ID,
    provider: "whatsapp",
    mode: "export",
    status: "disconnected",
    review_mode: "manual",
    date_order: "DMY",
    detect_relative_dates: false,
    profile_ref: null,
    last_error: null,
    qr_data_enc: null,
    qr_expires_at: null,
    created_at: "2026-09-02T09:00:00.000Z",
    updated_at: "2026-09-02T09:00:00.000Z",
    ...overrides,
  };
}

test.describe("whatsapp values (pure)", () => {
  test("accepts a .txt export within the cap", () => {
    expect(
      parseWhatsAppExport({ name: "Chat with Areeb.txt", sizeBytes: 1024 }),
    ).toEqual({
      name: "Chat with Areeb.txt",
      sizeBytes: 1024,
      reviewMode: "manual",
      dateOrder: "DMY",
      detectRelativeDates: false,
    });
  });

  test("rejects wrong extensions, empty and oversized files", () => {
    expect(parseWhatsAppExport({ name: "chat.pdf", sizeBytes: 10 })).toBeNull();
    expect(parseWhatsAppExport({ name: "chat.txt", sizeBytes: 0 })).toBeNull();
    expect(
      parseWhatsAppExport({
        name: "chat.txt",
        sizeBytes: WHATSAPP_EXPORT_MAX_BYTES + 1,
      }),
    ).toBeNull();
    expect(parseWhatsAppExport(null)).toBeNull();
  });

  test("normalizes the name and rejects junk sizes at the boundary", () => {
    expect(
      parseWhatsAppExport({ name: "  chat.TXT  ", sizeBytes: 10 }),
    ).toEqual({
      name: "chat.TXT",
      sizeBytes: 10,
      reviewMode: "manual",
      dateOrder: "DMY",
      detectRelativeDates: false,
    });
    expect(
      parseWhatsAppExport({
        name: "chat.txt",
        sizeBytes: WHATSAPP_EXPORT_MAX_BYTES,
      }),
    ).toEqual({
      name: "chat.txt",
      sizeBytes: WHATSAPP_EXPORT_MAX_BYTES,
      reviewMode: "manual",
      dateOrder: "DMY",
      detectRelativeDates: false,
    });
    expect(parseWhatsAppExport({ name: "   ", sizeBytes: 10 })).toBeNull();
    expect(parseWhatsAppExport({ name: "chat.txt", sizeBytes: 10.5 })).toBeNull();
    expect(parseWhatsAppExport({ name: "chat.txt" })).toBeNull();
  });

  test("accepts both review modes and rejects unknown ones", () => {
    expect(
      parseWhatsAppExport({
        name: "chat.txt",
        sizeBytes: 10,
        reviewMode: "manual",
      }),
    ).toEqual({
      name: "chat.txt",
      sizeBytes: 10,
      reviewMode: "manual",
      dateOrder: "DMY",
      detectRelativeDates: false,
    });
    expect(
      parseWhatsAppExport({
        name: "chat.txt",
        sizeBytes: 10,
        reviewMode: "automatic",
      }),
    ).toEqual({
      name: "chat.txt",
      sizeBytes: 10,
      reviewMode: "automatic",
      dateOrder: "DMY",
      detectRelativeDates: false,
    });

    /* Absent means the documented manual default; every other non-word value
       — including an explicit null — rejects the whole selection. */
    for (const junk of ["auto", "", null, 5, {}, []]) {
      expect(
        parseWhatsAppExport({
          name: "chat.txt",
          sizeBytes: 10,
          reviewMode: junk,
        }),
      ).toBeNull();
    }
  });

  test("accepts both date orders and the relative-dates flag, rejecting junk", () => {
    /* C4 — the detection choices travel with the upload; absent payloads keep
       the documented defaults (DMY, relative off), and every value outside the
       vocabularies rejects the whole selection. */
    expect(
      parseWhatsAppExport({
        name: "chat.txt",
        sizeBytes: 10,
        dateOrder: "MDY",
        detectRelativeDates: true,
      }),
    ).toEqual({
      name: "chat.txt",
      sizeBytes: 10,
      reviewMode: "manual",
      dateOrder: "MDY",
      detectRelativeDates: true,
    });
    expect(
      parseWhatsAppExport({
        name: "chat.txt",
        sizeBytes: 10,
        dateOrder: "DMY",
        detectRelativeDates: false,
      }),
    ).toEqual({
      name: "chat.txt",
      sizeBytes: 10,
      reviewMode: "manual",
      dateOrder: "DMY",
      detectRelativeDates: false,
    });

    for (const junk of ["YMD", "dmy", "", null, 5, {}, []]) {
      expect(
        parseWhatsAppExport({
          name: "chat.txt",
          sizeBytes: 10,
          dateOrder: junk,
        }),
      ).toBeNull();
    }
    for (const junk of [0, 1, "true", "false", null, {}, []]) {
      expect(
        parseWhatsAppExport({
          name: "chat.txt",
          sizeBytes: 10,
          detectRelativeDates: junk,
        }),
      ).toBeNull();
    }
  });
});

test.describe("whatsapp run mapping (pure)", () => {
  test("maps a capped export run to display-ready values", () => {
    const item = integrationRunRowToItem(
      runRow({
        error:
          "Input capped at the per-run limit; later messages were not scanned.",
      }),
      "UTC",
    );

    expect(item).toEqual({
      id: RUN_ID,
      mode: "export",
      reviewMode: "manual",
      reviewModeLabel: "Review each event",
      statusValue: "succeeded",
      statusLabel: "Done",
      messageCount: 12,
      candidateCount: 3,
      error:
        "Input capped at the per-run limit; later messages were not scanned.",
      capped: true,
      dateLabel: "Wed, Sep 2",
    });
  });

  test("maps an automatic run's review mode to its label", () => {
    const automatic = integrationRunRowToItem(
      runRow({ review_mode: "automatic" }),
      "UTC",
    );
    expect(automatic.reviewMode).toBe("automatic");
    expect(automatic.reviewModeLabel).toBe(
      WHATSAPP_REVIEW_MODE_LABELS.automatic,
    );
  });

  test("keeps a live run's chat name and falls back on junk vocabulary", () => {
    const live = integrationRunRowToItem(
      runRow({
        mode: "live",
        status: "running",
        chat_name: "Trip",
        storage_path: null,
      }),
      "UTC",
    );
    expect(live).toEqual({
      id: RUN_ID,
      mode: "live",
      reviewMode: "manual",
      reviewModeLabel: "Review each event",
      statusValue: "running",
      statusLabel: "Scanning",
      messageCount: 12,
      candidateCount: 3,
      capped: false,
      dateLabel: "Wed, Sep 2",
      chatName: "Trip",
    });

    const junk = integrationRunRowToItem(
      runRow({ mode: "carrier-pigeon", status: "exploded", review_mode: "???" }),
      "UTC",
    );
    expect(junk.mode).toBe("export");
    expect(junk.statusValue).toBe("queued");
    expect(junk.statusLabel).toBe("Queued");
    expect(junk.capped).toBe(false);
    expect(junk.reviewMode).toBe("manual");
    expect(junk.reviewModeLabel).toBe("Review each event");
  });

  test("active-run helpers count only queued and running runs", () => {
    const queued = integrationRunRowToItem(runRow({ status: "queued" }), "UTC");
    const running = integrationRunRowToItem(
      runRow({ status: "running" }),
      "UTC",
    );
    const succeeded = integrationRunRowToItem(runRow(), "UTC");
    const failed = integrationRunRowToItem(
      runRow({ status: "failed", error: "The upload never finished." }),
      "UTC",
    );

    expect(isWhatsAppRunActive(queued)).toBe(true);
    expect(isWhatsAppRunActive(running)).toBe(true);
    expect(isWhatsAppRunActive(succeeded)).toBe(false);
    expect(isWhatsAppRunActive(failed)).toBe(false);
    expect(activeRunCount([queued, running, succeeded, failed])).toBe(2);
    expect(activeRunCount([])).toBe(0);
  });
});

test.describe("whatsapp connection mapping (pure)", () => {
  test("exposes the saved review mode and label", () => {
    const item = connectionRowToItem(
      connectionRow({ review_mode: "automatic", status: "connected" }),
    );
    expect(item).toEqual({
      id: CONNECTION_ID,
      statusValue: "connected",
      statusLabel: "Connected",
      reviewMode: "automatic",
      reviewModeLabel: "Add automatically",
      dateOrder: "DMY",
      detectRelativeDates: false,
    });
  });

  test("falls back to the manual default for a legacy row", () => {
    const item = connectionRowToItem(
      connectionRow({ review_mode: "sometimes" }),
    );
    expect(item.reviewMode).toBe("manual");
    expect(item.reviewModeLabel).toBe("Review each event");
  });

  test("maps the saved detection settings with defensive defaults", () => {
    /* C4 — the connection's saved date order / relative-date toggle drive the
       upload controls' preselect; a vocabulary miss or a missing legacy value
       falls back to the documented defaults instead of reaching the UI. */
    const saved = connectionRowToItem(
      connectionRow({ date_order: "MDY", detect_relative_dates: true }),
    );
    expect(saved.dateOrder).toBe("MDY");
    expect(saved.detectRelativeDates).toBe(true);

    const legacy = connectionRowToItem(
      connectionRow({
        date_order: "YMD" as never,
        detect_relative_dates: undefined as never,
      }),
    );
    expect(legacy.dateOrder).toBe("DMY");
    expect(legacy.detectRelativeDates).toBe(false);
  });
});

test.describe("whatsapp candidate mapping (pure)", () => {
  test("maps a timed pending candidate with zone-aware date and time", () => {
    expect(integrationCandidateRowToItem(candidateRow(), "UTC")).toEqual({
      id: CANDIDATE_ID,
      title: "Birthday party",
      statusValue: "pending",
      statusLabel: "Needs review",
      allDay: false,
      startAt: "2026-09-02T13:00:00.000Z",
      dateLabel: "Wed, Sep 2",
      timeLabel: "1:00 PM",
      messageSender: "Areeb",
      messageText: "Birthday party on Sep 2 at 9am",
      pushed: false,
      pushFailed: false,
    });
  });

  test("an all-day candidate carries no clock and derives push state", () => {
    const item = integrationCandidateRowToItem(
      candidateRow({
        all_day: true,
        start_at: "2026-09-02T04:00:00.000Z",
        status: "confirmed",
        pushed_at: "2026-09-02T09:05:00.000Z",
      }),
      "America/New_York",
    );

    expect(item).toEqual({
      id: CANDIDATE_ID,
      title: "Birthday party",
      statusValue: "confirmed",
      statusLabel: "Added",
      allDay: true,
      startAt: "2026-09-02T04:00:00.000Z",
      dateLabel: "Wed, Sep 2",
      messageSender: "Areeb",
      messageText: "Birthday party on Sep 2 at 9am",
      pushed: true,
      pushFailed: false,
    });
    expect("timeLabel" in item).toBe(false);
  });

  test("a push failure is a flag, never raw error text in the item", () => {
    const item = integrationCandidateRowToItem(
      candidateRow({
        status: "confirmed",
        push_error:
          "Google authorization expired (invalid_grant); reconnect Google Calendar.",
      }),
      "UTC",
    );

    expect(item.pushFailed).toBe(true);
    expect(item.pushed).toBe(false);
    expect(item.statusLabel).toBe("Added");
    expect(JSON.stringify(item)).not.toMatch(/invalid_grant/);

    const junk = integrationCandidateRowToItem(
      candidateRow({ status: "maybe" }),
      "UTC",
    );
    expect(junk.statusValue).toBe("pending");
    expect(junk.statusLabel).toBe("Needs review");
  });
});

/* ---------------------------------------------------------------------------
 * The rendered contract (P5.1). The server flags are read from the same
 * `.env.development.local` the Playwright config loads, so a spec never
 * asserts a state this server cannot be in.
 * ------------------------------------------------------------------------- */

const GOOGLE_CONFIGURED = Boolean(
  process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET,
);
const LIVE_ENABLED = process.env.UNIPILOT_WHATSAPP_LIVE === "1";

/** The panel's explanatory line for the not-configured state (P7.2). */
const GOOGLE_NOT_CONFIGURED_DETAIL = /no Google Calendar OAuth client/i;

/**
 * Task B4 — the card blurb must not promise "nothing is added without you"
 * once "Add automatically" is a real, selectable path; it names the choice
 * instead. Exact copy so a reword has to be deliberate.
 */
const WHATSAPP_CARD_BLURB =
  "Import events from your exported chats. You choose whether each event waits for review or is added automatically.";

test.describe("integrations page states", () => {
  let releaseWorkerLock: (() => void) | null = null;

  test.beforeAll(async () => {
    // P7.2's backfill proof in `whatsapp-security.spec.ts` seeds QA1's google
    // row and asserts absolute job counts; a targeted `--no-deps` run
    // parallelizes the two files, so both take the shared worker lock and the
    // seeded window stays single-writer (see workerLock.ts). In the full
    // suite the project dependency chain already sequences the specs, so the
    // lock is uncontended there.
    releaseWorkerLock = await acquireWorkerLock();
  });

  test.afterAll(() => {
    releaseWorkerLock?.();
    releaseWorkerLock = null;
  });

  test("authenticated: real WhatsApp card, Gmail still coming soon", async ({
    page,
  }) => {
    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");
    const main = page.locator("main");

    await expect(
      main.getByRole("button", { name: "Upload a WhatsApp export" }),
    ).toBeVisible();

    const whatsapp = main.locator("li").filter({ hasText: "WhatsApp" }).first();
    await expect(whatsapp.locator("[data-whatsapp-connection]")).toHaveText(
      "Not connected",
    );
    await expect(
      whatsapp.getByText("Connected", { exact: true }),
    ).toHaveCount(0);

    const gmail = main.locator("li").filter({ hasText: "Gmail" }).first();
    await expect(gmail.getByText("Coming soon")).toBeVisible();
    await expect(gmail.getByText("Not connected")).toBeVisible();

    await expect(main.getByRole("button", { name: /connect/i })).toHaveCount(0);
  });

  test("the card blurb names the review choice instead of promising review", async ({
    page,
  }) => {
    /* Task B4: with "Add automatically" selectable, the old "Nothing is added
       without you" promise is false; the card must state the choice it
       actually offers, and the old phrase must be gone from the card. */
    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");
    const whatsapp = page
      .locator("main li")
      .filter({ hasText: "WhatsApp" })
      .first();

    await expect(whatsapp.getByText(WHATSAPP_CARD_BLURB)).toBeVisible();
    await expect(
      whatsapp.getByText(/Nothing is added without you/),
    ).toHaveCount(0);
  });

  test("guest: actions route to the skippable sign-in prompt", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    const dataReads: string[] = [];
    page.on("request", (request) => {
      if (/\/rest\/v1\//.test(request.url())) dataReads.push(request.url());
    });

    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-signed-in="false"]')).toBeAttached();

    /* P6.1 — a guest never sees a live control: the flag-off render has no
       panel at all, so there is nothing that could fetch or open Chrome. */
    await expect(page.locator("[data-live-enabled]")).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: /link live whatsapp|scan this chat|disconnect/i,
      }),
    ).toHaveCount(0);

    /* P7.2 — a guest never sees an active Google control either: connect and
       reconnect are the only Google actions that could ever render, and the
       panel has none to show a signed-out visitor. */
    await expect(
      page.getByRole("button", { name: /connect google calendar/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /reconnect google calendar/i }),
    ).toHaveCount(0);

    await page
      .getByRole("button", { name: "Upload a WhatsApp export" })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Sign in to continue");
    await expect(dialog).toContainText("Continue browsing");
    await expect(dialog).toContainText("Sign in to connect WhatsApp.");

    expect(dataReads, "guest actions must not query the database").toEqual([]);
    await context.close();
  });

  test("live panel explains the self-host requirement when disabled", async ({
    page,
  }) => {
    test.skip(
      LIVE_ENABLED,
      "live is enabled locally; the flag-off copy cannot be asserted.",
    );
    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText(/self-hosted worker with a browser/i),
    ).toBeVisible();
    /* The flag-off copy lives in the card, not a panel host: the panel is
       absent entirely, so no live control and no QR image can exist. */
    await expect(page.locator("[data-live-enabled]")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /link live whatsapp/i }),
    ).toHaveCount(0);
    await expect(page.getByRole("img", { name: /QR/i })).toHaveCount(0);
  });

  test("google status reports the server's configuration honestly", async ({
    page,
  }) => {
    test.skip(
      GOOGLE_CONFIGURED,
      "the OAuth env pair is present; the not-configured state cannot be asserted.",
    );
    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");
    const main = page.locator("main");
    const panel = main.locator('[data-google-status="not_configured"]');

    await expect(panel, "the panel reports its real state").toBeVisible();
    await expect(panel.getByText("Not configured on this server")).toBeVisible();
    await expect(panel.getByText(GOOGLE_NOT_CONFIGURED_DETAIL)).toBeVisible();
    /* No control at all: connecting is impossible on this server, so the panel
       must not offer a dead button. */
    await expect(panel.getByRole("button")).toHaveCount(0);
    await expect(
      main.getByRole("button", { name: /connect google/i }),
    ).toHaveCount(0);
    await expect(
      main.getByRole("button", { name: /reconnect google/i }),
    ).toHaveCount(0);
  });

  test("review mode: both options render, the choice sticks, and the upload carries it", async ({
    page,
  }) => {
    /* Task 46.21 — every server-action POST is aborted (and its body kept) so
       the upload attempt can prove its payload without reserving anything. */
    const actionBodies: string[] = [];
    await page.route(/\/integrations(\?|$)/, async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"]) {
        actionBodies.push(request.postData() ?? "");
        await route.abort();
        return;
      }
      await route.continue();
    });

    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");

    const manual = page.getByRole("radio", { name: "Review each event" });
    const automatic = page.getByRole("radio", { name: "Add automatically" });
    const reviewGroup = page.getByRole("radiogroup", { name: "Review mode" });
    await expect(reviewGroup).toBeVisible();
    /* Scoped to the review group: C4 adds its own two-option date-order group
       beside it, so the page-wide radio count is no longer the contract. */
    await expect(reviewGroup.getByRole("radio")).toHaveCount(2);
    await expect(manual).toBeVisible();
    await expect(automatic).toBeVisible();

    /* QA1 has no saved default at rest, so the choice starts on manual and the
       manual sentence is the one shown. */
    await expect(manual).toBeChecked();
    await expect(
      page.getByText("Detected events wait for your review."),
    ).toBeVisible();

    /* The visible pill is the label; clicking it toggles the hidden radio. */
    await page.getByText("Add automatically", { exact: true }).click();
    await expect(automatic).toBeChecked();
    await expect(manual).not.toBeChecked();
    await expect(
      page.getByText(
        "Detected events are added to your calendar when the scan finishes.",
      ),
    ).toBeVisible();

    /* The next upload attempt must carry the selection. The intercepted
       action is aborted before it can reserve, so nothing is written. */
    actionBodies.length = 0;
    await page.setInputFiles('input[type="file"]', SAMPLE);
    await expect
      .poll(() =>
        actionBodies.some((body) =>
          body.includes('"reviewMode":"automatic"'),
        ),
      )
      .toBe(true);
  });
});

/* ---------------------------------------------------------------------------
 * P9.1 — the queued-state honesty check. An upload only reserves a `queued`
 * row; the Task 29.1 worker is what scans it. A run stuck `queued` must say so
 * on the card. The spec seeds the row through the service role (the UI path
 * needs a real upload + Python), holds the shared worker lock (`workerLock.ts`)
 * for the seeded window so the export spec's `integration_runs` residue count
 * cannot see it under a targeted `--no-deps` run, and deletes it by id.
 * ------------------------------------------------------------------------- */

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";
const QA1 = "qa.unipilot@unipilot.test";

/** The exact line a queued scan must render (P9.1). */
const QUEUED_WORKER_COPY =
  "Waiting for the background worker to pick this scan up.";

test.describe("queued scan honesty (P9.1)", () => {
  let service: SupabaseClient;
  let qa1Id = "";

  test.beforeAll(async () => {
    if (!LOCAL_TARGET.test(url)) throw new Error(`local-only; refusing ${url}`);
    if (!anonKey || !serviceKey) throw new Error("missing local keys");
    service = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });
    const qa1 = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await qa1.auth.signInWithPassword({
      email: QA1,
      password: qa1Password,
    });
    expect(error, `sign-in: ${error?.message}`).toBeNull();
    qa1Id = data.user!.id;
  });

  test("a queued run names the missing background worker", async ({ page }) => {
    /* One writer at a time: the export spec holds this lock for its whole run
       and asserts zero QA1 integration residue when it releases; seeding
       outside the lock would race that count under --no-deps. */
    const releaseWorkerLock = await acquireWorkerLock();
    const runId = randomUUID();
    try {
      const { error } = await service.from("integration_runs").insert({
        id: runId,
        user_id: qa1Id,
        mode: "export",
        status: "queued",
        // The unique marker makes the seeded row this spec's to delete.
        storage_path: `${qa1Id}/${runId}/p9-1-${runId}.txt`,
        created_at: new Date().toISOString(),
      });
      expect(error, `seed queued run: ${error?.message}`).toBeNull();

      await page.goto("/integrations");
      await expect(page.locator('[data-signed-in="true"]')).toBeAttached();
      await expect(page.getByText("Queued", { exact: true }).first()).toBeVisible();
      await expect(
        page.getByText(QUEUED_WORKER_COPY, { exact: true }),
      ).toBeVisible();
    } finally {
      try {
        const { error } = await service
          .from("integration_runs")
          .delete()
          .eq("id", runId);
        expect(error, `teardown run ${runId}: ${error?.message}`).toBeNull();
      } finally {
        releaseWorkerLock();
      }
    }
  });
});
