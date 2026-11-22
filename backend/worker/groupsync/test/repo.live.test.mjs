import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { extractMessage } from "../extractMessage.mjs";
import { createRepo } from "../repo.mjs";
import { createFakeGemini, extraction, item, when } from "./memoryRepo.mjs";

/**
 * LIVE database test: runs the REAL repository and the full extraction pipeline
 * against the LOCAL Supabase stack, with a FAKE Gemini (clearly a mock: it
 * proves the SQL/PostgREST shapes, the provenance triggers and the dedupe keys,
 * not the model). Skipped unless explicitly enabled; refuses any non-local URL.
 *
 *   $env:UNIPILOT_GROUPSYNC_DB_TEST = "1"
 *   (with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and UNIPILOT_INTEGRATIONS_KEY set)
 *   node --test worker/groupsync/test/repo.live.test.mjs
 *
 * One throwaway auth user is created and deleted (cascading every row).
 */
const url = process.env.SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const enabled = process.env.UNIPILOT_GROUPSYNC_DB_TEST === "1";
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url);
const skip = !enabled
  ? "set UNIPILOT_GROUPSYNC_DB_TEST=1 (needs the local Supabase stack)"
  : !isLocal
    ? "refusing a non-local SUPABASE_URL"
    : !serviceKey
      ? "needs SUPABASE_SERVICE_ROLE_KEY"
      : false;

const GROUP = "120363000000000099@g.us";
const NOW = new Date("2026-11-18T10:05:00Z");

