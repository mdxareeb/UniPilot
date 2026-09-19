/**
 * Task D8 — the chat proxy's pure frame vocabulary (spec §7.8, §5.4).
 *
 * `POST /api/presentation/{id}/chat` streams Server-Sent Events to the editor's
 * chat panel. The engine frames them as `event: response\ndata: {json}\n\n`
 * (`presenton-main/servers/fastapi/models/sse_response.py`); UniPilot
 * re-normalizes framing to a single `data: <json>\n\n` line and exposes only
 * these five frame shapes:
 *
 *     { "type": "chunk",    "text": "..." }
 *     { "type": "status",   "status": "..." }
 *     { "type": "trace",    "trace": { kind, round, tool, status, message } }
 *     { "type": "complete", "conversationId": "...", "response": "...",
 *                           "toolCalls": ["updateSlide", ...] }
 *     { "type": "error",    "message": "<sanitized copy>" }
 *
 * The error branch is the sanitizer: an upstream error frame carries the
 * engine's `detail` (which may quote an LLM provider), and only
 * {@link CHAT_ERROR_COPY} ever leaves this module. Unknown frame types and
 * malformed payloads are dropped, never guessed at, and no other branch copies
 * arbitrary upstream fields.
 *
 * The module also owns the client-side accumulation ({@link applyChatFrame}),
 * the conservative "did this turn mutate the deck?" rule
 * ({@link chatTurnMayChangeDeck}) and the edit-review representability rule
 * ({@link classifyChatDeckDiff}): a per-message review is offered only when the
 * before/after diff is whole-slide representable (same slide ids and order);
 * structural or deck-metadata changes are reported honestly instead.
 *
 * Pure and dependency-free so both the server route and the browser panel use
 * the exact same parsing, and so every rule is provable without an engine.
 */
import type { DeckSlide } from "./types";

/** The one line the panel shows when a turn fails; never upstream detail. */
export const CHAT_ERROR_COPY =
  "The deck assistant hit a problem and stopped. Try again in a moment.";

/** The engine's own message bound (`ChatMessageRequest.message` max_length). */
export const CHAT_MESSAGE_MAX_LENGTH = 8_000;

export type ChatTrace = {
  kind: string;
  round: number | null;
  tool: string | null;
  status: string | null;
  message: string | null;
};

export type ChatFrame =
  | { type: "chunk"; text: string }
  | { type: "status"; status: string }
  | { type: "trace"; trace: ChatTrace }
  | {
      type: "complete";
      conversationId: string | null;
      response: string;
      toolCalls: string[];
    }
  | { type: "error"; message: string };

/** One parsed SSE block: its `event:` field (when present) and joined data. */
export type SseEvent = { event: string | null; data: string };

/**
 * Splits a growing SSE buffer into complete events plus the incomplete tail.
 * Follows the wire format the engine emits (and the SSE spec): blocks are
 * blank-line separated, `data:` lines join with `\n`, comment lines (`:`) are
 * ignored, and an optional single space after the colon is stripped.
 */
export function parseSseBlocks(buffer: string): {
  events: SseEvent[];
  rest: string;
} {
  const blocks = buffer.replace(/\r\n/g, "\n").split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: SseEvent[] = [];

  for (const block of blocks) {
    if (block.trim() === "") continue;
    let event: string | null = null;
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":") || line === "") continue;
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const field = line.slice(0, colon);
      const rawValue = line.slice(colon + 1);
      const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
      if (field === "event") event = value;
      else if (field === "data") dataLines.push(value);
    }
    if (dataLines.length > 0) events.push({ event, data: dataLines.join("\n") });
  }

  return { events, rest };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTrace(value: Record<string, unknown>): ChatTrace {
  const kind =
    typeof value.kind === "string" && value.kind !== "" ? value.kind : "trace";
  const status =
    typeof value.status === "string" && value.status !== "" ? value.status : null;
  /* The engine builds error-trace messages from raw tool exceptions
     (`tools.py`) and model notes from provider output (`service.py`); neither
     may cross the proxy. Those two branches keep only the structural fields —
     the UI falls back to `<tool> (<status>)` / the kind label. */
  const message =
    status === "error" || kind === "model_note"
      ? null
      : typeof value.message === "string" && value.message !== ""
        ? value.message
        : null;
  return {
    kind,
    round:
      typeof value.round === "number" && Number.isFinite(value.round)
        ? value.round
        : null,
    tool: typeof value.tool === "string" && value.tool !== "" ? value.tool : null,
    status,
    message,
  };
}

