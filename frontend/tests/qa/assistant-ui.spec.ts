/**
 * tests/qa/assistant-ui.spec.ts — Task 19.x C1's pure-helper proof.
 *
 * The assistant chat UI's foundation is data-only: the client-safe frame
 * vocabulary moved out of the server module for 19.x, the SSE parser that
 * reassembles the route's `data: <json>\n\n` stream from arbitrary chunks, and
 * the reducer that accumulates frames onto a streaming assistant entry.
 * Nothing here touches the route, the database, a provider or a browser — the
 * cases prove the contract directly, including its honesty rules: content is
 * only ever delivered delta text, `unconfigured` stays honest, an error frame
 * never fabricates an answer, and malformed payloads are skipped.
 *
 * The live chat panel (composer, streaming render, source chips) is a later C
 * task's `qa-assistant-ui` UI case; this project stays green with no provider
 * configured.
 */
import { test, expect } from "@playwright/test";
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
