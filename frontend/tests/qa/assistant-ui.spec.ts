/**
 * tests/qa/assistant-ui.spec.ts — Task 19.x's proof.
 *
 * Two layers:
 *
 * 1. C1's pure-helper proof: the client-safe frame vocabulary moved out of the
 *    server module for 19.x, the SSE parser that reassembles the route's
 *    `data: <json>\n\n` stream from arbitrary chunks, and the reducer that
 *    accumulates frames onto a streaming assistant entry. No browser,
 *    database or provider — the cases prove the contract directly, including
 *    its honesty rules: content is only ever delivered delta text,
 *    `unconfigured` stays honest, an error frame never fabricates an answer,
 *    and malformed payloads are skipped.
 * 2. C2's live conversation shell: `/assistant` bound to the real 26.x
 *    services (`listConversations`/`listMessages`) through the QA1 fixture's
 *    stored session. The cases seed conversations/messages with the service
 *    role and sweep them by id afterwards; they assert the sidebar order, the
 *    selected conversation's bubbles (roles, avatar, mono labels), the honest
 *    empty states, the guest prompt and a clean console. No provider is
 *    configured in this environment, so every live case also pins the honest
 *    unconfigured state — the shell must never fabricate a reply.
 *
 * The live composer/streaming cases (19.7–19.11) are C3's; this project stays
 * green with no provider configured.
 */
import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  applyAssistantFrame,
  createAssistantEntry,
  normalizeAssistantFrame,
  parseSseFrames,
} from "../../lib/data/assistantFrames";
import type { AssistantStreamFrame } from "../../lib/data/assistantValues";

/** The exact wire form the turn route emits (its private `frameToSse`). */
function frameToSse(frame: AssistantStreamFrame): string {
  return `data: ${JSON.stringify(frame)}\n\n`;
}

const SOURCE_A = {
  documentId: "doc-1",
  documentName: "Syllabus.pdf",
  page: 3,
  chunkIndex: 1,
};

const SOURCE_B = {
  documentId: "doc-2",
  documentName: "Lecture notes.pdf",
  chunkIndex: 0,
};

test.describe("parseSseFrames", () => {
  test("parses every frame of a complete stream, in order", () => {
    const start: AssistantStreamFrame = {
      type: "start",
      conversationId: "conversation-1",
      configured: true,
    };
    const delta: AssistantStreamFrame = {
      type: "delta",
      text: "Photosynthesis converts light into chemical energy.",
    };
    const sources: AssistantStreamFrame = {
      type: "sources",
      sources: [SOURCE_A, SOURCE_B],
    };
    const done: AssistantStreamFrame = {
      type: "done",
      status: "complete",
      messageId: "message-1",
    };

    const { frames, carry } = parseSseFrames(
      frameToSse(start) + frameToSse(delta) + frameToSse(sources) + frameToSse(done),
      "",
    );

    expect(frames).toEqual([start, delta, sources, done]);
    expect(carry).toBe("");
  });

  test("carries a frame split across chunks and emits it exactly once", () => {
    const start: AssistantStreamFrame = {
      type: "start",
      conversationId: "conversation-1",
      configured: false,
    };
    const delta: AssistantStreamFrame = { type: "delta", text: "hi" };
    const stream = frameToSse(start) + frameToSse(delta);

    // Cut twelve characters into the second block's `data:` line.
    const cut = frameToSse(start).length + 12;
    const first = parseSseFrames(stream.slice(0, cut), "");
    expect(first.frames).toEqual([start]);
    expect(first.carry).toBe(stream.slice(frameToSse(start).length, cut));

    const second = parseSseFrames(stream.slice(cut), first.carry);
    expect(second.frames).toEqual([delta]);
    expect(second.carry).toBe("");
  });

  test("reassembles a stream delivered one character at a time", () => {
    const frames: AssistantStreamFrame[] = [
      { type: "start", conversationId: "conversation-2", configured: true },
      { type: "delta", text: "multi\nline" },
      { type: "done", status: "complete", messageId: "message-2" },
    ];
    const stream = frames.map(frameToSse).join("");

    const received: AssistantStreamFrame[] = [];
    let carry = "";
    for (const character of stream) {
      const parsed = parseSseFrames(character, carry);
      received.push(...parsed.frames);
      carry = parsed.carry;
    }

    expect(received).toEqual(frames);
    expect(carry).toBe("");
  });

  test("joins multi-line data fields with newlines", () => {
    const chunk =
      'data: {"type":"delta",\n' + 'data: "text":"multi"}\n' + "\n";
    expect(parseSseFrames(chunk, "").frames).toEqual([
      { type: "delta", text: "multi" },
    ]);
  });

  test("normalizes CRLF and bare-CR separators", () => {
    const crlf = 'data: {"type":"delta","text":"crlf"}\r\n\r\n';
    expect(parseSseFrames(crlf, "").frames).toEqual([
      { type: "delta", text: "crlf" },
    ]);

    const cr = 'data: {"type":"delta","text":"cr"}\r\r';
    expect(parseSseFrames(cr, "").frames).toEqual([
      { type: "delta", text: "cr" },
    ]);
  });

  test("skips comments, [DONE] terminators, malformed JSON and unknown frames", () => {
    const chunk =
      ": keep-alive\n\n" +
      "data: {oops\n\n" +
      "data: [DONE]\n\n" +
      "data:[DONE]\n\n" +
      'data: {"type":"frobnicate"}\n\n' +
      'data: {"type":"delta","text":"survives"}\n\n';

    expect(parseSseFrames(chunk, "").frames).toEqual([
      { type: "delta", text: "survives" },
    ]);
  });

  test("drops malformed frame shapes without dropping the rest of the stream", () => {
    const chunk =
      'data: {"type":"delta"}\n\n' +
      'data: {"type":"sources","sources":"nope"}\n\n' +
      'data: ["not","an","object"]\n\n' +
      'data: {"type":"done","status":"weird","messageId":"m"}\n\n' +
      'data: {"type":"error","error":"recovered"}\n\n';

    expect(parseSseFrames(chunk, "").frames).toEqual([
      { type: "error", error: "recovered" },
    ]);
  });
});