/**
 * One engine frame payload → the normalized frame, or null for anything this
 * contract does not carry. Error payloads are replaced by
 * {@link CHAT_ERROR_COPY} wholesale: the engine's `detail`, `source`,
 * `status_code` and every other upstream field are discarded here.
 */
export function normalizeChatFramePayload(value: unknown): ChatFrame | null {
  if (!isRecord(value)) return null;

  switch (value.type) {
    case "chunk":
      return typeof value.chunk === "string" && value.chunk !== ""
        ? { type: "chunk", text: value.chunk }
        : null;
    case "status":
      return typeof value.status === "string" && value.status !== ""
        ? { type: "status", status: value.status }
        : null;
    case "trace":
      return isRecord(value.trace)
        ? { type: "trace", trace: normalizeTrace(value.trace) }
        : null;
    case "complete": {
      if (!isRecord(value.chat)) return null;
      const chat = value.chat;
      return {
        type: "complete",
        conversationId:
          typeof chat.conversation_id === "string" &&
          chat.conversation_id !== ""
            ? chat.conversation_id
            : null,
        response: typeof chat.response === "string" ? chat.response : "",
        toolCalls: Array.isArray(chat.tool_calls)
          ? chat.tool_calls.filter(
              (entry): entry is string =>
                typeof entry === "string" && entry !== "",
            )
          : [],
      };
    }
    case "error":
      return { type: "error", message: CHAT_ERROR_COPY };
    default:
      return null;
  }
}

/** One parsed SSE event → a frame; non-`response` events and bad JSON drop. */
export function normalizeChatSseEvent(event: SseEvent): ChatFrame | null {
  if (event.event !== null && event.event !== "response") return null;
  try {
    return normalizeChatFramePayload(JSON.parse(event.data));
  } catch {
    return null;
  }
}

/** One frame on the wire: a single JSON `data:` line plus the blank separator. */
export function frameToSse(frame: ChatFrame): string {
  return `data: ${JSON.stringify(frame)}\n\n`;
}

/**
 * The engine tools that do not change the deck (`tools.py`). Anything not on
 * this list — including a tool this build has never seen — is treated as
 * mutating, so the editor re-reads the deck after such a turn rather than
 * showing a stale one.
 */
const READ_ONLY_CHAT_TOOLS = new Set([
  "getAvailableLayouts",
  "getAvailableBlocks",
  "getAvailableInfographics",
  "getContentSchemaFromLayoutId",
  "getTemplateSummary",
  "readSourceDocuments",
  "searchSlide",
  "getSlideAtIndex",
  "getPresentationTheme",
  "getSmartPresentationContext",
]);

/**
 * Whether a completed turn may have changed the stored deck. Conservative by
 * construction: an empty tool list is read-only, a known read tool is
 * read-only, and every other name (mutating or unknown) re-reads the deck.
 */
export function chatTurnMayChangeDeck(toolCalls: readonly string[]): boolean {
  return toolCalls.some((tool) => !READ_ONLY_CHAT_TOOLS.has(tool));
}

/**
 * Whether one `trace` frame proves a mutating tool actually started. A turn
 * can commit an engine-side edit and then fail (or be aborted) before its
 * `complete` frame, so the panel must learn this from the trace itself: the
 * engine emits a `status:"start"` trace before every tool call
 * (`service.py`, the `tool_call` start branch).
 */
export function chatTraceMutatesDeck(trace: ChatTrace): boolean {
  return (
    trace.status === "start" &&
    trace.tool !== null &&
    chatTurnMayChangeDeck([trace.tool])
  );
}