describe("group sync pipeline against the real database", { skip }, () => {
  it("writes tasks, events and candidates with provenance, once", async () => {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const created = await admin.auth.admin.createUser({
      email: `groupsync-live-${randomUUID()}@check.invalid`,
      email_confirm: true,
    });
    assert.ifError(created.error);
    const userId = created.data.user.id;
    const repo = createRepo(admin, { DEFAULT_TIMEZONE: "Asia/Kolkata" });

    try {
      await admin.from("profiles").update({ timezone: "Asia/Kolkata" }).eq("id", userId);
      const subjects = await admin
        .from("subjects")
        .insert([
          { user_id: userId, name: "Data Structures", course_code: "CS301", aliases: ["DSA"] },
          { user_id: userId, name: "Operating Systems", course_code: "CS305", aliases: [] },
        ])
        .select("id, name");
      assert.ifError(subjects.error);
      const dsId = subjects.data.find((s) => s.name === "Data Structures").id;
      const osId = subjects.data.find((s) => s.name === "Operating Systems").id;

      await admin.from("monitored_groups").insert({
        user_id: userId,
        group_jid: GROUP,
        group_name: "CS 2026",
        is_active: true,
      });

      // Capture three messages the way the bridge does (the real RPC).
      const send = async (id, text, minute) => {
        const ingested = await admin.rpc("ingest_raw_messages", {
          p_user_id: userId,
          p_rows: [
            {
              group_jid: GROUP,
              whatsapp_msg_id: id,
              fingerprint: id.padEnd(64, "0").replace(/[^0-9a-f]/g, "a").slice(0, 64),
              sender_name: "Prof Rao",
              sent_at: `2026-11-18T10:0${minute}:00Z`,
              raw_text: text,
              media_type: "none",
              status: "queued",
            },
          ],
        });
        assert.ifError(ingested.error);
        return ingested.data[0].message_id;
      };
      const confidentId = await send("m1", "CS301 assignment 3 due Friday", 0);
      const unsureId = await send("m2", "maybe quiz at some point", 1);
      const newSubjectId = await send("m3", "Computer Networks quiz tomorrow 2pm", 2);

      const run = (id, responses) =>
        extractMessage({ repo, gemini: createFakeGemini(responses), now: () => NOW, threshold: 0.85 }, id);

      // 1. confident, dated, sorted -> tasks
      const r1 = await run(confidentId, [extraction([item()])]);
      assert.equal(r1.outcome, "processed");
      const tasks = await admin.from("tasks").select("*").eq("user_id", userId);
      assert.equal(tasks.data.length, 1);
      const task = tasks.data[0];
      assert.equal(task.title, "Assignment 3");
      assert.equal(task.subject_id, dsId);
      assert.equal(task.source, "whatsapp_group");
      assert.equal(task.source_message_id, confidentId);
      assert.equal(task.task_type, "assignment");
      assert.equal(task.due_date, "2026-11-19T18:30:00+00:00");
      assert.ok(task.source_ref.startsWith("wg-"));
      assert.ok(task.confidence_score >= 0.85);

      // 2. a dated exam -> events with the app's own type vocabulary
      const examMsg = await send("m4", "CS305 midterm 5 Dec 10am", 3);
      await run(examMsg, [
        extraction([
          item({
            type: "exam",
            title: "OS midterm",
            course_hint: "CS305",
            when: when({ day: 5, month: 12, time: "10:00", end_time: "12:00" }),
          }),
        ]),
      ]);
      const events = await admin.from("events").select("*").eq("user_id", userId);
      assert.equal(events.data.length, 1);
      assert.equal(events.data[0].type, "exam");
      assert.equal(events.data[0].subject_id, osId);
      assert.equal(events.data[0].source, "whatsapp_group");
      assert.equal(events.data[0].start_at, "2026-12-05T04:30:00+00:00");
      assert.equal(events.data[0].all_day, false);

      // 3. below the threshold, and a new course -> the review queue
      await run(unsureId, [extraction([item({ title: "Maybe a quiz", confidence: 0.6 })])]);
      await run(newSubjectId, [
        extraction([
          item({
            type: "quiz",
            title: "Networks quiz",
            course_hint: "Computer Networks",
            proposed_subject_name: "Computer Networks",
            when: when({ relative: "tomorrow", time: "14:00" }),
          }),
        ]),
      ]);
      const candidates = await admin
        .from("integration_candidates")
        .select("*")
        .eq("user_id", userId)
        .order("created_at");
      assert.equal(candidates.data.length, 2);
      for (const c of candidates.data) {
        assert.equal(c.origin, "live_group");
        assert.equal(c.run_id, null);
        assert.equal(c.status, "pending");
        assert.equal(c.group_name, "CS 2026");
        assert.ok(c.fingerprint.startsWith("wg-"));
      }
      const proposal = candidates.data.find((c) => c.proposed_subject_name);
      assert.equal(proposal.proposed_subject_name, "Computer Networks");
      assert.equal(proposal.subject_id, null);
      assert.equal(proposal.kind, "task");
      assert.equal(proposal.task_type, "quiz");
      const lowConfidence = candidates.data.find((c) => !c.proposed_subject_name);
      assert.equal(lowConfidence.start_at, "2026-11-19T18:30:00+00:00", "dated but below the threshold");
      assert.ok(lowConfidence.confidence < 0.85);

      // 4. a message that was extracted is settled and never re-run
      const settled = await admin.from("raw_messages").select("id, status").eq("user_id", userId);
      assert.ok(settled.data.every((m) => m.status === "processed"));
      assert.deepEqual(await run(confidentId, [extraction([item()])]), { outcome: "already_settled" });

      // 5. a re-queued message cannot duplicate anything (unique source_ref)
      await admin.from("raw_messages").update({ status: "queued" }).eq("id", confidentId);
      const again = await run(confidentId, [extraction([item()])]);
      assert.equal(again.counts.duplicate, 1);
      const afterTasks = await admin.from("tasks").select("id").eq("user_id", userId);
      assert.equal(afterTasks.data.length, 1);

      // 6. a rejected suggestion is terminal, even if re-detected with high confidence
      await admin.from("integration_candidates").update({ status: "rejected" }).eq("id", lowConfidence.id);
      await admin.from("raw_messages").update({ status: "queued" }).eq("id", unsureId);
      const rerun = await run(unsureId, [extraction([item({ title: "Maybe a quiz", confidence: 0.99 })])]);
      assert.equal(rerun.counts.alreadyReviewed, 1);
      const taskCount = await admin.from("tasks").select("id").eq("user_id", userId);
      assert.equal(taskCount.data.length, 1, "the rejected item did not come back as a task");

      // 7. the 30-day purge removes the raw text and keeps every extracted row
      await admin.from("raw_messages").update({ created_at: "2026-09-01T00:00:00Z" }).eq("user_id", userId);
      const purged = await admin.rpc("purge_expired_raw_messages", { p_user_id: userId });
      assert.ifError(purged.error);
      assert.equal(purged.data, 4, "the four captured messages");
      const survivors = await Promise.all([
        admin.from("tasks").select("source_message_id").eq("user_id", userId),
        admin.from("events").select("source_message_id").eq("user_id", userId),
        admin.from("integration_candidates").select("source_message_id").eq("user_id", userId),
      ]);
      assert.equal(survivors[0].data.length, 1);
      assert.equal(survivors[1].data.length, 1);
      assert.equal(survivors[2].data.length, 2);
      for (const rows of survivors) assert.ok(rows.data.every((r) => r.source_message_id === null));

      // 8. usage ledger
      const usage = await admin.from("usage_events").select("kind, quantity").eq("user_id", userId);
      assert.ok(usage.data.length > 0 && usage.data.every((u) => u.kind === "gemini_extract"));
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  it("stores a document's summary, tags and subject, and discards a meme image", async () => {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const created = await admin.auth.admin.createUser({
      email: `groupsync-live-${randomUUID()}@check.invalid`,
      email_confirm: true,
    });
    assert.ifError(created.error);
    const userId = created.data.user.id;
    const repo = createRepo(admin);
    const toRemove = [];

    try {
      const subject = await admin
        .from("subjects")
        .insert({ user_id: userId, name: "Data Structures", course_code: "CS301" })
        .select("id")
        .single();
      await admin.from("monitored_groups").insert({ user_id: userId, group_jid: GROUP, group_name: "g", is_active: true });

      const addFile = async ({ msgId, mime, name, bytes, mediaType, sha, text = "" }) => {
        const ingested = await admin.rpc("ingest_raw_messages", {
          p_user_id: userId,
          p_rows: [
            {
              group_jid: GROUP,
              whatsapp_msg_id: msgId,
              fingerprint: sha,
              sender_name: "Prof",
              sent_at: "2026-11-18T10:00:00Z",
              raw_text: text,
              media_type: mediaType,
              file_sha256: sha,
              status: "queued",
            },
          ],
        });
        assert.ifError(ingested.error);
        const messageId = ingested.data[0].message_id;
        const documentId = randomUUID();
        const path = `${userId}/${documentId}/${name}`;
        toRemove.push(path);
        const up = await admin.storage.from("documents").upload(path, bytes, { contentType: mime });
        assert.ifError(up.error);
        const doc = await admin.from("documents").insert({
          id: documentId,
          user_id: userId,
          name,
          storage_path: path,
          mime_type: mime,
          size_bytes: bytes.length,
          status: "uploaded",
          source: "whatsapp_group",
          source_message_id: messageId,
          file_sha256: sha,
        });
        assert.ifError(doc.error);
        return { messageId, documentId, path };
      };

      // a PDF: summary/tags/subject land on the documents row; indexing queued
      const pdf = await addFile({
        msgId: "p1",
        mime: "application/pdf",
        name: "CS301-notes.pdf",
        bytes: Buffer.from("%PDF-1.7 fake"),
        mediaType: "pdf",
        sha: "1".repeat(64),
        text: "Notes attached",
      });
      await extractMessage(
        {
          repo,
          gemini: createFakeGemini([extraction([], { relevant: false, summary: "Trees and heaps.", topic_tags: ["trees", "heaps"] })]),
          now: () => NOW,
          extractors: { pdf: async () => ({ pages: ["Trees and heaps"], pageCount: 1 }) },
        },
        pdf.messageId,
      );
      const doc = await admin.from("documents").select("*").eq("id", pdf.documentId).single();
      assert.equal(doc.data.ai_summary, "Trees and heaps.");
      assert.deepEqual(doc.data.topic_tags, ["trees", "heaps"]);
      assert.equal(doc.data.subject_id, subject.data.id);
      assert.equal(doc.data.source, "whatsapp_group");
      const jobs = await admin.from("jobs").select("payload").eq("user_id", userId).eq("kind", "document.process");
      assert.deepEqual(jobs.data.map((j) => j.payload), [{ documentId: pdf.documentId }]);

      // a meme: the document row AND the stored object are removed
      const meme = await addFile({
        msgId: "i1",
        mime: "image/jpeg",
        name: "meme.jpg",
        bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
        mediaType: "image",
        sha: "2".repeat(64),
      });
      const result = await extractMessage(
        { repo, gemini: createFakeGemini([{ category: "meme", confidence: 0.99 }]), now: () => NOW },
        meme.messageId,
      );
      assert.equal(result.outcome, "discarded_image");
      const gone = await admin.from("documents").select("id").eq("id", meme.documentId);
      assert.equal(gone.data.length, 0);
      const objects = await admin.storage.from("documents").list(`${userId}/${meme.documentId}`);
      assert.equal(objects.data.length, 0, "the object was removed too");
      const msg = await admin.from("raw_messages").select("status").eq("id", meme.messageId).single();
      assert.equal(msg.data.status, "ignored_noise");
    } finally {
      if (toRemove.length) await admin.storage.from("documents").remove(toRemove);
      await admin.auth.admin.deleteUser(userId);
    }
  });
});
