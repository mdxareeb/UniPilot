import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { SupabaseSessionStore } from "../src/store/supabaseStore.ts";

/**
 * LIVE database test: runs the real SupabaseSessionStore against the LOCAL
 * Supabase stack (real PostgREST argument shapes, real pgcrypto RPCs). It is
 * skipped unless explicitly enabled, and it refuses any non-local URL, so it
 * can never touch the hosted project:
 *
 *   $env:UNIPILOT_BRIDGE_DB_TEST = "1"
 *   npm run bridge:test            # with backend/.env loaded, local stack up
 *
 * It creates one throwaway auth user and deletes it (cascading every row) at
 * the end. It uses no real WhatsApp data.
 */
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const integrationsKey = process.env.UNIPILOT_INTEGRATIONS_KEY ?? "";
const enabled = process.env.UNIPILOT_BRIDGE_DB_TEST === "1";
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url);

const skipReason = !enabled
  ? "set UNIPILOT_BRIDGE_DB_TEST=1 (needs the local Supabase stack)"
  : !isLocal
    ? "refusing a non-local SUPABASE_URL"
    : !serviceKey || !integrationsKey
      ? "needs SUPABASE_SERVICE_ROLE_KEY and UNIPILOT_INTEGRATIONS_KEY"
      : false;