/**
 * Whether a history response may still be applied. The conversation switch is
 * a race by nature: a slow response for conversation A must land only when A
 * is still both the latest request (`responseToken === latestToken`) and the
 * current selection (`requestedConversationId === currentConversationId`), and
 * only when no stream is active (`streamActive === false`) — a late history
 * read must never replace a just-started turn's messages. Anything else is
 * stale and is discarded.
 */
export function chatHistoryResponseApplies(input: {
  responseToken: number;
  latestToken: number;
  requestedConversationId: string;
  currentConversationId: string | null;
  streamActive: boolean;
}): boolean {
  return (
    !input.streamActive &&
    input.responseToken === input.latestToken &&
    input.currentConversationId === input.requestedConversationId
  );
}

/**
 * Whether discarding a stale history response must also release the loading
 * state. Only the request that owns the loading state may release it: when a
 * *newer* history request started, that request owns and clears the state; when
 * the token moved for another reason (a live turn's `complete` selecting its
 * conversation), nobody else will, and the panel would otherwise wedge in
 * "Loading conversation…" forever.
 */
export function chatHistoryDiscardReleasesLoading(input: {
  responseToken: number;
  loadingToken: number | null;
}): boolean {
  return input.loadingToken === input.responseToken;
}

// ---------------------------------------------------------------------------
// Client-side accumulation
// ---------------------------------------------------------------------------

export type ChatEntry = {
  role: "user" | "assistant";
  text: string;
  status: string | null;
  traces: ChatTrace[];
  conversationId: string | null;
  complete: boolean;
  stopped: boolean;
  /**
   * True when the stream ended without a `complete` or `error` frame (a
   * dropped connection, a proxy that ended early): the panel says so instead
   * of leaving an empty bubble.
   */
  interrupted: boolean;
  error: string | null;
};

export function createChatEntry(role: ChatEntry["role"]): ChatEntry {
  return {
    role,
    text: "",
    status: null,
    traces: [],
    conversationId: null,
    complete: false,
    stopped: false,
    interrupted: false,
    error: null,
  };
}

/**
 * Applies one frame to an assistant entry. `chunk` text accumulates; `status`
 * records the latest status line; `trace` appends the turn's tool trace;
 * `complete` marks the turn done and falls back to the engine's assembled
 * response when no delta was streamed; `error` records the sanitized message
 * without fabricating any reply text.
 */
export function applyChatFrame(entry: ChatEntry, frame: ChatFrame): ChatEntry {
  switch (frame.type) {
    case "chunk":
      return { ...entry, text: entry.text + frame.text };
    case "status":
      return { ...entry, status: frame.status };
    case "trace":
      return { ...entry, traces: [...entry.traces, frame.trace] };
    case "complete":
      return {
        ...entry,
        complete: true,
        conversationId: frame.conversationId ?? entry.conversationId,
        text: entry.text === "" ? frame.response : entry.text,
      };
    case "error":
      return { ...entry, error: frame.message };
  }
}

// ---------------------------------------------------------------------------
// Edit-review representability
// ---------------------------------------------------------------------------

/** The deck state a chat turn is compared against (local slides + metadata). */
export type ChatDeckSnapshot = {
  slides: DeckSlide[];
  theme: unknown;
  title: string;
};

export type ChatSlideChange = {
  slideId: string;
  /** 1-based slide number, the label the rail uses. */
  slideNumber: number;
  beforeText: string;
  afterText: string;
};

export type ChatDeckDiff =
  | { representable: true; changes: ChatSlideChange[] }
  | {
      representable: false;
      reason: "structural" | "metadata" | "mixed";
      changedSlideCount: number;
    };

/** Order-stable JSON so a re-read that only reorders keys compares equal. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function slideSignature(slide: DeckSlide): string {
  return stableJson({
    content: slide.content,
    index: slide.index,
    layout: slide.layout,
    layout_group: slide.layout_group,
    properties: slide.properties ?? null,
    speaker_note: slide.speaker_note ?? null,
    ui: slide.ui ?? null,
  });
}

/**
 * Classifies the difference a chat turn left on the stored deck.
 *
 * A per-message review is offered only when every change is whole-slide
 * representable: the slide ids and their order are unchanged, and only slide
 * bodies moved. A run that added, removed or reordered slides, or that touched
 * the deck's theme or title, is reported through the honest `reason` instead —
 * the panel then says "changes applied" and points at the editor's undo.
 */