test.describe("normalizeAssistantFrame", () => {
  test("accepts each frame of the contract", () => {
    expect(
      normalizeAssistantFrame({
        type: "start",
        conversationId: "c1",
        configured: false,
      }),
    ).toEqual({ type: "start", conversationId: "c1", configured: false });
    expect(normalizeAssistantFrame({ type: "delta", text: "" })).toEqual({
      type: "delta",
      text: "",
    });
    expect(
      normalizeAssistantFrame({
        type: "done",
        status: "unconfigured",
        messageId: null,
      }),
    ).toEqual({ type: "done", status: "unconfigured", messageId: null });
    expect(normalizeAssistantFrame({ type: "error", error: "copy" })).toEqual({
      type: "error",
      error: "copy",
    });
    // A `done` without the optional id is still terminal — it normalizes the
    // id to null rather than dropping the frame (the UI would stay streaming).
    expect(normalizeAssistantFrame({ type: "done", status: "complete" })).toEqual(
      { type: "done", status: "complete", messageId: null },
    );
  });

  test("rejects unknown types and wrong field types", () => {
    for (const value of [
      null,
      undefined,
      "delta",
      [],
      7,
      {},
      { type: "delta" },
      { type: "delta", text: 7 },
      { type: "start", conversationId: 42, configured: true },
      { type: "start", conversationId: "c1" },
      { type: "done", status: "okay", messageId: "m" },
      { type: "error" },
      { type: "error", error: 500 },
    ]) {
      expect(
        normalizeAssistantFrame(value),
        `must reject ${JSON.stringify(value)}`,
      ).toBeNull();
    }
  });

  test("normalizes a sources frame entry-by-entry", () => {
    expect(
      normalizeAssistantFrame({
        type: "sources",
        sources: [
          SOURCE_A,
          { documentId: "doc-2", documentName: "Lecture notes.pdf", page: "3", chunkIndex: 0 },
          { documentId: "doc-3", documentName: "Bad index.pdf", chunkIndex: "2" },
          null,
          "doc-4",
        ],
      }),
    ).toEqual({
      type: "sources",
      sources: [SOURCE_A, { documentId: "doc-2", documentName: "Lecture notes.pdf", chunkIndex: 0 }],
    });

    expect(normalizeAssistantFrame({ type: "sources", sources: "nope" })).toBeNull();
  });
});

