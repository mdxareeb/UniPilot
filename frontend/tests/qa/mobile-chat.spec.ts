/**
 * tests/qa/mobile-chat.spec.ts — Ask AI's Phase 2 backend proof.
 *
 * Four layers, local-only:
 *
 * 1. the Gemini client's pure contract: unconfigured honesty, sanitized
 *    401/429/502 mapping, retryability, bounded generation config — all with a
 *    mocked fetch, never a live provider;
 * 2. the retrieval migration: `p_subject_id` narrows both search branches,
 *    `recent_document_chunks` is bounded/newest-first, and RLS hides another
 *    student's chunks;
 * 3. the session API over real HTTP with real Bearer tokens: 401, onboarding
 *    403, owner CRUD, 404 for foreign ids, 400 for a conflicting scope, the
 *    service-only message writes, and the DB same-user scope guard;
 * 4. the turn route's status mapping: the real 429 guard (filled usage ledger,
 *    no provider call) plus 502/503 provider branches through the injectable
 *    handler, and citation formatting.
 *
 * Rows and usage events created here are swept by prefix after every test.
 */
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  GEMINI_CHAT_COPY,
  GeminiChatError,
  chatWithGemini,
  geminiChatStatus,
} from "../../lib/ai/geminiChat";
import { authenticateBearer } from "../../lib/auth/apiAuth";
import { createChatPost } from "../../app/api/mobile/chat/route";
import { runStudyChatTurn } from "../../lib/data/studyChat";
import {
  buildStudyChatSources,
  citationSnippet,
  STUDY_CHAT_SOURCE_SNIPPET_MAX_LENGTH,
  titleFromQuestion,
  type StudyChatMessage,
  type StudyChatSource,
} from "../../lib/data/studyChatValues";
import { isBroadSummaryQuery } from "../../lib/data/searchValues";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";
const qa2Password = process.env.UNIPILOT_QA2_PASSWORD ?? "";

const QA1 = "qa.unipilot@unipilot.test";
const QA2 = "qa2.unipilot@unipilot.test";
const PREFIX = "UI AskAI 2";

let qa1Id = "";
let qa2Id = "";
let qa1Token = "";
let qa2Token = "";
let service: SupabaseClient;
let qa1: SupabaseClient;
let qa2: SupabaseClient;

