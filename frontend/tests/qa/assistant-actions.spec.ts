/**
 * tests/qa/assistant-actions.spec.ts — Tasks 27.1/27.8 (T27-A) and 27.2–27.6/
 * 27.9/27.11/27.13 (T27-B) proof.
 *
 * Three layers, both against the real local stack:
 *
 * 1. the pure 27.1 contract: valid/invalid/bounds cases per type, the closed
 *    type union, the forced confirmation gate, the honest summary copy and the
 *    execution drafts — every normalized draft is re-parsed by the very
 *    service parser the executor will call (`parseTaskDraft`,
 *    `parseEventDraft`, `parsePresentationRequest`), so the contract and the
 *    services cannot drift;
 * 2. the real `assistant_actions` table: a QA session reads its own row
 *    through RLS and cannot write at all, the service role writes and settles
 *    it, `(user_id, idempotency_key)` rejects a duplicate, the closed
 *    vocabularies are CHECKs, `message_id` detaches on message delete (SET
 *    NULL) and the conversation cascade removes the log rows;
 * 3. the T27-B engine itself — `assistantActionLog.ts` register/list/confirm/
 *    reject/execute — driven against the real database and the real task/
 *    event/document tables: registration idempotency (27.9), owner-verified
 *    links (27.5), the created rows' exact values (27.2–27.4), reminder
 *    instants in the profile zone (R1), rejection that writes nothing,
 *    settle-once/double-confirm (27.13) and the honest not-available
 *    presentation failure (27.10's boundary).
 *
 * The engine's reads/writes run through the same session clients the app's
 * request path uses (`lib/supabase/server` needs a Next request context, so a
 * Playwright worker passes the signed-in QA client explicitly) — RLS and the
 * owner filters are still what authorize every row touched.
 *
 * Id-scoped teardown: this spec creates only conversations/messages/actions/
 * tasks/events/documents for the QA users and deletes exactly those (plus its
 * own idempotency-key prefix as a backstop), so it never touches the documents
 * bucket, storage objects, jobs or the other projects' rows. Local-only;
 * hosted is never contacted.
 */
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  ASSISTANT_ACTION_TYPES,
  normalizeAssistantActionForExecution,
  parseAssistantAction,
  summarizeAssistantAction,
} from "../../lib/ai/actionSchema";
import {
  collectStructuredActions,
  parseAssistantAction as parseAssistantActionFromContracts,
  parseStructuredAction,
  STRUCTURED_ACTION_INSTRUCTION,
} from "../../lib/ai/toolContracts";
import {
  ASSISTANT_ACTION_COPY,
  assistantActionIdempotencyKey,
  confirmAssistantAction,
  executeAssistantAction,
  listAssistantActions,
  registerAssistantProposals,
  rejectAssistantAction,
  type AssistantActionItem,
} from "../../lib/data/assistantActionLog";
import { parseTaskDraft } from "../../lib/data/taskValues";
import { parseEventDraft } from "../../lib/data/eventValues";
import { parsePresentationRequest } from "../../lib/data/presentationValues";
import {
  instantToZonedLocalDateTime,
  zonedDateOnlyToInstant,
  zonedLocalDateTimeToInstant,
} from "../../lib/data/taskDates";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";
const qa2Password = process.env.UNIPILOT_QA2_PASSWORD ?? "";

const QA1 = "qa.unipilot@unipilot.test";
const QA2 = "qa2.unipilot@unipilot.test";

/** Every row this spec writes carries this prefix (idempotency-key sweep). */
const PREFIX = "UI 27a";
/** T27-B's rows (tasks/events/documents/conversations) carry this one. */
const PREFIX_B = "UI 27b";

const UUID_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const UUID_B = "9c858901-8a57-4791-81fe-4c455b099bc9";

let qa1Id = "";
let qa2Id = "";
let service: SupabaseClient;
let qa1: SupabaseClient;
let qa2: SupabaseClient;

/** Conversations and action rows this spec created, by id (id-scoped teardown). */
const createdConversationIds: string[] = [];
const createdActionIds: string[] = [];
/** T27-B's created domain rows, by id. */
const createdTaskIds: string[] = [];
const createdEventIds: string[] = [];
const createdDocumentIds: string[] = [];

