/**
 * WhatsApp group sync: a small Gemini REST client.
 *
 * Configuration is environment only, and the MODEL is deliberately an env var
 * (`GEMINI_MODEL`): Google retires model names and free-tier quotas are per
 * model, so swapping one must never need a code change. Nothing guesses a
 * default model. Without both `GEMINI_API_KEY` and `GEMINI_MODEL` the client
 * reports "not configured" and the pipeline says so; it never fabricates a
 * result.
 *
 * Safety:
 * - the key travels in the `x-goog-api-key` header, never in a URL or a log;
 * - error messages are fixed sanitized strings; provider bodies are never
 *   logged or stored (they can echo the prompt, i.e. a student's messages);
 * - 429 and 5xx are retryable (the worker's backoff handles the delay), other
 *   4xx are permanent.
 *
 * Unverified against live Gemini in this repository (no key was available when
 * written): the request/response shapes follow Google's public documentation and
 * are exercised only by mocked-fetch tests. See whatsapp/README.md.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/* Google rejects some generated schemas ("too many states"). The worker runs
   one model per process, so remember the rejection here: the first job pays one
   400, every later job goes straight to prompt-carried JSON. */
let schemaSupported = true;

export class GeminiError extends Error {
  /**
   * @param {string} code  not_configured | rate_limited | unavailable | rejected | blocked | invalid_response
   * @param {string} message  sanitized, safe to store
   * @param {boolean} retryable
   */
  constructor(code, message, retryable) {
    super(message);
    this.name = "GeminiError";
    this.code = code;
    this.retryable = retryable;
  }
}

/** The only strings that ever reach `raw_messages.error` from this client. */
export const GEMINI_MESSAGES = {
  not_configured: "AI extraction isn't configured on this server.",
  rate_limited: "The AI service is busy. This will be retried.",
  unavailable: "The AI service is temporarily unavailable. This will be retried.",
  rejected: "The AI service rejected the request.",
  blocked: "The AI service declined to process this content.",
  invalid_response: "The AI service returned an unusable response.",
};

/** `{ apiKey, model }`, or `null` when either is missing. */
export function readGeminiConfig(env = process.env) {
  const apiKey = (env.GEMINI_API_KEY ?? "").trim();
  const model = (env.GEMINI_MODEL ?? "").trim();
  if (!apiKey || !model) return null;
  // The model name goes into a URL path: allow only what a model id contains.
  if (!/^[A-Za-z0-9._-]+$/.test(model)) return null;
  return { apiKey, model };
}

function extractText(body) {
  const parts = body?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .join("")
    .trim();
  return text || null;
}

function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Some models wrap JSON in a code fence despite the MIME type.
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text.trim());
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

/**
 * @param {object} options
 * @param {{apiKey: string, model: string} | null} options.config
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 */
export function createGeminiClient({ config, fetchImpl = globalThis.fetch, timeoutMs = 60_000 }) {
  async function post(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(`${ENDPOINT}/${config.model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new GeminiError("unavailable", GEMINI_MESSAGES.unavailable, true);
    } finally {
      clearTimeout(timer);
    }
  }

  function mapStatus(status) {
    if (status === 429) return new GeminiError("rate_limited", GEMINI_MESSAGES.rate_limited, true);
    if (status >= 500) return new GeminiError("unavailable", GEMINI_MESSAGES.unavailable, true);
    return new GeminiError("rejected", GEMINI_MESSAGES.rejected, false);
  }

  return {
    get configured() {
      return config !== null;
    },

    /**
     * Ask for JSON. Returns `{ value, usage }` where `value` is the parsed (not
     * yet validated) JSON; the caller validates it with its Zod schema.
     *
     * @param {object} request
     * @param {string} request.system  instructions (never user content)
     * @param {Array<object>} request.parts  user content parts (text / inlineData)
     * @param {object} [request.jsonSchema]  JSON Schema steering the output
     * @param {number} [request.maxOutputTokens]
     */
    async generateJson({ system, parts, jsonSchema, maxOutputTokens = 4096 }) {
      if (!config) {
        throw new GeminiError("not_configured", GEMINI_MESSAGES.not_configured, false);
      }

      const build = (withSchema) => ({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens,
          responseMimeType: "application/json",
          ...(withSchema && jsonSchema ? { responseJsonSchema: jsonSchema } : {}),
        },
      });

      let response = await post(
        build(schemaSupported && jsonSchema !== undefined),
      );

      // The schema field has changed names across API revisions, and some
      // models reject complex schemas outright. Fall back once, then remember
      // that this process must carry the schema in the prompt instead.
      if (response.status === 400 && jsonSchema !== undefined && schemaSupported) {
        schemaSupported = false;
        response = await post(build(false));
      }

      if (!response.ok) throw mapStatus(response.status);

      let body;
      try {
        body = await response.json();
      } catch {
        throw new GeminiError("invalid_response", GEMINI_MESSAGES.invalid_response, true);
      }

      if (body?.promptFeedback?.blockReason) {
        throw new GeminiError("blocked", GEMINI_MESSAGES.blocked, false);
      }
      const text = extractText(body);
      if (!text) {
        throw new GeminiError("invalid_response", GEMINI_MESSAGES.invalid_response, true);
      }
      const value = parseJsonLoose(text);
      if (value === undefined) {
        throw new GeminiError("invalid_response", GEMINI_MESSAGES.invalid_response, true);
      }

      const u = body?.usageMetadata ?? {};
      return {
        value,
        usage: {
          inputTokens: Number(u.promptTokenCount) || 0,
          outputTokens: Number(u.candidatesTokenCount) || 0,
        },
      };
    },
  };
}