async function signIn(
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<{ id: string; token: string }> {
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  expect(error, `sign-in failed for ${email}: ${error?.message}`).toBeNull();
  return {
    id: data.user!.id,
    token: data.session!.access_token,
  };
}

function bearer(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function seedSubject(userId: string, name: string): Promise<string> {
  const { data, error } = await service
    .from("subjects")
    .insert({ user_id: userId, name: `${PREFIX} ${name}` })
    .select("id")
    .single();
  expect(error, `seed subject: ${error?.message}`).toBeNull();
  return data!.id;
}

async function seedDocument(options: {
  userId: string;
  name: string;
  subjectId: string | null;
  chunks: { content: string; page?: number }[];
  createdAt?: string;
}): Promise<string> {
  const { data, error } = await service
    .from("documents")
    .insert({
      user_id: options.userId,
      name: `${PREFIX} ${options.name}`,
      subject_id: options.subjectId,
      status: "indexed",
      ...(options.createdAt ? { created_at: options.createdAt } : {}),
    })
    .select("id")
    .single();
  expect(error, `seed document: ${error?.message}`).toBeNull();

  const inserted = await service.from("document_chunks").insert(
    options.chunks.map((chunk, index) => ({
      document_id: data!.id,
      chunk_index: index,
      content: chunk.content,
      ...(chunk.page === undefined ? {} : { page: chunk.page }),
    })),
  );
  expect(inserted.error, `seed chunks: ${inserted.error?.message}`).toBeNull();
  return data!.id;
}

async function cleanup(): Promise<void> {
  for (const userId of [qa1Id, qa2Id]) {
    if (!userId) continue;
    await service
      .from("ai_chat_sessions")
      .delete()
      .eq("user_id", userId)
      .like("title", `${PREFIX}%`);
    await service
      .from("documents")
      .delete()
      .eq("user_id", userId)
      .like("name", `${PREFIX}%`);
    await service
      .from("subjects")
      .delete()
      .eq("user_id", userId)
      .like("name", `${PREFIX}%`);
    await service
      .from("usage_events")
      .delete()
      .eq("user_id", userId)
      .in("kind", ["assistant_turn", "assistant_tokens"]);
  }
}

test.beforeAll(async () => {
  if (!LOCAL_TARGET.test(url)) {
    throw new Error(
      `mobile-chat is local-only; refusing target "${url || "(unset)"}"`,
    );
  }
  if (!anonKey || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY (frontend/.env)",
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
  const first = await signIn(qa1, QA1, qa1Password);
  qa1Id = first.id;
  qa1Token = first.token;
  const second = await signIn(qa2, QA2, qa2Password);
  qa2Id = second.id;
  qa2Token = second.token;
});

test.afterEach(async () => {
  await cleanup();
});

test.describe("Ask AI gemini chat client", () => {
  test("unconfigured is honest and never calls fetch", async () => {
    const savedKey = process.env.GEMINI_API_KEY;
    const savedModel = process.env.GEMINI_MODEL;
    let called = false;
    try {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_MODEL;

      const status = geminiChatStatus();
      expect(status.configured).toBe(false);
      if (!status.configured) {
        expect(status.reason).toContain("GEMINI_API_KEY");
      }

      await expect(
        chatWithGemini({
          messages: [{ role: "user", content: "hello" }],
          fetchImpl: (async () => {
            called = true;
            return new Response("{}");
          }) as typeof fetch,
        }),
      ).rejects.toMatchObject({
        name: "GeminiChatError",
        code: "not_configured",
        retryable: false,
      });
      expect(called).toBe(false);

      // A key without a model is still unconfigured, and says which one.
      process.env.GEMINI_API_KEY = "test-key";
      const missingModel = geminiChatStatus();
      expect(missingModel.configured).toBe(false);
      if (!missingModel.configured) {
        expect(missingModel.reason).toContain("GEMINI_MODEL");
      }
    } finally {
      if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = savedKey;
      if (savedModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = savedModel;
    }
  });

  test("401, 429 and 502 are sanitized; retryability is explicit", async () => {
    const savedKey = process.env.GEMINI_API_KEY;
    const savedModel = process.env.GEMINI_MODEL;
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_MODEL = "test-model";

    const calls: { url: string; init: RequestInit }[] = [];
    const stub = (status: number, body: string) =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} });
        return new Response(body, { status });
      }) as typeof fetch;

    async function expectError(
      status: number,
      body: string,
    ): Promise<GeminiChatError> {
      try {
        await chatWithGemini({
          messages: [{ role: "user", content: "hello" }],
          fetchImpl: stub(status, body),
        });
      } catch (error) {
        expect(error).toBeInstanceOf(GeminiChatError);
        return error as GeminiChatError;
      }
      throw new Error(`expected a GeminiChatError for ${status}`);
    }

    try {
      const rejected = await expectError(
        401,
        '{"error":{"message":"secret provider body with the prompt"}}',
      );
      expect(rejected.code).toBe("rejected");
      expect(rejected.retryable).toBe(false);
      expect(rejected.message).toBe(GEMINI_CHAT_COPY.rejected);
      expect(rejected.message).not.toContain("secret provider body");

      const limited = await expectError(429, '{"error":"quota"}');
      expect(limited.code).toBe("rate_limited");
      expect(limited.retryable).toBe(true);
      expect(limited.message).toBe(GEMINI_CHAT_COPY.rate_limited);

      const unavailable = await expectError(502, '{"error":"upstream"}');
      expect(unavailable.code).toBe("unavailable");
      expect(unavailable.retryable).toBe(true);
      expect(unavailable.message).toBe(GEMINI_CHAT_COPY.unavailable);

      // The key travels in the header, never the URL; the model is the path.
      const [call] = calls;
      expect(call.url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent",
      );
      expect(call.url).not.toContain("test-key");
      const headers = new Headers(call.init.headers);
      expect(headers.get("x-goog-api-key")).toBe("test-key");
    } finally {
      if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = savedKey;
      if (savedModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = savedModel;
    }
  });

  test("a successful call carries the grounding prompt and bounded config", async () => {
    const savedKey = process.env.GEMINI_API_KEY;
    const savedModel = process.env.GEMINI_MODEL;
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_MODEL = "test-model";

    let requestBody: Record<string, unknown> | null = null;
    const fetchImpl = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Grounded answer." }] } }],
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    try {
      const result = await chatWithGemini({
        messages: [
          { role: "system", content: "SYSTEM RULES" },
          { role: "user", content: "QUESTION" },
        ],
        fetchImpl,
      });
      expect(result.text).toBe("Grounded answer.");
      expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 7 });

      expect(requestBody).not.toBeNull();
      const body = requestBody as unknown as {
        systemInstruction: { parts: { text: string }[] };
        generationConfig: { temperature: number; maxOutputTokens: number };
        contents: { role: string; parts: { text: string }[] }[];
      };
      expect(body.systemInstruction.parts[0].text).toBe("SYSTEM RULES");
      expect(body.generationConfig.temperature).toBeLessThanOrEqual(0.3);
      expect(body.generationConfig.maxOutputTokens).toBeLessThanOrEqual(4096);
      expect(body.contents).toEqual([
        { role: "user", parts: [{ text: "QUESTION" }] },
      ]);
    } finally {
      if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = savedKey;
      if (savedModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = savedModel;
    }
  });
});