test.describe("applyAssistantFrame", () => {
  test("accumulates deltas across chunks into a settled entry", () => {
    const stream =
      frameToSse({
        type: "start",
        conversationId: "conv-1",
        configured: true,
      }) +
      frameToSse({ type: "delta", text: "Photosynthesis " }) +
      frameToSse({ type: "delta", text: "converts light." }) +
      frameToSse({ type: "sources", sources: [SOURCE_A] }) +
      frameToSse({ type: "done", status: "complete", messageId: "message-1" });

    // Deliver the stream in two awkward chunks (the first cuts the start frame).
    let entry = createAssistantEntry();
    let carry = "";
    for (const chunk of [stream.slice(0, 40), stream.slice(40)]) {
      const parsed = parseSseFrames(chunk, carry);
      carry = parsed.carry;
      for (const frame of parsed.frames) {
        entry = applyAssistantFrame(entry, frame);
      }
    }

    expect(carry).toBe("");
    expect(entry).toEqual({
      role: "assistant",
      messageId: "message-1",
      conversationId: "conv-1",
      content: "Photosynthesis converts light.",
      status: "complete",
      configured: true,
      sources: [SOURCE_A],
      error: null,
    });
  });

  test("an empty delta changes nothing", () => {
    const fresh = createAssistantEntry();
    expect(applyAssistantFrame(fresh, { type: "delta", text: "" })).toBe(fresh);

    const streaming = applyAssistantFrame(fresh, {
      type: "delta",
      text: "Hello",
    });
    expect(applyAssistantFrame(streaming, { type: "delta", text: "" })).toBe(
      streaming,
    );
    expect(streaming.content).toBe("Hello");
  });

  test("a sources frame attaches the delivered list; an empty one never erases it", () => {
    const list = [SOURCE_A, SOURCE_B];
    const attached = applyAssistantFrame(createAssistantEntry(), {
      type: "sources",
      sources: list,
    });
    expect(attached.sources).toEqual([SOURCE_A, SOURCE_B]);
    expect(attached.sources).not.toBe(list);

    expect(
      applyAssistantFrame(attached, { type: "sources", sources: [] }),
    ).toBe(attached);
    expect(
      applyAssistantFrame(attached, { type: "sources", sources: [] }).sources,
    ).toEqual([SOURCE_A, SOURCE_B]);
  });

  test("a failed done keeps only the delivered text and marks the entry failed", () => {
    const copy =
      "The assistant couldn't answer that just now. Please try again.";
    let entry = createAssistantEntry();
    entry = applyAssistantFrame(entry, {
      type: "start",
      conversationId: "conv-2",
      configured: true,
    });
    entry = applyAssistantFrame(entry, { type: "delta", text: copy });
    entry = applyAssistantFrame(entry, {
      type: "done",
      status: "failed",
      messageId: "message-2",
    });

    expect(entry.status).toBe("failed");
    expect(entry.content).toBe(copy);
    expect(entry.messageId).toBe("message-2");
    expect(entry.error).toBeNull();
  });

  test("an unconfigured done leaves an honest unconfigured entry", () => {
    const copy =
      "The assistant isn't configured yet. No AI provider is connected in this environment, so I can't answer questions.";
    let entry = createAssistantEntry();
    entry = applyAssistantFrame(entry, {
      type: "start",
      conversationId: "conv-3",
      configured: false,
    });
    entry = applyAssistantFrame(entry, { type: "delta", text: copy });
    entry = applyAssistantFrame(entry, {
      type: "done",
      status: "unconfigured",
      messageId: "message-3",
    });

    expect(entry.status).toBe("unconfigured");
    expect(entry.configured).toBe(false);
    expect(entry.content).toBe(copy);
    expect(entry.error).toBeNull();
  });

  test("a bare unconfigured done fabricates no content", () => {
    const entry = applyAssistantFrame(createAssistantEntry(), {
      type: "done",
      status: "unconfigured",
      messageId: null,
    });

    expect(entry.content).toBe("");
    expect(entry.status).toBe("unconfigured");
    expect(entry.configured).toBeNull();
    expect(entry.messageId).toBeNull();
  });

  test("an error frame marks the entry failed with the sanitized copy, never invented answer text", () => {
    const copy =
      "The assistant couldn't answer that just now. Please try again.";
    let entry = createAssistantEntry();
    entry = applyAssistantFrame(entry, {
      type: "start",
      conversationId: "conv-4",
      configured: true,
    });
    entry = applyAssistantFrame(entry, {
      type: "delta",
      text: "Partial answer",
    });
    entry = applyAssistantFrame(entry, { type: "error", error: copy });

    expect(entry.status).toBe("failed");
    expect(entry.error).toBe(copy);
    expect(entry.content).toBe("Partial answer");
    expect(entry.messageId).toBeNull();

    const empty = applyAssistantFrame(createAssistantEntry(), {
      type: "error",
      error: copy,
    });
    expect(empty.content).toBe("");
    expect(empty.status).toBe("failed");
    expect(empty.error).toBe(copy);
  });
});

