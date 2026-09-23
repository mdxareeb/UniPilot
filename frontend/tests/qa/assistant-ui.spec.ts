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
 *    role and sweep them by id afterwards; they assert the sidebar order and
 *    exact seeded titles, the selected conversation's bubbles (roles, avatar,
 *    stored sources, mono labels), the honest empty states, the guest prompt
 *    and a clean console.
 * 3. C3's composer and streaming turn (19.7–19.11): the real endpoint driven
 *    through the UI (the unconfigured turn streams the verbatim 26.1 copy and
 *    persists), and — because this environment has no provider — a UI-level
 *    SSE stub that fulfills `POST /api/assistant/turn` with crafted frames in
 *    timed chunks: a complete turn with a split frame and sources, an `error`
 *    frame, a `done failed`, a dropped malformed block, and a held-open stream
 *    for the in-flight double-send proof. No provider is configured, so every
 *    live case also pins the honest unconfigured state — the shell never
 *    fabricates a reply.
 * 4. C4's conversation verbs (19.2/19.3): the sidebar's and the empty state's
 *    real "New conversation" controls create a row through
 *    `createConversationAction` and move `?c=`/selection together; rename
 *    persists through `renameConversationAction`; delete confirms in the
 *    shared `Modal`, removes the row and selects the next most recent
 *    conversation; a row that is already gone surfaces the action's own
 *    "no longer exists" copy with no silent switch. Guests keep every verb
 *    away.
 * 5. C5 (19.16): the global launcher panel as a real conversation surface on
 *    the same architecture — the shared turn hook, composer, bubbles and
 *    source rendering. The panel opens on a workspace route and on a
 *    marketing route (and keeps its composer reachable at 375×667 and
 *    1280×640), a live send streams the verbatim unconfigured copy and
 *    offers the full-conversation link, a stubbed turn grows incrementally
 *    with sources and a follow-up continues the same conversation, a guest in
 *    the shell is prompted instead of given a panel, and a marketing guest's
 *    401 surfaces the route's own copy with no fabricated reply and no
 *    per-user read.
 * 6. C6 (19.13/19.15 closeout): the responsive and accessibility pass and the
 *    deferred review fixes. `/assistant` renders at 320/375/768/1024/1280 and
 *    in a 667×375 landscape viewport with no horizontal overflow and no
 *    clipped primary control; the launcher panel holds the same contract at
 *    every width and, below the 520px height threshold, scrolls its composer
 *    into reach instead of clipping it. The composer's keyboard contract
 *    (label, described hint, chips, Enter/Shift+Enter, busy) and the shell's
 *    live regions are asserted; the rename form and the shared delete `Modal`
 *    are exercised for focus placement and return; the launcher's bar, bubble
 *    and panel are exercised for keyboard focus handoff; and a reduced-motion
 *    context proves both surfaces render content immediately. The deferred
 *    fixes are pinned here too: Stop recovers a stream that never closes, the
 *    non-OK / missing-body / truncated-stream branches settle with sanitized
 *    copy, a created conversation's composer focus waits for the selection
 *    commit, and a settle during a held create navigation never steals the
 *    caller's selection.
 * 7. T27-C's confirmation UI (27.6/27.7/27.12): the stored proposals render as
 *    confirmation cards under their assistant message and settle through the
 *    real Server Actions — confirm creates a task that is really visible on
 *    `/tasks`, the card reports the created outcome and a double-confirm never
 *    creates a second row; reject writes nothing; a foreign document link
 *    fails with the sanitized copy; a presentation proposal fails honestly as
 *    not available; and a stubbed fenced turn registers through the real
 *    Server Action (the live key) and confirms from the launcher panel.
 *
 * This project stays green with no provider configured.
 */
import { randomUUID } from "node:crypto";
import { test, expect, type Page, type Route } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ASSISTANT_UNCONFIGURED_COPY } from "../../lib/ai/provider";
import {
  confirmAssistantAction,
  registerAssistantProposals,
} from "../../lib/data/assistantActionLog";
import {
  applyAssistantFrame,
  createAssistantEntry,
  normalizeAssistantFrame,
  parseSseFrames,
} from "../../lib/data/assistantFrames";
import {
  ASSISTANT_ACTION_COPY,
  MESSAGE_CONTENT_MAX_LENGTH,
  type AssistantActionItem,
  type AssistantSource,
  type AssistantStreamFrame,
} from "../../lib/data/assistantValues";
import { stubAssistantTurn, type AssistantTurnStub } from "./assistantTurnStub";

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

/** The 26.12 sanitized failure copy the pipeline persists/streams. */
const FAILED_COPY =
  "The assistant couldn't answer that just now. Please try again.";

/** The 26.10 sanitized rate-limit copy an `error` frame can carry. */
const RATE_LIMITED_COPY =
  "You're sending messages faster than the limit allows. Wait a moment and try again.";


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
/** T27-C's rows (conversations/messages/tasks/documents) carry this one. */
const PREFIX_C = "UI 27c";

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

/**
 * Waits for the assistant page's streamed tree to settle to a single copy.
 *
 * Next streams the server-rendered page in segments; for a moment after a
 * document load the hidden streamed segment and the mounted tree can coexist
 * in the DOM (a framework behaviour recorded at the Phase E gate — it settles
 * with no console error and no product defect). An unscoped strict locator can
 * therefore resolve to two copies, and there are windows where the parked
 * hidden copy is momentarily the *only* copy of the tree (proved from a trace:
 * `<div hidden id="S:4">` holding a full copy while the visible shell has no
 * panel content yet). So the settle condition is: exactly one *visible*
 * workspace root, and no hidden streamed holder carrying a copy of it. Only
 * then can a later interaction resolve to the real, mounted tree.
 */
async function waitForAssistantTree(page: Page): Promise<void> {
  await expect(page.locator("[data-assistant-status]:visible")).toHaveCount(1);
  await expect(
    page.locator("[hidden] [data-assistant-status]"),
  ).toHaveCount(0);
}

/**
 * C6 — holds client-side navigation fetches to `/assistant` open.
 *
 * Both deferred C4 fixes are windows that close as soon as the router commits
 * the new selection: the created conversation's focus must wait for that
 * commit, and a settle must read the caller's intent as it is *now*, not as
 * the last committed prop. Holding Next's RSC navigation fetch (a GET to
 * `/assistant`, not a document load; the created row's own prefetch is held
 * the same way, so no request path can commit the selection early) keeps that
 * window open long enough to prove both deterministically.
 */
type HeldAssistantNavigation = {
  /** Resolves once a navigation fetch is held; never resolves if none comes. */
  engaged: Promise<void>;
  /** The URL of the first held navigation (its `?c=` is the target selection). */
  heldUrl: () => string | null;
  /** Lets every held navigation continue. */
  release: () => void;
  /** Removes the interception. */
  dispose: () => Promise<void>;
};

async function holdAssistantNavigation(
  page: Page,
  /** The selection currently committed: its refreshes/prefetches pass through. */
  current: string | null,
): Promise<HeldAssistantNavigation> {
  let releaseGate: (() => void) | null = null;
  const released = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  let signalEngaged: (() => void) | null = null;
  const engaged = new Promise<void>((resolve) => {
    signalEngaged = resolve;
  });
  let heldUrl: string | null = null;

  const handler = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const selection = url.searchParams.get("c");
    const isTargetNavigation =
      request.method() === "GET" &&
      url.pathname === "/assistant" &&
      request.resourceType() !== "document" &&
      selection !== current;
    if (!isTargetNavigation) {
      /* Defer, never continue: this handler shares the page with the turn
         stub, and `route.continue()` would bypass that later handler. */
      await route.fallback();
      return;
    }
    if (heldUrl === null) heldUrl = request.url();
    signalEngaged?.();
    await released;
    await route.fallback();
  };

  await page.route("**/assistant**", handler);
  return {
    engaged,
    heldUrl: () => heldUrl,
    release: () => releaseGate?.(),
    dispose: () => page.unroute("**/assistant**", handler),
  };
}

