/**
 * Task 29.1 — the background worker's handler registry.
 *
 * A handler is `async (payload, ctx) => void`:
 *
 * - resolve → the job is marked `succeeded`;
 * - throw → the job is retried with backoff until `max_attempts`, then
 *   dead-lettered. Throw an error with `.retryable = false` for a *permanent*
 *   failure (unsupported input, a 4xx from a provider) so the job goes
 *   straight to `failed` instead of burning its attempts.
 *
 * `ctx` carries `{ jobId, userId, attempt, workerId, log }`. The `log` helper
 * prints the job identity only; handlers must never log payload secrets or
 * tokens (payloads are expected to carry ids, never credentials).
 *
 * 24.2 registers the real document-processing handler here. 29.1 ships
 * `noop.test`, whose payload drives the loop proof: plain payload → success;
 * `{ "fail": true }` → a retryable failure; `{ "fail": true, "retryable":
 * false }` → a permanent failure. 46.13 registers the WhatsApp handlers that
 * delegate to the Python service through `whatsappJobs.mjs`
 * (`whatsapp.connect`, `whatsapp.sync`, `whatsapp.push`,
 * `whatsapp.disconnect`). 31.x registers `presentation.generate`, which drives
 * the separate Presenton service through `presentationJobs.mjs`. Task C1 adds
 * `presentation.export`, the re-export that replaces a deck's document in
 * place, from the same module.
 */
import { processDocument } from "./documentProcessing.mjs";
import { reindexDocument } from "./documentReindex.mjs";
import { exportPresentation, generatePresentation } from "./presentationJobs.mjs";
import {
  whatsappConnect,
  whatsappDisconnect,
  whatsappPush,
  whatsappSync,
} from "./whatsappJobs.mjs";

export const handlers = {
  "document.process": processDocument,

  "document.reindex": reindexDocument,

  "presentation.generate": generatePresentation,

  "presentation.export": exportPresentation,

  "whatsapp.connect": whatsappConnect,

  "whatsapp.sync": whatsappSync,

  "whatsapp.push": whatsappPush,

  "whatsapp.disconnect": whatsappDisconnect,

  "noop.test": async (payload, ctx) => {
    ctx.log(`noop.test ran (job ${ctx.jobId}, attempt ${ctx.attempt})`);
    if (payload && payload.fail === true) {
      const error = new Error("noop.test instructed to fail");
      error.retryable = payload.retryable !== false;
      throw error;
    }
  },
};