/* -------------------------------------------------------------------------
   C2 — the live conversation shell (tests/qa project `qa-assistant-ui`)
   ------------------------------------------------------------------------- */

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";
const qa2Password = process.env.UNIPILOT_QA2_PASSWORD ?? "";

const QA1 = "qa.unipilot@unipilot.test";
const QA2 = "qa2.unipilot@unipilot.test";

/** Every row this spec creates carries this prefix, so teardown is exact. */
const PREFIX = "UI 19x";

/** Seeds this spec keeps ahead of the account's real conversations. */
const FUTURE_MINUTES = 10;

function ahead(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/** Watches a page for console errors and uncaught page errors. */
function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

test.describe("assistant conversation shell (live)", () => {
  let service: SupabaseClient;
  let qa1Id = "";
  let qa2Id = "";
  /** Conversations this spec created, by id; teardown deletes exactly these. */
  const createdConversationIds: string[] = [];

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

  /**
   * Seeds one conversation straight through the service role with a controlled
   * `updated_at`, so the sidebar-order case is deterministic even when the
   * account owns other rows.
   */
  async function seedConversation(
    userId: string,
    name: string,
    updatedAt: string,
  ): Promise<string> {
    const { data, error } = await service
      .from("conversations")
      .insert({
        user_id: userId,
        title: `${PREFIX} ${name}`,
        created_at: updatedAt,
        updated_at: updatedAt,
      })
      .select("id")
      .single();
    expect(error, `seed conversation "${name}": ${error?.message}`).toBeNull();
    const id = (data as { id: string }).id;
    createdConversationIds.push(id);
    return id;
  }

  async function seedMessage(
    conversationId: string,
    role: "user" | "assistant" | "system",
    content: string,
  ): Promise<void> {
    const { error } = await service
      .from("messages")
      .insert({ conversation_id: conversationId, role, content });
    expect(error, `seed ${role} message: ${error?.message}`).toBeNull();
  }

  test.beforeAll(async () => {
    if (!LOCAL_TARGET.test(url)) {
      throw new Error(
        `assistant-ui live cases are local-only; refusing target "${url || "(unset)"}"`,
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
    const qa1 = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const qa2 = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    qa1Id = await signIn(qa1, QA1, qa1Password);
    qa2Id = await signIn(qa2, QA2, qa2Password);
  });

  test.afterEach(async () => {
    if (createdConversationIds.length === 0) return;
    const ids = [...createdConversationIds];
    createdConversationIds.length = 0;

    // Messages cascade with their conversation; both sides are proven gone.
    const removed = await service
      .from("conversations")
      .delete()
      .in("id", ids)
      .select("id");
    expect(removed.error, `teardown delete: ${removed.error?.message}`).toBeNull();
    expect(removed.data ?? [], "every seeded conversation is removed").toHaveLength(
      ids.length,
    );

    const conversationResidue = await service
      .from("conversations")
      .select("id")
      .in("id", ids);
    expect(conversationResidue.error).toBeNull();
    expect(conversationResidue.data ?? [], "no conversation residue").toHaveLength(0);

    const messageResidue = await service
      .from("messages")
      .select("id")
      .in("conversation_id", ids);
    expect(messageResidue.error).toBeNull();
    expect(messageResidue.data ?? [], "no message residue").toHaveLength(0);
  });

  test("sidebar order, selection and the stored bubbles", async ({ page }) => {
    test.slow();
    const errors = trackConsoleErrors(page);

    const first = await seedConversation(qa1Id, "biology revision", ahead(FUTURE_MINUTES));
    const second = await seedConversation(
      qa1Id,
      "essay outline",
      ahead(FUTURE_MINUTES - 1),
    );
    const third = await seedConversation(
      qa1Id,
      "reading list",
      ahead(FUTURE_MINUTES - 2),
    );

    const question = `${PREFIX} what is photosynthesis?`;
    const answer = `${PREFIX} photosynthesis converts light into chemical energy.`;
    await seedMessage(first, "user", question);
    await seedMessage(first, "assistant", answer);
    await seedMessage(second, "user", `${PREFIX} second conversation question`);

    // No `?c=`: the shell selects the most recently active conversation.
    await page.goto("/assistant");
    await expect(
      page.getByRole("heading", { level: 1, name: "Assistant" }),
    ).toBeVisible();
    await expect(page.locator(`[data-conversation-id="${first}"]`)).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(page.locator("[data-message-list]")).toContainText(question);
    await expect(page.locator("[data-message-list]")).toContainText(answer);

    // Newest first: the service's order survives into the sidebar's DOM order.
    const rowIds = await page
      .locator("[data-conversation-id]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-conversation-id")),
      );
    const firstIndex = rowIds.indexOf(first);
    const secondIndex = rowIds.indexOf(second);
    const thirdIndex = rowIds.indexOf(third);
    expect(firstIndex, "the newest conversation is listed").toBeGreaterThanOrEqual(0);
    expect(secondIndex, "the middle conversation follows").toBeGreaterThan(firstIndex);
    expect(thirdIndex, "the oldest conversation is last").toBeGreaterThan(secondIndex);

    // Bubbles: role-aligned, one avatar on the assistant turn, mono labels,
    // and exactly the stored text — no fabricated reply copy.
    const userBubble = page.locator('[data-message-role="user"]');
    const assistantBubble = page.locator('[data-message-role="assistant"]');
    await expect(userBubble).toHaveCount(1);
    await expect(assistantBubble).toHaveCount(1);
    await expect(userBubble.locator("[data-message-content]")).toHaveText(question);
    await expect(assistantBubble.locator("[data-message-content]")).toHaveText(answer);
    await expect(userBubble.locator("[data-message-role-label]")).toHaveText("You");
    await expect(assistantBubble.locator("[data-message-role-label]")).toHaveText(
      "Assistant",
    );
    await expect(userBubble.locator("[data-message-timestamp]")).toHaveClass(
      /font-mono/,
    );
    await expect(assistantBubble.locator("[data-message-timestamp]")).toHaveClass(
      /font-mono/,
    );
    await expect(assistantBubble.locator("[data-assistant-avatar]")).toHaveCount(1);
    await expect(userBubble.locator("[data-assistant-avatar]")).toHaveCount(0);

    // The provider verdict is stated honestly in the shell.
    await expect(page.locator('[data-assistant-status="unconfigured"]')).toBeAttached();
    await expect(page.locator("[data-assistant-unconfigured]")).toContainText(
      "isn't configured yet",
    );

    // Selecting another conversation loads that conversation's messages.
    // Keyboard first: the rows are real links, so focus + Enter is the
    // browser's own activation, not a synthetic handler.
    const secondRow = page.locator(`[data-conversation-id="${second}"]`);
    await secondRow.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`c=${second}`));
    await expect(secondRow).toHaveAttribute("aria-current", "true");
    await expect(page.locator("[data-message-list]")).toContainText(
      `${PREFIX} second conversation question`,
    );
    await expect(page.locator("[data-message-list]")).not.toContainText(question);

    // A conversation with no stored turns says so instead of inventing one.
    await page.locator(`[data-conversation-id="${third}"]`).click();
    await expect(page).toHaveURL(new RegExp(`c=${third}`));
    await expect(page.locator('[data-assistant-empty="empty-conversation"]')).toBeVisible();
    await expect(page.locator("[data-message-role]")).toHaveCount(0);

    expect(errors, "the assistant shell stays console-clean").toEqual([]);
  });

  test("a ?c= id the account does not own is unavailable, never foreign data", async ({
    page,
  }) => {
    const foreign = await seedConversation(qa2Id, "foreign private", ahead(FUTURE_MINUTES));
    const marker = `${PREFIX} foreign private marker`;
    await seedMessage(foreign, "user", marker);

    const errors = trackConsoleErrors(page);
    await page.goto(`/assistant?c=${foreign}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Assistant" }),
    ).toBeVisible();

    // The read was refused honestly: no selection, no bubbles, no leak.
    await expect(page.locator('[data-assistant-empty="unavailable"]')).toBeVisible();
    await expect(page.locator(`[data-conversation-id="${foreign}"]`)).toHaveCount(0);
    await expect(page.locator("[data-message-role]")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(marker);

    expect(errors, "the unavailable state stays console-clean").toEqual([]);
  });

  test("the empty state is honest when the account owns no conversations", async ({
    page,
  }) => {
    const { count, error } = await service
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", qa1Id);
    expect(error).toBeNull();
    test.skip(
      (count ?? 0) > 0,
      `QA1 owns ${count} conversation(s) (residue from other flows); the empty state cannot be proven without deleting real rows`,
    );

    const errors = trackConsoleErrors(page);
    await page.goto("/assistant");
    await expect(
      page.getByRole("heading", { level: 1, name: "Assistant" }),
    ).toBeVisible();

    await expect(page.locator('[data-assistant-empty="none"]')).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 3, name: "No conversations yet" }),
    ).toBeVisible();
    await expect(page.locator('[data-assistant-status="unconfigured"]')).toBeAttached();
    await expect(page.locator("[data-assistant-unconfigured]")).toBeVisible();
    await expect(page.locator("[data-conversation-id]")).toHaveCount(0);
    await expect(page.locator("[data-message-role]")).toHaveCount(0);

    // The affordance is honest: disabled, with the reason stated, rather than
    // a dead control that looks live.
    await expect(page.getByRole("button", { name: "New conversation" })).toBeDisabled();
    await expect(
      page.getByText("Starting a conversation isn't available yet."),
    ).toBeVisible();

    await page.screenshot({
      path: "screenshots/c2-assistant-empty.png",
      fullPage: true,
    });
    expect(errors, "the empty state stays console-clean").toEqual([]);
  });

  test("a guest sees the sign-in prompt and no conversation data", async ({
    browser,
  }) => {
    // Explicit guest context: the project's stored QA session is discarded.
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    const errors = trackConsoleErrors(page);
    const dataReads: string[] = [];
    page.on("request", (request) => {
      if (/\/rest\/v1\//.test(request.url())) dataReads.push(request.url());
    });

    await page.goto("/assistant");
    await expect(
      page.getByRole("heading", { level: 1, name: "Assistant" }),
    ).toBeVisible();
    await expect(page.locator('[data-assistant-empty="guest"]')).toBeVisible();
    await expect(
      page
        .getByText("Sign in to start a conversation with the assistant.")
        .filter({ visible: true }),
    ).toBeVisible();
    await expect(page.locator("[data-conversation-id]")).toHaveCount(0);
    await expect(page.locator("[data-message-role]")).toHaveCount(0);

    await page.screenshot({
      path: "screenshots/c2-assistant-guest.png",
      fullPage: true,
    });

    // The header action opens the shared skippable prompt, not a dead button.
    await expect(page.locator('[data-signed-in="false"]')).toBeAttached();
    await page.getByRole("button", { name: "New conversation" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("Sign in to start a conversation with the assistant."),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Continue browsing" }).click();
    await expect(dialog).not.toBeVisible();

    expect(dataReads, "the guest assistant page must not query the database").toEqual(
      [],
    );
    expect(errors, "the guest assistant page stays console-clean").toEqual([]);
    await context.close();
  });

  test("renders at 375, 768 and 1280 with no horizontal overflow", async ({ page }) => {
    test.slow();
    const errors = trackConsoleErrors(page);

    const conversation = await seedConversation(
      qa1Id,
      "responsive pass",
      ahead(FUTURE_MINUTES),
    );
    await seedMessage(conversation, "user", `${PREFIX} responsive question`);
    await seedMessage(conversation, "assistant", `${PREFIX} responsive answer`);

    for (const [width, height] of [
      [375, 812],
      [768, 1024],
      [1280, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`/assistant?c=${conversation}`);
      await expect(page.locator("[data-message-list]")).toContainText(
        `${PREFIX} responsive answer`,
      );

      // Let the shared entrance ladder settle before measuring/shooting.
      await page.waitForTimeout(600);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        scrollWidth,
        `${width}px must not scroll horizontally (scrollWidth ${scrollWidth} > clientWidth ${clientWidth})`,
      ).toBeLessThanOrEqual(clientWidth);

      // Real-Chromium evidence for the task report (git-ignored directory).
      await page.screenshot({
        path: `screenshots/c2-assistant-${width}.png`,
        fullPage: true,
      });
    }

    expect(errors, "the responsive pass stays console-clean").toEqual([]);
  });
});