export function classifyChatDeckDiff(
  before: ChatDeckSnapshot,
  after: ChatDeckSnapshot,
): ChatDeckDiff {
  const sameStructure =
    before.slides.length === after.slides.length &&
    before.slides.every((slide, index) => slide.id === after.slides[index]?.id);

  if (!sameStructure) {
    const limit = Math.max(before.slides.length, after.slides.length);
    let changedSlideCount = 0;
    for (let index = 0; index < limit; index += 1) {
      const a = before.slides[index];
      const b = after.slides[index];
      if (a === undefined || b === undefined || a.id !== b.id) {
        changedSlideCount += 1;
        continue;
      }
      if (slideSignature(a) !== slideSignature(b)) changedSlideCount += 1;
    }
    return { representable: false, reason: "structural", changedSlideCount };
  }

  const changes: ChatSlideChange[] = [];
  before.slides.forEach((slide, index) => {
    const next = after.slides[index];
    if (slideSignature(slide) === slideSignature(next)) return;
    changes.push({
      slideId: slide.id,
      slideNumber: index + 1,
      beforeText: slideTextSummary(slide),
      afterText: slideTextSummary(next),
    });
  });

  const metadataChanged =
    before.title !== after.title ||
    stableJson(before.theme) !== stableJson(after.theme);

  if (metadataChanged) {
    return {
      representable: false,
      reason: changes.length > 0 ? "mixed" : "metadata",
      changedSlideCount: changes.length,
    };
  }

  return { representable: true, changes };
}

// ---------------------------------------------------------------------------
// Slide text summary (the review's before/after)
// ---------------------------------------------------------------------------

/** The display text of one run list; LaTeX runs contribute no summary. */
function runsText(runs: unknown): string {
  if (!Array.isArray(runs)) return "";
  let text = "";
  for (const run of runs) {
    if (!isRecord(run)) continue;
    if (run.type === "latex") continue;
    if (typeof run.text === "string") text += run.text;
  }
  return text.replace(/\s+/g, " ").trim();
}

function collectElementText(element: unknown, out: string[], depth: number): void {
  if (depth > 12 || !isRecord(element)) return;

  if (element.type === "text") {
    const text = runsText(element.runs);
    if (text !== "") out.push(text);
  } else if (element.type === "text-list" && Array.isArray(element.items)) {
    for (const item of element.items) {
      const text = runsText(item);
      if (text !== "") out.push(text);
    }
  } else if (element.type === "table" && Array.isArray(element.rows)) {
    for (const row of element.rows) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) {
        if (!isRecord(cell)) continue;
        const text = runsText(cell.runs);
        if (text !== "") out.push(text);
      }
    }
  }

  if (element.type === "container" && element.child !== undefined) {
    collectElementText(element.child, out, depth + 1);
  }
  if (Array.isArray(element.children)) {
    for (const child of element.children) {
      collectElementText(child, out, depth + 1);
    }
  }
}

/**
 * A short, ordered summary of a slide's text content (the review's before and
 * after strings). Component and root elements are both walked; symbols,
 * images, charts and LaTeX runs contribute nothing.
 */
export function slideTextSummary(slide: DeckSlide): string {
  const ui = slide.ui;
  if (!isRecord(ui)) return "";
  const parts: string[] = [];

  if (Array.isArray(ui.components)) {
    for (const component of ui.components) {
      if (!isRecord(component) || !Array.isArray(component.elements)) continue;
      for (const element of component.elements) {
        collectElementText(element, parts, 0);
      }
    }
  }
  if (Array.isArray(ui.elements)) {
    for (const element of ui.elements) {
      collectElementText(element, parts, 0);
    }
  }

  return parts.join(" · ").slice(0, 400);
}