test.describe("Ask AI retrieval scoping", () => {
  test("subject and document filters narrow keyword search; RLS isolates users", async () => {
    const subjectA = await seedSubject(qa1Id, "scope algebra");
    const subjectB = await seedSubject(qa1Id, "scope biology");
    const subjectQA2 = await seedSubject(qa2Id, "scope foreign");
    const documentA = await seedDocument({
      userId: qa1Id,
      name: "algebra reading",
      subjectId: subjectA,
      chunks: [{ content: "zephyrneedlealpha is the algebra marker.", page: 1 }],
    });
    const documentB = await seedDocument({
      userId: qa1Id,
      name: "biology reading",
      subjectId: subjectB,
      chunks: [{ content: "zephyrneedlebeta is the biology marker." }],
    });
    const foreignDocument = await seedDocument({
      userId: qa2Id,
      name: "foreign reading",
      subjectId: subjectQA2,
      chunks: [{ content: "zephyrneedlealpha belongs to the other student." }],
    });

    const bySubject = await qa1.rpc("search_document_chunks", {
      p_query: "zephyrneedlealpha",
      p_limit: 10,
      p_subject_id: subjectA,
    });
    expect(bySubject.error, bySubject.error?.message).toBeNull();
    expect(
      (bySubject.data ?? []).map((row: { document_id: string }) => row.document_id),
    ).toEqual([documentA]);

    const byDocument = await qa1.rpc("search_document_chunks", {
      p_query: "zephyrneedlebeta",
      p_limit: 10,
      p_document_id: documentB,
    });
    expect(byDocument.error, byDocument.error?.message).toBeNull();
    expect(
      (byDocument.data ?? []).map(
        (row: { document_id: string }) => row.document_id,
      ),
    ).toEqual([documentB]);

    // The other student's marker is invisible even without a filter.
    const foreign = await qa1.rpc("search_document_chunks", {
      p_query: "zephyrneedlealpha",
      p_limit: 10,
    });
    expect(foreign.error, foreign.error?.message).toBeNull();
    expect(
      (foreign.data ?? []).map((row: { document_id: string }) => row.document_id),
    ).not.toContain(foreignDocument);
  });

  test("recency fallback is bounded, newest-first and scope-aware", async () => {
    const subject = await seedSubject(qa1Id, "recency");
    const older = await seedDocument({
      userId: qa1Id,
      name: "older notes",
      subjectId: subject,
      createdAt: new Date(Date.now() - 120_000).toISOString(),
      chunks: [{ content: "older material", page: 1 }],
    });
    const newer = await seedDocument({
      userId: qa1Id,
      name: "newer notes",
      subjectId: subject,
      chunks: [
        { content: "newer material part one", page: 2 },
        { content: "newer material part two", page: 3 },
      ],
    });

    const recent = await qa1.rpc("recent_document_chunks", {
      p_limit: 99,
      p_subject_id: subject,
    });
    expect(recent.error, recent.error?.message).toBeNull();
    const rows = (recent.data ?? []) as {
      document_id: string;
      chunk_index: number;
      match_kind: string;
    }[];
    expect(rows.length).toBe(3);
    expect(rows.length).toBeLessThanOrEqual(8);
    expect(rows.map((row) => row.document_id)).toEqual([
      newer,
      newer,
      older,
    ]);
    expect(rows.map((row) => row.chunk_index)).toEqual([0, 1, 0]);
    expect(rows.every((row) => row.match_kind === "recent")).toBe(true);

    // A foreign subject id returns nothing: RLS sees no chunk rows.
    const foreignSubject = await service
      .from("subjects")
      .select("id")
      .eq("user_id", qa2Id)
      .like("name", `${PREFIX}%`)
      .limit(1)
      .maybeSingle();
    if (foreignSubject.data) {
      const hidden = await qa1.rpc("recent_document_chunks", {
        p_subject_id: foreignSubject.data.id,
      });
      expect(hidden.error, hidden.error?.message).toBeNull();
      expect(hidden.data ?? []).toHaveLength(0);
    }
  });

  test("broad summary questions are recognised without upgrading ordinary lookups", () => {
    for (const query of [
      "summarize my latest notes",
      "give me an overview of this course",
      "what are the key points?",
      "what's in my readings?",
      "recap the newest material",
    ]) {
      expect(isBroadSummaryQuery(query), query).toBe(true);
    }
    for (const query of [
      "what is recursion",
      "define mitosis",
      "when is the latest homework deadline",
      "zephyrneedlealpha",
    ]) {
      expect(isBroadSummaryQuery(query), query).toBe(false);
    }
  });
});

