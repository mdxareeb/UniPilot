import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGeminiClient, GeminiError, GEMINI_MESSAGES, readGeminiConfig } from "../gemini.mjs";
import { ExtractionSchema, toRequestSchema } from "../schemas.mjs";

const CONFIG = { apiKey: "test-key-not-real", model: "gemini-test-model" };

function reply(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
const okBody = (text, usage = { promptTokenCount: 11, candidatesTokenCount: 7 }) => ({
  candidates: [{ content: { parts: [{ text }] } }],
  usageMetadata: usage,
});

function client(responses, over = {}) {
  const calls = [];
  const queue = [...responses];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { gemini: createGeminiClient({ config: CONFIG, fetchImpl, ...over }), calls };
}

const request = { system: "sys", parts: [{ text: "hi" }], jsonSchema: { type: "object" } };

describe("readGeminiConfig", () => {
  it("needs BOTH the key and the model, and guesses neither", () => {
    assert.equal(readGeminiConfig({}), null);
    assert.equal(readGeminiConfig({ GEMINI_API_KEY: "k" }), null);
    assert.equal(readGeminiConfig({ GEMINI_MODEL: "m" }), null);
    assert.deepEqual(readGeminiConfig({ GEMINI_API_KEY: " k ", GEMINI_MODEL: " m-1.5 " }), {
      apiKey: "k",
      model: "m-1.5",
    });
  });

  it("refuses a model name that could escape the URL path", () => {
    assert.equal(readGeminiConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "../v1/other" }), null);
    assert.equal(readGeminiConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "a?b=c" }), null);
  });
});

describe("generateJson", () => {
  it("posts to the configured model with the key only in a header", async () => {
    const { gemini, calls } = client([reply(200, okBody('{"ok":true}'))]);
    const out = await gemini.generateJson(request);

    assert.deepEqual(out.value, { ok: true });
    assert.deepEqual(out.usage, { inputTokens: 11, outputTokens: 7 });
    const [call] = calls;
    assert.equal(
      call.url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent",
    );
    assert.equal(call.init.headers["x-goog-api-key"], CONFIG.apiKey);
    assert.ok(!call.url.includes(CONFIG.apiKey), "the key is never in the URL");
    assert.equal(call.body.generationConfig.responseMimeType, "application/json");
    assert.equal(call.body.generationConfig.temperature, 0);
    assert.deepEqual(call.body.systemInstruction.parts, [{ text: "sys" }]);
    assert.deepEqual(call.body.contents, [{ role: "user", parts: [{ text: "hi" }] }]);
  });

  it("the model comes from the config, so a swap needs no code change", async () => {
    const calls = [];
    const g = createGeminiClient({
      config: { apiKey: "k", model: "another-model" },
      fetchImpl: async (url) => {
        calls.push(url);
        return reply(200, okBody("{}"));
      },
    });
    await g.generateJson(request);
    assert.match(calls[0], /models\/another-model:generateContent$/);
  });

  it("tolerates a ```json fenced answer", async () => {
    const { gemini } = client([reply(200, okBody('```json\n{"a":1}\n```'))]);
    assert.deepEqual((await gemini.generateJson(request)).value, { a: 1 });
  });

  it("retries once without the schema when the schema field itself is rejected", async () => {
    const { gemini, calls } = client([reply(400, {}), reply(200, okBody('{"a":1}'))]);
    const out = await gemini.generateJson(request);
    assert.deepEqual(out.value, { a: 1 });
    assert.equal(calls.length, 2);
    assert.ok("responseJsonSchema" in calls[0].body.generationConfig);
    assert.ok(!("responseJsonSchema" in calls[1].body.generationConfig));
  });

  it("maps statuses to retryable / permanent with fixed copy", async () => {
    const cases = [
      [429, "rate_limited", true],
      [500, "unavailable", true],
      [503, "unavailable", true],
      [401, "rejected", false],
      [403, "rejected", false],
      [404, "rejected", false],
    ];
    for (const [status, code, retryable] of cases) {
      const { gemini } = client([reply(status, { error: { message: "SECRET prompt echo: Dear Prof" } })]);
      await assert.rejects(gemini.generateJson({ ...request, jsonSchema: undefined }), (error) => {
        assert.ok(error instanceof GeminiError);
        assert.equal(error.code, code, String(status));
        assert.equal(error.retryable, retryable, String(status));
        assert.equal(error.message, GEMINI_MESSAGES[code]);
        assert.doesNotMatch(error.message, /SECRET|Prof/);
        return true;
      });
    }
  });

  it("a network failure or timeout is a retryable outage", async () => {
    const { gemini } = client([new Error("ECONNRESET to 1.2.3.4")]);
    await assert.rejects(gemini.generateJson(request), (e) => e.code === "unavailable" && e.retryable);

    const hang = createGeminiClient({
      config: CONFIG,
      timeoutMs: 20,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))),
    });
    await assert.rejects(hang.generateJson(request), (e) => e.code === "unavailable");
  });

  it("a safety block is permanent", async () => {
    const { gemini } = client([reply(200, { promptFeedback: { blockReason: "SAFETY" } })]);
    await assert.rejects(gemini.generateJson(request), (e) => e.code === "blocked" && !e.retryable);
  });

  it("an empty or non-JSON answer is an invalid response", async () => {
    for (const body of [{}, okBody(""), okBody("not json at all")]) {
      const { gemini } = client([reply(200, body)]);
      await assert.rejects(gemini.generateJson(request), (e) => e.code === "invalid_response");
    }
  });

  it("without configuration it refuses, permanently, and never calls the network", async () => {
    let called = false;
    const g = createGeminiClient({ config: null, fetchImpl: async () => { called = true; } });
    assert.equal(g.configured, false);
    await assert.rejects(g.generateJson(request), (e) => e.code === "not_configured" && !e.retryable);
    assert.equal(called, false);
  });
});

describe("schemas", () => {
  it("converts to JSON Schema without the $schema key", () => {
    const json = toRequestSchema(ExtractionSchema);
    assert.equal(json.$schema, undefined);
    assert.equal(json.type, "object");
    assert.ok(json.properties.items);
  });

  it("accepts a normal answer and fills omitted nullable fields", () => {
    const parsed = ExtractionSchema.parse({
      relevant: true,
      items: [
        {
          type: "quiz",
          title: " Quiz 2 ",
          when: { weekday: "monday", time: "09:30" },
          confidence: 0.9,
          evidence: "quiz monday 9:30",
        },
      ],
    });
    assert.equal(parsed.items[0].title, "Quiz 2");
  });

  it("rejects an unknown item type, a bad time and an out-of-range confidence", () => {
    const base = { relevant: true, items: [{ type: "quiz", title: "t", when: {}, confidence: 0.5, evidence: "e" }] };
    assert.ok(ExtractionSchema.safeParse(base).success);
    for (const patch of [{ type: "party" }, { when: { time: "9:30" } }, { confidence: 2 }, { title: "  " }]) {
      const bad = { ...base, items: [{ ...base.items[0], ...patch }] };
      assert.equal(ExtractionSchema.safeParse(bad).success, false, JSON.stringify(patch));
    }
  });
});
