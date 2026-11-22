/**
 * An in-memory stand-in for repo.mjs. A FAKE: it proves the pipeline's logic,
 * not Postgres. The real repository's statements are exercised by the live
 * checks in backend/supabase/qa/ and the runbook.
 */

export const USER = "11111111-1111-1111-1111-111111111111";
export const GROUP = "120363000000000001@g.us";

export function makeMessage(overrides = {}) {
  return {
    id: "msg-1",
    user_id: USER,
    group_jid: GROUP,
    whatsapp_msg_id: "WA-1",
    fingerprint: "f".repeat(64),
    sender_name: "Prof Rao",
    // Wednesday 2026-11-18 10:00 UTC
    sent_at: "2026-11-18T10:00:00.000Z",
    raw_text: "CS301 assignment 3 is due Friday",
    media_type: "none",
    file_sha256: null,
    status: "queued",
    ...overrides,
  };
}

export const SUBJECTS = [
  { id: "sub-ds", name: "Data Structures", course_code: "CS301", aliases: ["DSA"] },
  { id: "sub-os", name: "Operating Systems", course_code: "CS305", aliases: [] },
];

export function createMemoryRepo({ message = makeMessage(), context = {}, document = null, files = {} } = {}) {
  const state = {
    message: message ? { ...message } : null,
    document: document ? { ...document } : null,
    tasks: [],
    events: [],
    candidates: [],
    documentUpdates: [],
    deletedDocuments: [],
    indexing: [],
    usage: [],
    outcomes: [],
    failUsage: false,
    failDownload: false,
  };
  const ctx = {
    timeZone: "Asia/Kolkata",
    dateOrder: "DMY",
    subjects: SUBJECTS,
    groupName: "CS301 2026",
    ...context,
  };

  const repo = {
    state,
    async getMessage() {
      return state.message;
    },
    async getContext() {
      return ctx;
    },
    async getDocument() {
      return state.document;
    },
    async downloadObject(path) {
      if (state.failDownload) {
        const error = new Error("storage down");
        error.name = "RepoError";
        error.retryable = true;
        throw error;
      }
      if (!(path in files)) throw new Error("no such object");
      return files[path];
    },
    async setMessage(id, status, error = null) {
      state.outcomes.push({ status, error });
      if (state.message?.id === id) state.message.status = status;
    },
    async candidateExists(_userId, ref) {
      return state.candidates.some((c) => c.ref === ref);
    },
    async insertTask(rec) {
      if (state.tasks.some((t) => t.ref === rec.ref)) return "duplicate";
      state.tasks.push(rec);
      return "inserted";
    },
    async insertEvent(rec) {
      if (state.events.some((e) => e.ref === rec.ref)) return "duplicate";
      state.events.push(rec);
      return "inserted";
    },
    async insertCandidate(rec) {
      if (state.candidates.some((c) => c.ref === rec.ref)) return "duplicate";
      state.candidates.push({ ...rec, status: "pending" });
      return "inserted";
    },
    async updateDocument(id, patch) {
      state.documentUpdates.push({ id, patch });
    },
    async deleteDocument(id, path) {
      state.deletedDocuments.push({ id, path });
      state.document = null;
    },
    async enqueueIndexing(_userId, documentId) {
      state.indexing.push(documentId);
    },
    async recordUsage(_userId, kind, quantity) {
      if (state.failUsage) throw new Error("ledger down");
      state.usage.push({ kind, quantity });
    },
  };
  return repo;
}

/** A fake Gemini client that returns queued results or throws queued errors. */
export function createFakeGemini(responses, { configured = true } = {}) {
  const queue = [...responses];
  const calls = [];
  return {
    configured,
    calls,
    async generateJson(request) {
      calls.push(request);
      const next = queue.shift();
      if (next === undefined) throw new Error("fake gemini: no response queued");
      if (next instanceof Error) throw next;
      return { value: next, usage: { inputTokens: 100, outputTokens: 20 } };
    },
  };
}

export const when = (over = {}) => ({
  date_text: null,
  day: null,
  month: null,
  year: null,
  weekday: null,
  week_ref: null,
  relative: null,
  in_days: null,
  in_weeks: null,
  time: null,
  end_time: null,
  ...over,
});

export const item = (over = {}) => ({
  type: "assignment",
  title: "Assignment 3",
  course_hint: "CS301",
  proposed_subject_name: null,
  when: when({ weekday: "friday" }),
  confidence: 0.95,
  evidence: "assignment 3 is due Friday",
  ...over,
});

export const extraction = (items = [item()], over = {}) => ({
  relevant: items.length > 0,
  items,
  summary: null,
  topic_tags: [],
  ...over,
});