test.describe("Ask AI session API", () => {
  test("401 without a token and 403 before onboarding", async ({ request }) => {
    const anonymous = await request.get("/api/mobile/chat/sessions");
    expect(anonymous.status()).toBe(401);
    expect(anonymous.headers()["www-authenticate"]).toContain("Bearer");

    const preOnboarding = await request.get("/api/mobile/chat/sessions", {
      headers: bearer(qa2Token),
    });
    expect(preOnboarding.status()).toBe(403);

    const chat = await request.post("/api/mobile/chat", {
      data: { sessionId: randomUUID(), content: "hello" },
    });
    expect(chat.status()).toBe(401);
  });

  test("owner CRUD, scope validation and foreign ids", async ({ request }) => {
    const subject = await seedSubject(qa1Id, "api scope");
    const foreignSubject = await seedSubject(qa2Id, "api foreign");

    const empty = await request.post("/api/mobile/chat/sessions", {
      headers: bearer(qa1Token),
      data: { title: `${PREFIX} plain` },
    });
    expect(empty.status()).toBe(201);
    const plain = (await empty.json()) as {
      session: { id: string; title: string; scopeSubjectId: string | null };
    };
    expect(plain.session.title).toBe(`${PREFIX} plain`);
    expect(plain.session.scopeSubjectId).toBeNull();

    const scoped = await request.post("/api/mobile/chat/sessions", {
      headers: bearer(qa1Token),
      data: { title: `${PREFIX} scoped`, subjectId: subject },
    });
    expect(scoped.status()).toBe(201);

    const both = await request.post("/api/mobile/chat/sessions", {
      headers: bearer(qa1Token),
      data: { subjectId: subject, documentId: randomUUID() },
    });
    expect(both.status()).toBe(400);

    const blank = await request.post("/api/mobile/chat/sessions", {
      headers: bearer(qa1Token),
      data: { title: "   " },
    });
    expect(blank.status()).toBe(400);

    const foreignScope = await request.post("/api/mobile/chat/sessions", {
      headers: bearer(qa1Token),
      data: { subjectId: foreignSubject },
    });
    expect(foreignScope.status()).toBe(404);

    const list = await request.get("/api/mobile/chat/sessions", {
      headers: bearer(qa1Token),
    });
    expect(list.status()).toBe(200);
    expect(list.headers()["cache-control"]).toBe("no-store");
    const listed = (await list.json()) as {
      sessions: { id: string; title: string }[];
    };
    expect(listed.sessions.map((session) => session.id)).toContain(
      plain.session.id,
    );

    const detail = await request.get(
      `/api/mobile/chat/sessions/${plain.session.id}`,
      { headers: bearer(qa1Token) },
    );
    expect(detail.status()).toBe(200);
    const detailBody = (await detail.json()) as {
      session: { messages: unknown[] };
    };
    expect(detailBody.session.messages).toEqual([]);

    const missing = await request.get(
      `/api/mobile/chat/sessions/${randomUUID()}`,
      { headers: bearer(qa1Token) },
    );
    expect(missing.status()).toBe(404);

    const deleted = await request.delete(
      `/api/mobile/chat/sessions/${plain.session.id}`,
      { headers: bearer(qa1Token) },
    );
    expect(deleted.status()).toBe(200);
    const afterDelete = await request.get(
      `/api/mobile/chat/sessions/${plain.session.id}`,
      { headers: bearer(qa1Token) },
    );
    expect(afterDelete.status()).toBe(404);
  });

  test("foreign sessions are 404 for read, delete and chat; messages are service-only", async ({
    request,
  }) => {
    const foreign = await service
      .from("ai_chat_sessions")
      .insert({ user_id: qa2Id, title: `${PREFIX} foreign` })
      .select("id")
      .single();
    expect(foreign.error, foreign.error?.message).toBeNull();
    const foreignId = foreign.data!.id;

    const read = await request.get(`/api/mobile/chat/sessions/${foreignId}`, {
      headers: bearer(qa1Token),
    });
    expect(read.status()).toBe(404);

    const removed = await request.delete(
      `/api/mobile/chat/sessions/${foreignId}`,
      { headers: bearer(qa1Token) },
    );
    expect(removed.status()).toBe(404);

    const chat = await request.post("/api/mobile/chat", {
      headers: bearer(qa1Token),
      data: { sessionId: foreignId, content: "summarize this" },
    });
    expect(chat.status()).toBe(404);

    // The owner cannot forge a message; the route writes with service role.
    const forged = await qa1.from("ai_chat_messages").insert({
      session_id: foreignId,
      role: "assistant",
      content: "forged",
    });
    expect(forged.error).not.toBeNull();

    const ownRead = await qa1
      .from("ai_chat_sessions")
      .select("id")
      .eq("id", foreignId);
    expect(ownRead.error, ownRead.error?.message).toBeNull();
    expect(ownRead.data).toEqual([]);
  });

  test("the same-user guard rejects a foreign scope even for a service write", async () => {
    const subject = await seedSubject(qa2Id, "guard subject");
    const document = await seedDocument({
      userId: qa2Id,
      name: "guard document",
      subjectId: subject,
      chunks: [{ content: "guard material" }],
    });

    const bySubject = await service.from("ai_chat_sessions").insert({
      user_id: qa1Id,
      title: `${PREFIX} guard`,
      scope_subject_id: subject,
    });
    expect(bySubject.error?.message).toContain(
      "scope subject must belong to the owner",
    );

    const byDocument = await service.from("ai_chat_sessions").insert({
      user_id: qa1Id,
      title: `${PREFIX} guard`,
      scope_document_id: document,
    });
    expect(byDocument.error?.message).toContain(
      "scope document must belong to the owner",
    );
  });
});