describe("SupabaseSessionStore (live, local stack)", { skip: skipReason }, () => {
  it("round-trips the encrypted session store and the status channel", async () => {
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const store = new SupabaseSessionStore({ url, serviceRoleKey: serviceKey, integrationsKey });

    const created = await admin.auth.admin.createUser({
      email: `bridge-live-${randomUUID()}@check.invalid`,
      email_confirm: true,
    });
    assert.ifError(created.error);
    const userId = created.data.user!.id;

    try {
      // The web app creates this row (service role); the bridge reconciles it.
      const inserted = await admin
        .from("whatsapp_sessions")
        .insert({ user_id: userId, desired_state: "connected" });
      assert.ifError(inserted.error);

      const listed = await store.listSessions();
      const mine = listed.find((row) => row.userId === userId);
      assert.deepEqual(mine, {
        userId,
        status: "disconnected",
        desiredState: "connected",
        linkMethod: "qr",
      });

      // credentials
      assert.equal(await store.getCreds(userId), null);
      await store.setCreds(userId, '{"noiseKey":{"type":"Buffer","data":[1,2]}}');
      assert.equal(await store.getCreds(userId), '{"noiseKey":{"type":"Buffer","data":[1,2]}}');

      // signal keys (batched, null deletes)
      await store.setKeys(userId, [
        { type: "pre-key", id: "1", value: "AAA" },
        { type: "pre-key", id: "2", value: "BBB" },
        { type: "session", id: "x", value: "CCC" },
      ]);
      assert.deepEqual(await store.getKeys(userId, "pre-key", ["1", "2", "3"]), {
        "1": "AAA",
        "2": "BBB",
      });
      await store.setKeys(userId, [{ type: "pre-key", id: "2", value: null }]);
      assert.deepEqual(await store.getKeys(userId, "pre-key", ["2"]), {});

      // QR: stored encrypted, readable only through the RPC with the key
      await store.setQr(userId, "2@live-qr", 60);
      const rpc = await admin.rpc("get_whatsapp_session_qr", {
        p_user_id: userId,
        p_key: integrationsKey,
      });
      assert.equal(rpc.data, "2@live-qr");
      await store.clearQr(userId);
      const gone = await admin.rpc("get_whatsapp_session_qr", {
        p_user_id: userId,
        p_key: integrationsKey,
      });
      assert.equal(gone.data, null);

      // status + heartbeat
      await store.updateSession(userId, {
        status: "connected",
        connectedAt: new Date(),
        lastError: null,
      });
      await store.heartbeat([userId]);
      const row = await admin
        .from("whatsapp_sessions")
        .select("status, connected_at, bridge_heartbeat_at")
        .eq("user_id", userId)
        .single();
      assert.equal(row.data?.status, "connected");
      assert.ok(row.data?.connected_at);
      assert.ok(row.data?.bridge_heartbeat_at);

      // groups: new ones start OFF; an upsert never overwrites the owner's choice
      await store.upsertGroups(userId, [
        { jid: "111@g.us", name: "CS301" },
        { jid: "222@g.us", name: "Family" },
      ]);
      assert.deepEqual([...(await store.listActiveGroups(userId))], []);
      const switched = await admin
        .from("monitored_groups")
        .update({ is_active: true })
        .eq("user_id", userId)
        .eq("group_jid", "111@g.us");
      assert.ifError(switched.error);
      await store.upsertGroups(userId, [{ jid: "111@g.us", name: "CS301 Renamed" }]);
      assert.deepEqual([...(await store.listActiveGroups(userId))], ["111@g.us"]);
      const renamed = await admin
        .from("monitored_groups")
        .select("group_name, is_active, activated_at")
        .eq("user_id", userId)
        .eq("group_jid", "111@g.us")
        .single();
      assert.equal(renamed.data?.group_name, "CS301 Renamed");
      assert.equal(renamed.data?.is_active, true);
      assert.ok(renamed.data?.activated_at, "activation was stamped when switched on");

      // ingestion: active group only, idempotent, text enqueues a job, files do not
      const mkRow = (id: string, jid: string, text: string, media: "none" | "pdf" = "none") => ({
        groupJid: jid,
        whatsappMsgId: id,
        fingerprint: randomUUID().replace(/-/g, "").padEnd(64, "0"),
        senderName: "Prof",
        sentAt: new Date().toISOString(),
        rawText: text,
        mediaType: media,
        fileSha256: null,
      });
      const first = await store.ingestMessages(userId, [
        mkRow("M1", "111@g.us", "Assignment 3 due Friday"),
        mkRow("M2", "222@g.us", "Dinner at 8"), // group is OFF
        mkRow("M3", "111@g.us", "Notes attached", "pdf"),
      ]);
      assert.deepEqual(first.map((r) => r.whatsappMsgId).sort(), ["M1", "M3"]);
      const replay = await store.ingestMessages(userId, [
        { ...mkRow("M1", "111@g.us", "Assignment 3 due Friday"), fingerprint: "f".repeat(64) },
      ]);
      assert.deepEqual(replay, [], "the same WhatsApp message id never creates a second row");

      const jobs = await admin
        .from("jobs")
        .select("payload")
        .eq("user_id", userId)
        .eq("kind", "whatsapp.extract");
      assert.equal(jobs.data?.length, 1, "one job for the text message; none for the file yet");
      const textMsg = first.find((r) => r.whatsappMsgId === "M1")!;
      assert.deepEqual(jobs.data?.[0]?.payload, { rawMessageId: textMsg.messageId });

      // files: dedupe by hash, real Storage object under the owner's folder
      const fileMsg = first.find((r) => r.whatsappMsgId === "M3")!;
      const sha = "ab".repeat(32);
      assert.equal(await store.findDocumentByHash(userId, sha), null);
      const documentId = randomUUID();
      const path = `${userId}/${documentId}/notes.pdf`;
      await store.uploadDocumentObject(path, Buffer.from("%PDF-1.7 test"), "application/pdf");
      assert.equal(
        await store.insertDocument(userId, {
          documentId,
          name: "notes.pdf",
          storagePath: path,
          mimeType: "application/pdf",
          sizeBytes: 13,
          fileSha256: sha,
          sourceMessageId: fileMsg.messageId,
        }),
        "inserted",
      );
      assert.equal(await store.findDocumentByHash(userId, sha), documentId);
      assert.equal(
        await store.insertDocument(userId, {
          documentId: randomUUID(),
          name: "again.pdf",
          storagePath: `${userId}/${randomUUID()}/again.pdf`,
          mimeType: "application/pdf",
          sizeBytes: 13,
          fileSha256: sha,
          sourceMessageId: fileMsg.messageId,
        }),
        "duplicate",
        "the per-user unique hash rejects a second copy",
      );
      assert.equal(await store.enqueueExtraction(userId, fileMsg.messageId), true);
      assert.equal(await store.enqueueExtraction(userId, fileMsg.messageId), false, "idempotent");
      await store.setMessageStatus(userId, textMsg.messageId, "failed", "The file could not be saved.");
      const settled = await admin
        .from("raw_messages")
        .select("status, error")
        .eq("id", textMsg.messageId)
        .single();
      assert.deepEqual(settled.data, { status: "failed", error: "The file could not be saved." });
      await store.removeDocumentObject(path);

      // pairing code (mobile): the app stores the number encrypted, the bridge
      // reads it, publishes the code, and forgets both when the attempt ends
      assert.equal(mine?.linkMethod, "qr", "the web flow is the default");
      await admin.from("whatsapp_sessions").update({ link_method: "pairing_code" }).eq("user_id", userId);
      assert.equal(
        (await store.listSessions()).find((s) => s.userId === userId)?.linkMethod,
        "pairing_code",
      );
      const stored = await admin.rpc("set_whatsapp_pairing_phone", {
        p_user_id: userId,
        p_phone: "919876543210",
        p_key: integrationsKey,
      });
      assert.ifError(stored.error);
      assert.equal(await store.getPairingPhone(userId), "919876543210");
      await store.setPairingCode(userId, "ABCD1234", 120);
      const code = await admin.rpc("get_whatsapp_pairing_code", {
        p_user_id: userId,
        p_key: integrationsKey,
      });
      assert.equal(code.data, "ABCD1234");
      await store.clearPairing(userId);
      assert.equal(await store.getPairingPhone(userId), null);
      const codeGone = await admin.rpc("get_whatsapp_pairing_code", {
        p_user_id: userId,
        p_key: integrationsKey,
      });
      assert.equal(codeGone.data, null);

      // retention: the purge RPC runs (nothing here is 30 days old, so the
      // throwaway rows survive until the user is deleted)
      assert.equal(typeof (await store.purgeExpiredMessages()), "number");
      const stillThere = await admin.from("raw_messages").select("id").eq("user_id", userId);
      assert.ok((stillThere.data?.length ?? 0) >= 2, "fresh messages are not purged");

      // logout forgets every secret
      await store.clearSession(userId);
      assert.equal(await store.getCreds(userId), null);
      assert.deepEqual(await store.getKeys(userId, "session", ["x"]), {});
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });
});