async function signIn(
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<string> {
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  expect(error, `sign-in failed for ${email}: ${error?.message}`).toBeNull();
  return data.user!.id;
}

async function cleanup() {
  if (createdTaskIds.length > 0) {
    await service.from("tasks").delete().in("id", createdTaskIds);
    createdTaskIds.length = 0;
  }
  if (createdEventIds.length > 0) {
    await service.from("events").delete().in("id", createdEventIds);
    createdEventIds.length = 0;
  }
  if (createdDocumentIds.length > 0) {
    await service.from("documents").delete().in("id", createdDocumentIds);
    createdDocumentIds.length = 0;
  }
  if (createdConversationIds.length > 0) {
    await service.from("conversations").delete().in("id", createdConversationIds);
    createdConversationIds.length = 0;
  }
  if (createdActionIds.length > 0) {
    await service.from("assistant_actions").delete().in("id", createdActionIds);
    createdActionIds.length = 0;
  }
  for (const userId of [qa1Id, qa2Id]) {
    if (!userId) continue;
    await service
      .from("assistant_actions")
      .delete()
      .eq("user_id", userId)
      .like("idempotency_key", `${PREFIX}%`);
  }
}

test.beforeAll(async () => {
  if (!LOCAL_TARGET.test(url)) {
    throw new Error(
      `assistant-actions is local-only; refusing target "${url || "(unset)"}"`,
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
  qa1 = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  qa2 = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  qa1Id = await signIn(qa1, QA1, qa1Password);
  qa2Id = await signIn(qa2, QA2, qa2Password);
});

test.afterEach(async () => {
  await cleanup();
});

// ---------------------------------------------------------------------------
// T27-B helpers — the engine's inputs and the assertions' reads
// ---------------------------------------------------------------------------

/** One fenced `unipilot-action` block, exactly as the provider contract emits. */
function fence(action: unknown): string {
  return ["```unipilot-action", JSON.stringify(action), "```"].join("\n");
}

/** The QA user's profile zone, the same one the services resolve dates in. */
async function profileZone(
  client: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data, error } = await client
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .single();
  expect(error).toBeNull();
  return data!.timezone;
}

/**
 * One real conversation (+ optionally its assistant message) and a real
 * registration of `content`, returning the proposal items. Every id is
 * tracked for the id-scoped teardown.
 */
async function registerFenced(
  userId: string,
  content: string,
  options: { message?: boolean } = {},
): Promise<{
  conversationId: string;
  messageId: string | null;
  items: AssistantActionItem[];
}> {
  const { data: conversation, error } = await service
    .from("conversations")
    .insert({ user_id: userId, title: `${PREFIX_B} conversation` })
    .select("id")
    .single();
  expect(error).toBeNull();
  createdConversationIds.push(conversation!.id);

  let messageId: string | null = null;
  if (options.message !== false) {
    const { data: message, error: messageError } = await service
      .from("messages")
      .insert({
        conversation_id: conversation!.id,
        role: "assistant",
        content,
      })
      .select("id")
      .single();
    expect(messageError).toBeNull();
    messageId = message!.id;
  }

  const result = await registerAssistantProposals(userId, {
    conversationId: conversation!.id,
    messageId,
    content,
  });
  expect(result.status).toBe("ok");
  const items = result.status === "ok" ? result.items : [];
  createdActionIds.push(...items.map((item) => item.id));
  return { conversationId: conversation!.id, messageId, items };
}

/** The stored log row for one action id (service read; no RLS ambiguity). */
async function storedAction(actionId: string) {
  const { data, error } = await service
    .from("assistant_actions")
    .select("id, status, result, error, settled_at, idempotency_key, message_id")
    .eq("id", actionId)
    .maybeSingle();
  expect(error).toBeNull();
  return data;
}

/** The stored task row for one id, service read for exact column values. */
async function storedTask(taskId: string) {
  const { data, error } = await service
    .from("tasks")
    .select(
      "id, title, description, due_date, priority, status, source_document_id",
    )
    .eq("id", taskId)
    .maybeSingle();
  expect(error).toBeNull();
  return data;
}

test.describe("assistant action contract (27.1)", () => {
  test("task.create: bounds mirror the task service, confirmation is forced", () => {
    const action = parseAssistantAction({
      type: "task.create",
      payload: {
        title: "  Buy milk  ",
        description: " 2% ",
        dueDate: "2026-09-25",
        effortMinutes: 30,
        priority: "high",
        documentId: UUID_A,
      },
      // The model cannot turn the gate off; the parser ignores it.
      requiresConfirmation: false,
    });
    expect(action).toEqual({
      type: "task.create",
      payload: {
        title: "Buy milk",
        description: "2%",
        dueDate: "2026-09-25",
        effortMinutes: 30,
        priority: "high",
        documentId: UUID_A,
      },
      requiresConfirmation: true,
    });

    const summary = summarizeAssistantAction(action!);
    expect(summary).toBe(
      "Create task: Buy milk — due Fri, Sep 25 — 30 min — High priority — from a document",
    );
    expect(summary).not.toContain("Created");

    // The executor's draft is exactly what the task service re-validates.
    const execution = normalizeAssistantActionForExecution(action!);
    expect(execution).toEqual({
      type: "task.create",
      draft: {
        title: "Buy milk",
        description: "2%",
        dueDate: "2026-09-25",
        effortMinutes: 30,
        priority: "high",
      },
      documentId: UUID_A,
    });
    expect(parseTaskDraft(execution.draft)).toEqual(execution.draft);

    const minimal = parseAssistantAction({
      type: "task.create",
      payload: { title: "Read chapter 4" },
    });
    expect(minimal).toEqual({
      type: "task.create",
      payload: {
        title: "Read chapter 4",
        description: null,
        dueDate: null,
        effortMinutes: null,
        priority: null,
        documentId: null,
      },
      requiresConfirmation: true,
    });
    expect(summarizeAssistantAction(minimal!)).toBe("Create task: Read chapter 4");

    const invalid: unknown[] = [
      { type: "task.create", payload: { title: "" } },
      { type: "task.create", payload: { title: "x".repeat(81) } },
      { type: "task.create", payload: { title: "ok", dueDate: "2026-02-30" } },
      // A due date is a calendar date; an instant is not a date-only value.
      {
        type: "task.create",
        payload: { title: "ok", dueDate: "2026-09-25T10:00:00Z" },
      },
      { type: "task.create", payload: { title: "ok", effortMinutes: 0 } },
      { type: "task.create", payload: { title: "ok", effortMinutes: 10_081 } },
      { type: "task.create", payload: { title: "ok", priority: "urgent" } },
      {
        type: "task.create",
        payload: { title: "ok", description: "x".repeat(2_001) },
      },
      { type: "task.create", payload: { title: "ok", documentId: "nope" } },
    ];
    for (const value of invalid) {
      expect(parseAssistantAction(value), JSON.stringify(value)).toBeNull();
    }
  });

  test("reminder.create: day-granular, R1's TaskDraft", () => {
    const action = parseAssistantAction({
      type: "reminder.create",
      payload: { title: "Call mum", remindAt: "2026-09-25" },
    });
    // The day is kept verbatim; the tasks service resolves the zone.
    expect(action).toEqual({
      type: "reminder.create",
      payload: { title: "Call mum", remindAt: "2026-09-25" },
      requiresConfirmation: true,
    });
    expect(summarizeAssistantAction(action!)).toBe(
      "Create reminder: Call mum — due Fri, Sep 25",
    );

    // R1 + day granularity: the executor gets the exact TaskDraft createTask
    // takes, whose date-only is resolved to 00:00 in the profile's zone.
    const execution = normalizeAssistantActionForExecution(action!);
    expect(execution).toEqual({
      type: "reminder.create",
      draft: {
        title: "Call mum",
        description: null,
        dueDate: "2026-09-25",
        effortMinutes: null,
        priority: null,
      },
    });
    expect(parseTaskDraft(execution.draft)).toEqual(execution.draft);

    const invalid: unknown[] = [
      { type: "reminder.create", payload: { title: "ok", remindAt: "tomorrow" } },
      // Not a real date, even though Date.parse accepts and rolls it.
      {
        type: "reminder.create",
        payload: { title: "ok", remindAt: "2026-02-30" },
      },
      // Day-granular by ruling: time-bearing and instant values are rejected,
      // never truncated to a day that would move the reminder.
      {
        type: "reminder.create",
        payload: { title: "ok", remindAt: "2026-09-25T15:00" },
      },
      {
        type: "reminder.create",
        payload: { title: "ok", remindAt: "2026-09-25T15:00:00Z" },
      },
      {
        type: "reminder.create",
        payload: { title: "ok", remindAt: "2026-09-25T15:00:00+02:00" },
      },
      // Impossible instants that Date.parse rolls forward, all rejected.
      {
        type: "reminder.create",
        payload: { title: "ok", remindAt: "2026-02-30T15:00:00Z" },
      },
      {
        type: "reminder.create",
        payload: { title: "ok", remindAt: "2026-04-31T10:00:00Z" },
      },
      {
        type: "reminder.create",
        payload: { title: "ok", remindAt: "2026-09-25T24:00:00Z" },
      },
      // Non-padded dates are not the day shape either.
      {
        type: "reminder.create",
        payload: { title: "ok", remindAt: "2026-9-25" },
      },
      { type: "reminder.create", payload: { title: "ok" } },
      {
        type: "reminder.create",
        payload: { title: "x".repeat(81), remindAt: "2026-09-25" },
      },
    ];
    for (const value of invalid) {
      expect(parseAssistantAction(value), JSON.stringify(value)).toBeNull();
    }
  });

  test("event.create: the form's wall-clock shape, real dates, ordered end", () => {
    const timed = parseAssistantAction({
      type: "event.create",
      payload: {
        title: "Calculus",
        startAt: "2026-09-25T14:00",
        endAt: "2026-09-25T15:30",
        location: "Room 4",
      },
    });
    expect(timed).toEqual({
      type: "event.create",
      payload: {
        title: "Calculus",
        startAt: "2026-09-25T14:00",
        endAt: "2026-09-25T15:30",
        allDay: false,
        location: "Room 4",
        description: null,
        documentId: null,
      },
      requiresConfirmation: true,
    });
    expect(summarizeAssistantAction(timed!)).toBe(
      "Create event: Calculus — Fri, Sep 25, 2:00 PM – 3:30 PM — at Room 4",
    );

    const allDay = parseAssistantAction({
      type: "event.create",
      payload: {
        title: "Reading week",
        startAt: "2026-09-28",
        endAt: "2026-09-30",
        allDay: true,
      },
    });
    expect(summarizeAssistantAction(allDay!)).toBe(
      "Create event: Reading week — Mon, Sep 28 – Wed, Sep 30 (all day)",
    );

    // The executor's draft is exactly what the events service re-validates.
    const execution = normalizeAssistantActionForExecution(timed!);
    expect(execution).toEqual({
      type: "event.create",
      draft: {
        title: "Calculus",
        type: null,
        startAt: "2026-09-25T14:00",
        endAt: "2026-09-25T15:30",
        allDay: false,
        location: "Room 4",
        description: null,
        subjectId: null,
      },
      documentId: null,
    });
    expect(parseEventDraft(execution.draft)).toEqual(execution.draft);

    const invalid: unknown[] = [
      {
        type: "event.create",
        payload: {
          title: "ok",
          startAt: "2026-09-25T15:00",
          endAt: "2026-09-25T14:00",
        },
      },
      {
        type: "event.create",
        payload: { title: "ok", startAt: "2026-02-30T10:00" },
      },
      {
        type: "event.create",
        payload: {
          title: "ok",
          startAt: "2026-09-28",
          endAt: "2026-09-30T10:00",
          allDay: true,
        },
      },
      {
        type: "event.create",
        payload: { title: "x".repeat(121), startAt: "2026-09-25T14:00" },
      },
      {
        type: "event.create",
        payload: {
          title: "ok",
          startAt: "2026-09-25T14:00",
          description: "x".repeat(2_001),
        },
      },
      {
        type: "event.create",
        payload: {
          title: "ok",
          startAt: "2026-09-25T14:00",
          documentId: "nope",
        },
      },
    ];
    for (const value of invalid) {
      expect(parseAssistantAction(value), JSON.stringify(value)).toBeNull();
    }
  });

  test("presentation.create: bounded to the real draft, defaults filled once", () => {
    const action = parseAssistantAction({
      type: "presentation.create",
      payload: {
        title: "Photosynthesis",
        prompt: "Explain photosynthesis for a first-year class",
        slideCount: 12,
        template: "academic",
        sourceDocumentIds: [UUID_A, UUID_B],
      },
    });
    expect(action).toEqual({
      type: "presentation.create",
      payload: {
        title: "Photosynthesis",
        prompt: "Explain photosynthesis for a first-year class",
        slideCount: 12,
        template: "academic",
        sourceDocumentIds: [UUID_A, UUID_B],
      },
      requiresConfirmation: true,
    });
    expect(summarizeAssistantAction(action!)).toBe(
      "Create presentation: Photosynthesis — 12 slides — academic template — from 2 documents",
    );

    const execution = normalizeAssistantActionForExecution(action!);
    expect(execution).toEqual({
      type: "presentation.create",
      draft: {
        prompt: "Explain photosynthesis for a first-year class",
        template: "academic",
        nSlides: 12,
        format: "pptx",
        language: null,
        instructions: null,
        tone: null,
        verbosity: null,
        includeTableOfContents: false,
        includeTitleSlide: true,
        sourceDocumentIds: [UUID_A, UUID_B],
      },
    });
    // The normalized draft is a draft the presentation service re-accepts
    // unchanged: no default is applied twice and none is forgotten.
    expect(parsePresentationRequest(execution.draft)).toEqual(execution.draft);

    const minimal = parseAssistantAction({
      type: "presentation.create",
      payload: { title: "Photosynthesis" },
    });
    expect(minimal).toEqual({
      type: "presentation.create",
      payload: {
        title: "Photosynthesis",
        prompt: null,
        slideCount: null,
        template: "general",
        sourceDocumentIds: [],
      },
      requiresConfirmation: true,
    });
    const minimalExecution = normalizeAssistantActionForExecution(minimal!);
    // No prompt given: the title is the prompt, exactly as the draft expects.
    expect(minimalExecution).toEqual({
      type: "presentation.create",
      draft: {
        prompt: "Photosynthesis",
        template: "general",
        nSlides: null,
        format: "pptx",
        language: null,
        instructions: null,
        tone: null,
        verbosity: null,
        includeTableOfContents: false,
        includeTitleSlide: true,
        sourceDocumentIds: [],
      },
    });
    expect(parsePresentationRequest(minimalExecution.draft)).toEqual(
      minimalExecution.draft,
    );

    const tooManySources = Array.from(
      { length: 9 },
      (_, index) => `3f2504e0-4f89-41d3-9a0c-0305e82c330${index}`,
    );
    const invalid: unknown[] = [
      { type: "presentation.create", payload: { title: "ok", slideCount: 4 } },
      { type: "presentation.create", payload: { title: "ok", slideCount: 31 } },
      { type: "presentation.create", payload: { title: "ok", slideCount: "12" } },
      {
        type: "presentation.create",
        payload: { title: "ok", sourceDocumentIds: [UUID_A, UUID_A] },
      },
      {
        type: "presentation.create",
        payload: { title: "ok", sourceDocumentIds: ["nope"] },
      },
      {
        type: "presentation.create",
        payload: { title: "ok", sourceDocumentIds: tooManySources },
      },
      { type: "presentation.create", payload: { title: " " } },
      {
        type: "presentation.create",
        payload: { title: "ok", template: "x".repeat(121) },
      },
      {
        type: "presentation.create",
        payload: { title: "ok", prompt: "x".repeat(2_001) },
      },
    ];
    for (const value of invalid) {
      expect(parseAssistantAction(value), JSON.stringify(value)).toBeNull();
    }
  });

  test("closed vocabulary: unknown types and malformed envelopes are rejected", () => {
    expect(ASSISTANT_ACTION_TYPES).toEqual([
      "task.create",
      "reminder.create",
      "event.create",
      "presentation.create",
    ]);
    // The 27.1 API is re-exported from 26.9's module: one import surface.
    expect(parseAssistantActionFromContracts).toBe(parseAssistantAction);

    // The provider instruction names every supported type from the union and
    // keeps the confirmation honesty.
    for (const type of ASSISTANT_ACTION_TYPES) {
      expect(STRUCTURED_ACTION_INSTRUCTION).toContain(type);
    }
    expect(STRUCTURED_ACTION_INSTRUCTION).toContain("never claim you performed it");

    const rejected: unknown[] = [
      null,
      "task.create",
      42,
      [],
      { type: "task.create" },
      { type: "task.create", payload: "x" },
      { type: "task.delete", payload: { title: "ok" } },
      { type: "TASK.CREATE", payload: { title: "ok" } },
      { type: "event.update", payload: {} },
      { type: "presentation.generate", payload: { title: "ok" } },
    ];
    for (const value of rejected) {
      expect(parseAssistantAction(value), JSON.stringify(value)).toBeNull();
    }

    // 26.9's envelope still accepts a syntactically valid action; 27.1's typed
    // layer is what rejects the unknown type.
    const structured = parseStructuredAction({ type: "task.delete", payload: {} });
    expect(structured).not.toBeNull();
    expect(parseAssistantAction(structured)).toBeNull();

    // The full provider path: a fenced block collected by 26.9's collector is
    // exactly what the typed parser accepts — the shape the executor consumes.
    const fenced = [
      "Here is what I can do:",
      "```unipilot-action",
      JSON.stringify({
        type: "reminder.create",
        payload: { title: "Call mum", remindAt: "2026-09-25" },
      }),
      "```",
    ].join("\n");
    const collected = collectStructuredActions(fenced);
    expect(collected).toHaveLength(1);
    expect(parseAssistantAction(collected[0])).toEqual({
      type: "reminder.create",
      payload: { title: "Call mum", remindAt: "2026-09-25" },
      requiresConfirmation: true,
    });
  });
});

test.describe("assistant action log (27.8)", () => {
  test("owner reads, clients cannot write, idempotency, cascade", async () => {
    // One real conversation per QA user, written service-side like the turn
    // pipeline writes them.
    const { data: conversation, error: conversationError } = await service
      .from("conversations")
      .insert({ user_id: qa1Id, title: `${PREFIX} action log` })
      .select("id")
      .single();
    expect(conversationError).toBeNull();
    createdConversationIds.push(conversation!.id);

    const { data: otherConversation, error: otherConversationError } =
      await service
        .from("conversations")
        .insert({ user_id: qa2Id, title: `${PREFIX} action log other` })
        .select("id")
        .single();
    expect(otherConversationError).toBeNull();
    createdConversationIds.push(otherConversation!.id);

    const { data: message } = await service
      .from("messages")
      .insert({
        conversation_id: conversation!.id,
        role: "assistant",
        content: `${PREFIX} I can create that task.`,
      })
      .select("id")
      .single();

    const idempotencyKey = `${PREFIX} ${randomUUID()}`;
    const payload = { title: `${PREFIX} buy milk` };
    const { data: action, error: actionError } = await service
      .from("assistant_actions")
      .insert({
        user_id: qa1Id,
        conversation_id: conversation!.id,
        message_id: message!.id,
        type: "task.create",
        payload,
        idempotency_key: idempotencyKey,
      })
      .select("id, status, settled_at")
      .single();
    expect(actionError).toBeNull();
    expect(action!.status).toBe("proposed");
    expect(action!.settled_at).toBeNull();
    createdActionIds.push(action!.id);

    // The owner sees the row and its exact payload; the other user sees none.
    const own = await qa1
      .from("assistant_actions")
      .select("id, type, payload, status")
      .eq("id", action!.id);
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(1);
    expect(own.data![0].payload).toEqual(payload);

    const foreign = await qa2
      .from("assistant_actions")
      .select("id")
      .eq("id", action!.id);
    expect(foreign.error).toBeNull();
    expect(foreign.data ?? []).toHaveLength(0);

    // Clients cannot write at all: INSERT/UPDATE/DELETE are revoked (42501).
    const clientInsert = await qa1
      .from("assistant_actions")
      .insert({
        user_id: qa1Id,
        conversation_id: conversation!.id,
        type: "task.create",
        payload: { title: "forged" },
        idempotency_key: `${idempotencyKey} forged`,
      })
      .select("id");
    expect(
      clientInsert.error,
      "client action insert must be denied",
    ).not.toBeNull();
    expect(clientInsert.error!.code).toBe("42501");

    const clientUpdate = await qa1
      .from("assistant_actions")
      .update({ status: "confirmed" })
      .eq("id", action!.id)
      .select("id");
    expect(
      clientUpdate.error,
      "client action update must be denied",
    ).not.toBeNull();
    expect(clientUpdate.error!.code).toBe("42501");

    const clientDelete = await qa1
      .from("assistant_actions")
      .delete()
      .eq("id", action!.id)
      .select("id");
    expect(
      clientDelete.error,
      "client action delete must be denied",
    ).not.toBeNull();
    expect(clientDelete.error!.code).toBe("42501");

    const survived = await service
      .from("assistant_actions")
      .select("status")
      .eq("id", action!.id)
      .maybeSingle();
    expect(survived.data!.status).toBe("proposed");

    // 27.13's anchor: the same (user, key) cannot be inserted twice…
    const duplicate = await service.from("assistant_actions").insert({
      user_id: qa1Id,
      conversation_id: conversation!.id,
      type: "task.create",
      payload,
      idempotency_key: idempotencyKey,
    });
    expect(duplicate.error).not.toBeNull();
    expect(duplicate.error!.code).toBe("23505");

    // …while another user's identical key is their own (unique per user).
    const otherUser = await service
      .from("assistant_actions")
      .insert({
        user_id: qa2Id,
        conversation_id: otherConversation!.id,
        type: "reminder.create",
        payload: { title: "call", remindAt: "2026-09-25T15:00:00.000Z" },
        idempotency_key: idempotencyKey,
      })
      .select("id")
      .single();
    expect(otherUser.error).toBeNull();
    createdActionIds.push(otherUser.data!.id);

    // The closed vocabularies are database facts, not conventions.
    const badType = await service.from("assistant_actions").insert({
      user_id: qa1Id,
      conversation_id: conversation!.id,
      type: "task.delete",
      payload: {},
      idempotency_key: `${idempotencyKey} type`,
    });
    expect(badType.error).not.toBeNull();
    expect(badType.error!.code).toBe("23514");

    const badStatus = await service.from("assistant_actions").insert({
      user_id: qa1Id,
      conversation_id: conversation!.id,
      type: "task.create",
      payload,
      status: "bogus",
      idempotency_key: `${idempotencyKey} status`,
    });
    expect(badStatus.error).not.toBeNull();
    expect(badStatus.error!.code).toBe("23514");

    const blankKey = await service.from("assistant_actions").insert({
      user_id: qa1Id,
      conversation_id: conversation!.id,
      type: "task.create",
      payload,
      idempotency_key: "   ",
    });
    expect(blankKey.error).not.toBeNull();
    expect(blankKey.error!.code).toBe("23514");

    // message_id detaches (SET NULL) instead of erasing the log entry…
    const messageRemoved = await service
      .from("messages")
      .delete()
      .eq("id", message!.id)
      .select("id");
    expect(messageRemoved.error).toBeNull();
    const detached = await service
      .from("assistant_actions")
      .select("message_id")
      .eq("id", action!.id)
      .maybeSingle();
    expect(detached.data!.message_id).toBeNull();

    // …and deleting the conversation removes its actions (CASCADE).
    await service.from("conversations").delete().eq("id", conversation!.id);
    await service.from("conversations").delete().eq("id", otherConversation!.id);

    const residue = await service
      .from("assistant_actions")
      .select("id", { count: "exact", head: true })
      .in("user_id", [qa1Id, qa2Id])
      .like("idempotency_key", `${PREFIX}%`);
    expect(residue.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T27-B — the engine: registration, the log, confirmation and the executor
// ---------------------------------------------------------------------------

test.describe("assistant action key (27.9)", () => {
  test("deterministic, canonical and identity-scoped", () => {
    const base = {
      userId: UUID_A,
      conversationId: UUID_B,
      messageId: null,
      index: 0,
      type: "task.create" as const,
      payload: { title: "Buy milk", dueDate: "2026-09-25" },
    };
    const key = assistantActionIdempotencyKey(base);

    // A real hash, stable for identical input and independent of key order.
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(
      assistantActionIdempotencyKey({ ...base, payload: { ...base.payload } }),
    ).toBe(key);
    expect(
      assistantActionIdempotencyKey({
        ...base,
        payload: { dueDate: "2026-09-25", title: "Buy milk" },
      }),
    ).toBe(key);

    // Every identity dimension moves the key: user, conversation, message,
    // index, type, payload.
    const variants = [
      { ...base, userId: UUID_B },
      { ...base, conversationId: UUID_A },
      { ...base, messageId: UUID_A },
      { ...base, index: 1 },
      { ...base, type: "reminder.create" as const },
      { ...base, payload: { title: "Buy oat milk", dueDate: "2026-09-25" } },
    ];
    for (const variant of variants) {
      expect(
        assistantActionIdempotencyKey(variant),
        JSON.stringify(variant),
      ).not.toBe(key);
    }
  });
});

test.describe("assistant action log — register/list (27.8/27.9)", () => {
  test("fenced content becomes proposed rows and re-registering never duplicates", async () => {
    const taskTitle = `${PREFIX_B} read chapter 4`;
    const content = [
      "Here is what I can do:",
      fence({
        type: "task.create",
        payload: {
          title: taskTitle,
          description: "Related notes: pages 20-34",
          dueDate: "2026-09-25",
          priority: "high",
        },
      }),
      fence({
        type: "reminder.create",
        payload: { title: `${PREFIX_B} call mum`, remindAt: "2026-09-26" },
      }),
      // Unknown vocabulary and malformed JSON are skipped, not guessed at.
      fence({ type: "task.delete", payload: { title: "nope" } }),
      fence("{ not json"),
    ].join("\n");

    const { conversationId, messageId, items } = await registerFenced(
      qa1Id,
      content,
    );

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.type)).toEqual([
      "task.create",
      "reminder.create",
    ]);
    for (const item of items) {
      expect(item.status).toBe("proposed");
      expect(item.error).toBeNull();
      expect(item.result).toBeNull();
      expect(item.messageId).toBe(messageId);
      expect(item.settledLabel).toBeNull();
      expect(item.createdLabel.length).toBeGreaterThan(0);
      expect(item.summary).toContain("Create");
    }

    // The database agrees: two proposed rows with the normalized payloads.
    const rows = await service
      .from("assistant_actions")
      .select("id, type, payload, status, message_id, idempotency_key")
      .eq("conversation_id", conversationId)
      .order("proposed_at", { ascending: true })
      .order("id", { ascending: true });
    expect(rows.error).toBeNull();
    expect(rows.data).toHaveLength(2);
    const taskRow = rows.data!.find((row) => row.type === "task.create")!;
    const reminderRow = rows.data!.find((row) => row.type === "reminder.create")!;
    expect(taskRow).toMatchObject({
      type: "task.create",
      status: "proposed",
      message_id: messageId,
    });
    expect(taskRow.payload).toEqual({
      title: taskTitle,
      description: "Related notes: pages 20-34",
      dueDate: "2026-09-25",
      effortMinutes: null,
      priority: "high",
      documentId: null,
    });
    expect(reminderRow.payload).toEqual({
      title: `${PREFIX_B} call mum`,
      remindAt: "2026-09-26",
    });

    // 27.9: the stored key is the deterministic hash of the normalized
    // proposal — the identity a retry relies on.
    expect(taskRow.idempotency_key).toBe(
      assistantActionIdempotencyKey({
        userId: qa1Id,
        conversationId,
        messageId,
        index: 0,
        type: "task.create",
        payload: items[0].payload,
      }),
    );

    // Re-registering identical content returns the very same rows.
    const again = await registerAssistantProposals(qa1Id, {
      conversationId,
      messageId,
      content,
    });
    expect(again.status).toBe("ok");
    if (again.status === "ok") {
      expect(again.items.map((item) => item.id)).toEqual(
        items.map((item) => item.id),
      );
    }
    const count = await service
      .from("assistant_actions")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId);
    expect(count.count).toBe(2);
  });

  test("live content works; foreign conversation/message ids write nothing", async () => {
    const content = fence({
      type: "task.create",
      payload: { title: `${PREFIX_B} live proposal` },
    });

    // QA1's own conversation with no message: a real "live" registration.
    const owned = await registerFenced(qa1Id, content, { message: false });
    expect(owned.items).toHaveLength(1);
    expect(owned.items[0].messageId).toBeNull();

    // QA2's conversation/message, seeded without registering anything, so the
    // only possible rows in it are the ones QA1's denied call could write.
    const { data: foreignConversation, error: foreignConversationError } =
      await service
        .from("conversations")
        .insert({ user_id: qa2Id, title: `${PREFIX_B} foreign conversation` })
        .select("id")
        .single();
    expect(foreignConversationError).toBeNull();
    createdConversationIds.push(foreignConversation!.id);
    const { data: foreignMessage, error: foreignMessageError } = await service
      .from("messages")
      .insert({
        conversation_id: foreignConversation!.id,
        role: "assistant",
        content,
      })
      .select("id")
      .single();
    expect(foreignMessageError).toBeNull();

    // QA2's conversation under QA1's identity: honest not-found, zero rows.
    const denied = await registerAssistantProposals(qa1Id, {
      conversationId: foreignConversation!.id,
      messageId: foreignMessage!.id,
      content,
    });
    expect(denied).toEqual({ status: "not-found" });
    const foreignRows = await service
      .from("assistant_actions")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", foreignConversation!.id);
    expect(foreignRows.count).toBe(0);

    // A message that does not belong to the named conversation: same answer,
    // and the owned conversation's log is untouched.
    const mismatched = await registerAssistantProposals(qa1Id, {
      conversationId: owned.conversationId,
      messageId: foreignMessage!.id,
      content,
    });
    expect(mismatched).toEqual({ status: "not-found" });
    const ownedRows = await service
      .from("assistant_actions")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", owned.conversationId);
    expect(ownedRows.count).toBe(1);

    // Junk ids are rejected before any query.
    expect(
      await registerAssistantProposals(qa1Id, {
        conversationId: "not-a-uuid",
        content,
      }),
    ).toEqual({ status: "not-found" });
  });

  test("list is owner-scoped and returns the display contract", async () => {
    const content = fence({
      type: "reminder.create",
      payload: { title: `${PREFIX_B} listed reminder`, remindAt: "2026-10-01" },
    });
    const { conversationId, messageId, items } = await registerFenced(
      qa1Id,
      content,
    );

    const owned = await listAssistantActions(qa1Id, conversationId, {
      client: qa1,
    });
    expect(owned).toHaveLength(1);
    expect(owned[0]).toMatchObject({
      id: items[0].id,
      type: "reminder.create",
      payload: { title: `${PREFIX_B} listed reminder`, remindAt: "2026-10-01" },
      status: "proposed",
      result: null,
      error: null,
      messageId,
    });
    expect(owned[0].summary).toContain(`${PREFIX_B} listed reminder`);
    expect(owned[0].settledLabel).toBeNull();

    // QA2 reads nothing: RLS + the explicit owner filter.
    const foreign = await listAssistantActions(qa2Id, conversationId, {
      client: qa2,
    });
    expect(foreign).toEqual([]);
  });
});

test.describe("assistant action executor (27.2–27.6/27.13)", () => {
  test("confirm task.create creates exactly one owned task; double-confirm never re-executes", async () => {
    const title = `${PREFIX_B} read chapter 4`;
    const content = fence({
      type: "task.create",
      payload: {
        title,
        description: "Related notes: pages 20-34",
        dueDate: "2026-09-25",
        priority: "high",
      },
    });
    const { conversationId, messageId, items } = await registerFenced(
      qa1Id,
      content,
    );
    const item = items[0];

    const confirmed = await confirmAssistantAction(qa1Id, item.id, {
      client: qa1,
    });
    expect(confirmed.error).toBeNull();
    expect(confirmed.action?.status).toBe("succeeded");
    expect(confirmed.action?.settledLabel).not.toBeNull();
    expect(confirmed.action?.result).toMatchObject({
      kind: "task",
      label: title,
    });
    const taskId = confirmed.action!.result!.id;
    createdTaskIds.push(taskId);

    // The stored row is owner-scoped and carries the exact values.
    const zone = await profileZone(qa1, qa1Id);
    const task = await storedTask(taskId);
    expect(task).toMatchObject({
      title,
      description: "Related notes: pages 20-34",
      priority: "high",
      status: "todo",
      source_document_id: null,
    });
    expect(Date.parse(task!.due_date!)).toBe(
      Date.parse(zonedDateOnlyToInstant("2026-09-25", zone)),
    );
    // The owner's session can read it (RLS), the other user cannot.
    const ownedRead = await qa1.from("tasks").select("id").eq("id", taskId);
    expect(ownedRead.data).toHaveLength(1);
    const foreignRead = await qa2.from("tasks").select("id").eq("id", taskId);
    expect(foreignRead.data ?? []).toHaveLength(0);

    // The log settled with the created row's facts (not a fake success).
    const logRow = await storedAction(item.id);
    expect(logRow!.status).toBe("succeeded");
    expect(logRow!.error).toBeNull();
    expect(logRow!.result).toEqual(confirmed.action!.result);
    expect(logRow!.settled_at).not.toBeNull();

    // 27.13: the second confirm returns the stored result, creates nothing.
    const again = await confirmAssistantAction(qa1Id, item.id, { client: qa1 });
    expect(again.error).toBeNull();
    expect(again.action?.status).toBe("succeeded");
    expect(again.action?.result).toEqual(confirmed.action!.result);

    // A direct executor retry with the same key is the same no-op.
    const stored = await storedAction(item.id);
    const retry = await executeAssistantAction(
      qa1Id,
      parseAssistantAction({ type: item.type, payload: item.payload })!,
      {
        conversationId,
        messageId,
        idempotencyKey: stored!.idempotency_key,
        client: qa1,
      },
    );
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.result).toEqual(confirmed.action!.result);

    const count = await service
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", qa1Id)
      .eq("title", title);
    expect(count.count).toBe(1);
  });

  test("document links are owner-verified: owned sets source_document_id, foreign/missing fail with no row", async () => {
    const ownDocId = randomUUID();
    const ownInsert = await service.from("documents").insert({
      id: ownDocId,
      user_id: qa1Id,
      name: `${PREFIX_B} own notes.pdf`,
      mime_type: "application/pdf",
      size_bytes: 1024,
      status: "uploaded",
    });
    expect(ownInsert.error).toBeNull();
    createdDocumentIds.push(ownDocId);

    const foreignDocId = randomUUID();
    const foreignInsert = await service.from("documents").insert({
      id: foreignDocId,
      user_id: qa2Id,
      name: `${PREFIX_B} foreign notes.pdf`,
      mime_type: "application/pdf",
      size_bytes: 1024,
      status: "uploaded",
    });
    expect(foreignInsert.error).toBeNull();
    createdDocumentIds.push(foreignDocId);

    // The caller's own document: the link lands on the created task.
    const ownTitle = `${PREFIX_B} linked task`;
    const own = await registerFenced(
      qa1Id,
      fence({
        type: "task.create",
        payload: {
          title: ownTitle,
          description: "Related notes",
          documentId: ownDocId,
        },
      }),
    );
    const confirmed = await confirmAssistantAction(qa1Id, own.items[0].id, {
      client: qa1,
    });
    expect(confirmed.error).toBeNull();
    expect(confirmed.action?.status).toBe("succeeded");
    const ownTaskId = confirmed.action!.result!.id;
    createdTaskIds.push(ownTaskId);
    expect((await storedTask(ownTaskId))!.source_document_id).toBe(ownDocId);

    // A foreign document id: failed with sanitized copy, no task row.
    const foreignTitle = `${PREFIX_B} foreign-linked task`;
    const foreign = await registerFenced(
      qa1Id,
      fence({
        type: "task.create",
        payload: { title: foreignTitle, documentId: foreignDocId },
      }),
    );
    const foreignResult = await confirmAssistantAction(
      qa1Id,
      foreign.items[0].id,
      { client: qa1 },
    );
    expect(foreignResult.error).toBe(
      ASSISTANT_ACTION_COPY.DOCUMENT_NOT_FOUND,
    );
    expect(foreignResult.action?.status).toBe("failed");
    expect(foreignResult.action?.error).toBe(
      ASSISTANT_ACTION_COPY.DOCUMENT_NOT_FOUND,
    );
    expect(foreignResult.action?.result).toBeNull();
    const foreignLog = await storedAction(foreign.items[0].id);
    expect(foreignLog!.status).toBe("failed");
    expect(foreignLog!.error).toBe(ASSISTANT_ACTION_COPY.DOCUMENT_NOT_FOUND);
    const foreignTasks = await service
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", qa1Id)
      .eq("title", foreignTitle);
    expect(foreignTasks.count).toBe(0);

    // A missing id (valid uuid, no row) fails the same honest way.
    const missing = await registerFenced(
      qa1Id,
      fence({
        type: "task.create",
        payload: { title: `${PREFIX_B} missing-linked task`, documentId: randomUUID() },
      }),
    );
    const missingResult = await confirmAssistantAction(
      qa1Id,
      missing.items[0].id,
      { client: qa1 },
    );
    expect(missingResult.error).toBe(
      ASSISTANT_ACTION_COPY.DOCUMENT_NOT_FOUND,
    );
    expect(missingResult.action?.status).toBe("failed");
    const missingTasks = await service
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", qa1Id)
      .eq("title", `${PREFIX_B} missing-linked task`);
    expect(missingTasks.count).toBe(0);
  });

  test("confirm reminder.create stores the profile zone's 00:00 instant", async () => {
    const remindAt = "2026-10-05";
    const title = `${PREFIX_B} call mum`;
    const { items } = await registerFenced(
      qa1Id,
      fence({
        type: "reminder.create",
        payload: { title, remindAt },
      }),
    );

    const confirmed = await confirmAssistantAction(qa1Id, items[0].id, {
      client: qa1,
    });
    expect(confirmed.error).toBeNull();
    expect(confirmed.action?.status).toBe("succeeded");
    expect(confirmed.action?.result).toMatchObject({ kind: "task", label: title });
    const taskId = confirmed.action!.result!.id;
    createdTaskIds.push(taskId);

    // R1: the stored instant is exactly 00:00 in the profile's zone — proof
    // by round trip, not by the date-only label.
    const zone = await profileZone(qa1, qa1Id);
    const task = await storedTask(taskId);
    expect(Date.parse(task!.due_date!)).toBe(
      Date.parse(zonedDateOnlyToInstant(remindAt, zone)),
    );
    expect(instantToZonedLocalDateTime(task!.due_date!, zone)).toBe(
      `${remindAt}T00:00`,
    );
    expect(task!.description).toBeNull();
  });

  test("confirm event.create creates the real event row", async () => {
    const title = `${PREFIX_B} calculus`;
    const { items } = await registerFenced(
      qa1Id,
      fence({
        type: "event.create",
        payload: {
          title,
          startAt: "2026-10-06T14:00",
          endAt: "2026-10-06T15:30",
          location: "Room 4",
        },
      }),
    );

    const confirmed = await confirmAssistantAction(qa1Id, items[0].id, {
      client: qa1,
    });
    expect(confirmed.error).toBeNull();
    expect(confirmed.action?.status).toBe("succeeded");
    expect(confirmed.action?.result).toMatchObject({ kind: "event", label: title });
    const eventId = confirmed.action!.result!.id;
    createdEventIds.push(eventId);

    const zone = await profileZone(qa1, qa1Id);
    const { data: event, error } = await service
      .from("events")
      .select("id, title, start_at, end_at, all_day, location, source_document_id")
      .eq("id", eventId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(event).toMatchObject({
      title,
      all_day: false,
      location: "Room 4",
      source_document_id: null,
    });
    expect(Date.parse(event!.start_at)).toBe(
      Date.parse(zonedLocalDateTimeToInstant("2026-10-06T14:00", zone)),
    );
    expect(Date.parse(event!.end_at!)).toBe(
      Date.parse(zonedLocalDateTimeToInstant("2026-10-06T15:30", zone)),
    );

    const ownedRead = await qa1.from("events").select("id").eq("id", eventId);
    expect(ownedRead.data).toHaveLength(1);
  });

  test("reject is idempotent, terminal and writes nothing", async () => {
    const title = `${PREFIX_B} rejected task`;
    const { items } = await registerFenced(
      qa1Id,
      fence({
        type: "task.create",
        payload: { title, dueDate: "2026-09-25" },
      }),
    );
    const actionId = items[0].id;

    const rejected = await rejectAssistantAction(qa1Id, actionId, {
      client: qa1,
    });
    expect(rejected.error).toBeNull();
    expect(rejected.action?.status).toBe("rejected");
    expect(rejected.action?.settledLabel).not.toBeNull();

    const logRow = await storedAction(actionId);
    expect(logRow).toMatchObject({ status: "rejected", result: null, error: null });
    expect(logRow!.settled_at).not.toBeNull();

    const tasks = await service
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", qa1Id)
      .eq("title", title);
    expect(tasks.count).toBe(0);

    // Idempotent re-reject…
    const again = await rejectAssistantAction(qa1Id, actionId, { client: qa1 });
    expect(again.error).toBeNull();
    expect(again.action?.status).toBe("rejected");

    // …and a rejected row can never be confirmed into running (27.6).
    const confirmed = await confirmAssistantAction(qa1Id, actionId, {
      client: qa1,
    });
    expect(confirmed.error).toBe(ASSISTANT_ACTION_COPY.REJECTED);
    expect(confirmed.action?.status).toBe("rejected");
    expect((await storedAction(actionId))!.status).toBe("rejected");
    expect(
      (
        await service
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("user_id", qa1Id)
          .eq("title", title)
      ).count,
    ).toBe(0);
  });

  test("presentation.create fails honestly: nothing generated, nothing enqueued", async () => {
    // QA2 keeps this clear of QA1's live presentation runs.
    const title = `${PREFIX_B} deck idea`;
    const { items } = await registerFenced(
      qa2Id,
      fence({
        type: "presentation.create",
        payload: {
          title,
          prompt: "Explain photosynthesis for a first-year class",
          slideCount: 8,
        },
      }),
    );

    const beforeJobs = await service
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", qa2Id)
      .eq("kind", "presentation.generate");
    const beforeDecks = await service
      .from("presentations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", qa2Id);

    const confirmed = await confirmAssistantAction(qa2Id, items[0].id, {
      client: qa2,
    });
    expect(confirmed.error).toBe(
      ASSISTANT_ACTION_COPY.PRESENTATION_NOT_AVAILABLE,
    );
    expect(confirmed.action?.status).toBe("failed");
    expect(confirmed.action?.error).toBe(
      ASSISTANT_ACTION_COPY.PRESENTATION_NOT_AVAILABLE,
    );
    expect(confirmed.action?.result).toBeNull();

    const afterJobs = await service
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", qa2Id)
      .eq("kind", "presentation.generate");
    const afterDecks = await service
      .from("presentations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", qa2Id);
    expect(afterJobs.count).toBe(beforeJobs.count);
    expect(afterDecks.count).toBe(beforeDecks.count);

    // The failure is terminal: re-confirming returns the stored copy.
    const again = await confirmAssistantAction(qa2Id, items[0].id, {
      client: qa2,
    });
    expect(again.error).toBe(
      ASSISTANT_ACTION_COPY.PRESENTATION_NOT_AVAILABLE,
    );
    expect(again.action?.status).toBe("failed");
  });

  test("ownership: foreign, unknown and mismatched ids never execute", async () => {
    const title = `${PREFIX_B} owned only`;
    const { conversationId, messageId, items } = await registerFenced(
      qa1Id,
      fence({ type: "task.create", payload: { title } }),
    );
    const actionId = items[0].id;

    // QA2 cannot confirm QA1's action: the owner-scoped read finds nothing.
    const foreign = await confirmAssistantAction(qa2Id, actionId, {
      client: qa2,
    });
    expect(foreign.error).toBe(ASSISTANT_ACTION_COPY.NOT_FOUND);
    expect(foreign.action).toBeNull();

    // An unknown id is the same honest answer.
    const unknown = await confirmAssistantAction(qa1Id, randomUUID(), {
      client: qa1,
    });
    expect(unknown.error).toBe(ASSISTANT_ACTION_COPY.NOT_FOUND);

    // The executor refuses a key that is not this conversation's proposal…
    const logRow = await storedAction(actionId);
    const wrongConversation = await executeAssistantAction(
      qa1Id,
      parseAssistantAction({ type: "task.create", payload: items[0].payload })!,
      {
        conversationId: randomUUID(),
        messageId,
        idempotencyKey: logRow!.idempotency_key,
        client: qa1,
      },
    );
    expect(wrongConversation.ok).toBe(false);
    if (!wrongConversation.ok) {
      expect(wrongConversation.error).toBe(ASSISTANT_ACTION_COPY.NOT_FOUND);
    }

    // …and a different action under a real key (the stored payload is the
    // action of record).
    const mismatched = await executeAssistantAction(
      qa1Id,
      parseAssistantAction({
        type: "task.create",
        payload: { title: "something else" },
      })!,
      {
        conversationId,
        messageId,
        idempotencyKey: logRow!.idempotency_key,
        client: qa1,
      },
    );
    expect(mismatched.ok).toBe(false);
    if (!mismatched.ok) {
      expect(mismatched.error).toBe(ASSISTANT_ACTION_COPY.NOT_FOUND);
    }

    // None of those attempts wrote anything or moved the row.
    expect((await storedAction(actionId))!.status).toBe("proposed");
    const tasks = await service
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", qa1Id)
      .eq("title", title);
    expect(tasks.count).toBe(0);
  });
});