test.describe("Ask AI turn route mapping", () => {
  test("the real 429 guard answers before any provider call", async ({
    request,
  }) => {
    await service.from("usage_events").insert(
      Array.from({ length: 10 }, () => ({
        user_id: qa1Id,
        kind: "assistant_turn",
        quantity: 1,
      })),
    );

    const response = await request.post("/api/mobile/chat", {
      headers: bearer(qa1Token),
      data: { sessionId: randomUUID(), content: "rate limited" },
    });
    expect(response.status()).toBe(429);
    expect(response.headers()["retry-after"]).toBe("60");
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("faster than the limit");
  });

  test("an unconfigured turn persists an honest answer without a provider call", async ({
    request,
  }) => {
    const created = await request.post("/api/mobile/chat/sessions", {
      headers: bearer(qa1Token),
      data: { title: `${PREFIX} unconfigured` },
    });
    expect(created.status()).toBe(201);
    const sessionId = ((await created.json()) as {
      session: { id: string };
    }).session.id;

    const savedKey = process.env.GEMINI_API_KEY;
    const savedModel = process.env.GEMINI_MODEL;
    try {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_MODEL;

      const result = await runStudyChatTurn({
        client: qa1,
        userId: qa1Id,
        sessionId,
        content: "summarise my latest notes",
      });
      expect(result.status).toBe("ok");
      if (result.status !== "ok") throw new Error("expected an ok turn");
      expect(result.configured).toBe(false);
      expect(result.userMessage.role).toBe("user");
      expect(result.assistantMessage.role).toBe("assistant");
      expect(result.assistantMessage.status).toBe("complete");
      expect(result.assistantMessage.content).toContain("isn't configured");
      expect(result.sources).toEqual([]);

      // The turn is in history: user first, honest answer second.
      const detail = await request.get(
        `/api/mobile/chat/sessions/${sessionId}`,
        { headers: bearer(qa1Token) },
      );
      expect(detail.status()).toBe(200);
      const messages = ((await detail.json()) as {
        session: { messages: { role: string; content: string }[] };
      }).session.messages;
      expect(messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
      ]);
      expect(messages[1].content).toContain("isn't configured");
    } finally {
      if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = savedKey;
      if (savedModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = savedModel;
    }
  });

  test("provider failures map to 503/502 with sanitized copy and no body leak", async () => {
    const userMessage: StudyChatMessage = {
      id: randomUUID(),
      role: "user",
      content: "a question",
      status: "complete",
      sources: [],
      createdAt: new Date().toISOString(),
    };
    const sources: StudyChatSource[] = [
      {
        documentId: randomUUID(),
        documentName: `${PREFIX} cited`,
        page: 4,
        chunkIndex: 2,
        snippet: "a cited excerpt",
      },
    ];
    const assistantMessage: StudyChatMessage = {
      id: randomUUID(),
      role: "assistant",
      content: "a grounded answer",
      status: "complete",
      sources,
      createdAt: new Date().toISOString(),
    };

    const retryable: typeof runStudyChatTurn = async () => ({
      status: "provider_error",
      error: GEMINI_CHAT_COPY.unavailable,
      retryable: true,
      sessionId: randomUUID(),
      userMessage,
      assistantMessage: { ...assistantMessage, status: "failed" },
      sources: [],
    });
    const permanent: typeof runStudyChatTurn = async () => ({
      status: "provider_error",
      error: GEMINI_CHAT_COPY.rejected,
      retryable: false,
      sessionId: randomUUID(),
      userMessage,
      assistantMessage: { ...assistantMessage, status: "failed" },
      sources: [],
    });
    const answered: typeof runStudyChatTurn = async () => ({
      status: "ok",
      configured: true,
      sessionId: randomUUID(),
      userMessage,
      assistantMessage,
      sources,
    });

    async function invoke(
      runTurn: typeof runStudyChatTurn,
    ): Promise<Response> {
      return createChatPost({ authenticate: authenticateBearer, runTurn })(
        new Request("http://localhost/api/mobile/chat", {
          method: "POST",
          headers: bearer(qa1Token),
          body: JSON.stringify({
            sessionId: randomUUID(),
            content: "a question",
          }),
        }),
      );
    }

    const unavailable = await invoke(retryable);
    expect(unavailable.status).toBe(503);
    const unavailableBody = (await unavailable.json()) as {
      error: string;
      retryable: boolean;
    };
    expect(unavailableBody.error).toBe(GEMINI_CHAT_COPY.unavailable);
    expect(unavailableBody.retryable).toBe(true);

    const rejected = await invoke(permanent);
    expect(rejected.status).toBe(502);

    const ok = await invoke(answered);
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as {
      configured: boolean;
      sources: StudyChatSource[];
    };
    expect(okBody.configured).toBe(true);
    expect(okBody.sources).toEqual(sources);
  });

  test("citations keep provenance, strip highlight markers and stay bounded", () => {
    const documentId = randomUUID();
    const longSnippet = `The [[zephyrneedle]] ${"material ".repeat(60)}`;
    const sources = buildStudyChatSources(
      [
        {
          documentId,
          documentName: "Week 3 notes",
          chunkIndex: 2,
          page: 7,
          content: "full chunk",
          snippet: longSnippet,
          score: 1,
          matchKind: "keyword",
        },
      ],
      [
        {
          documentId,
          documentName: "Week 3 notes",
          chunkIndex: 2,
          page: 7,
          content: "full chunk",
        },
      ],
    );

    expect(sources).toHaveLength(1);
    expect(sources[0].documentId).toBe(documentId);
    expect(sources[0].page).toBe(7);
    expect(sources[0].snippet).not.toContain("[[");
    expect(sources[0].snippet).not.toContain("]]");
    expect(sources[0].snippet.length).toBeLessThanOrEqual(
      STUDY_CHAT_SOURCE_SNIPPET_MAX_LENGTH,
    );
    expect(citationSnippet("  one   [[two]]  ")).toBe("one two");
    expect(titleFromQuestion("  summarize\nmy notes  ")).toBe(
      "summarize my notes",
    );
  });
});

test.describe("Ask AI health diagnostics", () => {
  test("reports the three facts the More panel renders", async ({ request }) => {
    const response = await request.get("/api/mobile/health", {
      headers: bearer(qa1Token),
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const body = (await response.json()) as {
      ok: boolean;
      aiConfigured: boolean;
      supabase: string;
    };
    expect(body.ok).toBe(true);
    expect(typeof body.aiConfigured).toBe("boolean");
    expect(body.supabase).toBe("ok");
  });
});