test.describe("assistant conversation shell (live)", () => {
  let service: SupabaseClient;
  let qa1: SupabaseClient;
  let qa2: SupabaseClient;
  let qa1Id = "";
  let qa2Id = "";
  /** Conversations this spec created, by id; teardown deletes exactly these. */
  const createdConversationIds: string[] = [];
  /** T27-C's rows, by id (the confirmation tests' real writes). */
  const createdActionIds: string[] = [];
  const createdTaskIds: string[] = [];
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
    sources?: AssistantSource[],
  ): Promise<void> {
    const { error } = await service.from("messages").insert({
      conversation_id: conversationId,
      role,
      content,
      ...(sources !== undefined ? { sources } : {}),
    });
    expect(error, `seed ${role} message: ${error?.message}`).toBeNull();
  }

  /* -------------------------------------------------------------------------
     T27-C — the confirmation UI's real inputs
     ------------------------------------------------------------------------- */

  /** One fenced `unipilot-action` block, exactly as the provider contract emits. */
  function fence(action: unknown): string {
    return ["```unipilot-action", JSON.stringify(action), "```"].join("\n");
  }

  /** One stored assistant message carrying `content`; returns its id. */
  async function seedFencedAssistantMessage(
    conversationId: string,
    content: string,
  ): Promise<string> {
    const { data, error } = await service
      .from("messages")
      .insert({ conversation_id: conversationId, role: "assistant", content })
      .select("id")
      .single();
    expect(error, `seed fenced message: ${error?.message}`).toBeNull();
    return (data as { id: string }).id;
  }

  /**
   * Register `content` through the real log service (the same call the turn
   * pipeline makes), keyed to the seeded message, and track the rows.
   */
  async function registerFencedFor(
    conversationId: string,
    messageId: string | null,
    content: string,
  ): Promise<AssistantActionItem[]> {
    const result = await registerAssistantProposals(qa1Id, {
      conversationId,
      messageId,
      content,
    });
    expect(result.status, "registration is real").toBe("ok");
    const items = result.status === "ok" ? result.items : [];
    createdActionIds.push(...items.map((item) => item.id));
    return items;
  }

  /** The stored log row for one action id (service read). */
  async function storedAction(actionId: string) {
    const { data, error } = await service
      .from("assistant_actions")
      .select("id, status, result, error, settled_at")
      .eq("id", actionId)
      .maybeSingle();
    expect(error).toBeNull();
    return data;
  }

  /** How many tasks QA1 owns with exactly this title. */
  async function taskCount(title: string): Promise<number> {
    const { count, error } = await service
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", qa1Id)
      .eq("title", title);
    expect(error).toBeNull();
    return count ?? 0;
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
    qa1 = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    qa2 = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    qa1Id = await signIn(qa1, QA1, qa1Password);
    qa2Id = await signIn(qa2, QA2, qa2Password);
  });

  /** The wall-clock window a test's usage rows can have been written in. */
  let testStartedAt = "";

  test.beforeEach(() => {
    testStartedAt = new Date().toISOString();
  });

  test.afterEach(async () => {
    // A live turn records `assistant_turn` (and, with a provider, token) rows
    // in `usage_events` (26.10/26.11). They are swept in this test's own
    // window, id/kind/user-scoped, and the residue is proven zero.
    const usage = await service
      .from("usage_events")
      .delete()
      .eq("user_id", qa1Id)
      .in("kind", ["assistant_turn", "assistant_tokens"])
      .gte("occurred_at", testStartedAt)
      .select("id");
    expect(usage.error, `teardown usage: ${usage.error?.message}`).toBeNull();

    const usageResidue = await service
      .from("usage_events")
      .select("id")
      .eq("user_id", qa1Id)
      .in("kind", ["assistant_turn", "assistant_tokens"])
      .gte("occurred_at", testStartedAt);
    expect(usageResidue.error).toBeNull();
    expect(usageResidue.data ?? [], "no usage residue").toHaveLength(0);

    /* T27-C — the confirmation tests' real writes: created tasks/documents
       and the log rows, id-scoped first, then an owner/prefix sweep as the
       backstop for a row stranded before its id was read. `PREFIX_C` is
       unique to this spec, so the sweeps cannot touch anything else. */
    if (createdTaskIds.length > 0) {
      const tasks = await service
        .from("tasks")
        .delete()
        .in("id", createdTaskIds)
        .select("id");
      expect(tasks.error, `teardown tasks: ${tasks.error?.message}`).toBeNull();
      createdTaskIds.length = 0;
    }
    if (createdDocumentIds.length > 0) {
      const documents = await service
        .from("documents")
        .delete()
        .in("id", createdDocumentIds)
        .select("id");
      expect(
        documents.error,
        `teardown documents: ${documents.error?.message}`,
      ).toBeNull();
      createdDocumentIds.length = 0;
    }
    if (createdActionIds.length > 0) {
      const actions = await service
        .from("assistant_actions")
        .delete()
        .in("id", createdActionIds)
        .select("id");
      expect(
        actions.error,
        `teardown actions: ${actions.error?.message}`,
      ).toBeNull();
      createdActionIds.length = 0;
    }

    const taskSweep = await service
      .from("tasks")
      .delete()
      .eq("user_id", qa1Id)
      .like("title", `${PREFIX_C}%`)
      .select("id");
    expect(
      taskSweep.error,
      `teardown task sweep: ${taskSweep.error?.message}`,
    ).toBeNull();
    const taskResidue = await service
      .from("tasks")
      .select("id")
      .eq("user_id", qa1Id)
      .like("title", `${PREFIX_C}%`);
    expect(taskResidue.error).toBeNull();
    expect(taskResidue.data ?? [], "no T27-C task residue").toHaveLength(0);

    const documentSweep = await service
      .from("documents")
      .delete()
      .in("user_id", [qa1Id, qa2Id])
      .like("name", `${PREFIX_C}%`)
      .select("id");
    expect(
      documentSweep.error,
      `teardown document sweep: ${documentSweep.error?.message}`,
    ).toBeNull();
    const documentResidue = await service
      .from("documents")
      .select("id")
      .in("user_id", [qa1Id, qa2Id])
      .like("name", `${PREFIX_C}%`);
    expect(documentResidue.error).toBeNull();
    expect(documentResidue.data ?? [], "no T27-C document residue").toHaveLength(
      0,
    );

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
    /* `removed.data` lists the rows that were still there. A conversation the
       test itself already deleted — through the UI, or through the service
       role for the "already gone" case — is legitimately absent, so the
       count is not asserted; the id-scoped residue probes below are the
       authority that nothing this spec created remains. */

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

    const actionResidue = await service
      .from("assistant_actions")
      .select("id")
      .in("conversation_id", ids);
    expect(actionResidue.error).toBeNull();
    expect(actionResidue.data ?? [], "no action residue").toHaveLength(0);

    /* C6 residue hole: the create test and the panel's live send track their
       rows by URL id, but a failure before the URL surfaced could strand one.
       This owner-scoped, creation-window sweep catches exactly the rows a UI
       flow can create: the create verb's own title ("New conversation") and
       any row whose title carries this spec's PREFIX (a composer first send
       derives the title from the typed text). Seeded rows are explicitly
       future-dated and tracked by id, so they are never in this window; the
       window starts at this test's own `beforeEach` timestamp. Messages
       cascade with the conversations. */
    const uiSweep = await service
      .from("conversations")
      .delete()
      .eq("user_id", qa1Id)
      .gte("created_at", testStartedAt)
      .or(
        `title.eq."New conversation",title.like."${PREFIX}%",title.like."${PREFIX_C}%"`,
      )
      .select("id");
    expect(uiSweep.error, `teardown UI sweep: ${uiSweep.error?.message}`).toBeNull();

    const uiResidue = await service
      .from("conversations")
      .select("id")
      .eq("user_id", qa1Id)
      .gte("created_at", testStartedAt)
      .or(
        `title.eq."New conversation",title.like."${PREFIX}%",title.like."${PREFIX_C}%"`,
      );
    expect(uiResidue.error).toBeNull();
    expect(uiResidue.data ?? [], "no UI-created conversation residue").toHaveLength(
      0,
    );
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
    await seedMessage(first, "assistant", answer, [SOURCE_A]);
    await seedMessage(second, "user", `${PREFIX} second conversation question`);

    // No `?c=`: the shell selects the most recently active conversation.
    await page.goto("/assistant");
    await waitForAssistantTree(page);
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

    // C2 review fold-in: the exact seeded titles are on the rows, not just
    // their order. The title span truncates visually; textContent is exact.
    await expect(page.locator(`[data-conversation-id="${first}"]`)).toContainText(
      `${PREFIX} biology revision`,
    );
    await expect(page.locator(`[data-conversation-id="${second}"]`)).toContainText(
      `${PREFIX} essay outline`,
    );
    await expect(page.locator(`[data-conversation-id="${third}"]`)).toContainText(
      `${PREFIX} reading list`,
    );

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

    // 19.11: a stored assistant row renders its persisted sources — document
    // name, the stored page and the chunk index in mono.
    const storedSources = assistantBubble.locator("[data-assistant-sources]");
    await expect(storedSources).toHaveCount(1);
    const storedSource = storedSources.locator("[data-assistant-source]").first();
    await expect(storedSource).toContainText("Syllabus.pdf");
    await expect(storedSource.locator("[data-assistant-source-page]")).toHaveText("p. 3");
    await expect(storedSource.locator("[data-assistant-source-chunk]")).toHaveText(
      "chunk 1",
    );
    await expect(storedSource.locator("[data-assistant-source-chunk]")).toHaveClass(
      /font-mono/,
    );

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
    await waitForAssistantTree(page);
    await expect(
      page.getByRole("heading", { level: 1, name: "Assistant" }),
    ).toBeVisible();

    // The read was refused honestly: no selection, no bubbles, no leak — and
    // no composer, so a send can never aim at the foreign id or silently
    // start a different conversation behind the error state.
    await expect(page.locator('[data-assistant-empty="unavailable"]')).toBeVisible();
    await expect(page.locator(`[data-conversation-id="${foreign}"]`)).toHaveCount(0);
    await expect(page.locator("[data-message-role]")).toHaveCount(0);
    await expect(page.locator("[data-assistant-composer]")).toHaveCount(0);
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
    await waitForAssistantTree(page);
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

    // The no-conversations state can send: the pipeline creates the
    // conversation server-side (19.7–19.9). The explicit "New conversation"
    // control is still 19.2/C4's; the empty send button here is honest (no
    // text typed yet), not a dead affordance.
    await expect(page.locator("[data-assistant-composer]")).toBeVisible();
    await expect(page.locator("[data-assistant-input]")).toBeVisible();
    await expect(page.locator("[data-assistant-send]")).toBeDisabled();
    await expect(page.locator("[data-assistant-send]")).toBeVisible();

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
    await waitForAssistantTree(page);
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
    // A guest never gets the composer (19.7–19.9): no send, no data.
    await expect(page.locator("[data-assistant-composer]")).toHaveCount(0);
    // 19.2/19.3: a guest gets no conversation verbs either — the header's
    // sign-in action is the only "New conversation" affordance on the page.
    await expect(page.locator("[data-assistant-new]")).toHaveCount(0);
    await expect(page.locator("[data-conversation-verb]")).toHaveCount(0);

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

  test("renders at 320, 375, 768, 1024 and 1280 with no horizontal overflow", async ({
    page,
  }) => {
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
      [320, 568],
      [375, 812],
      [768, 1024],
      [1024, 768],
      [1280, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`/assistant?c=${conversation}`);
      await waitForAssistantTree(page);
      await expect(page.locator("[data-message-list]")).toContainText(
        `${PREFIX} responsive answer`,
      );
      // The composer (19.7–19.9) is part of the shell at every width, and the
      // provider verdict stays honest at every width.
      await expect(page.locator("[data-assistant-composer]")).toBeVisible();
      await expect(page.locator("[data-assistant-input]")).toBeVisible();
      await expect(page.locator("[data-assistant-send]")).toBeVisible();
      await expect(page.locator('[data-assistant-status="unconfigured"]')).toBeAttached();
      await expect(page.locator("[data-assistant-unconfigured]")).toBeVisible();
      await expect(page.locator('[data-assistant-empty="empty-conversation"]')).toHaveCount(0);

      // Let the shared entrance ladder settle before measuring/shooting.
      await page.waitForTimeout(600);
      const metrics = await page.evaluate(() => {
        const send = document.querySelector("[data-assistant-send]");
        const composer = document.querySelector("[data-assistant-composer]");
        if (send === null || composer === null) return null;
        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          send: send.getBoundingClientRect().toJSON(),
          composer: composer.getBoundingClientRect().toJSON(),
        };
      });
      expect(metrics, `${width}px: the composer is mounted`).not.toBeNull();
      expect(
        metrics!.scrollWidth,
        `${width}px must not scroll horizontally (scrollWidth ${metrics!.scrollWidth} > clientWidth ${metrics!.clientWidth})`,
      ).toBeLessThanOrEqual(metrics!.clientWidth);
      // No clipped primary control: Send and the composer sit inside the
      // viewport's horizontal box (a control past the right edge is the
      // failure mode `scrollWidth` alone would not catch once the page wraps).
      expect(metrics!.send.left, `${width}px: Send starts on-screen`).toBeGreaterThanOrEqual(-1);
      expect(
        metrics!.send.right,
        `${width}px: Send ends on-screen`,
      ).toBeLessThanOrEqual(metrics!.clientWidth + 1);
      expect(
        metrics!.composer.left,
        `${width}px: the composer starts on-screen`,
      ).toBeGreaterThanOrEqual(-1);
      expect(
        metrics!.composer.right,
        `${width}px: the composer ends on-screen`,
      ).toBeLessThanOrEqual(metrics!.clientWidth + 1);

      // Real-Chromium evidence for the task report (git-ignored directory).
      await page.screenshot({
        path: `screenshots/c6-assistant-${width}.png`,
        fullPage: true,
      });
    }

    // C6 landscape residual: a phone-height viewport (667×375) must still
    // reach the composer, through the document's own scroll — the page is a
    // normal scrolling document, so `scrollIntoViewIfNeeded` is the proof
    // that no fixed chrome traps the send path.
    await page.setViewportSize({ width: 667, height: 375 });
    await page.goto(`/assistant?c=${conversation}`);
    await waitForAssistantTree(page);
    const landscapeComposer = page.locator("[data-assistant-composer]");
    await landscapeComposer.scrollIntoViewIfNeeded();
    await expect(landscapeComposer).toBeVisible();
    await expect(page.locator("[data-assistant-input]")).toBeVisible();
    await expect(page.locator("[data-assistant-send]")).toBeVisible();
    await page.waitForTimeout(600);
    const landscape = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      landscape.scrollWidth,
      "667×375 must not scroll horizontally",
    ).toBeLessThanOrEqual(landscape.clientWidth);
    await page.screenshot({
      path: "screenshots/c6-assistant-667x375.png",
      fullPage: true,
    });

    expect(errors, "the responsive pass stays console-clean").toEqual([]);
  });

  /* -----------------------------------------------------------------------
     C3 — the composer (19.7–19.9), the streaming turn (19.10) and source
     references (19.11). The live case drives the real endpoint; the stubbed
     cases replace only the HTTP boundary with crafted SSE chunks.
     ----------------------------------------------------------------------- */

  test("a live turn streams the honest unconfigured copy and settles stored", async ({
    page,
  }) => {
    test.slow();
    const errors = trackConsoleErrors(page);
    const conversation = await seedConversation(
      qa1Id,
      "live unconfigured turn",
      ahead(FUTURE_MINUTES),
    );
    const question = `${PREFIX} what should I revise first?`;

    // Poll at frame granularity: the local entry passes through
    // `unconfigured` and is retired by the reconciliation refresh moments
    // later, so a plain locator assertion could miss that committed state.
    const optimisticUserText = page.waitForFunction(() => {
      const content = document.querySelector(
        '[data-message-role="user"][data-message-local] [data-message-content]',
      );
      return content === null ? null : content.textContent;
    });
    const unconfiguredEntry = page.waitForFunction(() => {
      const bubble = document.querySelector(
        '[data-message-role="assistant"][data-message-local]',
      );
      if (bubble === null) return null;
      return bubble.getAttribute("data-message-status") === "unconfigured"
        ? bubble.textContent
        : null;
    });

    await page.goto(`/assistant?c=${conversation}`);
    await waitForAssistantTree(page);
    const input = page.locator("[data-assistant-input]");
    await input.fill(question);
    await expect(page.locator("[data-assistant-send]")).toBeEnabled();
    await page.locator("[data-assistant-send]").click();

    // The optimistic user bubble carries the exact typed text, and the live
    // entry streams the route's verbatim 26.1 copy and settles unconfigured.
    expect(await (await optimisticUserText).jsonValue()).toBe(question);
    const streamedText = String(await (await unconfiguredEntry).jsonValue());
    expect(streamedText).toContain(ASSISTANT_UNCONFIGURED_COPY);
    // No sources frame exists on the unconfigured path.
    expect(streamedText).not.toContain("Sources");

    // After settle the hook refreshes and retires the local turn: the stored
    // rows are the source of truth, and the URL keeps the same ?c=.
    await expect(page.locator("[data-message-local]")).toHaveCount(0, {
      timeout: 20_000,
    });
    await waitForAssistantTree(page);
    await expect(page).toHaveURL(new RegExp(`c=${conversation}`));
    const storedUser = page.locator('[data-message-role="user"]');
    const storedAssistant = page.locator('[data-message-role="assistant"]');
    await expect(storedUser).toHaveCount(1);
    await expect(storedAssistant).toHaveCount(1);
    await expect(storedUser.locator("[data-message-content]")).toHaveText(question);
    await expect(storedAssistant.locator("[data-message-content]")).toContainText(
      ASSISTANT_UNCONFIGURED_COPY,
    );
    await expect(storedAssistant).toHaveAttribute("data-message-status", "complete");
    await expect(storedAssistant.locator("[data-assistant-sources]")).toHaveCount(0);

    // The stored rows are actually visible, not merely in the DOM: a row that
    // mounts after a single-observer reveal group has already played stays at
    // `opacity: 0` (the defect the per-row reveals in MessageList fix).
    await expect(page.locator("[data-message-list] > li").last()).toHaveCSS(
      "opacity",
      "1",
    );

    // Let the shared reveal ladder settle before the evidence shot (the same
    // pause the responsive pass uses).
    await page.waitForTimeout(600);
    await page.screenshot({
      path: "screenshots/c3-assistant-unconfigured.png",
      fullPage: true,
    });

    // A reload reads both stored messages back.
    await page.reload();
    await waitForAssistantTree(page);
    await expect(
      page.locator('[data-message-role="user"] [data-message-content]'),
    ).toHaveText(question);
    await expect(page.locator('[data-message-role="assistant"]')).toContainText(
      ASSISTANT_UNCONFIGURED_COPY,
    );
    await expect(page.locator("[data-message-local]")).toHaveCount(0);
    await expect(page.locator("[data-assistant-sources]")).toHaveCount(0);

    expect(errors, "the live turn stays console-clean").toEqual([]);
  });

  test("a stubbed complete turn grows incrementally and renders sources", async ({
    page,
  }) => {
    test.slow();
    const errors = trackConsoleErrors(page);
    const conversation = await seedConversation(
      qa1Id,
      "stubbed stream",
      ahead(FUTURE_MINUTES),
    );

    /* One crafted stream: a real start, two deltas, one delta frame SPLIT
       across two writes, a malformed block that must be dropped, the sources
       frame and the terminal done. The stub holds after the first delta so the
       mid-stream state is a deterministic observation, not a timing guess. */
    const chunks = [
      frameToSse({
        type: "start",
        conversationId: conversation,
        configured: true,
      }),
      frameToSse({ type: "delta", text: "Photosynthesis " }),
      'data: {"type":"delta","text":"converts light',
      ' into sugar"}\n\n',
      "data: {not json\n\n",
      frameToSse({ type: "sources", sources: [SOURCE_A, SOURCE_B] }),
      frameToSse({
        type: "done",
        status: "complete",
        messageId: "stub-c3-message",
      }),
    ];
    /* C6: a small gapMs so the split frame really arrives in separate reads
       (the wire carry path), not coalesced into one chunk. */
    const stub = await stubAssistantTurn(page, { chunks, holdAfter: 2, gapMs: 25 });

    try {
      await page.goto(`/assistant?c=${conversation}`);
      await waitForAssistantTree(page);
      await page
        .locator("[data-assistant-input]")
        .fill(`${PREFIX} stubbed question`);
      await page.locator("[data-assistant-send]").click();

      const bubble = page.locator(
        '[data-message-role="assistant"][data-message-local]',
      );
      // Mid-stream: the first delta is on screen, the rest is still held.
      await expect(bubble).toHaveAttribute("data-message-status", "streaming");
      await expect(bubble.locator("[data-message-content]")).toHaveText(
        "Photosynthesis ",
      );
      await expect(bubble.locator("[data-message-streaming]")).toBeVisible();
      // The live row itself is visible, not stuck at the reveal's hidden state.
      await expect(page.locator("[data-message-list] > li").last()).toHaveCSS(
        "opacity",
        "1",
      );
      await expect(page.locator("[data-assistant-composer]")).toHaveAttribute(
        "aria-busy",
        "true",
      );
      await page.screenshot({
        path: "screenshots/c3-assistant-streaming.png",
        fullPage: true,
      });

      stub.release();

      // The rest of the stream reassembles: the split frame, the dropped
      // malformed block, the sources and the terminal status.
      await expect(bubble).toHaveAttribute("data-message-status", "complete", {
        timeout: 20_000,
      });
      await expect(bubble.locator("[data-message-content]")).toHaveText(
        "Photosynthesis converts light into sugar",
      );

      // 19.11: name, optional page and mono chunk index; no extra chrome.
      const sources = bubble.locator("[data-assistant-sources]");
      await expect(sources).toHaveCount(1);
      const rows = sources.locator("[data-assistant-source]");
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toContainText("Syllabus.pdf");
      await expect(rows.nth(0).locator("[data-assistant-source-page]")).toHaveText(
        "p. 3",
      );
      await expect(
        rows.nth(0).locator("[data-assistant-source-chunk]"),
      ).toHaveText("chunk 1");
      await expect(
        rows.nth(0).locator("[data-assistant-source-chunk]"),
      ).toHaveClass(/font-mono/);
      await expect(rows.nth(1)).toContainText("Lecture notes.pdf");
      await expect(
        rows.nth(1).locator("[data-assistant-source-page]"),
      ).toHaveCount(0);
      await page.screenshot({
        path: "screenshots/c3-assistant-sources.png",
        fullPage: true,
      });

      expect(stub.requestCount(), "exactly one turn was sent").toBe(1);
      expect(errors, "the stubbed stream stays console-clean").toEqual([]);
    } finally {
      await stub.dispose();
    }
  });

  test("a stubbed error frame shows its sanitized copy, never an invented answer", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    const conversation = await seedConversation(
      qa1Id,
      "stubbed failure",
      ahead(FUTURE_MINUTES),
    );
    const stub = await stubAssistantTurn(page, {
      chunks: [frameToSse({ type: "error", error: RATE_LIMITED_COPY })],
    });

    try {
      await page.goto(`/assistant?c=${conversation}`);
      await waitForAssistantTree(page);
      const question = `${PREFIX} stubbed rate limited`;
      await page.locator("[data-assistant-input]").fill(question);
      await page.locator("[data-assistant-send]").click();

      const bubble = page.locator(
        '[data-message-role="assistant"][data-message-local]',
      );
      await expect(bubble).toHaveAttribute("data-message-status", "failed");
      await expect(bubble.locator("[data-assistant-failure]")).toHaveText(
        RATE_LIMITED_COPY,
      );
      // The copy is failure text, not answer text: no content paragraph was
      // fabricated, and the generic failure copy is not substituted.
      await expect(bubble.locator("[data-message-content]")).toHaveCount(0);
      await expect(bubble).not.toContainText(FAILED_COPY);
      await expect(
        page.locator(
          '[data-message-role="user"][data-message-local] [data-message-content]',
        ),
      ).toHaveText(question);
      await page.screenshot({
        path: "screenshots/c3-assistant-failed.png",
        fullPage: true,
      });
      expect(stub.requestCount()).toBe(1);
      expect(errors, "the errored turn stays console-clean").toEqual([]);
    } finally {
      await stub.dispose();
    }
  });

  test("a stubbed done failed keeps only the delivered text and marks it failed", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    const conversation = await seedConversation(
      qa1Id,
      "stubbed done failed",
      ahead(FUTURE_MINUTES),
    );
    const stub = await stubAssistantTurn(page, {
      chunks: [
        frameToSse({
          type: "start",
          conversationId: conversation,
          configured: true,
        }),
        frameToSse({ type: "delta", text: "Half an answer" }),
        frameToSse({ type: "done", status: "failed", messageId: null }),
      ],
    });

    try {
      await page.goto(`/assistant?c=${conversation}`);
      await waitForAssistantTree(page);
      await page
        .locator("[data-assistant-input]")
        .fill(`${PREFIX} stubbed done failed`);
      await page.locator("[data-assistant-send]").click();

      const bubble = page.locator(
        '[data-message-role="assistant"][data-message-local]',
      );
      await expect(bubble).toHaveAttribute("data-message-status", "failed");
      await expect(bubble.locator("[data-message-content]")).toHaveText(
        "Half an answer",
      );
      await expect(bubble).toContainText("Failed");
      // A failed status is not an error copy: the delivered text stands alone
      // with the Failed badge, and nothing else is printed.
      await expect(bubble.locator("[data-assistant-failure]")).toHaveCount(0);
      await expect(bubble.locator("[data-assistant-sources]")).toHaveCount(0);
      expect(errors, "the failed turn stays console-clean").toEqual([]);
    } finally {
      await stub.dispose();
    }
  });

  test("the composer: labelled, bounded, Enter sends, Shift+Enter breaks the line", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    const conversation = await seedConversation(
      qa1Id,
      "composer behaviour",
      ahead(FUTURE_MINUTES),
    );
    /* A settled stub so the send path is deterministic and never spends the
       real rate-limit window. */
    const stub = await stubAssistantTurn(page, {
      chunks: [
        frameToSse({
          type: "start",
          conversationId: conversation,
          configured: true,
        }),
        frameToSse({ type: "done", status: "complete", messageId: null }),
      ],
    });

    try {
      await page.goto(`/assistant?c=${conversation}`);
      await waitForAssistantTree(page);
      const composer = page.locator("[data-assistant-composer]");
      const input = page.locator("[data-assistant-input]");
      const send = page.locator("[data-assistant-send]");

      await expect(composer).toBeVisible();
      await expect(composer).toHaveAttribute("aria-busy", "false");
      // A real label names the field, and the contract's bound is applied.
      await expect(page.getByLabel("Message the assistant")).toHaveCount(1);
      await expect(input).toHaveAttribute(
        "maxlength",
        String(MESSAGE_CONTENT_MAX_LENGTH),
      );
      await expect(page.locator("[data-assistant-busy]")).toContainText(
        "Enter sends · Shift+Enter adds a line",
      );

      // Empty and whitespace-only never send.
      await expect(send).toBeDisabled();
      await input.fill("   ");
      await expect(send).toBeDisabled();
      await input.press("Enter");
      await expect(page.locator("[data-message-local]")).toHaveCount(0);
      expect(stub.requestCount(), "no request for a whitespace message").toBe(0);

      // Shift+Enter inserts a newline and does not send.
      await input.fill("");
      await input.pressSequentially("line one");
      await input.press("Shift+Enter");
      await input.pressSequentially("line two");
      await expect(input).toHaveValue("line one\nline two");
      await expect(send).toBeEnabled();
      expect(stub.requestCount()).toBe(0);
      await expect(page.locator("[data-message-local]")).toHaveCount(0);

      // An action chip fills the composer and never sends on its own.
      const chip = page.locator("[data-assistant-chip]").first();
      const chipText = (await chip.textContent())?.trim() ?? "";
      expect(chipText.length, "chips carry real prompt text").toBeGreaterThan(8);
      await chip.click();
      await expect(input).toHaveValue(chipText);
      expect(stub.requestCount()).toBe(0);
      await expect(page.locator("[data-message-local]")).toHaveCount(0);

      // Enter sends the exact typed text, newlines included, and focus stays
      // in the composer once the turn settles.
      await input.fill("line one\nline two");
      await input.press("Enter");
      const sentContent = page.locator(
        '[data-message-role="user"][data-message-local] [data-message-content]',
      );
      await expect(sentContent).toHaveCount(1);
      expect(await sentContent.evaluate((node) => node.textContent)).toBe(
        "line one\nline two",
      );
      await expect(
        page.locator('[data-message-role="assistant"][data-message-local]'),
      ).toHaveAttribute("data-message-status", "complete");
      await expect(input).toHaveValue("");
      await expect(input).toBeFocused();
      await expect(composer).toHaveAttribute("aria-busy", "false");
      expect(stub.requestCount()).toBe(1);
      expect(errors, "the composer stays console-clean").toEqual([]);
    } finally {
      await stub.dispose();
    }
  });

  test("an in-flight turn blocks a second send", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    const conversation = await seedConversation(
      qa1Id,
      "double send",
      ahead(FUTURE_MINUTES),
    );
    /* Hold before the first chunk: the response headers are sent and the turn
       is genuinely in flight while the test tries to send again. */
    const stub = await stubAssistantTurn(page, {
      chunks: [
        frameToSse({
          type: "start",
          conversationId: conversation,
          configured: true,
        }),
        frameToSse({ type: "done", status: "complete", messageId: null }),
      ],
      holdAfter: 0,
    });

    try {
      await page.goto(`/assistant?c=${conversation}`);
      await waitForAssistantTree(page);
      const composer = page.locator("[data-assistant-composer]");
      const input = page.locator("[data-assistant-input]");
      const send = page.locator("[data-assistant-send]");

      await input.fill(`${PREFIX} one at a time`);
      await input.press("Enter");

      await expect.poll(() => stub.requestCount()).toBe(1);
      await expect(composer).toHaveAttribute("aria-busy", "true");
      await expect(page.locator("[data-assistant-busy]")).toHaveText(
        /answering/,
      );
      await expect(send).toBeDisabled();
      await expect(page.locator("[data-message-local]")).toHaveCount(2);

      // A second Enter and a forced click on the disabled send cannot start a
      // second turn; the request counter proves nothing reached the wire.
      await input.press("Enter");
      await send.click({ force: true });
      stub.release();

      await expect(
        page.locator('[data-message-role="assistant"][data-message-local]'),
      ).toHaveAttribute("data-message-status", "complete", { timeout: 20_000 });
      expect(stub.requestCount(), "the second send never became a request").toBe(
        1,
      );
      await expect(
        page.locator('[data-message-role="user"][data-message-local]'),
      ).toHaveCount(1);
      await expect(composer).toHaveAttribute("aria-busy", "false");
      expect(errors, "the blocked double-send stays console-clean").toEqual([]);
    } finally {
      await stub.dispose();
    }
  });

  test("Stop ends a stream that never closes and recovers with the sanitized copy", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    const conversation = await seedConversation(
      qa1Id,
      "stopped stream",
      ahead(FUTURE_MINUTES),
    );
    /* C6 (deferred C3 Important): the stub writes the start frame and then
       holds the body open forever — a live stream that never closes. Without
       the Stop affordance the composer would stay wedged in `busy`. */
    const stub = await stubAssistantTurn(page, {
      chunks: [
        frameToSse({
          type: "start",
          conversationId: conversation,
          configured: true,
        }),
      ],
      holdAfter: 1,
    });

    try {
      await page.goto(`/assistant?c=${conversation}`);
      await waitForAssistantTree(page);
      const composer = page.locator("[data-assistant-composer]");
      const input = page.locator("[data-assistant-input]");
      const send = page.locator("[data-assistant-send]");
      const stop = page.locator("[data-assistant-stop]");

      await input.fill(`${PREFIX} never closes`);
      await input.press("Enter");
      await expect.poll(() => stub.requestCount()).toBe(1);
      // Busy, with a real way out; the field stays typable.
      await expect(composer).toHaveAttribute("aria-busy", "true");
      await expect(stop).toBeVisible();
      await expect(send).toBeDisabled();
      await expect(input).toBeEnabled();
      await page.waitForTimeout(600);
      await page.screenshot({ path: "screenshots/c6-stream-busy.png" });

      await stop.click();

      // The abort settles as a sanitized failure: the composer recovers,
      // focus returns to the textarea, and the only failure text is the
      // server's copy — never invented answer text.
      const bubble = page.locator(
        '[data-message-role="assistant"][data-message-local]',
      );
      await expect(bubble).toHaveAttribute("data-message-status", "failed");
      await expect(bubble.locator("[data-assistant-failure]")).toHaveText(
        FAILED_COPY,
      );
      await expect(bubble.locator("[data-message-content]")).toHaveCount(0);
      await expect(bubble).not.toContainText(ASSISTANT_UNCONFIGURED_COPY);
      await expect(composer).toHaveAttribute("aria-busy", "false");
      await expect(stop).toHaveCount(0);
      await expect(input).toBeFocused();
      await page.screenshot({ path: "screenshots/c6-stream-stopped.png" });

      // Recovered means sendable: a second turn reaches the stub.
      await input.fill(`${PREFIX} after the stop`);
      await expect(send).toBeEnabled();
      await input.press("Enter");
      await expect.poll(() => stub.requestCount()).toBe(2);
      await expect(composer).toHaveAttribute("aria-busy", "true");
      expect(errors, "the stopped turn stays console-clean").toEqual([]);
    } finally {
      await stub.dispose();
    }
  });

  test("a non-OK response uses the route's copy, else the sanitized fallback", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    const conversation = await seedConversation(
      qa1Id,
      "non-OK turn",
      ahead(FUTURE_MINUTES),
    );
    const bubble = page.locator(
      '[data-message-role="assistant"][data-message-local]',
    );

    /* C6 (deferred C3 minor): the non-OK branch with a real JSON `{ error }`
       body — the route's own sanitized copy is the failure text. */
    const refused = await stubAssistantTurn(page, {
      status: 401,
      chunks: ['{"error":"Sign in to use the assistant."}'],
    });
    try {
      await page.goto(`/assistant?c=${conversation}`);
      await waitForAssistantTree(page);
      await page.locator("[data-assistant-input]").fill(`${PREFIX} unauthorized`);
      await page.locator("[data-assistant-send]").click();

      await expect(bubble).toHaveAttribute("data-message-status", "failed");
      await expect(bubble.locator("[data-assistant-failure]")).toHaveText(
        "Sign in to use the assistant.",
      );
      await expect(bubble.locator("[data-message-content]")).toHaveCount(0);
      await expect(page.locator("[data-assistant-composer]")).toHaveAttribute(
        "aria-busy",
        "false",
      );
    } finally {
      await refused.dispose();
    }

    /* And the same branch with a body that is not JSON: the server-passed
       transport fallback is used, never a guessed message. */
    const broken = await stubAssistantTurn(page, {
      status: 500,
      chunks: ["<html>upstream failed</html>"],
    });
    try {
      await page.locator("[data-assistant-input]").fill(`${PREFIX} server error`);
      await page.locator("[data-assistant-send]").click();
      await expect(bubble).toHaveAttribute("data-message-status", "failed");
      await expect(bubble.locator("[data-assistant-failure]")).toHaveText(
        FAILED_COPY,
      );
      await expect(bubble.locator("[data-message-content]")).toHaveCount(0);
    } finally {
      await broken.dispose();
    }

    // The deliberate non-OK responses are logged by Chromium at the network
    // layer ("Failed to load resource … 401/500"); the app adds no console
    // error of its own, and the copy assertions above prove both were handled.
    const unexpected = errors.filter(
      (message) => !/Failed to load resource.*(401|500)/.test(message),
    );
    expect(unexpected, "the non-OK turns stay console-clean").toEqual([]);
  });

  test("a missing body and a truncated stream both settle as sanitized failures", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    const conversation = await seedConversation(
      qa1Id,
      "broken streams",
      ahead(FUTURE_MINUTES),
    );
    const bubble = page.locator(
      '[data-message-role="assistant"][data-message-local]',
    );

    /* C6 (deferred C3 minor): an OK response with no body at all (204) is a
       failure, never an empty answer. */
    const noBody = await stubAssistantTurn(page, { status: 204, chunks: [] });
    try {
      await page.goto(`/assistant?c=${conversation}`);
      await waitForAssistantTree(page);
      await page.locator("[data-assistant-input]").fill(`${PREFIX} no body`);
      await page.locator("[data-assistant-send]").click();

      await expect(bubble).toHaveAttribute("data-message-status", "failed");
      await expect(bubble.locator("[data-assistant-failure]")).toHaveText(
        FAILED_COPY,
      );
      await expect(bubble.locator("[data-message-content]")).toHaveCount(0);
      await expect(page.locator("[data-assistant-composer]")).toHaveAttribute(
        "aria-busy",
        "false",
      );
    } finally {
      await noBody.dispose();
    }

    /* A body that ends without any terminal frame keeps exactly the delivered
       text and is marked failed — a truncated turn is not a silent success. */
    const truncated = await stubAssistantTurn(page, {
      chunks: [
        frameToSse({
          type: "start",
          conversationId: conversation,
          configured: true,
        }),
        frameToSse({ type: "delta", text: "Half an answer" }),
      ],
    });
    try {
      await page.locator("[data-assistant-input]").fill(`${PREFIX} truncated`);
      await page.locator("[data-assistant-send]").click();
      await expect(bubble).toHaveAttribute("data-message-status", "failed");
      await expect(bubble.locator("[data-message-content]")).toHaveText(
        "Half an answer",
      );
      await expect(bubble.locator("[data-assistant-failure]")).toHaveText(
        FAILED_COPY,
      );
      await expect(bubble).toContainText("Failed");
      await expect(page.locator("[data-assistant-composer]")).toHaveAttribute(
        "aria-busy",
        "false",
      );
    } finally {
      await truncated.dispose();
    }

    expect(errors, "the broken streams stay console-clean").toEqual([]);
  });

  test("the first send from the no-conversations state starts the conversation", async ({
    page,
  }) => {
    const { count, error } = await service
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", qa1Id);
    expect(error).toBeNull();
    test.skip(
      (count ?? 0) > 0,
      `QA1 owns ${count} conversation(s) (residue from other flows); the no-conversations send cannot be proven without deleting real rows`,
    );
    const errors = trackConsoleErrors(page);
    const question = `${PREFIX} start this conversation`;
    let createdId: string | null = null;

    try {
      await page.goto("/assistant");
      await waitForAssistantTree(page);
      await expect(page.locator('[data-assistant-empty="none"]')).toBeVisible();
      await page.locator("[data-assistant-input]").fill(question);
      await page.locator("[data-assistant-send]").click();

      // The pipeline created the conversation and `start` announced it; the
      // hook replaces the URL so the read side and sidebar agree.
      await expect(page).toHaveURL(/\/assistant\?c=[0-9a-f-]{36}/i, {
        timeout: 20_000,
      });
      createdId = new URL(page.url()).searchParams.get("c");
      if (createdId !== null) createdConversationIds.push(createdId);

      await expect(page.locator("[data-message-local]")).toHaveCount(0, {
        timeout: 20_000,
      });
      await expect(
        page.locator('[data-message-role="user"] [data-message-content]'),
      ).toHaveText(question);
      await expect(page.locator('[data-message-role="assistant"]')).toContainText(
        ASSISTANT_UNCONFIGURED_COPY,
      );
      if (createdId !== null) {
        await expect(
          page.locator(`[data-conversation-id="${createdId}"]`),
        ).toHaveAttribute("aria-current", "true");
        await expect(
          page.locator(`[data-conversation-id="${createdId}"]`),
        ).toContainText(question);
      }
      expect(errors, "the first-send flow stays console-clean").toEqual([]);
    } finally {
      // Safety net: if the URL never surfaced, the created row is still
      // identified (and removed) by the exact derived title.
      if (createdId === null) {
        const { data } = await service
          .from("conversations")
          .select("id")
          .eq("user_id", qa1Id)
          .eq("title", question);
        for (const row of data ?? []) {
          createdConversationIds.push((row as { id: string }).id);
        }
      }
    }
  });

  /* -----------------------------------------------------------------------
     C4 — the conversation verbs (19.2/19.3): create through
     `createConversationAction`, rename through `renameConversationAction`,
     delete through `deleteConversationAction`. These are live cases only:
     the contract under test is the action plus URL/selection coherence, so
     no stub could prove anything here.
     ----------------------------------------------------------------------- */

  test("New conversation creates a real row, selects it and focuses the composer", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    /* In the past, so the created row (now) takes the newest sidebar slot. */
    const existing = await seedConversation(
      qa1Id,
      "existing conversation",
      ahead(-5),
    );

    await page.goto(`/assistant?c=${existing}`);
    await waitForAssistantTree(page);
    await expect(
      page.locator(`[data-conversation-id="${existing}"]`),
    ).toHaveAttribute("aria-current", "true");

    const control = page.locator('[data-assistant-new="sidebar"]');
    await expect(control).toBeVisible();
    await control.click();

    // The action round-trips and pushes a new id. The URL we were on already
    // matches the generic `?c=` shape, so poll for the id to actually change
    // (and for the action to report no failure) before reading it.
    await expect
      .poll(() => new URL(page.url()).searchParams.get("c"), {
        message: "the create verb never moved the URL",
        timeout: 15_000,
      })
      .not.toBe(existing);
    await expect(page.locator("[data-assistant-create-error]")).toHaveCount(0);

    const createdId = new URL(page.url()).searchParams.get("c");
    expect(createdId, "the create flow produced no conversation id").not.toBeNull();
    expect(createdId).not.toBe(existing);
    if (createdId === null) throw new Error("create never produced an id");
    createdConversationIds.push(createdId);

    const createdRow = page.locator(`[data-conversation-id="${createdId}"]`);
    await expect(createdRow).toHaveCount(1);
    await expect(createdRow).toHaveAttribute("aria-current", "true");
    await expect(createdRow).toContainText("New conversation");
    await expect(page.locator("[data-conversation-title]")).toHaveText(
      "New conversation",
    );
    await expect(
      page.locator('[data-assistant-empty="empty-conversation"]'),
    ).toBeVisible();
    // 19.2: the new conversation is ready to be written into.
    await expect(page.locator("[data-assistant-input]")).toBeFocused();

    // The row is really in the database, owned by the caller.
    const stored = await service
      .from("conversations")
      .select("id, user_id, title")
      .eq("id", createdId)
      .single();
    expect(stored.error, `read created row: ${stored.error?.message}`).toBeNull();
    expect(stored.data).toMatchObject({
      id: createdId,
      user_id: qa1Id,
      title: "New conversation",
    });

    await page.screenshot({
      path: "screenshots/c4-new-conversation.png",
      fullPage: true,
    });

    // A reload still finds the URL naming it and the sidebar selecting it.
    await page.reload();
    await waitForAssistantTree(page);
    await expect(page).toHaveURL(new RegExp(`c=${createdId}`));
    await expect(
      page.locator(`[data-conversation-id="${createdId}"]`),
    ).toHaveAttribute("aria-current", "true");
    await expect(page.locator("[data-conversation-title]")).toHaveText(
      "New conversation",
    );
    await expect(
      page.locator('[data-assistant-empty="empty-conversation"]'),
    ).toBeVisible();
    expect(errors, "the create flow stays console-clean").toEqual([]);
  });

  test("the no-conversations empty state creates the first conversation through its own control", async ({
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
    await waitForAssistantTree(page);
    const empty = page.locator('[data-assistant-empty="none"]');
    await expect(empty).toBeVisible();

    const control = empty.locator('[data-assistant-new="empty"]');
    await expect(control).toBeVisible();
    await control.click();

    await expect(page).toHaveURL(/\/assistant\?c=[0-9a-f-]{36}/i);
    const createdId = new URL(page.url()).searchParams.get("c");
    if (createdId === null) throw new Error("create never produced an id");
    createdConversationIds.push(createdId);

    await expect(page.locator('[data-assistant-empty="none"]')).toHaveCount(0);
    await expect(
      page.locator(`[data-conversation-id="${createdId}"]`),
    ).toHaveAttribute("aria-current", "true");
    await expect(page.locator("[data-conversation-title]")).toHaveText(
      "New conversation",
    );
    await expect(page.locator("[data-assistant-input]")).toBeFocused();
    expect(errors, "the empty-state create stays console-clean").toEqual([]);
  });

  test("rename updates the sidebar and the panel, persists, and cancels cleanly", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    const first = await seedConversation(qa1Id, "rename me", ahead(FUTURE_MINUTES));
    const second = await seedConversation(
      qa1Id,
      "other conversation",
      ahead(FUTURE_MINUTES - 1),
    );
    const renamed = `${PREFIX} renamed conversation`;

    await page.goto(`/assistant?c=${first}`);
    await waitForAssistantTree(page);

    // Cancel first: the draft is abandoned and the stored title is untouched.
    await page.locator('[data-conversation-verb="rename"]').click();
    const input = page.locator("[data-conversation-rename-input]");
    await expect(input).toBeVisible();
    await expect(input).toHaveValue(`${PREFIX} rename me`);
    // The service's own bound (CONVERSATION_TITLE_MAX_LENGTH, 120).
    await expect(input).toHaveAttribute("maxlength", "120");
    await input.fill("Junk name");
    await page.locator("[data-conversation-rename-cancel]").click();
    await expect(page.locator("[data-conversation-rename-input]")).toHaveCount(0);
    await expect(page.locator("[data-conversation-title]")).toHaveText(
      `${PREFIX} rename me`,
    );

    // Rename for real: the title changes in place, then the settled row is
    // reconciled; the stored title is what the reload proves.
    await page.locator('[data-conversation-verb="rename"]').click();
    await page.locator("[data-conversation-rename-input]").fill(renamed);
    await page.screenshot({
      path: "screenshots/c4-rename.png",
      fullPage: true,
    });
    await page.locator("[data-conversation-rename-save]").click();
    await expect(page.locator("[data-conversation-title]")).toHaveText(renamed);
    await expect(page.locator(`[data-conversation-id="${first}"]`)).toContainText(
      renamed,
    );

    /* C6 (deferred minor): the action's response and the row it wrote are not
       the same instant, so poll the stored title instead of reading once. */
    await expect
      .poll(
        async () => {
          const stored = await service
            .from("conversations")
            .select("title")
            .eq("id", first)
            .single();
          expect(
            stored.error,
            `read renamed row: ${stored.error?.message}`,
          ).toBeNull();
          return (stored.data as { title: string } | null)?.title ?? null;
        },
        { message: "the rename never reached the stored row", timeout: 10_000 },
      )
      .toBe(renamed);

    await page.reload();
    await waitForAssistantTree(page);
    await expect(page.locator("[data-conversation-title]")).toHaveText(renamed);
    await expect(page.locator(`[data-conversation-id="${first}"]`)).toContainText(
      renamed,
    );
    // The neighbour is untouched by the rename.
    await expect(
      page.locator(`[data-conversation-id="${second}"]`),
    ).toContainText(`${PREFIX} other conversation`);
    expect(errors, "the rename flow stays console-clean").toEqual([]);
  });

  test("delete confirms, removes the row and selects the next most recent conversation", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    const first = await seedConversation(qa1Id, "delete me", ahead(FUTURE_MINUTES));
    const second = await seedConversation(
      qa1Id,
      "the survivor",
      ahead(FUTURE_MINUTES - 1),
    );

    await page.goto(`/assistant?c=${first}`);
    await waitForAssistantTree(page);

    await page.locator('[data-conversation-verb="delete"]').click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Delete this conversation?" }),
    ).toBeVisible();
    await expect(dialog).toContainText(`${PREFIX} delete me`);
    await page.screenshot({
      path: "screenshots/c4-delete-confirm.png",
      fullPage: true,
    });

    await dialog.locator("[data-conversation-delete-confirm]").click();

    // The selection moves to the next most recent conversation, honestly: the
    // URL and `aria-current` agree, and the deleted row is gone from the list.
    await expect(page).toHaveURL(new RegExp(`c=${second}`));
    await expect(page.locator(`[data-conversation-id="${first}"]`)).toHaveCount(0);
    await expect(
      page.locator(`[data-conversation-id="${second}"]`),
    ).toHaveAttribute("aria-current", "true");
    await expect(page.locator("[data-assistant-notice]")).toHaveText(
      "Conversation deleted.",
    );
    // Closing the confirmation returns focus to the control that opened it.
    await expect(page.locator('[data-conversation-verb="delete"]')).toBeFocused();

    const gone = await service.from("conversations").select("id").eq("id", first);
    expect(gone.error).toBeNull();
    expect(gone.data ?? []).toHaveLength(0);

    await page.reload();
    await waitForAssistantTree(page);
    await expect(page).toHaveURL(new RegExp(`c=${second}`));
    await expect(page.locator(`[data-conversation-id="${first}"]`)).toHaveCount(0);
    await expect(
      page.locator(`[data-conversation-id="${second}"]`),
    ).toHaveAttribute("aria-current", "true");
    expect(errors, "the delete flow stays console-clean").toEqual([]);
  });

  test("a delete for a row already gone surfaces the action's copy and never switches silently", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    const vanished = await seedConversation(
      qa1Id,
      "vanishing row",
      ahead(FUTURE_MINUTES),
    );
    const survivor = await seedConversation(
      qa1Id,
      "still here",
      ahead(FUTURE_MINUTES - 1),
    );

    await page.goto(`/assistant?c=${vanished}`);
    await waitForAssistantTree(page);

    // The row disappears behind the UI's back (another tab, another flow);
    // the service-role delete is exactly what the action will then meet.
    const removed = await service
      .from("conversations")
      .delete()
      .eq("id", vanished)
      .select("id");
    expect(removed.error).toBeNull();
    const index = createdConversationIds.indexOf(vanished);
    if (index !== -1) createdConversationIds.splice(index, 1);

    await page.locator('[data-conversation-verb="delete"]').click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("[data-conversation-delete-confirm]").click();

    // The action's own copy, inside the dialog, where the caller is looking.
    await expect(dialog.locator("[data-assistant-delete-error]")).toHaveText(
      "That conversation no longer exists.",
    );
    // No silent switch: the URL still names the conversation the caller asked
    // about, the survivor is never marked selected, and no success is claimed.
    await expect(page).toHaveURL(new RegExp(`c=${vanished}`));
    await expect(
      page.locator(`[data-conversation-id="${survivor}"]`),
    ).not.toHaveAttribute("aria-current", "true");
    await expect(page.locator("[data-assistant-notice]")).toHaveCount(0);

    // Closing leaves the honest unavailable state — the server read is the
    // authority, not a fabricated success — with no composer to send from.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await waitForAssistantTree(page);
    await expect(
      page.locator('[data-assistant-empty="unavailable"]'),
    ).toBeVisible();
    await expect(
      page.locator(`[data-conversation-id="${vanished}"]`),
    ).toHaveCount(0);
    await expect(page.locator("[data-assistant-composer]")).toHaveCount(0);
    expect(errors, "the refused delete stays console-clean").toEqual([]);
  });

  test("New conversation focuses the composer only once the selection commits", async ({
    page,
  }) => {
    test.slow();
    const errors = trackConsoleErrors(page);
    const existing = await seedConversation(qa1Id, "focus origin", ahead(-5));

    await page.goto(`/assistant?c=${existing}`);
    await waitForAssistantTree(page);
    await expect(page.locator("[data-conversation-title]")).toHaveText(
      `${PREFIX} focus origin`,
    );

    /* Hold the create navigation open: the window in which the C4 defect
       focused the previous conversation's composer before the new selection
       had committed. */
    const navigation = await holdAssistantNavigation(page, existing);
    try {
      await page.locator('[data-assistant-new="sidebar"]').click();

      // The action resolved (the real row is in the sidebar) but its
      // navigation is held: the selection has not committed yet.
      const createdRow = page.locator("[data-conversation-id]").first();
      await expect(createdRow).toContainText("New conversation");
      const createdId = await createdRow.getAttribute("data-conversation-id");
      expect(createdId, "the created row carries no id").not.toBeNull();
      if (createdId === null) throw new Error("create never produced an id");
      createdConversationIds.push(createdId);

      await navigation.engaged;
      await page.waitForTimeout(400);
      await expect(page.locator("[data-assistant-composer]")).toBeVisible();
      await expect(page.locator("[data-conversation-title]")).toHaveText(
        `${PREFIX} focus origin`,
      );
      await expect(page.locator("[data-assistant-input]")).not.toBeFocused();

      navigation.release();

      // The held navigation was the create's own target, and the commit lands
      // only now — with the caret arriving with it.
      const held = navigation.heldUrl();
      expect(held, "the create navigation never reached the router").not.toBeNull();
      expect(
        new URL(held!, "http://localhost:3000").searchParams.get("c"),
        "the held navigation must name the created conversation",
      ).toBe(createdId);
      await expect(page.locator("[data-conversation-title]")).toHaveText(
        "New conversation",
      );
      await expect(page.locator("[data-assistant-input]")).toBeFocused();

      /* The typed send targets the created conversation — the exact harm the
         deferred C4 finding described (a fast paste+Enter writing into the
         conversation the caller just left). */
      const turnStub = await stubAssistantTurn(page, {
        chunks: [
          frameToSse({
            type: "start",
            conversationId: createdId,
            configured: true,
          }),
          frameToSse({ type: "done", status: "complete", messageId: null }),
        ],
      });
      try {
        await page.locator("[data-assistant-input]").fill(`${PREFIX} fast write`);
        await page.locator("[data-assistant-input]").press("Enter");
        await expect.poll(() => turnStub.requests().length).toBe(1);
        expect(turnStub.requests()[0]).toEqual({
          conversationId: createdId,
          content: `${PREFIX} fast write`,
        });
      } finally {
        await turnStub.dispose();
      }
      expect(errors, "the create-focus flow stays console-clean").toEqual([]);
    } finally {
      navigation.release();
      await navigation.dispose();
    }
  });

  test("a settle during a held create navigation never steals the new selection", async ({
    page,
  }) => {
    test.slow();
    const errors = trackConsoleErrors(page);
    const origin = await seedConversation(qa1Id, "steal origin", ahead(-5));
    const announcedId = "11111111-1111-1111-1111-111111111111";

    /* The stream is held before any frame; when it settles it announces a
       conversation the send did not target (the stub's `start`), which is the
       handoff the settle guard exists for. */
    const stub = await stubAssistantTurn(page, {
      chunks: [
        frameToSse({
          type: "start",
          conversationId: announcedId,
          configured: true,
        }),
        frameToSse({ type: "done", status: "complete", messageId: null }),
      ],
      holdAfter: 0,
    });
    const navigation = await holdAssistantNavigation(page, origin);

    try {
      await page.goto(`/assistant?c=${origin}`);
      await waitForAssistantTree(page);
      await page.locator("[data-assistant-input]").fill(`${PREFIX} steal probe`);
      await page.locator("[data-assistant-input]").press("Enter");
      await expect.poll(() => stub.requestCount()).toBe(1);
      await expect(page.locator("[data-assistant-composer]")).toHaveAttribute(
        "aria-busy",
        "true",
      );

      // The caller asks for a new conversation while the turn is still
      // streaming; its navigation is held open so the settle lands before the
      // selection prop commits — the window the deferred C4 finding named.
      await page.locator('[data-assistant-new="sidebar"]').click();
      const createdRow = page.locator("[data-conversation-id]").first();
      await expect(createdRow).toContainText("New conversation");
      const createdId = await createdRow.getAttribute("data-conversation-id");
      expect(createdId, "the created row carries no id").not.toBeNull();
      if (createdId === null) throw new Error("create never produced an id");
      createdConversationIds.push(createdId);
      await navigation.engaged;

      stub.release();

      // The settle runs entirely inside the held window: the composer leaves
      // busy with the new selection still pending.
      await expect(page.locator("[data-assistant-composer]")).toHaveAttribute(
        "aria-busy",
        "false",
      );

      navigation.release();

      // The caller's choice stands: the URL commits the created conversation,
      // never the stream's announced one, and no selection was stolen.
      await expect(page).toHaveURL(new RegExp(`c=${createdId}`));
      await expect(page.locator("[data-conversation-title]")).toHaveText(
        "New conversation",
      );
      expect(page.url()).not.toContain(announcedId);
      await expect(
        page.locator(`[data-conversation-id="${createdId}"]`),
      ).toHaveAttribute("aria-current", "true");
      expect(errors, "the held create navigation stays console-clean").toEqual(
        [],
      );
    } finally {
      navigation.release();
      await navigation.dispose();
      await stub.dispose();
    }
  });

  /* -----------------------------------------------------------------------
     C5 (19.16) — the global launcher panel as a real conversation surface.
     The panel renders the shared architecture (`components/assistant/`): the
     same turn hook over the same route, the same composer, the same bubbles
     and source references. The live case drives the real endpoint; the
     stubbed case replaces only the HTTP boundary.
     ----------------------------------------------------------------------- */

  test("the launcher panel opens on a workspace route and keeps its dismissal behaviour", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    await page.goto("/tasks");

    const bar = page.getByRole("button", { name: /Ask UniPilot anything/i });
    // The guest-browsing probe's exact label (19.16 keeps it).
    await expect(bar).toHaveAttribute(
      "aria-label",
      "Ask UniPilot anything — opens search and the assistant",
    );
    await bar.click();

    const panel = page.locator("#unipilot-assistant-panel");
    await expect(panel).toBeVisible();
    // The starter links and the honest note survive the panel becoming a
    // conversation surface.
    await expect(
      panel.getByRole("link", { name: "Create a presentation" }),
    ).toBeVisible();
    await expect(panel).toContainText(
      "Answers stream in from the same assistant as the Assistant page.",
    );
    // The real, shared composer — not a link to one — and no invented
    // transcript before the first send.
    await expect(panel.locator("[data-assistant-composer]")).toBeVisible();
    await expect(panel.locator("[data-assistant-input]")).toBeVisible();
    await expect(panel.locator("[data-assistant-send]")).toBeDisabled();
    await expect(panel.locator("[data-assistant-panel-empty]")).toBeVisible();
    await expect(panel.locator("[data-assistant-open]")).toHaveCount(0);
    // Let the panel's entrance and the reveal ladder settle before the shot.
    await page.waitForTimeout(600);
    await page.screenshot({ path: "screenshots/c5-panel-open.png" });

    // Escape closes the panel and hands focus back to the bar body (the
    // committed behaviour, unchanged).
    await page.keyboard.press("Escape");
    await expect(panel).not.toBeVisible();
    await expect(bar).toBeFocused();

    // A pointer press outside the shell and the panel closes it too.
    await bar.click();
    await expect(panel).toBeVisible();
    await page.locator("h1").first().click();
    await expect(panel).not.toBeVisible();

    expect(errors, "the launcher panel stays console-clean").toEqual([]);
  });

  test("the idle panel keeps its composer reachable on short viewports", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    /* A settled stub, so the reachability proof never spends a real turn. */
    const stub = await stubAssistantTurn(page, {
      chunks: [
        frameToSse({
          type: "start",
          conversationId: "c5-short-viewport",
          configured: true,
        }),
        frameToSse({ type: "done", status: "complete", messageId: null }),
      ],
    });

    try {
      for (const [width, height] of [
        [320, 568],
        [375, 667],
        [1280, 640],
      ] as const) {
        await page.setViewportSize({ width, height });
        await page.goto("/tasks");
        await page
          .getByRole("button", { name: /Ask UniPilot anything/i })
          .click();
        const panel = page.locator("#unipilot-assistant-panel");
        await expect(panel).toBeVisible();

        // The idle region (six starters + the note) shrinks and scrolls on a
        // short viewport, but the composer and its Send control are the
        // panel's pinned bottom child. The panel is `overflow-hidden`, so a
        // clipped composer would have no wheel/touch path back: prove the
        // composer and Send are already inside the panel's visible box and
        // the viewport, with the panel itself unscrolled, before any
        // interaction.
        const composer = panel.locator("[data-assistant-composer]");
        await expect(composer).toBeVisible();
        const input = panel.locator("[data-assistant-input]");
        await expect(input).toBeVisible();
        const send = panel.locator("[data-assistant-send]");
        await expect(send).toBeVisible();
        await expect(send).toBeDisabled();

        const reachable = await page.evaluate(() => {
          const panelEl = document.querySelector("#unipilot-assistant-panel");
          const composerEl = panelEl?.querySelector("[data-assistant-composer]");
          const sendEl = panelEl?.querySelector("[data-assistant-send]");
          if (!panelEl || !composerEl || !sendEl) return null;
          const pr = panelEl.getBoundingClientRect();
          const inside = (rect: DOMRect) =>
            rect.top >= pr.top - 1 &&
            rect.bottom <= pr.bottom + 1 &&
            rect.bottom <= window.innerHeight + 1;
          return {
            panelScrollTop: panelEl.scrollTop,
            composerInside: inside(composerEl.getBoundingClientRect()),
            sendInside: inside(sendEl.getBoundingClientRect()),
          };
        });
        expect(reachable, "the panel's chat chrome is mounted").not.toBeNull();
        expect(
          reachable!.panelScrollTop,
          `${width}px: the overflow-hidden panel must not be programmatically scrolled`,
        ).toBe(0);
        expect(
          reachable!.composerInside,
          `${width}px: the composer sits inside the panel's visible box`,
        ).toBe(true);
        expect(
          reachable!.sendInside,
          `${width}px: Send sits inside the panel's visible box`,
        ).toBe(true);

        if (width === 375) {
          await page.waitForTimeout(600);
          await page.screenshot({
            path: "screenshots/c5-panel-short-viewport.png",
          });
        }

        await input.fill(`${PREFIX} short ${width}`);
        await expect(send).toBeEnabled();
        await send.click();
        await expect(
          panel.locator(
            '[data-message-role="user"][data-message-local] [data-message-content]',
          ),
        ).toHaveText(`${PREFIX} short ${width}`);

        // The launcher chrome stays inside the viewport at every width.
        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(
          scrollWidth,
          `${width}px must not scroll horizontally`,
        ).toBeLessThanOrEqual(clientWidth);
      }

      expect(stub.requestCount(), "every viewport's send reached the stub").toBe(3);
      expect(errors, "the short-viewport panel stays console-clean").toEqual([]);
    } finally {
      await stub.dispose();
    }
  });

  test("a live send from the panel streams the unconfigured copy and opens the conversation", async ({
    page,
  }) => {
    test.slow();
    const errors = trackConsoleErrors(page);
    const question = `${PREFIX} panel live question`;

    await page.goto("/tasks");
    await page.getByRole("button", { name: /Ask UniPilot anything/i }).click();
    const panel = page.locator("#unipilot-assistant-panel");
    await expect(panel).toBeVisible();

    await panel.locator("[data-assistant-input]").fill(question);
    await panel.locator("[data-assistant-send]").click();

    // The optimistic bubble carries the exact typed text, and the live entry
    // streams the route's verbatim 26.1 copy and settles `unconfigured` — the
    // same honesty rules as the page, from the same hook.
    await expect(
      panel.locator(
        '[data-message-role="user"][data-message-local] [data-message-content]',
      ),
    ).toHaveText(question);
    const assistant = panel.locator(
      '[data-message-role="assistant"][data-message-local]',
    );
    await expect(assistant).toHaveAttribute(
      "data-message-status",
      "unconfigured",
      { timeout: 20_000 },
    );
    await expect(assistant.locator("[data-message-content]")).toContainText(
      ASSISTANT_UNCONFIGURED_COPY,
    );
    await expect(assistant.locator("[data-assistant-sources]")).toHaveCount(0);
    // Let the panel's entrance and the reveal ladder settle before the shot.
    await page.waitForTimeout(600);
    await page.screenshot({ path: "screenshots/c5-panel-unconfigured.png" });

    // The `start` frame's conversation id is held in state and offered as the
    // full-conversation link; following it lands on the stored conversation.
    const open = panel.locator("[data-assistant-open]");
    await expect(open).toBeVisible({ timeout: 20_000 });
    await expect(open).toHaveAttribute("href", /^\/assistant\?c=[0-9a-f-]{36}$/i);
    const href = await open.getAttribute("href");
    const createdId = new URL(href!, "http://localhost:3000").searchParams.get(
      "c",
    );
    expect(createdId, "the panel's link names no conversation").not.toBeNull();
    if (createdId === null) throw new Error("the panel link never carried an id");
    createdConversationIds.push(createdId);

    await open.click();
    await expect(page).toHaveURL(new RegExp(`c=${createdId}`));
    await waitForAssistantTree(page);
    await expect(
      page.locator('[data-message-role="user"] [data-message-content]'),
    ).toHaveText(question);
    await expect(page.locator('[data-message-role="assistant"]')).toContainText(
      ASSISTANT_UNCONFIGURED_COPY,
    );
    await expect(page.locator("[data-message-local]")).toHaveCount(0);
    expect(errors, "the panel's live turn stays console-clean").toEqual([]);
  });

  test("a stubbed panel turn renders incrementally with sources and the follow-up continues it", async ({
    page,
  }) => {
    test.slow();
    const errors = trackConsoleErrors(page);
    const conversation = await seedConversation(
      qa1Id,
      "panel stubbed stream",
      ahead(FUTURE_MINUTES),
    );
    const firstQuestion = `${PREFIX} panel stubbed question`;
    const followUp = `${PREFIX} panel follow-up`;

    /* The C3 stream shape: a start, a delta held mid-stream, a delta frame
       split across two writes, a malformed block, the sources frame and the
       terminal done. The stub records each POST body, which is how the
       follow-up's conversation id is proven. */
    const chunks = [
      frameToSse({
        type: "start",
        conversationId: conversation,
        configured: true,
      }),
      frameToSse({ type: "delta", text: "Photosynthesis " }),
      'data: {"type":"delta","text":"converts light',
      ' into sugar"}\n\n',
      "data: {not json\n\n",
      frameToSse({ type: "sources", sources: [SOURCE_A, SOURCE_B] }),
      frameToSse({
        type: "done",
        status: "complete",
        messageId: "stub-c5-message",
      }),
    ];
    /* C6: a small gapMs so the split frame really arrives in separate reads
       (the wire carry path), not coalesced into one chunk. */
    const stub = await stubAssistantTurn(page, { chunks, holdAfter: 2, gapMs: 25 });

    try {
      await page.goto("/tasks");
      await page.getByRole("button", { name: /Ask UniPilot anything/i }).click();
      const panel = page.locator("#unipilot-assistant-panel");
      await expect(panel).toBeVisible();

      await panel.locator("[data-assistant-input]").fill(firstQuestion);
      await panel.locator("[data-assistant-send]").click();

      const bubble = panel.locator(
        '[data-message-role="assistant"][data-message-local]',
      );
      // Mid-stream: the first delta is on screen, the rest is still held.
      await expect(bubble).toHaveAttribute("data-message-status", "streaming");
      await expect(bubble.locator("[data-message-content]")).toHaveText(
        "Photosynthesis ",
      );
      await expect(bubble.locator("[data-message-streaming]")).toBeVisible();
      await expect(panel.locator("[data-message-list] > li").last()).toHaveCSS(
        "opacity",
        "1",
      );
      await expect(panel.locator("[data-assistant-composer]")).toHaveAttribute(
        "aria-busy",
        "true",
      );
      // The stream is held, so a short pause only lets the reveal settle.
      await page.waitForTimeout(600);
      await page.screenshot({ path: "screenshots/c5-panel-streaming.png" });

      stub.release();

      // The rest reassembles: the split frame, the dropped malformed block,
      // the sources and the terminal status — the same renderer as the page.
      await expect(bubble).toHaveAttribute("data-message-status", "complete", {
        timeout: 20_000,
      });
      await expect(bubble.locator("[data-message-content]")).toHaveText(
        "Photosynthesis converts light into sugar",
      );
      const sources = bubble.locator("[data-assistant-sources]");
      await expect(sources.locator("[data-assistant-source]")).toHaveCount(2);
      await expect(sources).toContainText("Syllabus.pdf");
      await page.waitForTimeout(600);
      await page.screenshot({ path: "screenshots/c5-panel-sources.png" });

      // The link names the conversation the `start` frame announced.
      await expect(panel.locator("[data-assistant-open]")).toHaveAttribute(
        "href",
        `/assistant?c=${conversation}`,
      );

      // Continuity: the panel held that id in component state, so the
      // follow-up POST targets the same conversation instead of starting a
      // new one. (The panel shows the latest exchange; the full conversation
      // is what the link opens.)
      await expect(panel.locator("[data-assistant-composer]")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await panel.locator("[data-assistant-input]").fill(followUp);
      await panel.locator("[data-assistant-send]").click();
      await expect.poll(() => stub.requests().length).toBe(2);
      expect(stub.requests()[0]).toEqual({
        conversationId: null,
        content: firstQuestion,
      });
      expect(stub.requests()[1]).toEqual({
        conversationId: conversation,
        content: followUp,
      });
      await expect(
        panel.locator(
          '[data-message-role="user"][data-message-local] [data-message-content]',
        ),
      ).toHaveText(followUp);

      expect(errors, "the stubbed panel stream stays console-clean").toEqual([]);
    } finally {
      await stub.dispose();
    }
  });

  test("a guest in the workspace shell gets the sign-in prompt and no panel", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    const errors = trackConsoleErrors(page);

    await page.goto("/tasks");
    await expect(page.locator('[data-signed-in="false"]')).toBeAttached();
    await page.getByRole("button", { name: /Ask UniPilot anything/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("Sign in to ask the assistant about your workspace."),
    ).toBeVisible();
    // No panel, no composer, no send path for a guest.
    await expect(page.locator("#unipilot-assistant-panel")).toHaveCount(0);
    await expect(page.locator("[data-assistant-composer]")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Continue browsing" }).click();
    await expect(dialog).not.toBeVisible();

    expect(errors, "the guest launcher stays console-clean").toEqual([]);
    await context.close();
  });

  test("the marketing panel opens for a guest without a session read, and a 401 surfaces the route's copy", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    const errors = trackConsoleErrors(page);
    const dataReads: string[] = [];
    page.on("request", (request) => {
      if (/\/rest\/v1\//.test(request.url())) dataReads.push(request.url());
    });

    await page.goto("/pricing");
    // Marketing mounts no sign-in provider: no session verdict is read, and
    // the launcher reads no session of its own on any route.
    await expect(page.locator("[data-signed-in]")).toHaveCount(0);
    await page.getByRole("button", { name: /Ask UniPilot anything/i }).click();
    const panel = page.locator("#unipilot-assistant-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator("[data-assistant-composer]")).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: "screenshots/c5-panel-marketing.png" });

    const question = `${PREFIX} marketing guest question`;
    await panel.locator("[data-assistant-input]").fill(question);
    await panel.locator("[data-assistant-send]").click();

    // The route's own 401 copy is the failure text — never a fabricated
    // reply, never an invented answer, and no conversation id to open.
    const bubble = panel.locator(
      '[data-message-role="assistant"][data-message-local]',
    );
    await expect(bubble).toHaveAttribute("data-message-status", "failed");
    await expect(bubble.locator("[data-assistant-failure]")).toHaveText(
      "Sign in to use the assistant.",
    );
    await expect(bubble.locator("[data-message-content]")).toHaveCount(0);
    await expect(
      panel.locator(
        '[data-message-role="user"][data-message-local] [data-message-content]',
      ),
    ).toHaveText(question);
    await expect(panel.locator("[data-assistant-open]")).toHaveCount(0);
    await page.waitForTimeout(600);
    await page.screenshot({ path: "screenshots/c5-panel-marketing-401.png" });

    expect(dataReads, "the marketing launcher must not read user data").toEqual(
      [],
    );
    // The deliberate unauthenticated POST is logged by Chromium at the
    // network layer ("Failed to load resource … 401"); the app itself must
    // have added no console error of its own. The copy above proves the 401
    // was handled honestly, not swallowed.
    const unexpected = errors.filter(
      (message) => !/Failed to load resource.*401/.test(message),
    );
    expect(unexpected, "the marketing panel stays console-clean").toEqual([]);
    await context.close();
  });

  test("the launcher panel keeps its controls reachable across widths and in landscape viewports", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    /* A settled stub, so the reachability proof never spends a real turn. */
    const stub = await stubAssistantTurn(page, {
      chunks: [
        frameToSse({
          type: "start",
          conversationId: "c6-landscape",
          configured: true,
        }),
        frameToSse({ type: "done", status: "complete", messageId: null }),
      ],
    });

    try {
      for (const [width, height] of [
        [667, 375],
        [1024, 500],
      ] as const) {
        await page.setViewportSize({ width, height });
        await page.goto("/tasks");
        await page
          .getByRole("button", { name: /Ask UniPilot anything/i })
          .click();
        const panel = page.locator("#unipilot-assistant-panel");
        await expect(panel).toBeVisible();
        const composer = panel.locator("[data-assistant-composer]");
        const input = panel.locator("[data-assistant-input]");
        const send = panel.locator("[data-assistant-send]");

        // C6: below the height threshold the panel itself is the scroll
        // container. Scroll it to the bottom and prove the composer wrapper
        // (with every primary control in it) is inside the panel's visible box
        // and the viewport — no `overflow-hidden` dead end.
        await panel.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        await expect(composer).toBeVisible();
        await expect(input).toBeVisible();
        await expect(send).toBeVisible();

        const reachable = await page.evaluate(() => {
          const panelEl = document.querySelector("#unipilot-assistant-panel");
          const composerEl = panelEl?.querySelector("[data-assistant-composer]");
          const sendEl = panelEl?.querySelector("[data-assistant-send]");
          if (!panelEl || !composerEl || !sendEl) return null;
          const pr = panelEl.getBoundingClientRect();
          const inside = (rect: DOMRect) =>
            rect.top >= pr.top - 1 &&
            rect.bottom <= pr.bottom + 1 &&
            rect.bottom <= window.innerHeight + 1;
          return {
            panelScrollable: panelEl.scrollHeight > panelEl.clientHeight,
            panelScrollTop: panelEl.scrollTop,
            composerInside: inside(composerEl.getBoundingClientRect()),
            sendInside: inside(sendEl.getBoundingClientRect()),
          };
        });
        expect(reachable, "the panel's chat chrome is mounted").not.toBeNull();
        expect(
          reachable!.panelScrollable,
          `${width}×${height}: the panel must offer a scroll path below the height threshold`,
        ).toBe(true);
        expect(
          reachable!.panelScrollTop,
          `${width}×${height}: the panel scrolled to its reachable bottom`,
        ).toBeGreaterThan(0);
        expect(
          reachable!.composerInside,
          `${width}×${height}: the composer sits inside the panel's visible box`,
        ).toBe(true);
        expect(
          reachable!.sendInside,
          `${width}×${height}: Send sits inside the panel's visible box`,
        ).toBe(true);

        if (width === 667) {
          await page.waitForTimeout(600);
          await page.screenshot({ path: "screenshots/c6-panel-landscape.png" });
        }

        // The reachable composer still sends, and the exchange that grows
        // above it keeps the same reachable path.
        await input.fill(`${PREFIX} landscape ${width}`);
        await expect(send).toBeEnabled();
        await send.click();
        await expect(
          panel.locator(
            '[data-message-role="user"][data-message-local] [data-message-content]',
          ),
        ).toHaveText(`${PREFIX} landscape ${width}`);
        await panel.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        await expect(send).toBeVisible();
        await expect(send).toBeInViewport();

        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(
          scrollWidth,
          `${width}px must not scroll horizontally`,
        ).toBeLessThanOrEqual(clientWidth);
      }

      // The committed pinned layout, above the height threshold: at every task
      // width the composer and Send sit inside the panel's visible box and the
      // viewport without any scrolling, and the panel never widens the page.
      for (const [width, height] of [
        [320, 568],
        [375, 667],
        [768, 720],
        [1024, 768],
        [1280, 900],
      ] as const) {
        await page.setViewportSize({ width, height });
        await page.goto("/tasks");
        await page
          .getByRole("button", { name: /Ask UniPilot anything/i })
          .click();
        const panel = page.locator("#unipilot-assistant-panel");
        await expect(panel).toBeVisible();
        await expect(panel.locator("[data-assistant-composer]")).toBeVisible();
        await expect(panel.locator("[data-assistant-input]")).toBeVisible();
        await expect(panel.locator("[data-assistant-send]")).toBeVisible();

        const pinned = await page.evaluate(() => {
          const panelEl = document.querySelector("#unipilot-assistant-panel");
          const composerEl = panelEl?.querySelector("[data-assistant-composer]");
          const sendEl = panelEl?.querySelector("[data-assistant-send]");
          if (!panelEl || !composerEl || !sendEl) return null;
          const pr = panelEl.getBoundingClientRect();
          const inside = (rect: DOMRect) =>
            rect.top >= pr.top - 1 &&
            rect.bottom <= pr.bottom + 1 &&
            rect.bottom <= window.innerHeight + 1;
          return {
            panelScrollTop: panelEl.scrollTop,
            composerInside: inside(composerEl.getBoundingClientRect()),
            sendInside: inside(sendEl.getBoundingClientRect()),
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
          };
        });
        expect(pinned, "the panel's chat chrome is mounted").not.toBeNull();
        expect(
          pinned!.panelScrollTop,
          `${width}×${height}: the pinned panel is not scrolled`,
        ).toBe(0);
        expect(
          pinned!.composerInside,
          `${width}×${height}: the composer sits inside the panel's visible box`,
        ).toBe(true);
        expect(
          pinned!.sendInside,
          `${width}×${height}: Send sits inside the panel's visible box`,
        ).toBe(true);
        expect(
          pinned!.scrollWidth,
          `${width}px must not scroll horizontally`,
        ).toBeLessThanOrEqual(pinned!.clientWidth);

        await page.keyboard.press("Escape");
        await expect(panel).not.toBeVisible();
      }

      expect(stub.requestCount(), "both landscape sends reached the stub").toBe(2);
      expect(errors, "the landscape panel stays console-clean").toEqual([]);
    } finally {
      await stub.dispose();
    }
  });

  test("the shell's keyboard surface and live regions are labelled and reachable", async ({
    page,
  }) => {
    test.slow();
    const errors = trackConsoleErrors(page);
    const conversation = await seedConversation(
      qa1Id,
      "keyboard pass",
      ahead(FUTURE_MINUTES),
    );
    await seedMessage(conversation, "user", `${PREFIX} keyboard question`);

    await page.goto(`/assistant?c=${conversation}`);
    await waitForAssistantTree(page);

    // The composer: a real label, and a described hint announced politely.
    const composer = page.locator("[data-assistant-composer]");
    const input = page.locator("[data-assistant-input]");
    await expect(page.getByLabel("Message the assistant")).toHaveCount(1);
    const describedBy = await input.getAttribute("aria-describedby");
    expect(describedBy, "the composer hint must be described").toBeTruthy();
    const hint = page.locator(`#${describedBy}`);
    await expect(hint).toHaveAttribute("role", "status");
    await expect(hint).toContainText("Enter sends");
    await expect(composer).toHaveAttribute("aria-busy", "false");

    // The action chips: a labelled group of real buttons, keyboard-operable,
    // and a chip never sends on its own.
    const chips = page.getByRole("group", { name: "Suggested prompts" });
    await expect(chips).toBeVisible();
    const chip = chips.locator("[data-assistant-chip]").first();
    await expect(chip).toHaveAttribute("type", "button");
    const chipText = (await chip.textContent())?.trim() ?? "";
    await chip.focus();
    await page.keyboard.press("Enter");
    await expect(input).toHaveValue(chipText);
    await expect(input).toBeFocused();
    await expect(page.locator("[data-message-local]")).toHaveCount(0);

    // The sidebar rows are real links, and the selected row says so.
    const row = page.locator(`[data-conversation-id="${conversation}"]`);
    await expect(row).toHaveRole("link");
    await expect(row).toHaveAttribute("aria-current", "true");
    await expect(row).toHaveAccessibleName(new RegExp("keyboard pass"));

    // Rename: a labelled form, autofocused, returning focus on cancel.
    await page.locator('[data-conversation-verb="rename"]').click();
    const renameInput = page.locator("[data-conversation-rename-input]");
    await expect(renameInput).toBeFocused();
    await expect(renameInput).toHaveAttribute("aria-label", "Conversation name");
    await page.locator('[data-conversation-rename-cancel]').click();
    await expect(page.locator('[data-conversation-verb="rename"]')).toBeFocused();

    // Delete: the shared Modal is a named dialog, focus starts inside it, no
    // control on the inert page behind it can be reached by Tab, and closing
    // hands focus back to the control that opened it. (Chromium parks focus
    // on <body> for one Tab stop between the dialog's first and last control —
    // its documented `dialog` behaviour; the inert page is never reachable.)
    await page.locator('[data-conversation-verb="delete"]').click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName("Delete this conversation?");
    const startsInside = await page.evaluate(() => {
      const dialogEl = document.querySelector("dialog[open]");
      return dialogEl !== null && dialogEl.contains(document.activeElement);
    });
    expect(startsInside, "focus starts inside the dialog").toBe(true);

    const visited = new Set<string>();
    for (let press = 0; press < 6; press += 1) {
      await page.keyboard.press("Tab");
      const focusState = await page.evaluate(() => {
        const dialogEl = document.querySelector("dialog[open]");
        const active = document.activeElement as HTMLElement | null;
        const inside = dialogEl !== null && active !== null && dialogEl.contains(active);
        return {
          dialogPresent: dialogEl !== null,
          inside,
          /* Any focusable element that is neither the dialog's content nor the
             document body (Chromium's between-wraps stop). */
          outsideInteractive:
            active !== null &&
            active !== document.body &&
            !(dialogEl?.contains(active) ?? false),
          activeLabel:
            active?.getAttribute("aria-label") ??
            (active?.textContent ?? "").trim().slice(0, 40),
        };
      });
      expect(focusState.dialogPresent, `Tab ${press + 1}: the dialog closes`).toBe(
        true,
      );
      expect(
        focusState.outsideInteractive,
        `Tab ${press + 1} reached "${focusState.activeLabel}" outside the dialog`,
      ).toBe(false);
      if (focusState.inside) visited.add(focusState.activeLabel);
    }
    expect(visited, "Tab visits the dialog's own controls").toContain("Cancel");
    expect(visited, "Tab visits the dialog's own controls").toContain(
      "Delete conversation",
    );

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator('[data-conversation-verb="delete"]')).toBeFocused();

    // The message list announces busy only while a turn is streaming; this
    // stored conversation is at rest.
    await expect(page.locator("[data-message-list]")).not.toHaveAttribute(
      "aria-busy",
      "true",
    );

    expect(errors, "the keyboard pass stays console-clean").toEqual([]);
  });

  test("the launcher's bar, bubble and panel hand focus over on the keyboard", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    await page.goto("/tasks");

    const bar = page.getByRole("button", { name: /Ask UniPilot anything/i });
    await expect(bar).toHaveAttribute("aria-expanded", "false");
    await expect(bar).toHaveAttribute("aria-controls", "unipilot-assistant-panel");
    await bar.focus();
    await page.keyboard.press("Enter");

    const panel = page.locator("#unipilot-assistant-panel");
    await expect(panel).toBeVisible();
    await expect(bar).toHaveAttribute("aria-expanded", "true");

    // Minimize docks the launcher into the bubble and hands it focus; the
    // bubble expands back and hands focus to the bar.
    await page.getByRole("button", { name: "Minimize UniPilot search" }).click();
    const bubble = page.getByRole("button", { name: "Expand UniPilot search" });
    await expect(bubble).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(bar).toBeFocused();
    await expect(bar).toHaveAttribute("aria-expanded", "false");

    // Escape closes the open panel and returns focus to the bar body.
    await page.keyboard.press("Enter");
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).not.toBeVisible();
    await expect(bar).toBeFocused();

    expect(errors, "the launcher keyboard pass stays console-clean").toEqual([]);
  });

  test("reduced motion: both surfaces render content immediately, nothing is gated", async ({
    browser,
  }) => {
    /* A real session (the QA fixture's storage state), reduced motion on. */
    const context = await browser.newContext({
      reducedMotion: "reduce",
      storageState:
        process.env.QA_STORAGE_STATE ?? ".playwright/qa-session.json",
    });
    const page = await context.newPage();
    const errors = trackConsoleErrors(page);

    try {
      const conversation = await seedConversation(
        qa1Id,
        "reduced motion",
        ahead(FUTURE_MINUTES),
      );
      await seedMessage(conversation, "user", `${PREFIX} reduced question`);
      await seedMessage(conversation, "assistant", `${PREFIX} reduced answer`);

      await page.goto(`/assistant?c=${conversation}`);
      await waitForAssistantTree(page);
      // Zero-duration reveals: the rows and the composer are visible straight
      // away, never stuck at the hidden variant.
      await expect(page.locator("[data-message-list] > li").first()).toHaveCSS(
        "opacity",
        "1",
      );
      await expect(page.locator("[data-message-list]")).toContainText(
        `${PREFIX} reduced answer`,
      );
      await expect(page.locator("[data-assistant-composer]")).toBeVisible();
      await expect(page.locator("[data-conversation-title]")).toBeVisible();
      await page.screenshot({
        path: "screenshots/c6-reduced-motion.png",
        fullPage: true,
      });

      // The launcher panel opens instantly with its composer and starters
      // reachable.
      await page.goto("/tasks");
      await page.getByRole("button", { name: /Ask UniPilot anything/i }).click();
      const panel = page.locator("#unipilot-assistant-panel");
      await expect(panel).toBeVisible();
      await expect(panel.locator("[data-assistant-composer]")).toBeVisible();
      await expect(
        panel.getByRole("link", { name: "Create a presentation" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(panel).not.toBeVisible();
      await expect(
        page.getByRole("button", { name: /Ask UniPilot anything/i }),
      ).toBeFocused();

      expect(errors, "the reduced-motion pass stays console-clean").toEqual([]);
    } finally {
      await context.close();
    }
  });

  /* -------------------------------------------------------------------------
     T27-C — the confirmation UI (27.6/27.7/27.12)
     ------------------------------------------------------------------------- */

  test("a stored proposal confirms into a real task and reports the created outcome", async ({
    page,
  }) => {
    test.slow();
    const errors = trackConsoleErrors(page);
    const conversation = await seedConversation(
      qa1Id,
      "action confirm",
      ahead(FUTURE_MINUTES),
    );
    const title = `${PREFIX_C} read chapter 4`;
    const content = fence({
      type: "task.create",
      payload: {
        title,
        description: "Related notes: pages 20-34",
        dueDate: "2026-09-30",
        priority: "high",
      },
    });
    const messageId = await seedFencedAssistantMessage(conversation, content);
    const items = await registerFencedFor(conversation, messageId, content);
    expect(items).toHaveLength(1);
    const actionId = items[0].id;

    await page.goto(`/assistant?c=${conversation}`);
    await waitForAssistantTree(page);

    // The card renders inside the assistant bubble that proposed it, with the
    // honest proposal copy ("Create …", never "Created …").
    const card = page.locator(`[data-assistant-action="${actionId}"]`);
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute(
      "data-assistant-action-status",
      "proposed",
    );
    await expect(card.locator("[data-assistant-action-label]")).toHaveText(
      "Task",
    );
    await expect(
      card.locator("[data-assistant-action-summary]"),
    ).toContainText(`Create task: ${title}`);
    await expect(
      page.locator(`[data-message-id="${messageId}"] [data-assistant-action]`),
    ).toHaveCount(1);
    await page.waitForTimeout(600);
    await page.screenshot({
      path: "screenshots/t27c-proposed.png",
      fullPage: true,
    });

    // Confirm: the real Server Action runs and the card reports the created row.
    await card.locator("[data-assistant-action-confirm]").click();
    await expect(card).toHaveAttribute(
      "data-assistant-action-status",
      "succeeded",
      { timeout: 20_000 },
    );
    await expect(card.locator("[data-assistant-action-created]")).toContainText(
      title,
    );
    await expect(card.locator("[data-assistant-action-link]")).toHaveAttribute(
      "href",
      "/tasks",
    );

    // The log settled with the real task's facts and the task really exists.
    const log = await storedAction(actionId);
    expect(log!.status).toBe("succeeded");
    expect(log!.error).toBeNull();
    expect(log!.settled_at).not.toBeNull();
    const result = log!.result as { kind: string; id: string; label: string };
    expect(result.kind).toBe("task");
    expect(result.label).toBe(title);
    createdTaskIds.push(result.id);

    await page.goto("/tasks");
    const taskCard = page.locator(`[data-task-id="${result.id}"]`);
    await expect(taskCard).toBeVisible();
    await expect(taskCard).toContainText(title);

    // 27.13: a second confirm returns the stored result; exactly one row.
    const again = await confirmAssistantAction(qa1Id, actionId, { client: qa1 });
    expect(again.error).toBeNull();
    expect(again.action?.status).toBe("succeeded");
    expect(again.action?.result).toEqual(log!.result);
    expect(await taskCount(title)).toBe(1);

    // A reload reads the settled card back from the log.
    await page.goto(`/assistant?c=${conversation}`);
    await waitForAssistantTree(page);
    const settled = page.locator(`[data-assistant-action="${actionId}"]`);
    await expect(settled).toHaveAttribute(
      "data-assistant-action-status",
      "succeeded",
    );
    await expect(
      settled.locator("[data-assistant-action-created]"),
    ).toContainText(title);
    await page.waitForTimeout(600);
    await page.screenshot({
      path: "screenshots/t27c-created.png",
      fullPage: true,
    });

    expect(errors, "the confirmation flow stays console-clean").toEqual([]);
  });

  test("a stored proposal rejects without writing anything", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    const conversation = await seedConversation(
      qa1Id,
      "action reject",
      ahead(FUTURE_MINUTES),
    );
    const title = `${PREFIX_C} rejected task`;
    const content = fence({ type: "task.create", payload: { title } });
    const messageId = await seedFencedAssistantMessage(conversation, content);
    const items = await registerFencedFor(conversation, messageId, content);
    const actionId = items[0].id;

    await page.goto(`/assistant?c=${conversation}`);
    await waitForAssistantTree(page);
    const card = page.locator(`[data-assistant-action="${actionId}"]`);
    await expect(card).toHaveAttribute(
      "data-assistant-action-status",
      "proposed",
    );
    await card.locator("[data-assistant-action-reject]").click();

    await expect(card).toHaveAttribute(
      "data-assistant-action-status",
      "rejected",
      { timeout: 20_000 },
    );
    await expect(card.locator("[data-assistant-action-rejected]")).toHaveText(
      ASSISTANT_ACTION_COPY.REJECTED,
    );
    await expect(card.locator("[data-assistant-action-confirm]")).toHaveCount(0);

    const log = await storedAction(actionId);
    expect(log).toMatchObject({ status: "rejected", result: null, error: null });
    expect(log!.settled_at).not.toBeNull();
    expect(await taskCount(title)).toBe(0);

    await page.waitForTimeout(600);
    await page.screenshot({
      path: "screenshots/t27c-rejected.png",
      fullPage: true,
    });
    expect(errors, "the rejection flow stays console-clean").toEqual([]);
  });

  test("a linked foreign document fails with sanitized copy and writes nothing", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    const foreignDocId = randomUUID();
    const foreign = await service.from("documents").insert({
      id: foreignDocId,
      user_id: qa2Id,
      name: `${PREFIX_C} foreign notes.pdf`,
      mime_type: "application/pdf",
      size_bytes: 1024,
      status: "uploaded",
    });
    expect(
      foreign.error,
      `seed foreign document: ${foreign.error?.message}`,
    ).toBeNull();
    createdDocumentIds.push(foreignDocId);

    const conversation = await seedConversation(
      qa1Id,
      "action foreign link",
      ahead(FUTURE_MINUTES),
    );
    const title = `${PREFIX_C} foreign-linked task`;
    const content = fence({
      type: "task.create",
      payload: { title, documentId: foreignDocId },
    });
    const messageId = await seedFencedAssistantMessage(conversation, content);
    const items = await registerFencedFor(conversation, messageId, content);
    const actionId = items[0].id;

    await page.goto(`/assistant?c=${conversation}`);
    await waitForAssistantTree(page);
    const card = page.locator(`[data-assistant-action="${actionId}"]`);
    await card.locator("[data-assistant-action-confirm]").click();

    await expect(card).toHaveAttribute(
      "data-assistant-action-status",
      "failed",
      { timeout: 20_000 },
    );
    await expect(card.locator("[data-assistant-action-error]")).toHaveText(
      ASSISTANT_ACTION_COPY.DOCUMENT_NOT_FOUND,
    );
    await expect(card.locator("[data-assistant-action-created]")).toHaveCount(0);

    const log = await storedAction(actionId);
    expect(log!.status).toBe("failed");
    expect(log!.error).toBe(ASSISTANT_ACTION_COPY.DOCUMENT_NOT_FOUND);
    expect(log!.result).toBeNull();
    expect(await taskCount(title)).toBe(0);

    await page.waitForTimeout(600);
    await page.screenshot({
      path: "screenshots/t27c-failed.png",
      fullPage: true,
    });
    expect(errors, "the honest failure stays console-clean").toEqual([]);
  });

  test("a presentation proposal fails honestly as not available", async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    const conversation = await seedConversation(
      qa1Id,
      "action presentation",
      ahead(FUTURE_MINUTES),
    );
    const title = `${PREFIX_C} deck idea`;
    const prompt = `${PREFIX_C} explain photosynthesis for a first-year class`;
    const content = fence({
      type: "presentation.create",
      payload: { title, prompt, slideCount: 8 },
    });
    const messageId = await seedFencedAssistantMessage(conversation, content);
    const items = await registerFencedFor(conversation, messageId, content);
    const actionId = items[0].id;

    await page.goto(`/assistant?c=${conversation}`);
    await waitForAssistantTree(page);
    const card = page.locator(`[data-assistant-action="${actionId}"]`);
    await expect(card.locator("[data-assistant-action-label]")).toHaveText(
      "Presentation",
    );
    await card.locator("[data-assistant-action-confirm]").click();

    await expect(card).toHaveAttribute(
      "data-assistant-action-status",
      "failed",
      { timeout: 20_000 },
    );
    await expect(card.locator("[data-assistant-action-error]")).toHaveText(
      ASSISTANT_ACTION_COPY.PRESENTATION_NOT_AVAILABLE,
    );

    const log = await storedAction(actionId);
    expect(log!.status).toBe("failed");
    expect(log!.error).toBe(ASSISTANT_ACTION_COPY.PRESENTATION_NOT_AVAILABLE);

    // T27-D wires the real path; nothing was generated and no deck exists.
    const decks = await service
      .from("presentations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", qa1Id)
      .eq("prompt", prompt);
    expect(decks.error).toBeNull();
    expect(decks.count).toBe(0);
    expect(errors, "the not-available failure stays console-clean").toEqual([]);
  });

  test("a stubbed fenced turn registers through the real action and confirms from the panel", async ({
    page,
  }) => {
    test.slow();
    const errors = trackConsoleErrors(page);
    const conversation = await seedConversation(
      qa1Id,
      "stubbed action",
      ahead(FUTURE_MINUTES),
    );
    const title = `${PREFIX_C} stubbed task`;
    const content = `Here is what I can do.\n\n${fence({
      type: "task.create",
      payload: { title, dueDate: "2026-10-02" },
    })}`;
    /* The stub persists nothing server-side, so the client registration is
       the only thing that turns this fenced delta into a real proposal; its
       `done` carries no message id, so the key is the live one. */
    const stub = await stubAssistantTurn(page, {
      chunks: [
        frameToSse({
          type: "start",
          conversationId: conversation,
          configured: true,
        }),
        frameToSse({ type: "delta", text: content }),
        frameToSse({ type: "done", status: "complete", messageId: null }),
      ],
    });

    try {
      await page.goto("/tasks");
      await page.getByRole("button", { name: /Ask UniPilot anything/i }).click();
      const panel = page.locator("#unipilot-assistant-panel");
      await expect(panel).toBeVisible();

      await panel
        .locator("[data-assistant-input]")
        .fill(`${PREFIX_C} make a task`);
      await panel.locator("[data-assistant-send]").click();

      const bubble = panel.locator(
        '[data-message-role="assistant"][data-message-local]',
      );
      await expect(bubble).toHaveAttribute("data-message-status", "complete", {
        timeout: 20_000,
      });

      // The real registration returned the proposal; the panel renders it
      // inside the live bubble (its local state is the only rendering here).
      const card = bubble.locator("[data-assistant-action]");
      await expect(card).toHaveCount(1, { timeout: 20_000 });
      await expect(card).toHaveAttribute(
        "data-assistant-action-status",
        "proposed",
      );
      await expect(
        card.locator("[data-assistant-action-summary]"),
      ).toContainText(`Create task: ${title}`);

      // The row is real and keyed to the live content (no message id).
      const { data: row, error } = await service
        .from("assistant_actions")
        .select("id, message_id, status")
        .eq("user_id", qa1Id)
        .eq("conversation_id", conversation)
        .limit(1)
        .maybeSingle();
      expect(error).toBeNull();
      expect(row, "the live registration wrote a real row").not.toBeNull();
      expect(row!.message_id).toBeNull();
      expect(row!.status).toBe("proposed");
      createdActionIds.push(row!.id);

      // Confirm from the panel: the card settles against the real action.
      await card.locator("[data-assistant-action-confirm]").click();
      await expect(card).toHaveAttribute(
        "data-assistant-action-status",
        "succeeded",
        { timeout: 20_000 },
      );
      await expect(card.locator("[data-assistant-action-created]")).toContainText(
        title,
      );

      const log = await storedAction(row!.id);
      expect(log!.status).toBe("succeeded");
      const result = log!.result as { id: string };
      createdTaskIds.push(result.id);
      expect(await taskCount(title)).toBe(1);

      expect(
        errors,
        "the stubbed registration flow stays console-clean",
      ).toEqual([]);
    } finally {
      await stub.dispose();
    }
  });

  test("a late registration from a previous turn never lands on the next turn", async ({
    page,
  }) => {
    test.slow();
    const errors = trackConsoleErrors(page);
    const conversation = await seedConversation(
      qa1Id,
      "stale registration",
      ahead(FUTURE_MINUTES),
    );
    const title = `${PREFIX_C} stale task`;
    const firstContent = `First answer.\n\n${fence({
      type: "task.create",
      payload: { title },
    })}`;

    /* Hold the first registration's Server Action request until the second
       turn has settled, so its result resolves afterwards. Without the turn
       token in `useAssistantTurn`, that late result would write the first
       turn's cards into the second turn's bubble. */
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    const handler = async (route: Route) => {
      const request = route.request();
      if (
        request.method() !== "POST" ||
        request.headers()["next-action"] === undefined
      ) {
        await route.fallback();
        return;
      }
      if (!held) {
        held = true;
        await gate;
      }
      await route.fallback();
    };
    await page.route("**/tasks", handler);

    let active: AssistantTurnStub | null = await stubAssistantTurn(page, {
      chunks: [
        frameToSse({
          type: "start",
          conversationId: conversation,
          configured: true,
        }),
        frameToSse({ type: "delta", text: firstContent }),
        frameToSse({ type: "done", status: "complete", messageId: null }),
      ],
    });

    try {
      await page.goto("/tasks");
      await page.getByRole("button", { name: /Ask UniPilot anything/i }).click();
      const panel = page.locator("#unipilot-assistant-panel");
      await expect(panel).toBeVisible();

      // First turn: settles with a proposal; its registration is held.
      await panel.locator("[data-assistant-input]").fill(`${PREFIX_C} first`);
      await panel.locator("[data-assistant-send]").click();
      const bubble = panel.locator(
        '[data-message-role="assistant"][data-message-local]',
      );
      await expect(bubble).toHaveAttribute("data-message-status", "complete", {
        timeout: 20_000,
      });
      await expect.poll(() => held).toBe(true);
      await expect(panel.locator("[data-assistant-composer]")).toHaveAttribute(
        "aria-busy",
        "false",
      );

      // Second turn, before the first registration resolves: a stream that
      // proposes nothing.
      await active.dispose();
      active = await stubAssistantTurn(page, {
        chunks: [
          frameToSse({
            type: "start",
            conversationId: conversation,
            configured: true,
          }),
          frameToSse({ type: "delta", text: "Second answer with no actions." }),
          frameToSse({ type: "done", status: "complete", messageId: null }),
        ],
      });
      await panel.locator("[data-assistant-input]").fill(`${PREFIX_C} second`);
      await panel.locator("[data-assistant-send]").click();
      await expect(bubble).toHaveAttribute("data-message-status", "complete", {
        timeout: 20_000,
      });
      await expect(bubble.locator("[data-message-content]")).toHaveText(
        "Second answer with no actions.",
      );

      // Release the stale registration and wait for its real response (the
      // row it wrote proves it carried an action).
      const staleResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.request().headers()["next-action"] !== undefined,
      );
      release();
      await staleResponse;
      await expect
        .poll(async () => {
          const { data } = await service
            .from("assistant_actions")
            .select("id")
            .eq("user_id", qa1Id)
            .eq("conversation_id", conversation)
            .limit(1);
          return data?.[0]?.id ?? null;
        })
        .not.toBeNull();
      // Give the client's settled state a beat to flush, then prove the new
      // bubble owns no cards (the first turn's card must not appear under it).
      await page.waitForTimeout(500);
      await expect(bubble.locator("[data-assistant-action]")).toHaveCount(0);
      await expect(panel.locator("[data-assistant-action]")).toHaveCount(0);

      expect(errors, "the stale-registration flow stays console-clean").toEqual(
        [],
      );
    } finally {
      release();
      await page.unroute("**/tasks", handler);
      if (active !== null) await active.dispose();
    }
  });
});
