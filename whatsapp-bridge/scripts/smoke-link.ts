/**
 * Link smoke test (local stack only). Needs the bridge RUNNING in another
 * terminal (`npm run bridge`). It:
 *
 *   1. creates a throwaway auth user and a `whatsapp_sessions` row asking for
 *      a connection (what the web app's "Connect" action will do);
 *   2. waits for the bridge to publish a QR (`status = qr_ready`);
 *   3. proves the QR is stored ENCRYPTED and readable only through the RPC
 *      (prints its length, never the payload: a QR is a login credential);
 *   4. asks to disconnect and waits for the bridge to settle the row;
 *   5. deletes the user (cascading every row).
 *
 * It scans nothing and links nothing: no phone is involved. Refuses any
 * non-local Supabase URL.
 *
 *   npm run smoke -w whatsapp-bridge     (with backend/.env loaded)
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const integrationsKey = process.env.UNIPILOT_INTEGRATIONS_KEY ?? "";

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  console.error("smoke-link: refusing a non-local SUPABASE_URL.");
  process.exit(1);
}
if (!serviceKey || !integrationsKey) {
  console.error("smoke-link: needs SUPABASE_SERVICE_ROLE_KEY and UNIPILOT_INTEGRATIONS_KEY.");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(label: string, read: () => Promise<T | null>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await sleep(1000);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

async function main(): Promise<void> {
  const created = await admin.auth.admin.createUser({
    email: `bridge-smoke-${randomUUID()}@check.invalid`,
    email_confirm: true,
  });
  if (created.error || !created.data.user) throw new Error("could not create the throwaway user");
  const userId = created.data.user.id;
  console.log(`user ${userId.slice(0, 8)} created`);

  try {
    const insert = await admin
      .from("whatsapp_sessions")
      .insert({ user_id: userId, desired_state: "connected", requested_at: new Date().toISOString() });
    if (insert.error) throw new Error("could not request a connection");
    console.log("requested connection (desired_state = connected)");

    const row = await waitFor(
      "status = qr_ready (is the bridge running?)",
      async () => {
        const r = await admin
          .from("whatsapp_sessions")
          .select("status, bridge_heartbeat_at, last_error")
          .eq("user_id", userId)
          .single();
        return r.data?.status === "qr_ready" ? r.data : null;
      },
      60_000,
    );
    console.log(`status = ${row.status}; heartbeat ${row.bridge_heartbeat_at ? "present" : "missing"}`);

    // Even the service role has no direct table access to the secrets: the
    // encrypted QR is reachable only through the RPC, with the key.
    const direct = await admin.from("whatsapp_session_secrets").select("qr_enc").eq("user_id", userId);
    console.log(`service role can read the secrets table directly: ${direct.error ? "no (denied)" : "YES"}`);
    if (!direct.error) throw new Error("the secrets table is directly readable");

    const qr = await admin.rpc("get_whatsapp_session_qr", { p_user_id: userId, p_key: integrationsKey });
    const plain = typeof qr.data === "string" ? qr.data : "";
    console.log(`QR readable through the RPC with the key: ${plain.length > 20 ? "yes" : "NO"} (length ${plain.length})`);
    if (plain.length <= 20) throw new Error("no QR payload came back");

    const wrong = await admin.rpc("get_whatsapp_session_qr", { p_user_id: userId, p_key: "not-the-key" });
    console.log(`QR readable with a wrong key: ${wrong.error ? "no (raises)" : "YES"}`);
    if (!wrong.error) throw new Error("a wrong key read the QR");

    await admin
      .from("whatsapp_sessions")
      .update({ desired_state: "disconnected" })
      .eq("user_id", userId);
    console.log("requested disconnect (desired_state = disconnected)");

    await waitFor(
      "status = disconnected and the QR/credentials cleared",
      async () => {
        const r = await admin.from("whatsapp_sessions").select("status").eq("user_id", userId).single();
        const q = await admin.rpc("get_whatsapp_session_qr", { p_user_id: userId, p_key: integrationsKey });
        const c = await admin.rpc("get_whatsapp_creds", { p_user_id: userId, p_key: integrationsKey });
        if (q.error || c.error) throw new Error("could not read the secrets through the RPC");
        return r.data?.status === "disconnected" && q.data === null && c.data === null ? true : null;
      },
      30_000,
    );
    console.log("disconnected; QR and credentials cleared (checked through the RPC)");
    console.log("SMOKE OK");
  } finally {
    await admin.auth.admin.deleteUser(userId);
    console.log("throwaway user deleted");
  }
}

main().catch((error: unknown) => {
  console.error(`SMOKE FAILED: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
});
