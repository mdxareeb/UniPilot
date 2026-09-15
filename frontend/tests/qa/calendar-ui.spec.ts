/**
 * tests/qa/calendar-ui.spec.ts — Tasks 17.5–17.14's UI flows against the real
 * service.
 *
 * Runs authenticated as QA1 (the qa-events-ui project's storage state) with
 * `qa-auth-setup`, `qa-onboarding` and `qa-events-data` as dependencies, so
 * QA1 is onboarded, the QA subjects are settled and no other event-mutating
 * spec runs concurrently.
 *
 * Every test seeds what it needs through the service role (title-prefixed)
 * and tears the prefix down in `afterEach`, so the spec is repeatable and
 * leaves no residue. The flows are the real UI: create (17.9), the typed
 * blocks and legend (17.5–17.8), month/week rendering, edit and delete
 * (17.10) and a forced-failure rollback. The first test also exercises the
 * pure placement maths (17.14's UI half) directly.
 *
 * Local-only by construction; hosted is never contacted.
 */
import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveEventDraft } from "../../lib/data/eventValues";
import { zonedLocalDateTimeToInstant } from "../../lib/data/taskDates";
import {
  eventDateSpan,
  eventFormValues,
  timedPlacement,
  toEventDraftLocal,
  type EventFormValues,
} from "../../app/(app)/calendar/_components/calendarEvents";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";
const qa2Password = process.env.UNIPILOT_QA2_PASSWORD ?? "";

const QA1 = "qa.unipilot@unipilot.test";
const QA2 = "qa2.unipilot@unipilot.test";

/** Every row this spec creates carries this prefix, so teardown is exact. */
const PREFIX = "UI 17x";

let qa1Id = "";
let qa2Id = "";
let timeZone = "UTC";
let service: SupabaseClient;

/** The server's date as the grid computes it: UTC `YYYY-MM-DD`. */
function serverToday(): string {
  return new Date().toISOString().slice(0, 10);
}

async function signIn(client: SupabaseClient, email: string, password: string) {
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  expect(error, `sign-in failed for ${email}: ${error?.message}`).toBeNull();
  return data.user!.id;
}

/** Seeds one event straight through the service role and returns its id. */
async function seedEvent(
  userId: string,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await service
    .from("events")
    .insert({ user_id: userId, title: `${PREFIX} ${title}`, ...extra })
    .select("id")
    .single();
  expect(error, `seed "${title}": ${error?.message}`).toBeNull();
  return (data as { id: string }).id;
}

/** One event of the spec, in the profile zone the UI renders in. */
function timed(
  day: string,
  start: string,
  end: string,
): Record<string, unknown> {
  return {
    all_day: false,
    start_at: zonedLocalDateTimeToInstant(`${day}T${start}`, timeZone),
    end_at: zonedLocalDateTimeToInstant(`${day}T${end}`, timeZone),
  };
}

async function deleteByPrefix() {
  for (const userId of [qa1Id, qa2Id]) {
    if (!userId) continue;
    const { error } = await service
      .from("events")
      .delete()
      .eq("user_id", userId)
      .like("title", `${PREFIX}%`);
    expect(error, `teardown: ${error?.message}`).toBeNull();
  }
}

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

test.beforeAll(async () => {
  if (!LOCAL_TARGET.test(url)) {
    throw new Error(
      `calendar-ui is local-only; refusing target "${url || "(unset)"}"`,
    );
  }
  if (!anonKey || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY (frontend/.env.development.local)",
    );
  }
  if (!qa1Password || !qa2Password) {
    throw new Error(
      "Missing UNIPILOT_QA_PASSWORD / UNIPILOT_QA2_PASSWORD; seed the identities first (npm run seed:qa)",
    );
  }

  service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  qa1Id = await signIn(createClient(url, anonKey, { auth: { persistSession: false } }), QA1, qa1Password);
  qa2Id = await signIn(createClient(url, anonKey, { auth: { persistSession: false } }), QA2, qa2Password);

  const { data, error } = await service
    .from("profiles")
    .select("timezone")
    .eq("id", qa1Id)
    .maybeSingle();
  expect(error, `profile read: ${error?.message}`).toBeNull();
  timeZone = (data as { timezone: string } | null)?.timezone ?? "UTC";
});

