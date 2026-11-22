import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { readBearerToken } from "../../lib/auth/bearer";
import { PHONE_REJECTION_COPY, sanitizePhone } from "../../lib/data/groupSyncValues";

/**
 * The mobile app's channel: Bearer-authenticated routes under
 * /api/integrations/whatsapp-groups. Real HTTP against the production server,
 * with a REAL Supabase access token for QA1, seeded rows (the bridge is not
 * running in QA), and direct database assertions. The pairing code in the
 * "code_ready" spec is a placeholder written through the real RPC; it is not a
 * WhatsApp code. Needs UNIPILOT_WHATSAPP_BRIDGE=1 on the server under test.
 */

const ENABLED = process.env.UNIPILOT_WHATSAPP_BRIDGE === "1";
const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
const API = "/api/integrations/whatsapp-groups";

test.describe("bearer + phone helpers (pure)", () => {
  const jwt = "aaaa.bbbb.cccc";

  test("accepts only a well-formed Bearer JWT", () => {
    expect(readBearerToken(`Bearer ${jwt}`)).toBe(jwt);
    expect(readBearerToken(`bearer ${jwt}`)).toBe(jwt);
    expect(readBearerToken(`  Bearer ${jwt}  `)).toBe(jwt);
    for (const bad of [
      null,
      undefined,
      "",
      "Bearer",
      "Bearer ",
      jwt,
      `Basic ${jwt}`,
      "Bearer not-a-jwt",
      "Bearer a.b",
      `Bearer ${jwt} extra`,
      `Bearer ${"a".repeat(5000)}.b.c`,
      "Bearer a.b.c\r\nX-Injected: 1",
    ]) {
      expect(readBearerToken(bad as string | null), String(bad).slice(0, 30)).toBeNull();
    }
  });

  test("phone numbers become digits-only E.164 or are refused with plain copy", () => {
    for (const input of ["+91 98765 43210", "00919876543210", "(91) 98765-43210", "919876543210"]) {
      expect(sanitizePhone(input)).toEqual({ ok: true, digits: "919876543210" });
    }
    expect(sanitizePhone("09876543210")).toEqual({ ok: false, reason: "country_code" });
    expect(sanitizePhone("91 98x76")).toEqual({ ok: false, reason: "characters" });
    expect(sanitizePhone("12345")).toEqual({ ok: false, reason: "length" });
    expect(sanitizePhone("")).toEqual({ ok: false, reason: "empty" });
    for (const copy of Object.values(PHONE_REJECTION_COPY)) {
      expect(copy.replace("919876543210", "")).not.toMatch(/\d{6,}/);
    }
  });
});

