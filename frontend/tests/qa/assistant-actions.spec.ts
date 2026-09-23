/**
 * tests/qa/assistant-actions.spec.ts — Tasks 27.1 + 27.8's proof.
 *
 * Two layers, both against the real local stack:
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
 *    NULL) and the conversation cascade removes the log rows.
 *
 * Id-scoped teardown: this spec creates only conversations/messages/actions
 * for the QA users and deletes exactly those (plus its own idempotency-key
 * prefix as a backstop), so it never touches the documents bucket, jobs or the
 * other projects' rows. Local-only; hosted is never contacted.
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
import { parseTaskDraft } from "../../lib/data/taskValues";
import { parseEventDraft } from "../../lib/data/eventValues";
import { parsePresentationRequest } from "../../lib/data/presentationValues";

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