test.afterEach(async () => {
  await deleteByPrefix();
});

test.describe("calendar UI (17.x)", () => {
  test("pure placement: minute offsets, hour rows, spans and the form bridge", () => {
    const base = {
      id: "e1",
      title: "Algorithms",
      startAt: "2026-09-02T09:30:00.000Z",
      allDay: false,
      startDate: "2026-09-02",
      endDateValue: "2026-09-02",
      startTime: "09:30",
      endTime: "11:00",
      durationMinutes: 90,
      dateLabel: "Wed, Sep 2",
    };

    expect(timedPlacement(base)).toEqual({
      hour: 9,
      topPercent: 50,
      heightPercent: 150,
    });

    // A point event reads at the default height; a tiny one never collapses.
    expect(timedPlacement({ ...base, endTime: undefined, durationMinutes: undefined }))
      .toMatchObject({ heightPercent: 50 });
    expect(
      timedPlacement({ ...base, endTime: "09:45", durationMinutes: 15 }),
    ).toMatchObject({ heightPercent: (20 / 60) * 100 });

    // An all-day event has no time placement; the month chip owns it.
    expect(timedPlacement({ ...base, allDay: true })).toBeNull();

    // Coverage: an all-day end is exclusive; a timed end date is inclusive.
    expect(
      eventDateSpan({
        ...base,
        allDay: true,
        startDate: "2026-09-02",
        endDateValue: "2026-09-04",
      }),
    ).toEqual({ start: "2026-09-02", endExclusive: "2026-09-04" });
    expect(
      eventDateSpan({ ...base, endDateValue: "2026-09-03" }).endExclusive,
    ).toBe("2026-09-04");

    // The form bridge speaks the service's wall-clock shapes.
    const values: EventFormValues = {
      title: "  Stats  ",
      type: "exam",
      allDay: false,
      startDate: "2026-09-02",
      startTime: "09:30",
      endDate: "2026-09-02",
      endTime: "11:00",
      location: "  Hall B ",
      subjectId: "",
    };
    expect(toEventDraftLocal(values)).toMatchObject({
      title: "Stats",
      type: "exam",
      startAt: "2026-09-02T09:30",
      endAt: "2026-09-02T11:00",
      location: "Hall B",
      subjectId: null,
    });
    // All-day ends come back as the last real day, not the exclusive next one.
    expect(
      eventFormValues({
        ...base,
        allDay: true,
        startDate: "2026-09-02",
        endDateValue: "2026-09-05",
      }).endDate,
    ).toBe("2026-09-04");
  });

  test("create: a class event appears in month and week, then persists", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    const today = serverToday();
    const title = `${PREFIX} created class`;

    const { data: subjects } = await service
      .from("subjects")
      .select("id, name")
      .eq("user_id", qa1Id)
      .order("name", { ascending: true })
      .limit(1);
    const course = (subjects ?? [])[0] as { id: string; name: string } | undefined;

    await page.goto("/calendar");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    await page.getByRole("button", { name: "Add event" }).click();
    const dialog = page.getByRole("dialog", { name: "New event" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Title").fill(title);
    await dialog.getByRole("combobox", { name: "Type" }).click();
    await dialog.getByRole("option", { name: "Class", exact: true }).click();
    if (course) {
      await dialog.getByRole("combobox", { name: /Course/ }).click();
      await dialog
        .getByRole("option", { name: course.name, exact: true })
        .click();
    }
    await dialog.getByLabel("Starts").fill(`${today}T09:00`);
    await dialog.getByLabel("Ends").fill(`${today}T10:30`);
    await dialog.getByRole("button", { name: "Add event" }).click();

    await expect(dialog).not.toBeVisible();

    // Month: the real chip, with the typed accessible name.
    const chip = page.getByRole("button", {
      name: new RegExp(`^Class: ${title}, 9:00 AM – 10:30 AM`),
    });
    await expect(chip).toBeVisible();

    // Week: the block sits in the 09:00 row with the exact geometry.
    await page
      .getByRole("group", { name: "Calendar view" })
      .getByRole("button", { name: "Week" })
      .click();
    await page.waitForTimeout(400);
    const block = page.locator('[data-event-id]').filter({ visible: true }).first();
    await expect(block).toBeVisible();
    await expect(block).toHaveCSS("top", "0px");
    const style = await block.getAttribute("style");
    expect(style).toContain("top: 0%");
    expect(style).toContain("height: 150%");

    // Persistence: a fresh server render still carries it.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("button", {
        name: new RegExp(`^Class: ${title}, 9:00 AM – 10:30 AM`),
      }),
    ).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("typed blocks + legend: class, exam and deadline render their own treatment", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    const today = serverToday();
    await seedEvent(qa1Id, "typed class", { type: "class", ...timed(today, "09:00", "10:00") });
    await seedEvent(qa1Id, "typed exam", { type: "exam", ...timed(today, "11:00", "12:00") });
    await seedEvent(qa1Id, "typed deadline", { type: "deadline", ...timed(today, "13:00", "13:30") });

    await page.goto("/calendar");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    // 17.8: the legend names the vocabulary exactly once.
    const legend = page.getByRole("list", { name: "Event types" });
    await expect(legend).toBeVisible();
    for (const label of ["Class", "Exam", "Deadline"]) {
      await expect(legend.getByText(label, { exact: true })).toBeVisible();
    }

    // Month chips carry the type in their accessible names.
    for (const [type, word] of [
      ["class", "Class"],
      ["exam", "Exam"],
      ["deadline", "Deadline"],
    ] as const) {
      await expect(
        page.getByRole("button", {
          name: new RegExp(`^${word}: ${PREFIX} typed ${type},`),
        }),
      ).toBeVisible();
    }

    // Week blocks: each starts in its own hour row.
    await page
      .getByRole("group", { name: "Calendar view" })
      .getByRole("button", { name: "Week" })
      .click();
    await page.waitForTimeout(400);
    await expect(
      page.getByRole("button", { name: /^Exam: UI 17x typed exam, 11:00 AM – 12:00 PM/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Deadline: UI 17x typed deadline, 1:00 PM – 1:30 PM/ }),
    ).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("all-day span: a chip on every covered month day and in the week band", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    const today = serverToday();
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    // Resolve through the app's own draft maths, so the stored span is
    // exactly what the form would write: an exclusive next-day end.
    const span = resolveEventDraft(
      {
        title: `${PREFIX} reading days`,
        type: null,
        allDay: true,
        startAt: today,
        endAt: tomorrow,
        location: null,
        description: null,
        subjectId: null,
      },
      timeZone,
    );
    await seedEvent(qa1Id, "reading days", {
      all_day: true,
      start_at: span.startAt,
      end_at: span.endAt,
    });

    await page.goto("/calendar");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    const chips = page.getByRole("button", {
      name: new RegExp(`^Event: ${PREFIX} reading days`),
    });
    // One per covered date: today and tomorrow (the exclusive end is a day,
    // not an event).
    await expect(chips).toHaveCount(2);

    await page
      .getByRole("group", { name: "Calendar view" })
      .getByRole("button", { name: "Week" })
      .click();
    await page.waitForTimeout(400);
    await expect(
      page.getByRole("button", { name: /reading days, All day/ }).first(),
    ).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("detail: edit updates the block, delete removes it after confirmation", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    const today = serverToday();
    const id = await seedEvent(qa1Id, "editable", {
      type: "exam",
      ...timed(today, "14:00", "15:00"),
    });

    await page.goto("/calendar");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    const chip = page.locator(`[data-event-id="${id}"]`).filter({ visible: true });
    await chip.click();
    await expect(page).toHaveURL(new RegExp(`event=${id}`));
    const detail = page.getByRole("dialog");
    await expect(detail).toContainText(`${PREFIX} editable`);
    await expect(detail).toContainText("Exam");

    await detail.getByRole("button", { name: "Edit event" }).click();
    const form = page.getByRole("dialog", { name: "Edit event" });
    await form.getByLabel("Title").fill(`${PREFIX} edited`);
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(form).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Exam: UI 17x edited,/ }),
    ).toBeVisible();

    // Delete: detail → confirmation → gone, and still gone after reload.
    await page
      .locator(`[data-event-id="${id}"]`)
      .filter({ visible: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`event=${id}`));
    await page.getByRole("dialog").getByRole("button", { name: "Delete event" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete this event?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Delete event" }).click();
    await expect(confirm).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: /UI 17x edited/ }),
    ).toHaveCount(0);

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("button", { name: /UI 17x edited/ }),
    ).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("detail: a foreign or fabricated id is not found", async ({ page }) => {
    const today = serverToday();
    const foreignId = await seedEvent(qa2Id, "foreign", {
      type: "class",
      ...timed(today, "10:00", "11:00"),
    });

    await page.goto(`/calendar?event=${foreignId}`);
    await expect(page.getByRole("dialog")).toContainText("Event not found");

    await page.goto("/calendar?event=not-a-uuid");
    await expect(page.getByRole("dialog")).toContainText("Event not found");
  });

  test("forced failure: the optimistic delete rolls back with sanitized copy", async ({
    page,
  }) => {
    const today = serverToday();
    const id = await seedEvent(qa1Id, "failure rollback", {
      type: "deadline",
      ...timed(today, "16:00", "16:30"),
    });

    await page.goto("/calendar");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    // Fail only the Server Action POST; page navigations continue normally.
    await page.route("**/calendar", async (route) => {
      if (route.request().method() === "POST") {
        await route.abort();
      } else {
        await route.continue();
      }
    });

    await page.locator(`[data-event-id="${id}"]`).filter({ visible: true }).click();
    const detail = page.getByRole("dialog", {
      name: `${PREFIX} failure rollback`,
    });
    await detail.getByRole("button", { name: "Delete event" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete this event?" });
    await confirm.getByRole("button", { name: "Delete event" }).click();

    await expect(
      confirm.getByRole("alert"),
    ).toContainText("We couldn't delete that event");
    await expect(
      page.locator(`[data-event-id="${id}"]`).filter({ visible: true }),
    ).toBeVisible();

    await page.unroute("**/calendar");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(
      page.locator(`[data-event-id="${id}"]`).filter({ visible: true }),
    ).toBeVisible();
  });

  test("guest: the real calendar renders and offers sign-in, never data", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      // `browser.newContext()` inherits the project's storage state; an
      // empty one is what makes this a real guest (fonts.spec.ts's note).
      storageState: { cookies: [], origins: [] },
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    const errors = trackConsoleErrors(page);

    await page.goto("/calendar");
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { level: 1, name: "Calendar" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Sign in to add classes, exams and deadlines to your calendar.",
      ),
    ).toBeVisible();
    await expect(page.locator("[data-event-id]")).toHaveCount(0);

    await page.getByRole("button", { name: "Add event" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
    await context.close();
  });

  test("reduced motion: the dialog opens and closes instantly", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState:
        process.env.QA_STORAGE_STATE ?? ".playwright/qa-session.json",
      reducedMotion: "reduce",
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    const errors = trackConsoleErrors(page);

    await page.goto("/calendar");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    await page.getByRole("button", { name: "Add event" }).click();
    const dialog = page.getByRole("dialog", { name: "New event" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Title")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Add event" })).toBeFocused();

    expect(errors, errors.join("\n")).toEqual([]);
    await context.close();
  });
});