test.describe("whatsapp-groups API (flag on)", () => {
  test.skip(!ENABLED, "needs UNIPILOT_WHATSAPP_BRIDGE=1 on the server under test.");
  // One QA1 session row is shared by every test: no parallel workers.
  test.describe.configure({ mode: "serial" });

  let service: SupabaseClient;
  let qa1Id = "";
  let token = "";
  const integrationsKey = process.env.UNIPILOT_INTEGRATIONS_KEY ?? "";
  const auth = () => ({ Authorization: `Bearer ${token}` });

  test.beforeAll(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    const password = process.env.UNIPILOT_QA_PASSWORD ?? "";
    if (!LOCAL_TARGET.test(url)) throw new Error("Refusing a non-local Supabase URL.");
    if (!anonKey || !serviceKey || !password || !integrationsKey) {
      throw new Error("Missing QA environment (see QA_SESSION.md).");
    }
    service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const signedIn = await anon.auth.signInWithPassword({
      email: "qa.unipilot@unipilot.test",
      password,
    });
    if (signedIn.error || !signedIn.data.session) throw new Error("QA1 sign-in failed.");
    qa1Id = signedIn.data.user!.id;
    token = signedIn.data.session.access_token;
  });

  async function reset() {
    await service.rpc("clear_whatsapp_session", { p_user_id: qa1Id });
    await service.from("monitored_groups").delete().eq("user_id", qa1Id);
    await service.from("whatsapp_sessions").delete().eq("user_id", qa1Id);
    await service.from("integration_candidates").delete().eq("user_id", qa1Id).eq("origin", "live_group");
    await service.from("tasks").delete().eq("user_id", qa1Id).eq("source", "whatsapp_group");
  }
  test.beforeEach(reset);
  test.afterEach(reset);

  async function sessionRow() {
    const r = await service
      .from("whatsapp_sessions")
      .select("status, desired_state, link_method, last_error")
      .eq("user_id", qa1Id)
      .maybeSingle();
    return r.data;
  }

  test("rejects a missing, malformed or forged token without detail", async ({ request }) => {
    const badHeaders: Record<string, string>[] = [
      {},
      { Authorization: "Bearer" },
      { Authorization: "Bearer not-a-jwt" },
      { Authorization: `Basic ${token}` },
      { Authorization: "Bearer aaaaaaaa.bbbbbbbb.cccccccc" },
      { Authorization: `Bearer ${token.slice(0, -4)}AAAA` },
    ];
    for (const headers of badHeaders) {
      const res = await request.get(API, { headers });
      expect(res.status(), JSON.stringify(headers).slice(0, 40)).toBe(401);
      expect(res.headers()["www-authenticate"]).toContain("Bearer");
      expect(await res.json()).toEqual({ error: "Sign in again." });
    }
    for (const path of ["/link", "/disconnect"]) {
      const res = await request.post(`${API}${path}`, { data: { phone: "919876543210" } });
      expect(res.status(), path).toBe(401);
    }
    expect(await sessionRow()).toBeNull();
  });

  test("a student who has not finished onboarding is refused (403)", async ({ request }) => {
    const created = await service.auth.admin.createUser({
      email: `api-gate-${randomUUID()}@check.invalid`,
      password: randomUUID(),
      email_confirm: true,
    });
    expect(created.error).toBeNull();
    const userId = created.data.user!.id;
    try {
      const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      // A throwaway password sign-in: the account exists only for this test.
      const pw = randomUUID();
      await service.auth.admin.updateUserById(userId, { password: pw });
      const signed = await anon.auth.signInWithPassword({ email: created.data.user!.email!, password: pw });
      expect(signed.error).toBeNull();
      const res = await request.get(API, {
        headers: { Authorization: `Bearer ${signed.data.session!.access_token}` },
      });
      expect(res.status()).toBe(403);
      expect((await res.json()).error).toMatch(/finish setting up/i);
    } finally {
      await service.auth.admin.deleteUser(userId);
    }
  });

  test("GET returns the caller's own state, never caches, and never returns the QR", async ({ request }) => {
    await service.from("whatsapp_sessions").insert({
      user_id: qa1Id,
      status: "qr_ready",
      desired_state: "connected",
      bridge_heartbeat_at: new Date().toISOString(),
      requested_at: new Date(Date.now() - 30_000).toISOString(),
    });
    await service.rpc("set_whatsapp_session_qr", {
      p_user_id: qa1Id,
      p_qr: "unipilot-qa-placeholder-not-a-login-qr",
      p_key: integrationsKey,
      p_ttl_seconds: 60,
    });
    const res = await request.get(API, { headers: auth() });
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ enabled: true, state: "qr_ready", qr: null, pairing: null });
    expect(JSON.stringify(body)).not.toContain("placeholder");
  });

  test("link: a bad number is a 400 with plain copy and stores nothing", async ({ request }) => {
    for (const phone of ["", "abc", "09876543210", "12345", "91 98x76 54321", null, 919876543210]) {
      const res = await request.post(`${API}/link`, { headers: auth(), data: { phone } });
      expect(res.status(), String(phone)).toBe(400);
      const body = await res.json();
      expect(body.field).toBe("phone");
      expect(body.error.length).toBeGreaterThan(10);
      expect(JSON.stringify(body).replace("919876543210", "")).not.toMatch(/\d{5,}/); // only the example number may appear, never the submitted one
    }
    const res = await request.post(`${API}/link`, {
      headers: { ...auth(), "content-type": "application/json" },
      data: "not json at all",
    });
    expect(res.status()).toBe(400);
    expect(await sessionRow()).toBeNull();
    const stored = await service.rpc("get_whatsapp_pairing_phone", { p_user_id: qa1Id, p_key: integrationsKey });
    expect(stored.data).toBeNull();
  });

  test("link: the number is stored digits-only and encrypted, and the request is queued", async ({ request }) => {
    const res = await request.post(`${API}/link`, {
      headers: auth(),
      data: { phone: "+91 98765-43210" },
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(JSON.stringify(await res.json().catch(() => ({})))).not.toContain("9876543210");

    expect(await sessionRow()).toMatchObject({
      desired_state: "connected",
      link_method: "pairing_code",
      last_error: null,
    });
    const phone = await service.rpc("get_whatsapp_pairing_phone", { p_user_id: qa1Id, p_key: integrationsKey });
    expect(phone.data).toBe("919876543210");
    const direct = await service.from("whatsapp_session_secrets").select("phone_enc").eq("user_id", qa1Id);
    expect(direct.error, "the secrets table is not directly readable, even by the service role").not.toBeNull();
  });

  test("link: a second request while one is in flight is a 429, and a linked account a 409", async ({ request }) => {
    const first = await request.post(`${API}/link`, { headers: auth(), data: { phone: "919876543210" } });
    expect(first.status()).toBe(200);
    const second = await request.post(`${API}/link`, { headers: auth(), data: { phone: "919876543210" } });
    expect(second.status()).toBe(429);

    await service
      .from("whatsapp_sessions")
      .update({ status: "connected", desired_state: "connected" })
      .eq("user_id", qa1Id);
    const linked = await request.post(`${API}/link`, { headers: auth(), data: { phone: "919876543210" } });
    expect(linked.status()).toBe(409);
  });

  test("GET returns the pairing code with its expiry only while code_ready, then nothing", async ({ request }) => {
    await service.from("whatsapp_sessions").insert({
      user_id: qa1Id,
      status: "code_ready",
      desired_state: "connected",
      link_method: "pairing_code",
      bridge_heartbeat_at: new Date().toISOString(),
      requested_at: new Date(Date.now() - 20_000).toISOString(),
    });
    await service.rpc("set_whatsapp_pairing_code", {
      p_user_id: qa1Id,
      p_code: "abcd-1234",
      p_key: integrationsKey,
      p_ttl_seconds: 120,
    });

    const res = await request.get(API, { headers: auth() });
    const body = await res.json();
    expect(body.state).toBe("code_ready");
    expect(body.pairing.code).toBe("ABCD1234");
    const msLeft = Date.parse(body.pairing.expiresAt) - Date.now();
    expect(msLeft).toBeGreaterThan(90_000);
    expect(msLeft).toBeLessThanOrEqual(121_000);

    // Expired: the code reads as nothing (and the app shows "get a new code").
    // The secrets table has no API-role grants, so expiry is real: re-issue with
    // the RPC's minimum TTL (30 s) and wait it out.
    test.setTimeout(90_000);
    await service.rpc("set_whatsapp_pairing_code", {
      p_user_id: qa1Id,
      p_code: "abcd-1234",
      p_key: integrationsKey,
      p_ttl_seconds: 30,
    });
    await new Promise((resolve) => setTimeout(resolve, 31_000));
    // The wait outlived the seeded heartbeat; keep the bridge looking alive.
    await service
      .from("whatsapp_sessions")
      .update({ bridge_heartbeat_at: new Date().toISOString() })
      .eq("user_id", qa1Id);
    const expired = await (await request.get(API, { headers: auth() })).json();
    expect(expired.state, JSON.stringify(expired) + JSON.stringify(await sessionRow())).toBe("code_ready");
    expect(expired.pairing).toBeNull();
  });

  test("GET never mixes in groups or suggestions that belong to someone else", async ({ request }) => {
    const other = await service.auth.admin.createUser({
      email: `api-iso-${randomUUID()}@check.invalid`,
      email_confirm: true,
    });
    const otherId = other.data.user!.id;
    try {
      await service.from("monitored_groups").insert({ user_id: otherId, group_jid: "9@g.us", group_name: "Not yours", is_active: true });
      await service.from("integration_candidates").insert({
        user_id: otherId,
        run_id: null,
        fingerprint: `wg-api-${randomUUID()}`,
        title: "Not yours",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
        message_sender: "x",
        message_text: "y",
        origin: "live_group",
        kind: "task",
        task_type: "assignment",
      });
      const body = await (await request.get(API, { headers: auth() })).json();
      expect(body.groups).toEqual([]);
      expect(body.review).toEqual([]);
    } finally {
      await service.auth.admin.deleteUser(otherId);
    }
  });

  test("disconnect with no bridge forgets everything, including the number", async ({ request }) => {
    await request.post(`${API}/link`, { headers: auth(), data: { phone: "919876543210" } });
    await service
      .from("whatsapp_sessions")
      .update({ bridge_heartbeat_at: new Date(Date.now() - 3_600_000).toISOString() })
      .eq("user_id", qa1Id);

    const res = await request.post(`${API}/disconnect`, { headers: auth() });
    expect(res.status()).toBe(200);
    expect((await res.json()).notice).toMatch(/Linked devices/);
    expect(await sessionRow()).toMatchObject({ status: "disconnected", desired_state: "disconnected" });
    const phone = await service.rpc("get_whatsapp_pairing_phone", { p_user_id: qa1Id, p_key: integrationsKey });
    expect(phone.data).toBeNull();
  });

  test("suggestions: confirm adds a task, reject is final, foreign and malformed ids are 404", async ({ request }) => {
    const seed = async (over: Record<string, unknown> = {}, userId = qa1Id) => {
      const { data, error } = await service
        .from("integration_candidates")
        .insert({
          user_id: userId,
          run_id: null,
          fingerprint: `wg-api-${randomUUID()}`,
          title: "API suggestion",
          start_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
          all_day: true,
          message_sender: "Prof",
          message_text: "due soon",
          origin: "live_group",
          kind: "task",
          task_type: "assignment",
          confidence: 0.7,
          ...over,
        })
        .select("id, fingerprint")
        .single();
      expect(error).toBeNull();
      return data!;
    };

    const mine = await seed();
    const confirmed = await request.post(`${API}/candidates/${mine.id}/confirm`, { headers: auth() });
    expect(confirmed.status()).toBe(200);
    const task = await service.from("tasks").select("title, source, source_ref").eq("user_id", qa1Id).eq("source", "whatsapp_group").single();
    expect(task.data).toMatchObject({ title: "API suggestion", source_ref: mine.fingerprint });
    const again = await request.post(`${API}/candidates/${mine.id}/confirm`, { headers: auth() });
    expect(again.status(), "already decided").toBe(404);

    const toReject = await seed({ title: "Reject me" });
    expect((await request.post(`${API}/candidates/${toReject.id}/reject`, { headers: auth() })).status()).toBe(200);
    const after = await service.from("integration_candidates").select("status").eq("id", toReject.id).single();
    expect(after.data?.status).toBe("rejected");
    expect((await request.post(`${API}/candidates/${toReject.id}/confirm`, { headers: auth() })).status()).toBe(404);

    const stranger = await service.auth.admin.createUser({ email: `api-foreign-${randomUUID()}@check.invalid`, email_confirm: true });
    try {
      const foreign = await seed({ title: "Foreign" }, stranger.data.user!.id);
      for (const decision of ["confirm", "reject"]) {
        const res = await request.post(`${API}/candidates/${foreign.id}/${decision}`, { headers: auth() });
        expect(res.status(), decision).toBe(404);
      }
      const untouched = await service.from("integration_candidates").select("status").eq("id", foreign.id).single();
      expect(untouched.data?.status).toBe("pending");
    } finally {
      await service.auth.admin.deleteUser(stranger.data.user!.id);
    }

    for (const path of ["not-a-uuid/confirm", `${randomUUID()}/shrug`, `${randomUUID()}/confirm`]) {
      const res = await request.post(`${API}/candidates/${path}`, { headers: auth() });
      expect(res.status(), path).toBe(404);
    }
  });
});
