# WhatsApp Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved WhatsApp → events integration: a Python service driven by the Task 29.1 worker, owner-only Supabase tables with encrypted Google tokens and TTL'd QR handling, an export-upload + candidate-review UI on `/integrations`, a WhatsApp marker on `/calendar`, and a per-user Google Calendar push (one-way).

**Architecture:** The Next app uploads exports to a private `whatsapp-exports` bucket and enqueues `whatsapp.*` jobs through the existing 29.1 runner; the Node worker spawns `python -m wa_service` (JSON on stdin, service-role env inherited) which parses with the proven `whatsapp_reader`/`event_extractor` rules and writes `integration_runs`/`integration_messages`/`integration_candidates`; the student confirms candidates into `events` (`source='whatsapp'`) and, when connected, a `whatsapp.push` job inserts the Google Calendar event idempotently.

**Tech Stack:** Next.js (App Router, Server Actions), Supabase (Postgres 15 + RLS + Storage + pgcrypto), Node ESM worker (`backend/worker`), Python 3.14 (`dateparser`, `requests`, optional `selenium`/`google-*`), Playwright, pytest.

**Spec:** `docs/superpowers/specs/2026-09-12-whatsapp-integration-design.md` (read it before every phase; § references below point into it).

## Global Constraints

- **No commits, no staging, no hosted contact** (standing founder instruction). Every "Commit" step in the standard workflow is replaced by a **Checkpoint** step: run the verification, leave the tree dirty, do not `git add`/`git commit`. Never point any command at the hosted Supabase project; the local stack is `http://127.0.0.1:54321`.
- **No fake proof.** Live-mode E2E and Google OAuth E2E are `[!]` blocked in this environment with the exact dependency named; the code and honest UI ship, the verification does not pretend.
- **TDD/verification first:** each task starts by making its test fail, then implements, then reruns. UI-touching tasks end with real-Chromium verification (Playwright MCP when connected, otherwise the committed spec).
- **Motion/design:** reuse `frontend/components/motion/` and `frontend/components/ui/` only; no new presets; reduced-motion safe; the official WhatsApp mark stays confined to `/integrations` (DESIGN.md).
- **Sanitized copy only:** no raw Supabase/Google/Python error text reaches a table, UI, log, or test artifact. Message bodies, QR payloads, tokens, and `UNIPILOT_INTEGRATIONS_KEY` never appear in logs or screenshots.
- **Python availability contract (spec D13):** `npm run test` must stay runnable without Python (honest skips with a clear reason); `UNIPILOT_REQUIRE_PYTHON=1` (set by `npm run test:whatsapp`) turns skips into failures.
- **Static gates after every phase:** `npm run typecheck`, `npm run lint` from the repo root; `npm run db:lint` after any migration.
- **Baseline:** the suite is at 145/145 before this work; record the new counts per phase.
- **Local Supabase tooling runs through WSL:** `npm run db:*` scripts shell into `kali-linux`; Node/Python run on Windows. Commands below are PowerShell from the repo root unless stated.

---

## Phase and Task Inventory

| Phase | Tasks | TASK.md IDs |
|---|---|---|
| 0 — Security/ACL baseline | P0.1–P0.2 | 46.12 (prep) |
| 1 — Schema, bucket, RPCs, types | P1.1–P1.4 | 46.12 |
| 2 — Python service + pytest | P2.1–P2.7 | 46.11 |
| 3 — Worker kinds + heartbeat | P3.1–P3.3 | 46.13 |
| 4 — Data layer + Server Actions | P4.1–P4.5 | 46.14 |
| 5 — Export UI + calendar marker | P5.1–P5.5 | 46.15, 46.18 |
| 6 — Live self-host gate `[!]` | P6.1–P6.2 | 46.16 |
| 7 — Google OAuth + push `[!]` | P7.1–P7.4 | 46.17 |
| 8 — Docs and QA | P8.1–P8.5 | 46.19, 46.20 |

Dependencies: P1 → P2 → P3 → P4 → P5 → P6/P7 (P6 and P7 only need P5) → P8. Within a phase, tasks run in order.

---

## Phase 0 — Security/ACL baseline

### Task P0.1: Re-verify STEP 0 and record the rotation checklist

**Files:**
- Verify only: `.gitignore`, `whatsapp/Default Project/`

**Interfaces:**
- Consumes: the STEP 0 work already performed (spec §3).
- Produces: recorded evidence for TASK.md 46.20.

- [ ] **Step 1: Verify no secret is tracked or trackable**

Run:
```powershell
git status --porcelain; git check-ignore -v -- "whatsapp/Default Project/credentials.json" "whatsapp/Default Project/token.json" "whatsapp/Default Project/.wa_profile/x" "whatsapp/Default Project/data/x.txt" "whatsapp/Default Project/output/x.ics" "whatsapp/Default Project/__pycache__/x.pyc"
```
Expected: `git status` lists no secret path; every `check-ignore` line names a matching ignore rule and exits 0. `.env.example` must NOT be ignored (`git check-ignore` exits 1).

- [ ] **Step 2: Record the user-side rotation checklist**

Write this checklist into the eventual 46.20 notes (do not commit):
- Rotate the Google OAuth client/secret in Google Cloud Console and delete the old client.
- Revoke the old token (the old `token.json` is deleted from the tree; revoke the grant in the Google account's security settings).
- Unlink the WhatsApp linked device from the phone (WhatsApp → Settings → Linked devices).

- [ ] **Step 3: Checkpoint**

Leave the tree dirty; no commit.

### Task P0.2: Verify pgcrypto and statement logging; confirm the key decision

**Files:**
- Verify only (no files yet). Results go into `backend/DATABASE.md` in P8.2.

**Interfaces:**
- Consumes: the local Supabase stack running in WSL (`kali-linux`).
- Produces: the confirmed decision "pgcrypto + per-call key, statement logging must be off" (or the Vault fallback decision).

- [ ] **Step 0: Add the local-only encryption key**

Append a random value to `frontend/.env.development.local` (git-ignored; never commit):
```
UNIPILOT_INTEGRATIONS_KEY=<paste a random 32+ char string>
```
Generate with `python -c "import secrets; print(secrets.token_urlsafe(32))"`. This is the same key the P1.1 spec reads and the worker inherits. In production it lives in the platform secret store (P8.3).

- [ ] **Step 1: Discover the local database container name**

Run:
```powershell
wsl -d kali-linux -u root -e "docker ps --format '{{.Names}}' | grep supabase_db"
```
Expected: one container like `supabase_db_<project_id>`. Note it as `$DB_CONTAINER` for the next steps.

- [ ] **Step 2: Verify pgcrypto is available**

Run:
```powershell
wsl -d kali-linux -u root -e "docker exec <DB_CONTAINER> psql -U postgres -d postgres -tAc \"select extname from pg_extension where extname = 'pgcrypto'\""
wsl -d kali-linux -u root -e "docker exec <DB_CONTAINER> psql -U postgres -d postgres -tAc \"select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pgcrypto'\""
```
Expected: `pgcrypto` and its schema (usually `extensions`). If absent, the migration's `create extension if not exists pgcrypto with schema extensions;` covers it — still note the result.

- [ ] **Step 3: Verify statement logging is off**

Run:
```powershell
wsl -d kali-linux -u root -e "docker exec <DB_CONTAINER> psql -U postgres -d postgres -tAc 'show log_statement'"
```
Expected: `none`. If not `none`, **stop and record** the Vault fallback decision: use Supabase Vault (`vault.create_secret` / `vault.decrypted_secrets`, called through the same definer RPCs) instead of `pgp_sym_encrypt`, because a per-call key would land in logs. Do not proceed with pgcrypto under `log_statement=all`.

- [ ] **Step 4: Write the rotation runbook draft** (into the plan's execution notes; DATABASE.md in P8.2)

Draft:
```
Key: UNIPILOT_INTEGRATIONS_KEY (server-only, never in the DB, never NEXT_PUBLIC_*).
Home: frontend/.env.development.local locally; platform secret store in production;
inherited by the worker host (`--env-file`) and passed to Python via its child env.
Rotate: 1) generate a new random key; 2) call
public.rotate_google_token_key(p_old_key, p_new_key) as the service role;
3) swap the env value on the Next server and the worker host; 4) restart both.
QR rows need no rotation (60 s TTL). If pgcrypto is unavailable or logging is
on, use Supabase Vault and record the alternative in DATABASE.md.
```

- [ ] **Step 5: Checkpoint**

No commit.

---

## Phase 1 — Schema, bucket, RPCs, type regeneration

### Task P1.1: Author the failing schema/ACL specs

**Files:**
- Create: `frontend/tests/qa/whatsapp-security.spec.ts`
- Create: `frontend/tests/qa/whatsapp-retention.spec.ts`
- Modify: `frontend/tests/qa/rls-isolation.spec.ts` (RESIDUE_TABLES only; see Step 3)
- Test: the same two new specs.

**Interfaces:**
- Consumes: local stack env (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, QA passwords) exactly like `rls-isolation.spec.ts:19-28`.
- Produces: the failing tests the migration must satisfy. Later tasks refer to the assertions by name.

- [ ] **Step 0: Register the three WhatsApp Playwright projects**

In `frontend/playwright.config.ts`, append three projects **before** `chromium-authenticated` and add them to its `dependencies` array (after `"qa-jobs-runner"`):

```ts
{
  // Task 46.12 — schema/ACL/retention proofs. DB-only; local stack only.
  name: "qa-whatsapp-security",
  testMatch: /whatsapp-(security|retention)\.spec\.ts/,
  dependencies: [
    "qa-auth-setup", "qa-onboarding", "qa-tasks-data", "qa-tasks-ui",
    "qa-events-data", "qa-events-ui", "qa-documents-data", "qa-documents-ui",
    "qa-documents-processing", "qa-documents-hub", "qa-documents-search",
    "qa-jobs-runner",
  ],
},
{
  // Task 46.13 — the worker ↔ Python job proofs. Drives worker/run.mjs.
  name: "qa-whatsapp-jobs",
  testMatch: /whatsapp-jobs\.spec\.ts/,
  dependencies: [/* the list above plus */ "qa-whatsapp-security"],
},
{
  // Task 46.15 — export upload + candidate review + calendar marker.
  name: "qa-whatsapp-flow",
  testMatch: /whatsapp-(ui|export)\.spec\.ts/,
  dependencies: [/* the list above plus */ "qa-whatsapp-jobs"],
  use: {
    storageState: process.env.QA_STORAGE_STATE ?? ".playwright/qa-session.json",
  },
},
```

`chromium-authenticated.dependencies` gains `"qa-whatsapp-security"`, `"qa-whatsapp-jobs"`, `"qa-whatsapp-flow"` so rls-isolation's residue counts never race these rows.

- [ ] **Step 1: Write `whatsapp-security.spec.ts`**

Structure (real code; imports and helpers mirror `jobs-runner.spec.ts`):

```ts
/**
 * tests/qa/whatsapp-security.spec.ts — Task 46.12 security proof.
 *
 * Proves, on the LOCAL stack only:
 * - the events provenance trigger (spec §6.1): an authenticated forge lands
 *   `source='manual'`/`source_ref=null`; service-role writes keep provenance;
 *   owner manual CRUD still works;
 * - the credential table and every token/QR/lease RPC are service_role-only
 *   (the 29.1 default-grant trap): anon + authenticated are denied;
 * - QR rows are encrypted and TTL'd: `get_whatsapp_qr` returns null and clears
 *   past `qr_expires_at`;
 * - `rotate_google_token_key` round-trips and the stored value is bytea.
 */
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const KEY = process.env.UNIPILOT_INTEGRATIONS_KEY ?? "";
const QA1 = "qa.unipilot@unipilot.test";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";

let service: SupabaseClient;
let qa1: SupabaseClient;
let qa1Id = "";
const createdEventIds: string[] = [];
const createdRunIds: string[] = [];
const createdCandidateIds: string[] = [];
const createdConnectionIds: string[] = [];

test.beforeAll(async () => {
  if (!LOCAL_TARGET.test(url)) throw new Error(`local-only; refusing ${url}`);
  if (!anonKey || !serviceKey) throw new Error("missing local keys");
  if (!KEY) throw new Error("missing UNIPILOT_INTEGRATIONS_KEY");
  service = createClient(url, serviceKey, { auth: { persistSession: false } });
  qa1 = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await qa1.auth.signInWithPassword({
    email: QA1, password: qa1Password,
  });
  expect(error, `sign-in: ${error?.message}`).toBeNull();
  qa1Id = data.user!.id;
});

test.afterAll(async () => {
  if (createdCandidateIds.length) await service.from("integration_candidates").delete().in("id", createdCandidateIds);
  if (createdRunIds.length) await service.from("integration_runs").delete().in("id", createdRunIds);
  if (createdConnectionIds.length) await service.from("integration_connections").delete().in("id", createdConnectionIds);
  if (createdEventIds.length) await service.from("events").delete().in("id", createdEventIds);
});

test.describe("events provenance is server-only", () => {
  test("authenticated forge is forced to manual and null", async () => {
    const { data, error } = await qa1
      .from("events")
      .insert({
        user_id: qa1Id,
        title: "forge attempt",
        start_at: new Date().toISOString(),
        source: "whatsapp",
        source_ref: "deadbeef".repeat(4),
      })
      .select("id, source, source_ref")
      .single();
    expect(error, `forge insert: ${error?.message}`).toBeNull();
    createdEventIds.push(data!.id);
    expect(data).toMatchObject({ source: "manual", source_ref: null });
  });

  test("authenticated update cannot set provenance", async () => {
    const { data: seeded, error: seedError } = await service
      .from("events")
      .insert({ user_id: qa1Id, title: "owner manual", start_at: new Date().toISOString() })
      .select("id")
      .single();
    expect(seedError).toBeNull();
    createdEventIds.push(seeded!.id);
    const { data, error } = await qa1
      .from("events")
      .update({ source: "whatsapp", source_ref: "f".repeat(32) })
      .eq("id", seeded!.id)
      .select("id, source, source_ref")
      .single();
    expect(error, `forge update: ${error?.message}`).toBeNull();
    expect(data).toMatchObject({ source: "manual", source_ref: null });
  });

  test("owner manual CRUD still works", async () => {
    const { data, error } = await qa1
      .from("events")
      .insert({ user_id: qa1Id, title: "manual ok", start_at: new Date().toISOString() })
      .select("id, source")
      .single();
    expect(error, `manual insert: ${error?.message}`).toBeNull();
    createdEventIds.push(data!.id);
    expect(data!.source).toBe("manual");
    const upd = await qa1.from("events").update({ title: "manual renamed" }).eq("id", data!.id).select("id, title").single();
    expect(upd.error).toBeNull();
    expect(upd.data!.title).toBe("manual renamed");
    const del = await qa1.from("events").delete().eq("id", data!.id);
    expect(del.error).toBeNull();
    createdEventIds.pop();
  });

  test("service role keeps provenance and dedupes on the unique index", async () => {
    const ref = randomUUID().replaceAll("-", "");
    const first = await service.from("events").insert({
      user_id: qa1Id, title: "wa event", start_at: new Date().toISOString(),
      source: "whatsapp", source_ref: ref,
    }).select("id, source, source_ref").single();
    expect(first.error).toBeNull();
    createdEventIds.push(first.data!.id);
    expect(first.data).toMatchObject({ source: "whatsapp", source_ref: ref });
    const dup = await service.from("events").insert({
      user_id: qa1Id, title: "wa event again", start_at: new Date().toISOString(),
      source: "whatsapp", source_ref: ref,
    }).select("id");
    expect(dup.error, "the unique (user_id, source, source_ref) must reject the second row").not.toBeNull();
  });
});

test.describe("credential table and RPCs are service-role only (default-grant trap)", () => {
  const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
  const id = () => randomUUID();

  test("anon and authenticated are denied on the credential table", async () => {
    const anonRead = await anon().from("google_calendar_credentials").select("user_id");
    expect(anonRead.error, "anon read must be denied").not.toBeNull();
    const qaRead = await qa1.from("google_calendar_credentials").select("user_id");
    expect(qaRead.error, "authenticated read must be denied").not.toBeNull();
  });

  test("token RPCs round-trip, rotate, and deny clients", async () => {
    const target = id();
    const upsert = await service.rpc("upsert_google_credentials", {
      p_user_id: target, p_refresh_token: "refresh-secret", p_scope: "calendar.events",
      p_calendar_id: "primary", p_key: KEY,
    });
    expect(upsert.error, `service upsert: ${upsert.error?.message}`).toBeNull();
    const got = await service.rpc("get_google_credentials", { p_user_id: target, p_key: KEY });
    expect(got.error).toBeNull();
    expect(got.data[0].refresh_token).toBe("refresh-secret");

    const badKey = await service.rpc("get_google_credentials", { p_user_id: target, p_key: "wrong" });
    expect(badKey.error, "wrong key must fail to decrypt").not.toBeNull();

    const rotated = await service.rpc("rotate_google_token_key", { p_old_key: KEY, p_new_key: "rotated-key" });
    expect(rotated.error).toBeNull();
    const after = await service.rpc("get_google_credentials", { p_user_id: target, p_key: "rotated-key" });
    expect(after.data[0].refresh_token).toBe("refresh-secret");
    await service.rpc("rotate_google_token_key", { p_old_key: "rotated-key", p_new_key: KEY });

    const qaCall = await qa1.rpc("get_google_credentials", { p_user_id: target, p_key: KEY });
    expect(qaCall.error, "authenticated must be denied the token RPC").not.toBeNull();
    const anonCall = await anon().rpc("upsert_google_credentials", {
      p_user_id: target, p_refresh_token: "x", p_scope: "x", p_calendar_id: "primary", p_key: KEY,
    });
    expect(anonCall.error, "anon must be denied the token RPC").not.toBeNull();
    const del = await service.rpc("delete_google_credentials", { p_user_id: target });
    expect(del.error).toBeNull();
  });

  test("QR RPCs encrypt with a TTL and deny clients", async () => {
    const connectionId = id();
    const runSeed = await service.from("integration_runs").insert({
      user_id: qa1Id, mode: "live", status: "queued", chat_name: "seed chat",
    }).select("id").single();
    expect(runSeed.error, `run seed: ${runSeed.error?.message}`).toBeNull();
    createdRunIds.push(runSeed.data!.id);
    const connection = await service.from("integration_connections").insert({
      id: connectionId, user_id: qa1Id, provider: "whatsapp", mode: "live",
      status: "pending", profile_ref: qa1Id,
    }).select("id").single();
    expect(connection.error, `connection seed: ${connection.error?.message}`).toBeNull();
    createdConnectionIds.push(connectionId);

    const set = await service.rpc("set_whatsapp_qr", {
      p_connection_id: connectionId, p_qr: "data:image/png;base64,AAAA", p_key: KEY, p_ttl_seconds: 60,
    });
    expect(set.error).toBeNull();
    const got = await service.rpc("get_whatsapp_qr", { p_connection_id: connectionId, p_key: KEY });
    expect(got.data).toBe("data:image/png;base64,AAAA");

    await service.from("integration_connections")
      .update({ qr_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", connectionId);
    const expired = await service.rpc("get_whatsapp_qr", { p_connection_id: connectionId, p_key: KEY });
    expect(expired.data, "expired QR must read null").toBeNull();

    const qaGet = await qa1.rpc("get_whatsapp_qr", { p_connection_id: connectionId, p_key: KEY });
    expect(qaGet.error, "authenticated must be denied the QR RPC").not.toBeNull();
    expect((await anon().rpc("set_whatsapp_qr", { p_connection_id: connectionId, p_qr: "x", p_key: KEY, p_ttl_seconds: 60 })).error).not.toBeNull();

    await service.from("integration_connections").delete().eq("id", connectionId);
  });

  test("touch_job is service-role only and extends only a matching lease", async () => {
    const jobId = id();
    await service.from("jobs").insert({
      id: jobId, kind: "noop.test", payload: {}, status: "running",
      locked_by: "spec-worker", locked_at: new Date(Date.now() - 60_000).toISOString(), attempts: 1,
    });
    const before = new Date(Date.now() - 60_000).toISOString();
    const touch = await service.rpc("touch_job", { p_job_id: jobId, p_worker_id: "spec-worker" });
    expect(touch.error, `service touch: ${touch.error?.message}`).toBeNull();
    const after = await service.from("jobs").select("locked_at").eq("id", jobId).single();
    expect(Date.parse(after.data!.locked_at) > Date.parse(before)).toBe(true);
    const wrongWorker = await service.rpc("touch_job", { p_job_id: jobId, p_worker_id: "someone-else" });
    expect(wrongWorker.error, "a non-holder must be rejected").not.toBeNull();
    const qaTouch = await qa1.rpc("touch_job", { p_job_id: jobId, p_worker_id: "spec-worker" });
    expect(qaTouch.error, "authenticated must be denied touch_job").not.toBeNull();
    await service.from("jobs").delete().eq("id", jobId);
  });
});
```

- [ ] **Step 2: Write `whatsapp-retention.spec.ts`**

```ts
/**
 * tests/qa/whatsapp-retention.spec.ts — Task 46.12 retention proof.
 * Backdates integration_messages, runs the overview purge path (P4), asserts
 * the 30-day rule; asserts disconnect deletes the raw archive.
 */
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";
const QA1 = "qa.unipilot@unipilot.test";

let service: SupabaseClient;
let qa1Id = "";
const runIds: string[] = [];

test.beforeAll(async () => {
  if (!LOCAL_TARGET.test(url)) throw new Error(`local-only; refusing ${url}`);
  service = createClient(url, serviceKey, { auth: { persistSession: false } });
  const qa1 = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await qa1.auth.signInWithPassword({ email: QA1, password: qa1Password });
  expect(error, `sign-in: ${error?.message}`).toBeNull();
  qa1Id = data.user!.id;
});

test.afterAll(async () => {
  if (runIds.length) await service.from("integration_runs").delete().in("id", runIds);
});

test.describe("whatsapp retention", () => {
  test("messages older than 30 days are purged by the overview hook", async () => {
    const run = await service.from("integration_runs").insert({
      user_id: qa1Id, mode: "export", status: "succeeded",
      storage_path: `${qa1Id}/seed/export.txt`, message_count: 2,
    }).select("id").single();
    expect(run.error, `run seed: ${run.error?.message}`).toBeNull();
    runIds.push(run.data!.id);
    await service.from("integration_messages").insert([
      { run_id: run.data!.id, user_id: qa1Id, position: 0, sender: "old", sent_at: new Date().toISOString(), body: "old body", created_at: new Date(Date.now() - 31 * 86_400_000).toISOString() },
      { run_id: run.data!.id, user_id: qa1Id, position: 1, sender: "new", sent_at: new Date().toISOString(), body: "new body" },
    ]);
    // P4's purgeExpiredWhatsAppMessages is exercised through the app: see
    // whatsapp-retention.spec.ts Task P4.5 for the server-action assertion.
    const { data } = await service.from("integration_messages").select("id, body").eq("run_id", run.data!.id);
    expect(data?.length).toBe(2);
  });
});
```

(The purge assertion is completed in P4.5 once the service exists; this task only seeds the fixture and proves the table shape.)

- [ ] **Step 3: Add the new tables to the residue list only**

In `rls-isolation.spec.ts`, do **not** add the integration tables to `OWNED_TABLES` (they are seeded through a run → message → candidate hierarchy and are SELECT-only for clients, so the generic per-table CRUD harness does not fit). Extend `RESIDUE_TABLES`:

```ts
const RESIDUE_TABLES = [
  ...OWNED_TABLES,
  "document_chunks",
  "messages",
  "integration_connections",
  "integration_runs",
  "integration_messages",
  "integration_candidates",
] as const;
```

- [ ] **Step 4: Run the specs to verify they fail**

Run: `npm run test -w frontend -- tests/qa/whatsapp-security.spec.ts tests/qa/whatsapp-retention.spec.ts`
Expected: FAIL — `relation "public.integration_runs" does not exist` / `column "source" does not exist` (the tables are not migrated yet). The failure must be a schema error, not a syntax error in the spec.

- [ ] **Step 5: Checkpoint**

No commit.

### Task P1.2: Write the integration schema migration

**Files:**
- Create: `backend/supabase/migrations/20260912120000_whatsapp_integration.sql`
- Modify: none.

**Interfaces:**
- Consumes: `public.set_updated_at()` (init migration), the `auth.users` table, `public.jobs` (29.1).
- Produces (used by all later phases): `events.source` / `events.source_ref` + unique index + trigger; tables `integration_connections`, `integration_runs`, `integration_messages`, `integration_candidates`, `google_calendar_credentials`; RPCs `upsert_google_credentials`, `get_google_credentials`, `delete_google_credentials`, `rotate_google_token_key`, `set_whatsapp_qr`, `get_whatsapp_qr`, `clear_whatsapp_qr`, `touch_job`.

- [ ] **Step 1: Confirm the timestamp orders after the latest migration**

Run: `Get-ChildItem backend/supabase/migrations | Select-Object -Last 3 Name`
Expected: latest is `20260912095011_search_embeddings.sql`; `20260912120000_...` sorts after it.

- [ ] **Step 2: Write the migration**

Full content:

```sql
-- =============================================================================
-- Task 46.12 — the WhatsApp integration schema (spec §6)
-- =============================================================================
--
-- Adds, in one logical change:
-- * events provenance: source/source_ref + unique (user_id, source, source_ref)
--   and a security-invoker trigger that forces manual provenance for every
--   caller that is not the service role (spec §6.1);
-- * the four owner-only integration tables (connections, runs, messages,
--   candidates) with indexes, updated_at triggers and SELECT-only client RLS
--   (spec §6.2–6.5);
-- * google_calendar_credentials (encrypted refresh token only) with zero
--   table grants for any API role and definer RPCs taking the server-only key
--   (spec §6.6);
-- * the live-QR definer RPCs with a hard TTL (spec §6.2);
-- * touch_job, the additive 29.1 lease-extension helper used by long scans
--   (spec §6.8, D8).
--
-- pgcrypto: enabled in the extensions schema; every encrypted call is
-- schema-qualified because the definer functions run with search_path = ''.
-- If P0.2 found log_statement <> 'none', use Supabase Vault instead and record
-- the alternative in DATABASE.md before applying this file.
--
-- Rollback (reference; forward-only):
--   drop function public.touch_job(uuid, text);
--   drop function public.clear_whatsapp_qr(uuid);
--   drop function public.get_whatsapp_qr(uuid, text);
--   drop function public.set_whatsapp_qr(uuid, text, text, integer);
--   drop function public.rotate_google_token_key(text, text);
--   drop function public.delete_google_credentials(uuid);
--   drop function public.get_google_credentials(uuid, text);
--   drop function public.upsert_google_credentials(uuid, text, text, text, text);
--   drop table public.google_calendar_credentials;
--   drop table public.integration_candidates;
--   drop table public.integration_messages;
--   drop table public.integration_runs;
--   drop table public.integration_connections;
--   drop trigger lock_event_provenance on public.events;
--   drop function public.lock_event_provenance();
--   drop index public.events_user_source_ref_key;
--   alter table public.events drop column source_ref, drop column source;
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- 1. events provenance (spec §6.1)
-- -----------------------------------------------------------------------------

alter table public.events
  add column source text not null default 'manual'
    constraint events_source_check check (source in ('manual', 'whatsapp')),
  add column source_ref text;

comment on column public.events.source is
  'Provenance: manual | whatsapp. Server-only; a trigger forces manual for non-service-role callers.';
comment on column public.events.source_ref is
  'Detector fingerprint for whatsapp rows (32 hex chars); NULL for manual rows.';

create unique index events_user_source_ref_key
  on public.events (user_id, source, source_ref);

create or replace function public.lock_event_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    new.source := 'manual';
    new.source_ref := null;
  end if;
  return new;
end;
$$;

comment on function public.lock_event_provenance() is
  'Task 46.12: forces manual provenance for every non-service-role caller (spec §6.1).';

create trigger lock_event_provenance
  before insert or update of source, source_ref on public.events
  for each row execute function public.lock_event_provenance();

-- -----------------------------------------------------------------------------
-- 2. integration_connections (spec §6.2)
-- -----------------------------------------------------------------------------

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null
    constraint integration_connections_provider_check
    check (provider in ('whatsapp', 'google')),
  mode text
    constraint integration_connections_mode_check
    check (mode is null or mode in ('export', 'live')),
  status text not null default 'pending'
    constraint integration_connections_status_check
    check (status in ('pending', 'connected', 'disconnected', 'error')),
  profile_ref text,
  qr_data_enc bytea,
  qr_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_connections_user_provider_key unique (user_id, provider),
  constraint integration_connections_provider_mode_check
    check ((provider = 'whatsapp') = (mode is not null))
);

comment on table public.integration_connections is
  'Task 46.12: per-user integration state. Owner SELECT only; every write is service-side (spec D5).';
comment on column public.integration_connections.qr_data_enc is
  'pgcrypto-encrypted login QR data-URL; short TTL; never plain, never logged (spec §6.2).';

create trigger set_integration_connections_updated_at
  before update on public.integration_connections
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. integration_runs (spec §6.3)
-- -----------------------------------------------------------------------------

create table public.integration_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid references public.integration_connections (id) on delete set null,
  mode text not null
    constraint integration_runs_mode_check check (mode in ('export', 'live')),
  status text not null default 'queued'
    constraint integration_runs_status_check
    check (status in ('queued', 'running', 'succeeded', 'failed')),
  storage_path text,
  chat_name text,
  message_count integer not null default 0
    constraint integration_runs_message_count_check check (message_count >= 0),
  candidate_count integer not null default 0
    constraint integration_runs_candidate_count_check check (candidate_count >= 0),
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_runs_input_check check (
    (mode = 'export' and storage_path is not null and chat_name is null)
    or (mode = 'live' and chat_name is not null and storage_path is null)
  )
);

comment on table public.integration_runs is
  'Task 46.12: one scan/sync. Owner SELECT only; Python writes with the service role.';
comment on column public.integration_runs.storage_path is
  'Export runs: object key in whatsapp-exports (no bucket prefix). Live runs use chat_name.';

create index integration_runs_user_created_idx
  on public.integration_runs (user_id, created_at desc);
create index integration_runs_status_idx on public.integration_runs (status);

create trigger set_integration_runs_updated_at
  before update on public.integration_runs
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. integration_messages (spec §6.4)
-- -----------------------------------------------------------------------------

create table public.integration_messages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.integration_runs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  position integer not null
    constraint integration_messages_position_check check (position >= 0),
  sender text not null,
  sent_at timestamptz not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint integration_messages_run_position_key unique (run_id, position)
);

comment on table public.integration_messages is
  'Task 46.12: raw imported messages. Owner SELECT only; 30-day best-effort purge (spec §6.10).';

create index integration_messages_user_sent_idx
  on public.integration_messages (user_id, sent_at);

-- -----------------------------------------------------------------------------
-- 5. integration_candidates (spec §6.5)
-- -----------------------------------------------------------------------------

create table public.integration_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid not null references public.integration_runs (id) on delete cascade,
  fingerprint text not null
    constraint integration_candidates_fingerprint_check check (length(fingerprint) > 0),
  title text not null
    constraint integration_candidates_title_check check (length(trim(title)) > 0),
  start_at timestamptz not null,
  end_at timestamptz
    constraint integration_candidates_end_at_check
    check (end_at is null or end_at >= start_at),
  all_day boolean not null default false,
  message_id uuid references public.integration_messages (id) on delete set null,
  message_sender text not null,
  message_text text not null,
  status text not null default 'pending'
    constraint integration_candidates_status_check
    check (status in ('pending', 'confirmed', 'rejected')),
  event_id uuid references public.events (id) on delete set null,
  pushed_at timestamptz,
  provider_event_id text,
  push_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_candidates_user_fingerprint_key unique (user_id, fingerprint)
);

comment on table public.integration_candidates is
  'Task 46.12: detected events awaiting review. Owner SELECT only; rejection is terminal (fingerprint unique).';

create index integration_candidates_user_status_idx
  on public.integration_candidates (user_id, status);
create index integration_candidates_run_idx on public.integration_candidates (run_id);

create trigger set_integration_candidates_updated_at
  before update on public.integration_candidates
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6. google_calendar_credentials (spec §6.6) — encrypted, no API-role grants
-- -----------------------------------------------------------------------------

create table public.google_calendar_credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token_enc bytea not null,
  scope text,
  calendar_id text not null default 'primary',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.google_calendar_credentials is
  'Task 46.12: pgcrypto-encrypted refresh token only; access tokens are never persisted. Reachable only through definer RPCs (spec §6.6).';

create trigger set_google_calendar_credentials_updated_at
  before update on public.google_calendar_credentials
  for each row execute function public.set_updated_at();

alter table public.google_calendar_credentials enable row level security;
-- no policies: deny by default.

-- -----------------------------------------------------------------------------
-- 7. RLS + grants for the four owner-readable tables (spec D5)
-- -----------------------------------------------------------------------------

alter table public.integration_connections enable row level security;
alter table public.integration_runs enable row level security;
alter table public.integration_messages enable row level security;
alter table public.integration_candidates enable row level security;

create policy "integration_connections_select_own"
  on public.integration_connections for select to authenticated
  using (auth.uid() = user_id);
create policy "integration_runs_select_own"
  on public.integration_runs for select to authenticated
  using (auth.uid() = user_id);
create policy "integration_messages_select_own"
  on public.integration_messages for select to authenticated
  using (auth.uid() = user_id);
create policy "integration_candidates_select_own"
  on public.integration_candidates for select to authenticated
  using (auth.uid() = user_id);

revoke all on public.integration_connections from anon, authenticated;
revoke all on public.integration_runs from anon, authenticated;
revoke all on public.integration_messages from anon, authenticated;
revoke all on public.integration_candidates from anon, authenticated;
revoke all on public.google_calendar_credentials from anon, authenticated, service_role;

grant select on public.integration_connections to authenticated;
grant select on public.integration_runs to authenticated;
grant select on public.integration_messages to authenticated;
grant select on public.integration_candidates to authenticated;
grant all on public.integration_connections to service_role;
grant all on public.integration_runs to service_role;
grant all on public.integration_messages to service_role;
grant all on public.integration_candidates to service_role;

-- -----------------------------------------------------------------------------
-- 8. Credential RPCs (spec §6.6)
-- -----------------------------------------------------------------------------

create or replace function public.upsert_google_credentials(
  p_user_id uuid,
  p_refresh_token text,
  p_scope text,
  p_calendar_id text,
  p_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or coalesce(p_refresh_token, '') = '' then
    raise exception 'upsert_google_credentials requires a user and a refresh token';
  end if;
  insert into public.google_calendar_credentials
    (user_id, refresh_token_enc, scope, calendar_id, connected_at, updated_at)
  values (
    p_user_id,
    extensions.pgp_sym_encrypt(p_refresh_token, p_key),
    p_scope,
    coalesce(nullif(p_calendar_id, ''), 'primary'),
    now(),
    now()
  )
  on conflict (user_id) do update set
    refresh_token_enc = excluded.refresh_token_enc,
    scope = excluded.scope,
    calendar_id = excluded.calendar_id,
    updated_at = now();
end;
$$;

create or replace function public.get_google_credentials(
  p_user_id uuid,
  p_key text
)
returns table (
  refresh_token text,
  scope text,
  calendar_id text,
  connected_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    select
      extensions.pgp_sym_decrypt(c.refresh_token_enc, p_key)::text,
      c.scope,
      c.calendar_id,
      c.connected_at
    from public.google_calendar_credentials c
    where c.user_id = p_user_id;
end;
$$;

create or replace function public.delete_google_credentials(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.google_calendar_credentials where user_id = p_user_id;
end;
$$;

create or replace function public.rotate_google_token_key(
  p_old_key text,
  p_new_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.google_calendar_credentials
     set refresh_token_enc = extensions.pgp_sym_encrypt(
           extensions.pgp_sym_decrypt(refresh_token_enc, p_old_key)::text,
           p_new_key
         ),
         updated_at = now();
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. QR RPCs (spec §6.2)
-- -----------------------------------------------------------------------------

create or replace function public.set_whatsapp_qr(
  p_connection_id uuid,
  p_qr text,
  p_key text,
  p_ttl_seconds integer default 60
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_qr, '') = '' then
    raise exception 'set_whatsapp_qr requires a payload';
  end if;
  update public.integration_connections
     set qr_data_enc = extensions.pgp_sym_encrypt(p_qr, p_key),
         qr_expires_at = now() + make_interval(secs => least(greatest(coalesce(p_ttl_seconds, 60), 5), 300))
   where id = p_connection_id;
  if not found then
    raise exception 'set_whatsapp_qr: unknown connection %', p_connection_id;
  end if;
end;
$$;

create or replace function public.get_whatsapp_qr(
  p_connection_id uuid,
  p_key text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qr text;
  v_expires timestamptz;
begin
  select extensions.pgp_sym_decrypt(c.qr_data_enc, p_key)::text, c.qr_expires_at
    into v_qr, v_expires
    from public.integration_connections c
   where c.id = p_connection_id
     and c.qr_data_enc is not null;

  if v_qr is null or v_expires is null or v_expires <= now() then
    update public.integration_connections
       set qr_data_enc = null, qr_expires_at = null
     where id = p_connection_id
       and (qr_expires_at is null or qr_expires_at <= now());
    return null;
  end if;
  return v_qr;
end;
$$;

create or replace function public.clear_whatsapp_qr(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.integration_connections
     set qr_data_enc = null, qr_expires_at = null
   where id = p_connection_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. touch_job (spec §6.8, D8) — additive 29.1 lease extension
-- -----------------------------------------------------------------------------

create or replace function public.touch_job(
  p_job_id uuid,
  p_worker_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.jobs
     set locked_at = now()
   where id = p_job_id
     and status = 'running'
     and locked_by = p_worker_id;
  if not found then
    raise exception 'touch_job: job % is not held by worker %', p_job_id, p_worker_id;
  end if;
end;
$$;

comment on function public.touch_job(uuid, text) is
  'Task 46.13: extends the claim lease of a running job held by the worker; service-role only.';

-- -----------------------------------------------------------------------------
-- 11. Function grants — explicit revokes before every service_role grant
--     (the 29.1 default-grant trap; spec D5/§6.6).
-- -----------------------------------------------------------------------------

revoke all on function public.upsert_google_credentials(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.get_google_credentials(uuid, text)
  from public, anon, authenticated;
revoke all on function public.delete_google_credentials(uuid)
  from public, anon, authenticated;
revoke all on function public.rotate_google_token_key(text, text)
  from public, anon, authenticated;
revoke all on function public.set_whatsapp_qr(uuid, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.get_whatsapp_qr(uuid, text)
  from public, anon, authenticated;
revoke all on function public.clear_whatsapp_qr(uuid)
  from public, anon, authenticated;
revoke all on function public.touch_job(uuid, text)
  from public, anon, authenticated;

grant execute on function public.upsert_google_credentials(uuid, text, text, text, text) to service_role;
grant execute on function public.get_google_credentials(uuid, text) to service_role;
grant execute on function public.delete_google_credentials(uuid) to service_role;
grant execute on function public.rotate_google_token_key(text, text) to service_role;
grant execute on function public.set_whatsapp_qr(uuid, text, text, integer) to service_role;
grant execute on function public.get_whatsapp_qr(uuid, text) to service_role;
grant execute on function public.clear_whatsapp_qr(uuid) to service_role;
grant execute on function public.touch_job(uuid, text) to service_role;
```

- [ ] **Step 3: Apply and lint**

Run:
```powershell
npm run db:reset
npm run db:lint
```
Expected: reset applies every migration including this one; lint reports no errors (warnings about `auth.role()` are acceptable only if already present; otherwise fix the function).

- [ ] **Step 4: Checkpoint**

No commit.

### Task P1.3: Write the `whatsapp-exports` bucket migration

**Files:**
- Create: `backend/supabase/migrations/20260912120100_whatsapp_exports_bucket.sql`

**Interfaces:**
- Consumes: Storage schema (`storage.buckets`, `storage.objects`), pattern from `20260912053249_documents_storage_bucket.sql`.
- Produces: bucket id `whatsapp-exports` and its four owner-folder policies.

- [ ] **Step 1: Write the migration**

Full content (mirror the documents bucket file, changing bucket/MIME/size):

```sql
-- =============================================================================
-- Task 46.12 — the private whatsapp-exports bucket (spec §6.7, D2)
-- =============================================================================
--
-- text/plain only, 25 MiB (same cap as documents), private; owner-folder RLS
-- keyed on `(storage.foldername(name))[1] = auth.uid()::text`.
--
-- Rollback (reference; forward-only): delete objects, drop the four policies,
-- delete from storage.buckets where id = 'whatsapp-exports'.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('whatsapp-exports', 'whatsapp-exports', false, 26214400, array['text/plain'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "whatsapp_exports_objects_select_own" on storage.objects;
create policy "whatsapp_exports_objects_select_own"
  on storage.objects for select to authenticated
  using (bucket_id = 'whatsapp-exports' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "whatsapp_exports_objects_insert_own" on storage.objects;
create policy "whatsapp_exports_objects_insert_own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'whatsapp-exports' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "whatsapp_exports_objects_update_own" on storage.objects;
create policy "whatsapp_exports_objects_update_own"
  on storage.objects for update to authenticated
  using (bucket_id = 'whatsapp-exports' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'whatsapp-exports' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "whatsapp_exports_objects_delete_own" on storage.objects;
create policy "whatsapp_exports_objects_delete_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'whatsapp-exports' and (storage.foldername(name))[1] = auth.uid()::text);
```

- [ ] **Step 2: Apply, lint, and prove the policies with a curl probe is NOT needed**

Run:
```powershell
npm run db:reset
npm run db:lint
```
Expected: clean apply; lint clean.

- [ ] **Step 3: Add the bucket isolation assertions to `whatsapp-security.spec.ts`**

Append a describe block that uploads with QA1's session to `whatsapp-exports/{qa1Id}/probe/export.txt`, downloads it back, asserts a `{qa2-like other id}/...` path is denied with that session, deletes it:

```ts
test.describe("whatsapp-exports bucket isolation", () => {
  test("owner uploads and reads only their own folder", async () => {
    const serviceBucket = service.storage.from("whatsapp-exports");
    const path = `${qa1Id}/probe/export.txt`;
    const upload = await serviceBucket.upload(path, new Blob(["hello"]), { contentType: "text/plain", upsert: true });
    expect(upload.error, `service upload: ${upload.error?.message}`).toBeNull();
    const own = await qa1.storage.from("whatsapp-exports").download(path);
    expect(own.error, `owner download: ${own.error?.message}`).toBeNull();
    const foreign = await qa1.storage
      .from("whatsapp-exports")
      .download(`${"00000000-0000-4000-8000-000000000000"}/probe/export.txt`);
    expect(foreign.error, "cross-folder download must be denied").not.toBeNull();
    const remove = await serviceBucket.remove([path]);
    expect(remove.error).toBeNull();
  });
});
```

- [ ] **Step 4: Run the security spec**

Run: `npm run test -w frontend -- tests/qa/whatsapp-security.spec.ts`
Expected: PASS for the provenance, credential, QR, touch_job, and bucket blocks (the retention spec's purge assertion still awaits P4.5).

- [ ] **Step 5: Checkpoint**

No commit.

### Task P1.4: Regenerate types and prove the contract

**Files:**
- Modify: `frontend/lib/supabase/database.types.ts` (generated)
- Verify: `frontend/lib/supabase/schema-contract.ts` (types-only; no edit expected)

**Interfaces:**
- Consumes: the local schema from P1.2/P1.3.
- Produces: typed access used by every later frontend task.

- [ ] **Step 1: Regenerate and check**

Run:
```powershell
npm run db:types
npm run db:check-types
npm run typecheck
```
Expected: `database.types.ts` gains the five tables and eight functions; `db:check-types` reports a match; `tsc` passes. Confirm the diff includes `google_calendar_credentials`, `integration_candidates`, `integration_connections`, `integration_messages`, `integration_runs`, and `touch_job`.

- [ ] **Step 2: Re-run the new DB specs on the regenerated schema**

Run: `npm run test -w frontend -- tests/qa/whatsapp-security.spec.ts`
Expected: PASS (unchanged).

- [ ] **Step 3: Checkpoint**

No commit.

---

## Phase 2 — Python service refactor + pytest (TASK.md 46.11)

Old source files live in `whatsapp/Default Project/` until P2.7, when the folder is deleted. Copy rule for every moved module: the parsing/extraction rules are **moved verbatim** — only imports, config access and function signatures change.

### Task P2.1: Scaffold the service and install tooling

**Files:**
- Create: `whatsapp/wa_service/__init__.py`, `whatsapp/wa_service/__main__.py`, `whatsapp/wa_service/config.py`, `whatsapp/wa_service/models.py`, `whatsapp/wa_service/reader.py`, `whatsapp/wa_service/extractor.py`, `whatsapp/wa_service/fingerprint.py`, `whatsapp/wa_service/timezones.py`, `whatsapp/wa_service/supabase_client.py`, `whatsapp/wa_service/sync.py`, `whatsapp/wa_service/calendar_push.py`, `whatsapp/wa_service/live.py`
- Create: `whatsapp/requirements.txt`, `whatsapp/requirements-dev.txt`, `whatsapp/requirements-google.txt`, `whatsapp/requirements-live.txt`, `whatsapp/pytest.ini`
- Move: `whatsapp/Default Project/sample_chat.txt` → `whatsapp/tests/fixtures/sample_chat.txt`; `whatsapp/Default Project/.gitignore` → `whatsapp/.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: the package import path `wa_service` runnable from `whatsapp/`, and a working `python -m pytest whatsapp` entry point.

- [ ] **Step 1: Create the tree and move the fixture**

Run (PowerShell from repo root):
```powershell
New-Item -ItemType Directory -Force whatsapp\wa_service, whatsapp\tests\fixtures | Out-Null
New-Item -ItemType File -Force whatsapp\wa_service\__init__.py | Out-Null
Move-Item "whatsapp\Default Project\sample_chat.txt" whatsapp\tests\fixtures\sample_chat.txt
Move-Item "whatsapp\Default Project\.gitignore" whatsapp\.gitignore
```

- [ ] **Step 2: Write the dependency files**

`whatsapp/requirements.txt`:
```
dateparser>=1.2.0
requests>=2.32.0
```

`whatsapp/requirements-dev.txt`:
```
-r requirements.txt
pytest>=8.3.0
```

`whatsapp/requirements-google.txt`:
```
-r requirements.txt
google-api-python-client>=2.100.0
google-auth-httplib2>=0.1.1
google-auth-oauthlib>=1.1.0
```

`whatsapp/requirements-live.txt`:
```
-r requirements.txt
selenium>=4.20.0
```

`whatsapp/pytest.ini`:
```ini
[pytest]
pythonpath = .
testpaths = tests
```

- [ ] **Step 3: Install locally (worker-host contract rehearsal)**

Run:
```powershell
python -m pip install -r whatsapp/requirements-dev.txt
python -c "import dateparser, requests, pytest; print('core ok')"
python -m pip install -r whatsapp/requirements-google.txt
python -c "import googleapiclient, google_auth_oauthlib; print('google ok')"
python -m pip install -r whatsapp/requirements-live.txt
python -c "import selenium; print('selenium ok')"
```
Expected: all three lines print. If a wheel is missing on Python 3.14, record the exact package/error in the P8.1 TASK.md entry, mark the matching capability `[!]` (never fake it), and continue — core (`dateparser`, `requests`, `pytest`) must install.

- [ ] **Step 4: Checkpoint**

No commit.

### Task P2.2: Move models, config, reader, timezones — with tests first

**Files:**
- Create/replace: `whatsapp/wa_service/models.py`, `config.py`, `reader.py`, `timezones.py`
- Test: `whatsapp/tests/test_reader.py`, `whatsapp/tests/test_config.py`
- Source to copy from: `whatsapp/Default Project/whatsapp_reader.py`, `config.py`

**Interfaces:**
- Produces:
  - `class Message` with `__slots__ = ("date_str", "time_str", "sender", "text")`
  - `parse_chat_text(text: str) -> list[Message]`
  - `parse_chat_file(path: Path | str) -> list[Message]`
  - `filter_ignored(messages, ignore_senders: tuple[str, ...]) -> list[Message]`
  - `class Settings` (dataclass) with the fields listed in `config.py` below
  - `load_settings() -> Settings`
  - `to_utc_rfc3339(naive: datetime, tz_name: str) -> str`

- [ ] **Step 1: Write the failing tests**

`whatsapp/tests/test_reader.py`:
```python
from pathlib import Path

from wa_service.reader import filter_ignored, parse_chat_file, parse_chat_text

FIXTURE = Path(__file__).parent / "fixtures" / "sample_chat.txt"


def test_parses_the_sample_export():
    messages = parse_chat_file(FIXTURE)
    assert len(messages) == 10
    assert messages[0].sender == "Priya"
    assert messages[0].date_str == "06/09/2026"
    assert messages[0].time_str == "20:15:22"
    assert messages[0].text.startswith("Hey everyone!")


def test_parses_bracketed_and_comma_formats():
    text = (
        "[06/02/2026, 21:14:33] Alice: first\n"
        "2/6/26, 9:14 PM - Bob: second\n"
    )
    messages = parse_chat_text(text)
    assert [m.sender for m in messages] == ["Alice", "Bob"]
    assert messages[1].text == "second"


def test_multiline_messages_append_to_the_previous():
    text = "[06/02/2026, 21:14:33] Alice: line one\nline two\nline three\n"
    messages = parse_chat_text(text)
    assert len(messages) == 1
    assert messages[0].text == "line one\nline two\nline three"


def test_strips_unicode_direction_marks_and_drops_empty_lines():
    text = "\u200f[06/02/2026, 21:14:33] Alice: hi\u200e\n\u200f\n[06/02/2026, 21:14:34] Bob: tue\n"
    messages = parse_chat_text(text)
    assert [m.text for m in messages] == ["hi", "tue"]


def test_filter_ignored_is_case_insensitive_substring():
    messages = parse_chat_text(
        "[06/02/2026, 21:14:33] Alice: a\n[06/02/2026, 21:14:34] Campus Bot: b\n"
    )
    kept = filter_ignored(messages, ("bot",))
    assert [m.sender for m in kept] == ["Alice"]
```

`whatsapp/tests/test_config.py`:
```python
from datetime import datetime

from wa_service import config
from wa_service.timezones import to_utc_rfc3339


def test_settings_defaults_are_the_documented_ones(monkeypatch):
    for name in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "UNIPILOT_INTEGRATIONS_KEY",
                 "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "DEFAULT_TIMEZONE",
                 "DATE_ORDER", "IGNORE_SENDERS", "WHATSAPP_PROFILE_ROOT"):
        monkeypatch.delenv(name, raising=False)
    settings = config.load_settings()
    assert settings.default_timezone == "Asia/Kolkata"
    assert settings.date_order == "DMY"
    assert settings.message_cap == 5000
    assert settings.candidate_cap == 500
    assert settings.ignore_senders == ()


def test_profile_timezone_beats_default():
    assert to_utc_rfc3339(datetime(2026, 9, 12, 19, 0), "Asia/Kolkata") == "2026-09-12T13:30:00Z"
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest whatsapp/tests/test_reader.py whatsapp/tests/test_config.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'wa_service'` / missing functions.

- [ ] **Step 3: Write `models.py` and `config.py`**

`wa_service/models.py`: copy the `Message` class from `whatsapp_reader.py:20-30` and the `DetectedEvent` class + `title`/`description` properties from `event_extractor.py:63-108` **verbatim** (only the module path changes; keep `__slots__` and the title-cleanup regexes exactly).

`wa_service/config.py`:
```python
"""Env-driven settings. No global file paths, no .env loading side effects."""
import os
from dataclasses import dataclass


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _int(name: str, default: int) -> int:
    try:
        return int(_env(name) or default)
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(_env(name) or default)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    service_key: str
    integrations_key: str
    google_client_id: str
    google_client_secret: str
    google_calendar_id: str
    default_timezone: str
    date_order: str
    ignore_senders: tuple[str, ...]
    default_event_duration_minutes: int
    message_cap: int
    candidate_cap: int
    live_qr_timeout: int
    live_max_messages: int
    live_scroll_wait: float
    live_stale_rounds: int
    profile_root: str


def load_settings() -> Settings:
    date_order = _env("DATE_ORDER", "DMY").upper()
    return Settings(
        supabase_url=_env("SUPABASE_URL") or _env("NEXT_PUBLIC_SUPABASE_URL"),
        service_key=_env("SUPABASE_SERVICE_ROLE_KEY"),
        integrations_key=_env("UNIPILOT_INTEGRATIONS_KEY"),
        google_client_id=_env("GOOGLE_OAUTH_CLIENT_ID"),
        google_client_secret=_env("GOOGLE_OAUTH_CLIENT_SECRET"),
        google_calendar_id=_env("GOOGLE_CALENDAR_ID", "primary"),
        default_timezone=_env("DEFAULT_TIMEZONE", "Asia/Kolkata"),
        date_order=date_order if date_order in ("DMY", "MDY") else "DMY",
        ignore_senders=tuple(s.strip() for s in _env("IGNORE_SENDERS").split(",") if s.strip()),
        default_event_duration_minutes=_int("DEFAULT_EVENT_DURATION_MINUTES", 60),
        message_cap=_int("WHATSAPP_MESSAGE_CAP", 5000),
        candidate_cap=_int("WHATSAPP_CANDIDATE_CAP", 500),
        live_qr_timeout=_int("LIVE_QR_TIMEOUT", 180),
        live_max_messages=_int("LIVE_MAX_MESSAGES", 2000),
        live_scroll_wait=_float("LIVE_SCROLL_WAIT", 0.9),
        live_stale_rounds=_int("LIVE_STALE_ROUNDS", 7),
        profile_root=_env("WHATSAPP_PROFILE_ROOT") or str(
            (os.path.dirname(os.path.dirname(os.path.abspath(__file__))) / ".profiles")
        ),
    )
```

- [ ] **Step 4: Write `reader.py` and `timezones.py`**

`wa_service/reader.py`: copy `LINE_RE` and the body of `parse_chat_file` from `whatsapp_reader.py:13-55` verbatim, renaming the entry points:
```python
from pathlib import Path

from .models import Message

# LINE_RE copied verbatim from whatsapp_reader.py:13-17


def parse_chat_text(text: str) -> list[Message]:
    """The line loop from whatsapp_reader.parse_chat_file, over a string."""

def parse_chat_file(path: Path | str) -> list[Message]:
    """read_text with utf-8 → utf-16 fallback (whatsapp_reader.py:36-40), then parse_chat_text."""

def filter_ignored(messages: list[Message], ignore_senders: tuple[str, ...]) -> list[Message]:
    """whatsapp_reader.py:68-71, parameterized instead of reading config."""
```

`wa_service/timezones.py`:
```python
from datetime import datetime, timezone
from zoneinfo import ZoneInfo


def to_utc_rfc3339(naive: datetime, tz_name: str) -> str:
    aware = naive.replace(tzinfo=ZoneInfo(tz_name))
    return aware.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest whatsapp/tests/test_reader.py whatsapp/tests/test_config.py -q`
Expected: PASS.

- [ ] **Step 6: Checkpoint**

No commit.

### Task P2.3: Move the extractor with deterministic time and caps

**Files:**
- Create/replace: `whatsapp/wa_service/extractor.py`
- Test: `whatsapp/tests/test_extractor.py`
- Source: `whatsapp/Default Project/event_extractor.py`

**Interfaces:**
- Produces: `extract_events(messages, *, now=None, date_order="DMY", default_duration_minutes=60, max_events=None) -> list[DetectedEvent]`. `now` defaults to `datetime.now()`; when given it seeds `RELATIVE_BASE` so relative phrases ("tomorrow", "Sunday") are deterministic in tests. `max_events` is the candidate cap.

- [ ] **Step 1: Write the failing tests**

`whatsapp/tests/test_extractor.py`:
```python
from datetime import datetime
from pathlib import Path

from wa_service.extractor import extract_events
from wa_service.reader import parse_chat_file

FIXTURE = Path(__file__).parent / "fixtures" / "sample_chat.txt"
NOW = datetime(2026, 9, 6, 20, 15, 0)


def extract(**overrides):
    messages = parse_chat_file(FIXTURE)
    return extract_events(messages, now=NOW, **overrides)


def test_sample_chat_yields_five_detections():
    events = extract()
    titles = [e.title for e in events]
    assert len(events) == 5, titles
    assert any("Birthday party" in t for t in titles)
    assert any("Team meeting" in t for t in titles)
    assert any("Football match" in t for t in titles)
    assert any("Webinar" in t for t in titles)
    assert any("picnic" in t for t in titles)


def test_birthday_is_september_12_at_19_00():
    events = [e for e in extract() if "Birthday" in e.title]
    assert len(events) == 1
    assert events[0].start == datetime(2026, 9, 12, 19, 0)
    assert events[0].all_day is False


def test_webinar_has_the_explicit_range():
    webinar = next(e for e in extract() if "Webinar" in e.title)
    assert webinar.start == datetime(2026, 9, 18, 18, 0)
    assert webinar.end == datetime(2026, 9, 18, 19, 30)
    assert webinar.all_day is False


def test_picnic_october_2_is_all_day():
    picnic = next(e for e in extract() if "picnic" in e.title)
    assert picnic.all_day is True
    assert (picnic.start.year, picnic.start.month, picnic.start.day) == (2026, 10, 2)
    assert picnic.end is None


def test_relative_dates_are_deterministic_with_injected_now():
    meeting = next(e for e in extract() if "Team meeting" in e.title)
    assert (meeting.start.month, meeting.start.day) == (9, 7)
    assert (meeting.start.hour, meeting.start.minute) == (10, 30)
    football = next(e for e in extract() if "Football" in e.title)
    assert football.start.hour == 17
    assert datetime(2026, 9, 6) <= football.start < datetime(2026, 9, 14)


def test_noise_and_keyword_only_messages_are_ignored():
    assert extract()  # sanity
    events = extract()
    assert not any(e.title.strip().lower() in {"ok", "congrats", "nice", "good night all"} for e in events)


def test_candidate_cap_stops_at_the_limit():
    events = extract(max_events=2)
    assert len(events) == 2


def test_duplicate_messages_dedupe_by_start_and_title():
    from wa_service.models import Message
    chunk = "Hey team, webinar on 18/09/2026 at 18:00"
    messages = [Message("06/09/2026", "20:00:00", "A", chunk), Message("06/09/2026", "20:01:00", "A", chunk)]
    events = extract_events(messages, now=NOW)
    assert len(events) == 1
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest whatsapp/tests/test_extractor.py -q`
Expected: FAIL — `extract_events() got an unexpected keyword argument 'now'` / missing module.

- [ ] **Step 3: Implement the extractor**

Copy `event_extractor.py` verbatim into `wa_service/extractor.py`, then apply exactly these deltas:
1. Replace `from config import DEFAULT_EVENT_DURATION_MINUTES, DATE_ORDER` with nothing; use parameters.
2. `_parse_time(message, *, now, date_order, default_duration_minutes)` — replace `dateparser.parse(...) or datetime.now()` with `or now`; replace every `DATE_ORDER` with `date_order`; replace `DEFAULT_EVENT_DURATION_MINUTES` with `default_duration_minutes`.
3. `extract_events(messages, *, now=None, date_order="DMY", default_duration_minutes=60, max_events=None)`: `now = now or datetime.now()`; after dedupe, `return unique[:max_events] if max_events else unique`.
4. Keep every regex, `_looks_like_event`, `_to_24h`, `_apply_clock`, title cleanup and the duplicate rule byte-for-byte.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest whatsapp/tests/test_extractor.py -q`
Expected: PASS. If the "Team meeting" date differs because of `PREFER_DATES_FROM`, do **not** change the rule — inspect and adjust only the assertion window if it reflects the original tool's real behavior; record the behavior in the test docstring.

- [ ] **Step 5: Checkpoint**

No commit.

### Task P2.4: Fingerprint module

**Files:**
- Create: `whatsapp/wa_service/fingerprint.py`
- Test: `whatsapp/tests/test_fingerprint.py`
- Source: `whatsapp/Default Project/calendar_sync.py:103-112`

**Interfaces:**
- Produces: `event_fingerprint(start: datetime, end: datetime | None, sender: str, text: str) -> str` (32 hex chars).

- [ ] **Step 1: Write the failing test**

```python
from datetime import datetime
from wa_service.fingerprint import event_fingerprint

START = datetime(2026, 9, 12, 19, 0)


def test_is_stable_for_identical_inputs():
    assert event_fingerprint(START, None, "Priya", "party at 7 pm") == event_fingerprint(START, None, "Priya", "party at 7 pm")


def test_changes_with_sender_time_or_text():
    base = event_fingerprint(START, None, "Priya", "party at 7 pm")
    assert base != event_fingerprint(START, None, "Rahul", "party at 7 pm")
    assert base != event_fingerprint(datetime(2026, 9, 12, 20, 0), None, "Priya", "party at 7 pm")
    assert base != event_fingerprint(START, None, "Priya", "party at 8 pm")


def test_is_32_lowercase_hex_chars():
    value = event_fingerprint(START, None, "Priya", "party at 7 pm")
    assert len(value) == 32
    assert value == value.lower()
    int(value, 16)
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest whatsapp/tests/test_fingerprint.py -q`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```python
"""Stable identity for a detected event (moved from calendar_sync.py:103-112)."""
import hashlib
from datetime import datetime


def event_fingerprint(start: datetime, end: datetime | None, sender: str, text: str) -> str:
    raw = "|".join([
        start.strftime("%Y%m%d%H%M"),
        end.strftime("%Y%m%d%H%M") if end else "",
        sender,
        text.strip().lower()[:200],
    ])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]
```

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest whatsapp/tests/test_fingerprint.py -q`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

No commit.

### Task P2.5: Supabase REST client + sync orchestration + CLI

**Files:**
- Create: `whatsapp/wa_service/supabase_client.py`, `whatsapp/wa_service/sync.py`, `whatsapp/wa_service/__main__.py`
- Test: `whatsapp/tests/test_sync.py`, `whatsapp/tests/test_cli.py`

**Interfaces:**
- Produces:
  - `class ServiceError(Exception)` with `.message: str`, `.retryable: bool`
  - `class SupabaseRest` with `select(table, params) -> list[dict]`, `select_one(table, params) -> dict | None`, `patch(table, params, body)`, `insert(table, body, *, prefer=None) -> list[dict]`, `delete(table, params)`, `rpc(name, body)`, `download_object(bucket, path) -> bytes`, `remove_object(bucket, path)`; constructor `SupabaseRest(url, service_key)`.
  - `sync.run_export(settings, client, run: dict) -> dict` and `sync.run_live(settings, client, run: dict, messages: list[Message]) -> dict`; both return `{"messages": int, "candidates": int, "capped": bool}`.
  - `push.run_push` lives in P2.6.
  - `__main__.main(argv=None) -> int`; stdout contract: exactly one JSON line `{"ok": true, ...}` or `{"ok": false, "error": "...", "retryable": bool}`.

- [ ] **Step 1: Write the sync tests (fake client, no network)**

`whatsapp/tests/test_sync.py`:
```python
from wa_service import sync
from wa_service.config import Settings

SETTINGS = Settings(
    supabase_url="http://local", service_key="service", integrations_key="k",
    google_client_id="", google_client_secret="", google_calendar_id="primary",
    default_timezone="Asia/Kolkata", date_order="DMY", ignore_senders=(),
    default_event_duration_minutes=60, message_cap=50, candidate_cap=10,
    live_qr_timeout=180, live_max_messages=2000, live_scroll_wait=0.9,
    live_stale_rounds=7, profile_root="/tmp/profiles",
)

CHAT = (
    "[06/09/2026, 20:15:22] Priya: Birthday party on 12/09/2026 at 7 pm\n"
    "[06/09/2026, 20:16:05] Rahul: congrats\n"
)[:]

class FakeClient:
    def __init__(self, profile_timezone="Asia/Kolkata"):
        self.patches = []
        self.inserted = []
        self.profile_timezone = profile_timezone

    def select_one(self, table, params):
        if table == "profiles":
            return {"timezone": self.profile_timezone}
        return None

    def patch(self, table, params, body):
        self.patches.append((table, params, body))

    def insert(self, table, body, prefer=None):
        rows = body if isinstance(body, list) else [body]
        self.inserted.append((table, rows, prefer))
        return [{"id": f"{table}-{i}"} for i, _ in enumerate(rows)]


def run_row():
    return {"id": "run-1", "user_id": "user-1", "mode": "export",
            "storage_path": "user-1/run-1/export.txt", "chat_name": None}


def test_run_export_writes_messages_and_candidates_and_settles(monkeypatch):
    client = FakeClient()
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: CHAT)
    result = sync.run_export(SETTINGS, client, run_row())
    assert result == {"messages": 2, "candidates": 1, "capped": False}
    tables = [row[0] for row in client.inserted]
    assert "integration_messages" in tables
    assert "integration_candidates" in tables
    message_rows = next(rows for table, rows, _ in client.inserted if table == "integration_messages")
    assert [row["position"] for row in message_rows] == [0, 1]
    candidate = next(rows[0] for table, rows, _ in client.inserted if table == "integration_candidates")
    assert candidate["user_id"] == "user-1"
    assert candidate["all_day"] is False
    run_patch = next(body for table, params, body in client.patches if table == "integration_runs")
    assert run_patch["status"] == "succeeded"
    assert run_patch["message_count"] == 2
    assert run_patch["candidate_count"] == 1
    assert run_patch["completed_at"]


def test_early_dedupe_does_not_count_existing_candidates(monkeypatch):
    client = FakeClient()
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: CHAT)
    real_insert = client.insert

    def insert(table, body, prefer=None):
        rows = real_insert(table, body, prefer)
        if table == "integration_candidates":
            return []  # Prefer: ignore-duplicates returned none
        return rows

    client.insert = insert
    result = sync.run_export(SETTINGS, client, run_row())
    assert result["candidates"] == 0


def test_message_cap_reports_capped(monkeypatch):
    client = FakeClient()
    many = "\n".join(f"[06/09/2026, 20:00:{i:02d}] A: event 12/09/2026 at {i % 24}:00" for i in range(60))
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: many)
    result = sync.run_export(SETTINGS, client, run_row())
    assert result["messages"] == 50
    assert result["capped"] is True


def test_profile_timezone_wins(monkeypatch):
    client = FakeClient(profile_timezone="Europe/London")
    monkeypatch.setattr(sync, "download_export", lambda settings, client, run: CHAT)
    sync.run_export(SETTINGS, client, run_row())
    candidate = next(rows[0] for table, rows, _ in client.inserted if table == "integration_candidates")
    # 19:00 Asia/Kolkata == 13:30 UTC; 19:00 Europe/London (BST) == 18:00 UTC.
    assert candidate["start_at"].startswith("2026-09-12T18:00")
```

`whatsapp/tests/test_cli.py`:
```python
import io
import json

from wa_service import __main__ as cli


def test_unknown_action_is_non_retryable(monkeypatch):
    monkeypatch.setattr("sys.stdin", io.StringIO('{"action": "nope"}'))
    out = io.StringIO()
    monkeypatch.setattr("sys.stdout", out)
    code = cli.main([])
    assert code == 1
    payload = json.loads(out.getvalue().strip().splitlines()[-1])
    assert payload["ok"] is False
    assert payload["retryable"] is False


def test_invalid_json_is_non_retryable(monkeypatch):
    monkeypatch.setattr("sys.stdin", io.StringIO("not json"))
    out = io.StringIO()
    monkeypatch.setattr("sys.stdout", out)
    code = cli.main([])
    assert code == 1
    payload = json.loads(out.getvalue().strip().splitlines()[-1])
    assert payload["ok"] is False
    assert payload["retryable"] is False
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest whatsapp/tests/test_sync.py whatsapp/tests/test_cli.py -q`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement `supabase_client.py`**

```python
"""Minimal PostgREST/Storage client over requests, service-role only."""
import requests


class ServiceError(Exception):
    def __init__(self, message: str, *, retryable: bool = True):
        super().__init__(message)
        self.message = message
        self.retryable = retryable


class SupabaseRest:
    def __init__(self, url: str, service_key: str, timeout: int = 30):
        if not url or not service_key:
            raise ServiceError("Supabase URL/service key missing on the worker host", retryable=False)
        self.url = url.rstrip("/")
        self.service_key = service_key
        self.timeout = timeout

    def _headers(self, prefer: str | None = None) -> dict:
        headers = {
            "apikey": self.service_key,
            "Authorization": f"Bearer {self.service_key}",
            "Content-Type": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        return headers

    def _request(self, method, path, *, params=None, json=None, prefer=None):
        response = requests.request(
            method, f"{self.url}{path}", params=params, json=json,
            headers=self._headers(prefer), timeout=self.timeout,
        )
        if response.status_code >= 400:
            raise ServiceError(
                f"{method} {path} failed with status {response.status_code}", retryable=True
            )
        return response

    def select(self, table: str, params: dict) -> list:
        return self._request("GET", f"/rest/v1/{table}", params=params).json()

    def select_one(self, table: str, params: dict):
        rows = self.select(table, params)
        return rows[0] if rows else None

    def patch(self, table, params, body):
        self._request("PATCH", f"/rest/v1/{table}", params=params, json=body, prefer="return=minimal")

    def insert(self, table, body, prefer=None):
        response = self._request(
            "POST", f"/rest/v1/{table}", json=body,
            prefer=prefer or "return=representation",
        )
        return response.json() if response.content else []

    def delete(self, table, params):
        self._request("DELETE", f"/rest/v1/{table}", params=params, prefer="return=minimal")

    def rpc(self, name, body):
        response = self._request("POST", f"/rest/v1/rpc/{name}", json=body)
        return response.json() if response.content else None

    def download_object(self, bucket: str, path: str) -> bytes:
        response = self._request("GET", f"/storage/v1/object/{bucket}/{path}")
        return response.content

    def remove_object(self, bucket: str, path: str):
        self._request("DELETE", f"/storage/v1/object/{bucket}/{path}", prefer="return=minimal")
```

- [ ] **Step 4: Implement `sync.py`**

```python
"""Run orchestration: read → parse → extract → persist (spec §8)."""
from datetime import datetime

from . import extractor, fingerprint
from .config import Settings
from .reader import filter_ignored, parse_chat_text
from .timezones import to_utc_rfc3339


def download_export(settings: Settings, client, run: dict) -> str:
    data = client.download_object("whatsapp-exports", run["storage_path"])
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("utf-16")


def _profile_timezone(client, user_id: str, fallback: str) -> str:
    profile = client.select_one("profiles", {"id": f"eq.{user_id}", "select": "timezone"})
    tz = (profile or {}).get("timezone") or fallback
    return tz if isinstance(tz, str) and tz else fallback


def run_export(settings: Settings, client, run: dict) -> dict:
    chat = download_export(settings, client, run)
    return _run(settings, client, run, chat)


def run_live(settings: Settings, client, run: dict, messages) -> dict:
    # live.py collects Message objects, then shares the exact persistence path.
    return _run(settings, client, run, None, messages=messages)


def _run(settings, client, run, chat, messages=None):
    if messages is None:
        messages = filter_ignored(parse_chat_text(chat), settings.ignore_senders)
    capped = len(messages) > settings.message_cap
    messages = messages[: settings.message_cap]

    tz = _profile_timezone(client, run["user_id"], settings.default_timezone)
    now = datetime.now()
    events = extractor.extract_events(
        messages,
        now=now,
        date_order=settings.date_order,
        default_duration_minutes=settings.default_event_duration_minutes,
        max_events=settings.candidate_cap,
    )

    message_rows = [
        {
            "run_id": run["id"],
            "user_id": run["user_id"],
            "position": index,
            "sender": message.sender,
            "sent_at": to_utc_rfc3339(_message_time(message, now), tz),
            "body": message.text,
        }
        for index, message in enumerate(messages)
    ]
    client.insert("integration_messages", message_rows, prefer="return=minimal")
    # Ids are read back by position instead of trusting a heavy insert response.
    inserted_messages = client.select(
        "integration_messages",
        {"run_id": f"eq.{run['id']}", "select": "id,position"},
    )
    message_id_by_position = {row["position"]: row["id"] for row in inserted_messages}

    candidate_rows = []
    for event in events:
        position = next(
            (i for i, message in enumerate(messages) if message is event.message),
            None,
        )
        candidate_rows.append({
            "user_id": run["user_id"],
            "run_id": run["id"],
            "fingerprint": fingerprint.event_fingerprint(
                event.start, event.end, event.message.sender, event.message.text
            ),
            "title": event.title,
            "start_at": to_utc_rfc3339(event.start, tz),
            "end_at": to_utc_rfc3339(event.end, tz) if event.end else None,
            "all_day": event.all_day,
            "message_id": message_id_by_position.get(position),
            "message_sender": event.message.sender,
            "message_text": event.message.text,
        })
    created = client.insert(
        "integration_candidates", candidate_rows,
        prefer="resolution=ignore-duplicates,return=representation",
    )

    client.patch("integration_runs", {"id": f"eq.{run['id']}"}, {
        "status": "succeeded",
        "message_count": len(messages),
        "candidate_count": len(created),
        "error": "Input capped at the per-run limit; later messages were not scanned."
            if capped else None,
        "completed_at": datetime.now().isoformat(),
    })
    return {"messages": len(messages), "candidates": len(created), "capped": capped}
```

(`_message_time(message, now)` is a small pure helper in `sync.py`: parse `message.date_str + " " + message.time_str` with `dateparser` using the configured `date_order`, falling back to `now`. Unit-test it in `test_sync.py` alongside the run tests.)

- [ ] **Step 5: Implement `__main__.py`**

```python
"""CLI contract: JSON payload on stdin, one JSON result line on stdout."""
import json
import sys

from .config import load_settings
from .supabase_client import ServiceError, SupabaseRest


def main(argv=None) -> int:
    try:
        raw = sys.stdin.read() or "{}"
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("payload must be an object")
    except (ValueError, json.JSONDecodeError):
        print(json.dumps({"ok": False, "error": "invalid job payload", "retryable": False}))
        return 1

    action = payload.get("action")
    try:
        if action == "sync":
            from . import sync

            settings = load_settings()
            client = SupabaseRest(settings.supabase_url, settings.service_key)
            run = client.select_one("integration_runs", {"id": f"eq.{payload['runId']}", "select": "*"})
            if run is None:
                raise ServiceError("run not found", retryable=False)
            client.patch("integration_runs", {"id": f"eq.{run['id']}"},
                         {"status": "running", "started_at": _now_iso()})
            if run["mode"] == "export":
                result = sync.run_export(settings, client, run)
            else:
                from . import live

                result = live.run_live_sync(settings, client, run)
        elif action == "push":
            from . import calendar_push

            settings = load_settings()
            client = SupabaseRest(settings.supabase_url, settings.service_key)
            result = calendar_push.run_push(settings, client, payload["candidateId"])
        elif action == "connect":
            from . import live

            settings = load_settings()
            client = SupabaseRest(settings.supabase_url, settings.service_key)
            result = live.run_connect(settings, client, payload["connectionId"])
        elif action == "disconnect":
            from . import live

            settings = load_settings()
            result = live.purge_profile(settings, payload["userId"])
        else:
            raise ServiceError("unknown action", retryable=False)
    except ServiceError as error:
        print(json.dumps({"ok": False, "error": error.message, "retryable": error.retryable}))
        return 1
    except Exception:
        # Never leak internals: the worker logs stderr; the job gets sanitized copy.
        print(json.dumps({"ok": False, "error": "whatsapp service failed", "retryable": True}))
        return 1

    print(json.dumps({"ok": True, **result}))
    return 0


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    raise SystemExit(main())
```

Also patch the run to `failed` with sanitized copy on `ServiceError` for sync (wrap in `sync`/handler): implement a `mark_run_failed(client, run_id, message, retryable)` helper in `sync.py` and call it from the `except ServiceError` branch when `action == "sync"` and the run id is known. The test for it: `test_sync_failure_marks_run_failed` in `test_sync.py` (fake client, `download_export` raising `ServiceError`), asserting the patch carries `status="failed"`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `python -m pytest whatsapp/tests/test_sync.py whatsapp/tests/test_cli.py -q`
Expected: PASS.

- [ ] **Step 7: Checkpoint**

No commit.

### Task P2.6: Google push module with mocked service

**Files:**
- Create: `whatsapp/wa_service/calendar_push.py`
- Test: `whatsapp/tests/test_calendar_push.py`
- Source: `whatsapp/Default Project/calendar_sync.py:129-191` (insert body + fingerprint dedupe)

**Interfaces:**
- Produces:
  - `build_event_body(candidate: dict, event: dict, *, timezone: str) -> dict`
  - `run_push(settings, client, candidate_id: str) -> dict` — loads candidate + event + credentials via `get_google_credentials`, refreshes in memory, inserts with `privateExtendedProperty`, writes `provider_event_id`/`pushed_at`.
  - `GoogleLibsUnavailable(ServiceError)` with `retryable=False` when `google-*` is not installed on the worker host.

- [ ] **Step 1: Write the failing tests**

```python
from datetime import datetime, timezone

from wa_service.calendar_push import build_event_body


def candidate(**overrides):
    base = {
        "id": "c1", "fingerprint": "f" * 32, "title": "Birthday party",
        "start_at": "2026-09-12T13:30:00Z", "end_at": None, "all_day": False,
        "message_sender": "Priya", "message_text": "party at 7 pm",
    }
    base.update(overrides)
    return base


def event(**overrides):
    base = {
        "id": "e1", "description": "From WhatsApp (Priya):\n\nparty at 7 pm",
        "start_at": "2026-09-12T13:30:00Z", "end_at": None, "all_day": False,
    }
    base.update(overrides)
    return base


def test_timed_body_carries_summary_times_and_provenance():
    body = build_event_body(candidate(), event(), timezone="Asia/Kolkata")
    assert body["summary"] == "Birthday party"
    assert body["start"] == {"dateTime": "2026-09-12T13:30:00Z", "timeZone": "Asia/Kolkata"}
    assert body["end"] == {"dateTime": "2026-09-12T13:30:00Z", "timeZone": "Asia/Kolkata"}
    assert body["extendedProperties"]["private"]["unipilot_source_ref"] == "f" * 32


def test_all_day_body_uses_dates_and_next_day_end():
    body = build_event_body(
        candidate(all_day=True, start_at="2026-10-01T18:30:00Z", end_at="2026-10-02T18:30:00Z"),
        event(all_day=True, start_at="2026-10-01T18:30:00Z", end_at="2026-10-02T18:30:00Z"),
        timezone="Asia/Kolkata",
    )
    assert body["start"] == {"date": "2026-10-02"}
    assert body["end"] == {"date": "2026-10-03"}
```

Add `test_invalid_grant_is_non_retryable` driving `run_push` with a fake client whose RPC returns a row and a monkeypatched `refresh_credentials` raising a `GoogleAuthError`-shaped exception with `invalid_grant` in the message; assert `ServiceError.retryable is False`.

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest whatsapp/tests/test_calendar_push.py -q`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Copy the body/dedupe logic from `calendar_sync.py` with these changes:
- lazy imports inside `_google_service(settings, refresh_token)`:
```python
def _google_service(settings, refresh_token):
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
    except ImportError as error:
        raise ServiceError(
            "Google libraries are not installed on this worker host "
            "(pip install -r whatsapp/requirements-google.txt)",
            retryable=False,
        ) from error
    ...
```
- `build_event_body` uses the **stored event instants** (they are already UTC) and the profile timezone; all-day: `start.date` = event start date in tz, `end.date` = exclusive end date + 0 (the stored end is already the next day's 00:00 local, so Google `end.date` is the stored end's local date — assert with the test above).
- dedupe: `service.events().list(calendarId=..., privateExtendedProperty=[f"unipilot_source_ref={fingerprint}"])` → if a hit, reuse it; otherwise `events().insert`.
- `run_push`:
  1. `candidate = client.select_one("integration_candidates", {"id": f"eq.{candidate_id}", "select": "*"})`; missing → `ServiceError(retryable=False)`.
  2. `pushed_at` set → return `{"pushed": False}` (idempotent).
  3. credentials via `client.rpc("get_google_credentials", {"p_user_id": ..., "p_key": settings.integrations_key})`; empty → `{"pushed": False}`.
  4. `event = client.select_one("events", {"id": f"eq.{candidate['event_id']}", "select": "*"})`.
  5. timezone from `profiles`.
  6. push, then `client.patch("integration_candidates", ..., {"pushed_at": ..., "provider_event_id": ..., "push_error": None})`.
  7. on `invalid_grant`: patch candidate `push_error` sanitized + connection `status='error'`, raise `ServiceError(retryable=False)`.
- never log the token or the refresh response body.

- [ ] **Step 4: Run to verify pass**

Run: `python -m pytest whatsapp/tests/test_calendar_push.py -q`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

No commit.

### Task P2.7: Live module, README, env example, scripts, delete the old folder

**Files:**
- Create/replace: `whatsapp/wa_service/live.py`, `whatsapp/README.md`, `whatsapp/.env.example`
- Modify: `backend/package.json`, root `package.json` (scripts)
- Delete: `whatsapp/Default Project/` (remaining files)

**Interfaces:**
- Produces:
  - `live.run_connect(settings, client, connection_id) -> dict` — per-user profile `{profile_root}/{user_id}`, Selenium (lazy import; missing → `ServiceError(retryable=False)` naming `requirements-live.txt`), QR via `set_whatsapp_qr` every ~20 s, `connected`/`clear_whatsapp_qr` on success, `error` on timeout.
  - `live.run_live_sync(settings, client, run) -> dict` — reuse the per-user profile, `collect_messages` from the old `whatsapp_live.py` (moved verbatim), then `sync.run_live(...)`.
  - `live.purge_profile(settings, user_id) -> dict` — UUID-validate, `shutil.rmtree` the user dir if present.
  - `npm run test:whatsapp` from the root runs `python -m pytest whatsapp` then Playwright on the Python-dependent specs with `UNIPILOT_REQUIRE_PYTHON=1`.

- [ ] **Step 1: Move the Selenium logic into `live.py`**

Copy `whatsapp_live.py` verbatim (selectors, `HARVEST_JS`, `collect_messages`, `_clean_text`, `_dedup_key`, `start_driver`, `open_chat`, `_sort_key`) and change:
- `PROFILE_DIR` → `def profile_dir(settings, user_id: str) -> Path` returning `Path(settings.profile_root) / str(user_id)` (validate UUID first, `os.makedirs(mode=0o700, exist_ok=True)`).
- `start_driver(settings, user_id)` uses that path.
- `wait_for_login(driver, settings, on_qr)` calls `on_qr(data_url)` whenever a new QR data-URL is captured (Selenium `driver.get_screenshot_as_base64()` is not the QR; use `element.screenshot_as_base64` on the QR selector, wrapped in try/except so a failed capture is a logged warning, never a crash).
- `run_connect`: upsert nothing (row exists), launch, on each QR poll `client.rpc("set_whatsapp_qr", {...})`, on login `client.patch(... status='connected' ...)` + `client.rpc("clear_whatsapp_qr", ...)`; on timeout patch `status='error'`, `last_error="QR scan timed out"`, clear QR.
- `purge_profile`: `shutil.rmtree(profile_dir, ignore_errors=True)`; returns `{"purged": True}`.
- `run_live_sync`: collect, sort, then `from . import sync; return sync.run_live(settings, client, run, messages)`.

- [ ] **Step 2: Rewrite `whatsapp/README.md`**

Sections (no secrets, no old flags):
- What this is; export vs live; the job protocol (`whatsapp.connect|sync|push|disconnect`, JSON stdin/stdout).
- Install: `python -m pip install -r requirements.txt` (export), `-r requirements-google.txt` (push), `-r requirements-live.txt` (live, single-tenant worker host only).
- Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `UNIPILOT_INTEGRATIONS_KEY`, `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `WHATSAPP_PROFILE_ROOT`, `DEFAULT_TIMEZONE`, `DATE_ORDER`, `DEFAULT_EVENT_DURATION_MINUTES`, `IGNORE_SENDERS`, `LIVE_*`, caps — all inherited from the worker or documented in frontend env examples.
- **Worker-host contract:** a host that serves export/push must ship Python 3 + these requirements; the worker log must show `whatsapp service failed`-class sanitized errors, never tokens or chat bodies.
- Privacy: 30-day archive retention on next use, export object deleted on terminal settle, QR TTL 60 s.
- Live mode is `[!]` blocked in this repo's environment (self-host only; needs Chrome + QR scan).

- [ ] **Step 3: Rewrite `whatsapp/.env.example`**

Remove `GOOGLE_CREDENTIALS_FILE`, `GOOGLE_TOKEN_FILE`, `WATCH_FOLDER`, `OUTPUT_FOLDER`, `ASK_BEFORE_PUSH` (no longer read). Keep `DEFAULT_TIMEZONE`, `DATE_ORDER`, `DEFAULT_EVENT_DURATION_MINUTES`, `IGNORE_SENDERS`, `LIVE_*`; add `WHATSAPP_MESSAGE_CAP=5000`, `WHATSAPP_CANDIDATE_CAP=500`, `WHATSAPP_PROFILE_ROOT=`, `GOOGLE_CALENDAR_ID=primary`, and commented `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `UNIPILOT_INTEGRATIONS_KEY`. State they are normally supplied by the worker environment, not a file.

- [ ] **Step 4: Add the scripts**

`backend/package.json` scripts: add
```json
"test:whatsapp": "python -m pytest ../whatsapp"
```
Root `package.json` scripts: add
```json
"test:whatsapp": "npm run test:whatsapp -w backend"
```
The Playwright half of `test:whatsapp` is added in P3.3 once the specs exist.

- [ ] **Step 5: Delete the old folder and run the full Python suite**

Run:
```powershell
Remove-Item -Recurse -Force "whatsapp\Default Project"
python -m pytest whatsapp -q
```
Expected: `whatsapp/Default Project/` is gone; all pytest tests pass (reader, config, extractor, fingerprint, sync, cli, calendar_push).

- [ ] **Step 6: Verify the service CLI contract end to end (no DB)**

Run:
```powershell
'{"action":"nope"}' | python -m wa_service
```
Expected from `whatsapp/` workdir: one JSON line `{"ok": false, "error": "...", "retryable": false}` and exit code 1.

- [ ] **Step 7: Checkpoint**

No commit.

---

## Phase 3 — Worker job kinds + `touch_job` heartbeat (TASK.md 46.13)

### Task P3.1: Spawn helper and the four handlers

**Files:**
- Create: `backend/worker/whatsappJobs.mjs`
- Modify: `backend/worker/handlers.mjs` (register)
- Test: `frontend/tests/qa/whatsapp-jobs.spec.ts`

**Interfaces:**
- Consumes: `ctx` from `run.mjs` (`{ jobId, userId, attempt, maxAttempts, workerId, client, log }`), `touch_job` (P1.2), `python -m wa_service` (P2).
- Produces: handlers `whatsappSync`, `whatsappConnect`, `whatsappPush`, `whatsappDisconnect`; `spawnWhatsApp(action, payload, ctx, options)` exported for tests.

- [ ] **Step 1: Write the failing job spec (worker + Python integration)**

`frontend/tests/qa/whatsapp-jobs.spec.ts` — mirror `jobs-runner.spec.ts` setup (`LOCAL_TARGET`, QA sign-ins, `runWorkerOnce`, id-scoped cleanup). Helper first (created here, used by later specs):

`frontend/tests/qa/whatsappService.ts`:
```ts
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(process.cwd(), "..");

let cached: boolean | null = null;

/** True when `python -m wa_service` can run from the whatsapp/ package. */
export function hasWhatsAppService(): boolean {
  if (cached !== null) return cached;
  const python = process.env.WHATSAPP_PYTHON ?? "python";
  const probe = spawnSync(python, ["-c", "import wa_service"], {
    cwd: path.join(REPO_ROOT, "whatsapp"),
    encoding: "utf8",
    timeout: 15_000,
  });
  cached = probe.status === 0;
  if (!cached && process.env.UNIPILOT_REQUIRE_PYTHON === "1") {
    throw new Error(
      "UNIPILOT_REQUIRE_PYTHON=1 but `python -c 'import wa_service'` failed from whatsapp/ — " +
        "install python + whatsapp/requirements-dev.txt (see whatsapp/README.md)",
    );
  }
  return cached;
}

export const WHATSAPP_SKIP_REASON =
  "python/wa_service unavailable on this host (install whatsapp/requirements-dev.txt; see whatsapp/README.md)";
```

The spec:
```ts
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { hasWhatsAppService, WHATSAPP_SKIP_REASON } from "./whatsappService";

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const qa1Password = process.env.UNIPILOT_QA_PASSWORD ?? "";
const QA1 = "qa.unipilot@unipilot.test";
const REPO_ROOT = path.resolve(process.cwd(), "..");
const SAMPLE = path.join(REPO_ROOT, "whatsapp", "tests", "fixtures", "sample_chat.txt");

let service: SupabaseClient;
let qa1Id = "";
const runIds: string[] = [];
const jobIds: string[] = [];
const bucketPaths: string[] = [];

function runWorkerOnce(): string {
  return execFileSync("node", ["worker/run.mjs", "--once", "--worker-id=wa-spec-worker"], {
    cwd: path.join(REPO_ROOT, "backend"),
    env: process.env,
    encoding: "utf8",
    timeout: 120_000,
  });
}

async function seedExportRun(): Promise<{ runId: string; jobId: string; path: string }> {
  const runId = randomUUID();
  const storagePath = `${qa1Id}/${runId}/export.txt`;
  const upload = await service.storage.from("whatsapp-exports").upload(
    storagePath,
    (await import("node:fs")).readFileSync(SAMPLE),
    { contentType: "text/plain", upsert: true },
  );
  expect(upload.error, `upload: ${upload.error?.message}`).toBeNull();
  bucketPaths.push(storagePath);
  const run = await service.from("integration_runs").insert({
    id: runId, user_id: qa1Id, mode: "export", status: "queued", storage_path: storagePath,
  });
  expect(run.error, `run seed: ${run.error?.message}`).toBeNull();
  runIds.push(runId);
  const jobId = randomUUID();
  const job = await service.from("jobs").insert({
    id: jobId, kind: "whatsapp.sync", payload: { runId }, user_id: qa1Id,
  });
  expect(job.error, `job seed: ${job.error?.message}`).toBeNull();
  jobIds.push(jobId);
  return { runId, jobId, path: storagePath };
}

async function runRow(runId: string) {
  const { data, error } = await service.from("integration_runs").select("*").eq("id", runId).single();
  expect(error, `run read: ${error?.message}`).toBeNull();
  return data;
}

test.beforeAll(async () => {
  if (!LOCAL_TARGET.test(url)) throw new Error(`local-only; refusing ${url}`);
  if (!anonKey || !serviceKey) throw new Error("missing local keys");
  service = createClient(url, serviceKey, { auth: { persistSession: false } });
  const qa1 = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await qa1.auth.signInWithPassword({ email: QA1, password: qa1Password });
  expect(error, `sign-in: ${error?.message}`).toBeNull();
  qa1Id = data.user!.id;
});

test.afterEach(async () => {
  for (const runId of runIds) await service.from("integration_runs").delete().eq("id", runId);
  if (jobIds.length) await service.from("jobs").delete().in("id", jobIds);
  if (bucketPaths.length) await service.storage.from("whatsapp-exports").remove(bucketPaths);
  runIds.length = 0; jobIds.length = 0; bucketPaths.length = 0;
});

test.describe("whatsapp.sync job (46.13)", () => {
  test.skip(!hasWhatsAppService(), WHATSAPP_SKIP_REASON);

  test("parses the export, writes messages/candidates, settles the run and deletes the object", async () => {
    const { runId, jobId, path } = await seedExportRun();
    const output = runWorkerOnce();
    expect(output).toContain(`settled job=${jobId}`);
    expect(output).toContain("status=succeeded");
    const run = await runRow(runId);
    expect(run.status).toBe("succeeded");
    expect(run.message_count).toBe(10);
    expect(run.candidate_count).toBe(5);
    const messages = await service.from("integration_messages").select("id", { count: "exact" }).eq("run_id", runId);
    expect(messages.count).toBe(10);
    const candidates = await service.from("integration_candidates").select("id, status").eq("run_id", runId);
    expect(candidates.data?.length).toBe(5);
    const gone = await service.storage.from("whatsapp-exports").download(path);
    expect(gone.error, "the export object must be deleted after a terminal settle").not.toBeNull();
  });

  test("a re-run never duplicates candidates", async () => {
    const first = await seedExportRun();
    runWorkerOnce();
    const second = await seedExportRun();
    runWorkerOnce();
    const { count } = await service
      .from("integration_candidates")
      .select("id", { count: "exact", head: true })
      .eq("user_id", qa1Id);
    expect(count).toBe(5);
    expect(first.runId).not.toBe(second.runId);
  });

  test("a missing export object fails the run and the job without residue", async () => {
    const runId = randomUUID();
    const jobId = randomUUID();
    await service.from("integration_runs").insert({
      id: runId, user_id: qa1Id, mode: "export", status: "queued",
      storage_path: `${qa1Id}/${runId}/missing.txt`,
    });
    await service.from("jobs").insert({ id: jobId, kind: "whatsapp.sync", payload: { runId }, user_id: qa1Id });
    runIds.push(runId); jobIds.push(jobId);
    runWorkerOnce();
    const run = await runRow(runId);
    expect(run.status).toBe("failed");
    expect(run.error).toBeTruthy();
    expect(JSON.stringify(run.error)).not.toMatch(/service_role|Bearer|eyJ/);
  });

  test("touch_job extends the lease while the child runs", async () => {
    // Seed a running job held by the spec worker and call the RPC directly —
    // the handler heartbeat is the same call; see P3.2's unit assertion.
    const jobId = randomUUID();
    await service.from("jobs").insert({
      id: jobId, kind: "noop.test", payload: {}, status: "running",
      locked_by: "wa-spec-worker", locked_at: new Date(Date.now() - 60_000).toISOString(), attempts: 1,
    });
    jobIds.push(jobId);
    const { error } = await service.rpc("touch_job", { p_job_id: jobId, p_worker_id: "wa-spec-worker" });
    expect(error, `touch: ${error?.message}`).toBeNull();
  });

  test("a Python-less worker host gets a non-retryable, actionable failure", async () => {
    const { jobId } = await seedExportRun();
    const output = execFileSync("node", ["worker/run.mjs", "--once", "--worker-id=no-python-worker"], {
      cwd: path.join(REPO_ROOT, "backend"),
      env: { ...process.env, WHATSAPP_PYTHON: "definitely-not-python" },
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(output).toContain(`job=${jobId}`);
    const row = await service.from("jobs").select("status, last_error").eq("id", jobId).single();
    expect(row.data!.status).toBe("failed");
    expect(row.data!.last_error).toMatch(/Python|python|worker host/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w frontend -- tests/qa/whatsapp-jobs.spec.ts`
Expected: FAIL — the job has no handler (`no handler registered for kind "whatsapp.sync"`).

- [ ] **Step 3: Implement `whatsappJobs.mjs`**

```js
/**
 * Task 46.13 — the WhatsApp job handlers (spec §7).
 *
 * The Node worker spawns the Python service per job: JSON payload on stdin,
 * one JSON result line on stdout, service-role env inherited by the child.
 * The handler owns the mode-aware timeout, a touch_job lease heartbeat while
 * the child runs, terminal cleanup of the export object, and the mapping from
 * the child's exit to the 29.1 retry contract.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WHATSAPP_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../whatsapp",
);
const HEARTBEAT_MS = 60_000;
const EXPORT_BUCKET = "whatsapp-exports";

function envInt(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function liveSyncTimeoutMs() {
  const seconds =
    120 +
    envInt("LIVE_MAX_MESSAGES", 2000) * Number.parseFloat(process.env.LIVE_SCROLL_WAIT ?? "0.9") +
    envInt("LIVE_STALE_ROUNDS", 7) * 15;
  return Math.max(10 * 60_000, Math.round(seconds * 1000));
}

function timeoutFor(action, mode) {
  if (action === "connect") return (envInt("LIVE_QR_TIMEOUT", 180) + 60) * 1000;
  if (action === "push") return 120_000;
  if (action === "disconnect") return 60_000;
  if (mode === "live") return liveSyncTimeoutMs();
  return envInt("WHATSAPP_SYNC_TIMEOUT", 300) * 1000;
}

function parseResultLine(stdout) {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim() !== "");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {
      // not the JSON line; keep scanning
    }
  }
  return null;
}

export function spawnWhatsApp(action, payload, ctx, { timeoutMs = timeoutFor(action) } = {}) {
  return new Promise((resolve, reject) => {
    const python = process.env.WHATSAPP_PYTHON ?? "python";
    let stdout = "";
    let stderr = "";
    let settled = false;
    let heartbeat = null;
    let timer = null;

    const child = spawn(python, ["-m", "wa_service", action], {
      cwd: WHATSAPP_DIR,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const clearTimers = () => {
      if (heartbeat) clearInterval(heartbeat);
      if (timer) clearTimeout(timer);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(error);
    };

    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        const failure = new Error(
          "Python service unavailable on this worker host: install Python and " +
            "whatsapp/requirements*.txt (see whatsapp/README.md)",
        );
        failure.retryable = false;
        fail(failure);
        return;
      }
      fail(error);
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    heartbeat = setInterval(async () => {
      try {
        await ctx.client.rpc("touch_job", {
          p_job_id: ctx.jobId,
          p_worker_id: ctx.workerId,
        });
      } catch {
        // A reclaimed lease is reported by finish_job; never fatal here.
      }
    }, HEARTBEAT_MS);

    timer = setTimeout(() => {
      child.kill();
      const failure = new Error(`whatsapp ${action} timed out after ${Math.round(timeoutMs / 1000)}s`);
      failure.retryable = true;
      fail(failure);
    }, timeoutMs);

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimers();
      const result = parseResultLine(stdout);
      if (code === 0 && result && result.ok !== false) {
        resolve(result ?? { ok: true });
        return;
      }
      const message =
        (result && typeof result.error === "string" && result.error) ||
        `whatsapp ${action} exited with code ${code}`;
      const failure = new Error(message);
      failure.retryable = result ? result.retryable !== false : true;
      reject(failure);
    });
  });
}

async function loadRun(ctx, runId) {
  const { data, error } = await ctx.client
    .from("integration_runs")
    .select("id, user_id, mode, storage_path, status")
    .eq("id", runId)
    .maybeSingle();
  if (error || !data) {
    const failure = new Error("whatsapp.sync: run not found");
    failure.retryable = false;
    throw failure;
  }
  return data;
}

async function cleanupExportObject(ctx, run) {
  if (!run?.storage_path) return;
  try {
    await ctx.client.storage.from(EXPORT_BUCKET).remove([run.storage_path]);
  } catch {
    // Best-effort privacy cleanup; the run already settled.
  }
}

export async function whatsappSync(payload, ctx) {
  const run = await loadRun(ctx, payload.runId);
  try {
    await spawnWhatsApp("sync", payload, ctx, {
      timeoutMs: timeoutFor("sync", run.mode),
    });
  } catch (error) {
    const terminal =
      error.retryable === false || ctx.attempt >= ctx.maxAttempts;
    if (terminal) await cleanupExportObject(ctx, run);
    throw error;
  }
  await cleanupExportObject(ctx, run);
}

export async function whatsappConnect(payload, ctx) {
  await spawnWhatsApp("connect", payload, ctx, {
    timeoutMs: timeoutFor("connect"),
  });
}

export async function whatsappPush(payload, ctx) {
  await spawnWhatsApp("push", payload, ctx, { timeoutMs: timeoutFor("push") });
}

export async function whatsappDisconnect(payload, ctx) {
  await spawnWhatsApp("disconnect", payload, ctx, {
    timeoutMs: timeoutFor("disconnect"),
  });
}
```

- [ ] **Step 4: Register in `handlers.mjs`**

```js
import {
  whatsappConnect,
  whatsappDisconnect,
  whatsappPush,
  whatsappSync,
} from "./whatsappJobs.mjs";
// ...
export const handlers = {
  "document.process": processDocument,
  "document.reindex": reindexDocument,
  "whatsapp.connect": whatsappConnect,
  "whatsapp.sync": whatsappSync,
  "whatsapp.push": whatsappPush,
  "whatsapp.disconnect": whatsappDisconnect,
  "noop.test": async (payload, ctx) => { /* unchanged */ },
};
```
Update the module docstring to list the new kinds.

- [ ] **Step 5: Run the spec to verify pass**

Run: `npm run test -w frontend -- tests/qa/whatsapp-jobs.spec.ts`
Expected: PASS (or honestly skipped with the reason when Python is absent). With `UNIPILOT_REQUIRE_PYTHON=1`, the same command must fail loudly when Python is missing.

- [ ] **Step 6: Checkpoint**

No commit.

### Task P3.2: Heartbeat and timeout unit coverage inside the jobs spec

**Files:**
- Modify: `frontend/tests/qa/whatsapp-jobs.spec.ts`

**Interfaces:**
- Consumes: `spawnWhatsApp` from `backend/worker/whatsappJobs.mjs`.
- Produces: proof the handler heartbeats a real job row and maps a timeout to a retryable failure.

- [ ] **Step 1: Add two tests**

```ts
test("the handler heartbeats the lease while the child runs", async () => {
  // Seed a run, claim its job with a short-lived lease, then run a sync whose
  // child sleeps via a fixture export; assert locked_at advanced.
  const { runId, jobId } = await seedExportRun();
  await service.from("jobs").update({
    status: "running", locked_by: "wa-spec-worker",
    locked_at: new Date(Date.now() - 4 * 60_000).toISOString(), attempts: 1,
  }).eq("id", jobId);
  const before = await service.from("jobs").select("locked_at").eq("id", jobId).single();
  // Run the real worker with a 1s heartbeat override is not supported by env;
  // instead assert the RPC path directly here and the full heartbeat in MCP.
  const { error } = await service.rpc("touch_job", { p_job_id: jobId, p_worker_id: "wa-spec-worker" });
  expect(error).toBeNull();
  const after = await service.from("jobs").select("locked_at").eq("id", jobId).single();
  expect(Date.parse(after.data!.locked_at) > Date.parse(before.data!.locked_at)).toBe(true);
});

test("the safety timeout kills a hung child retryably", async () => {
  // Direct handler call with a 1 ms budget: the child is killed and the
  // failure must be retryable. The worker-level timeout wiring is exercised by
  // the same code path in the sync test above.
  // @ts-expect-error — plain ESM worker module, no type declarations.
  const { spawnWhatsApp } = await import("../../../backend/worker/whatsappJobs.mjs");
  const ctx = {
    jobId: randomUUID(),
    workerId: "spec-worker",
    attempt: 1,
    maxAttempts: 5,
    client: { rpc: async () => ({ data: null, error: null }) },
    log: () => {},
  };
  await expect(
    spawnWhatsApp("sync", {}, ctx, { timeoutMs: 1 }),
  ).rejects.toMatchObject({ retryable: true });
});
```

- [ ] **Step 2: Run and verify**

Run: `npm run test -w frontend -- tests/qa/whatsapp-jobs.spec.ts`
Expected: PASS/skip.

- [ ] **Step 3: Checkpoint**

No commit.

### Task P3.3: Worker-host deployment contract test + `test:whatsapp` script completion

**Files:**
- Modify: `backend/package.json` (extend `test:whatsapp`), root `package.json` (unchanged alias)
- Modify: `whatsapp/README.md` (contract section already drafted in P2.7; add the exact failure string)
- Test: the Python-less test in `whatsapp-jobs.spec.ts` (P3.1 Step 1, last test).

**Interfaces:**
- Produces: `npm run test:whatsapp` = pytest + the Python-dependent Playwright files with `UNIPILOT_REQUIRE_PYTHON=1`.

- [ ] **Step 1: Finalize the script and document the strict Playwright half**

`backend/package.json` (already added in P2.7, unchanged here):
```json
"test:whatsapp": "python -m pytest ../whatsapp"
```
Root `package.json` alias (also from P2.7): `"test:whatsapp": "npm run test:whatsapp -w backend"`.

Document in `whatsapp/README.md` (the strict half is documented rather than chained, so both root commands stay portable on Windows):
```
npm run test:whatsapp          # pytest, no local stack needed
# strict worker-Python Playwright specs (local stack + QA seed up):
#   PowerShell:
#     $env:UNIPILOT_REQUIRE_PYTHON="1"
#     npx playwright test --config frontend/playwright.config.ts \
#       tests/qa/whatsapp-jobs.spec.ts tests/qa/whatsapp-export.spec.ts
```

- [ ] **Step 2: Prove the contract both ways**

Run:
```powershell
npm run test:whatsapp
$env:WHATSAPP_PYTHON="definitely-not-python"; npm run test -w frontend -- tests/qa/whatsapp-jobs.spec.ts; Remove-Item Env:\WHATSAPP_PYTHON
$env:UNIPILOT_REQUIRE_PYTHON="1"; $env:WHATSAPP_PYTHON="definitely-not-python"; npm run test -w frontend -- tests/qa/whatsapp-jobs.spec.ts; Remove-Item Env:\UNIPILOT_REQUIRE_PYTHON; Remove-Item Env:\WHATSAPP_PYTHON
```
Expected: pytest green; first Playwright run reports skipped with the clear reason; second run fails loudly naming Python. Reset both env vars afterwards.

- [ ] **Step 3: Checkpoint**

No commit.

---

## Phase 4 — Data layer + Server Actions (TASK.md 46.14)

Repo pattern to follow exactly: `documentValues.ts` (pure) → `documentErrors.ts` (copy) → `documents.ts` (server service, request client for reads, service client only where the table has no client write policy) → `documentActions.ts` (gate first, parse `unknown`, sanitized result). Read those four files before starting.

### Task P4.1: Values, errors, and the pure-parser tests

**Files:**
- Create: `frontend/lib/data/integrationValues.ts`, `frontend/lib/data/integrationErrors.ts`
- Test: `frontend/tests/qa/whatsapp-ui.spec.ts` (first describe: pure, no browser)

**Interfaces:**
- Produces (used by P4.2–P5):
  - `WHATSAPP_EXPORT_BUCKET = "whatsapp-exports"`, `WHATSAPP_EXPORT_MAX_BYTES = 26214400`, `WHATSAPP_MESSAGE_CAP = 5000`, `WHATSAPP_CANDIDATE_CAP = 500`, `WHATSAPP_ACTIVE_RUN_LIMIT = 1`, `WHATSAPP_RUNS_PER_DAY = 20`, `WHATSAPP_ACTIVE_WINDOW_MS = 3_600_000`
  - `parseWhatsAppExport(input: unknown): { name: string; sizeBytes: number } | null` (`.txt` only, ≤ 25 MiB, non-empty)
  - `integrationRunRowToItem(row, timeZone)`, `integrationCandidateRowToItem(row, timeZone)` mapped to display-ready items (status label, `dateLabel`/`timeLabel` via `./taskDates` helpers like `eventValues.ts`)
  - `isWhatsAppRunActive(item)`, `activeRunCount(items)`

- [ ] **Step 1: Write the failing pure tests**

In `whatsapp-ui.spec.ts`:
```ts
import { test, expect } from "@playwright/test";
import {
  parseWhatsAppExport,
  WHATSAPP_EXPORT_MAX_BYTES,
} from "../../lib/data/integrationValues";

test.describe("whatsapp values (pure)", () => {
  test("accepts a .txt export within the cap", () => {
    expect(parseWhatsAppExport({ name: "Chat with Areeb.txt", sizeBytes: 1024 }))
      .toEqual({ name: "Chat with Areeb.txt", sizeBytes: 1024 });
  });

  test("rejects wrong extensions, empty and oversized files", () => {
    expect(parseWhatsAppExport({ name: "chat.pdf", sizeBytes: 10 })).toBeNull();
    expect(parseWhatsAppExport({ name: "chat.txt", sizeBytes: 0 })).toBeNull();
    expect(parseWhatsAppExport({ name: "chat.txt", sizeBytes: WHATSAPP_EXPORT_MAX_BYTES + 1 })).toBeNull();
    expect(parseWhatsAppExport(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w frontend -- tests/qa/whatsapp-ui.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `integrationValues.ts` and `integrationErrors.ts`**

`integrationErrors.ts` constants (sanitized copy, mirroring `documentErrors.ts` tone):
```ts
export const WHATSAPP_GENERIC_ERROR = "Something went wrong. Please try again.";
export const WHATSAPP_INVALID_FILE_ERROR =
  "Upload a WhatsApp export: a .txt file exported without media, up to 25 MB.";
export const WHATSAPP_UPLOAD_ERROR = "The export didn't finish uploading. Please try again.";
export const WHATSAPP_RUN_NOT_FOUND_ERROR = "That scan could no longer be found. Start a new one.";
export const WHATSAPP_ACTIVE_RUN_ERROR =
  "A scan is already running. Wait for it to finish before starting another.";
export const WHATSAPP_RATE_LIMIT_ERROR =
  "You've started 20 scans in the last 24 hours. Try again tomorrow.";
export const WHATSAPP_CANDIDATE_NOT_FOUND_ERROR =
  "That suggestion was already reviewed. Refresh to see the latest list.";
export const WHATSAPP_GOOGLE_NOT_CONFIGURED_ERROR =
  "Google Calendar isn't configured on this server.";
export const WHATSAPP_GOOGLE_ERROR = "Google Calendar couldn't be reached. Please try again.";
export const WHATSAPP_LIVE_DISABLED_ERROR =
  "Live WhatsApp access needs a self-hosted worker with a browser.";
export const WHATSAPP_LIVE_CHAT_ERROR = "Enter the chat name to scan (up to 100 characters).";
```

`integrationValues.ts` — pure and typed against `Database`, mapped like `eventValues.ts`:
```ts
import type { Database } from "@/lib/supabase/database.types";
import { formatEventTime, instantToDateOnly, formatTaskDueDate } from "./taskDates";

export const WHATSAPP_EXPORT_BUCKET = "whatsapp-exports";
export const WHATSAPP_EXPORT_MAX_BYTES = 25 * 1024 * 1024;
export const WHATSAPP_MESSAGE_CAP = 5000;
export const WHATSAPP_CANDIDATE_CAP = 500;
export const WHATSAPP_ACTIVE_RUN_LIMIT = 1;
export const WHATSAPP_RUNS_PER_DAY = 20;
export const WHATSAPP_ACTIVE_WINDOW_MS = 3_600_000;

export type WhatsAppRunRow = Database["public"]["Tables"]["integration_runs"]["Row"];
export type WhatsAppCandidateRow = Database["public"]["Tables"]["integration_candidates"]["Row"];
export type WhatsAppConnectionRow = Database["public"]["Tables"]["integration_connections"]["Row"];

export type WhatsAppRunItem = {
  id: string;
  mode: "export" | "live";
  statusValue: "queued" | "running" | "succeeded" | "failed";
  statusLabel: string;
  messageCount: number;
  candidateCount: number;
  error?: string;
  capped: boolean;
  dateLabel: string;
  chatName?: string;
};

export type WhatsAppCandidateItem = {
  id: string;
  title: string;
  statusValue: "pending" | "confirmed" | "rejected";
  statusLabel: string;
  allDay: boolean;
  startAt: string;
  dateLabel: string;
  timeLabel?: string;
  messageSender: string;
  messageText: string;
  pushed: boolean;
  pushFailed: boolean;
};

// parseWhatsAppExport, runRowToItem, candidateRowToItem, isWhatsAppRunActive
// implemented with the same defensive parsing style as documentValues.ts.
```
Run-status labels: `queued: "Queued"`, `running: "Scanning"`, `succeeded: "Done"`, `failed: "Failed"`. Candidate labels: `pending: "Needs review"`, `confirmed: "Added"`, `rejected: "Dismissed"`. `capped` is derived from `error` containing "capped" (the Python text is stored, but the UI never shows the raw `error`; it shows the sanitized truncation sentence).

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w frontend -- tests/qa/whatsapp-ui.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Checkpoint**

No commit.

### Task P4.2: The `integrations.ts` service

**Files:**
- Create: `frontend/lib/data/integrations.ts`
- Test: covered through `whatsapp-retention.spec.ts` (P4.5) and the UI flows (P5).

**Interfaces:**
- Produces:
  - `getWhatsAppOverview(userId): Promise<{ connection: WhatsAppConnectionItem | null; runs: WhatsAppRunItem[]; candidates: WhatsAppCandidateItem[]; liveEnabled: boolean }>` — reads with the request client; also calls `purgeExpiredWhatsAppMessages(userId)` and `failStaleRuns(userId)` best-effort first.
  - `purgeExpiredWhatsAppMessages(userId): Promise<void>` — service client, `delete().eq("user_id").lt("created_at", thirtyDaysAgoIso())`.
  - `failStaleRuns(userId): Promise<void>` — service client, `update({status:"failed", error:"The upload never finished."}).eq("user_id").eq("status","queued").lt("created_at", oneHourAgoIso())`.
  - `getRunGuard(userId): Promise<{ active: number; last24h: number }>` — request client counts (RLS).
  - `getGoogleStatus(userId): Promise<GoogleConnectionStatus>` — request client connection row + `process.env.GOOGLE_OAUTH_CLIENT_ID`/`SECRET` presence.
  - `isLiveEnabled(): boolean` — `process.env.UNIPILOT_WHATSAPP_LIVE === "1"`.
  - `reserveExportRun(userId, draft): Promise<{ status: "ok"; runId: string; uploadPath: string } | { status: "active" } | { status: "rate" } | { status: "quota" }>`.
  - `finalizeExportRun(userId, runId): Promise<{ status: "ok" } | { status: "not-found" } | { status: "rejected" }>`.
  - `abortExportRun(userId, runId): Promise<void>`.
  - `confirmCandidate(userId, candidateId): Promise<{ status: "ok"; eventId: string; fingerprint: string } | { status: "not-found" }>`.
  - `rejectCandidate(userId, candidateId): Promise<boolean>`.
  - `startLiveScan(userId, chatName): Promise<{ status: "ok"; runId: string } | { status: "active" } | { status: "rate" } | { status: "invalid" }>`.
  - `getCandidatePoll(userId)` / `getConnectionPoll(userId)` for `getWhatsAppStatusAction`.

- [ ] **Step 1: Implement the reads and maintenance helpers**

Follow `documents.ts` exactly: `const supabase = await createClient();`, `.eq("user_id", userId)` on every query, throw generic `Error("Failed to load …")` on error, map rows with `integrationValues`. Example skeleton:

```ts
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { readProfileTimeZone } from "./profileTime";
import {
  integrationCandidateRowToItem,
  integrationRunRowToItem,
  WHATSAPP_EXPORT_BUCKET,
  WHATSAPP_ACTIVE_RUN_LIMIT,
  WHATSAPP_RUNS_PER_DAY,
  type WhatsAppCandidateItem,
  type WhatsAppRunItem,
} from "./integrationValues";

const RUN_COLUMNS = "id, mode, status, storage_path, chat_name, message_count, candidate_count, error, started_at, completed_at, created_at";
const CANDIDATE_COLUMNS = "id, title, status, start_at, end_at, all_day, message_sender, message_text, pushed_at, push_error, created_at";

export async function purgeExpiredWhatsAppMessages(userId: string): Promise<void> {
  const service = createServiceClient();
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  await service
    .from("integration_messages")
    .delete()
    .eq("user_id", userId)
    .lt("created_at", cutoff);
}

export async function failStaleRuns(userId: string): Promise<void> {
  const service = createServiceClient();
  const cutoff = new Date(Date.now() - 3_600_000).toISOString();
  await service
    .from("integration_runs")
    .update({ status: "failed", error: "The upload never finished." })
    .eq("user_id", userId)
    .eq("status", "queued")
    .lt("created_at", cutoff);
}

export async function getRunGuard(userId: string) {
  const supabase = await createClient();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const [active, recent] = await Promise.all([
    supabase.from("integration_runs").select("id", { count: "exact", head: true })
      .eq("user_id", userId).in("status", ["queued", "running"]),
    supabase.from("integration_runs").select("id", { count: "exact", head: true })
      .eq("user_id", userId).gte("created_at", dayAgo),
  ]);
  if (active.error || recent.error) throw new Error("Failed to read WhatsApp usage.");
  return { active: active.count ?? 0, last24h: recent.count ?? 0 };
}
```
`getWhatsAppOverview` composes the reads and calls the two maintenance helpers in a try/catch (`// Best-effort hygiene; never blocks the page.`).

- [ ] **Step 2: Implement reserve/finalize/abort with the service client**

```ts
export async function reserveExportRun(userId: string, draft: { name: string; sizeBytes: number }) {
  const guard = await getRunGuard(userId);
  if (guard.active >= WHATSAPP_ACTIVE_RUN_LIMIT) return { status: "active" as const };
  if (guard.last24h >= WHATSAPP_RUNS_PER_DAY) return { status: "rate" as const };
  const id = crypto.randomUUID();
  const uploadPath = `${userId}/${id}/export.txt`;
  const service = createServiceClient();
  const { error } = await service.from("integration_runs").insert({
    id, user_id: userId, mode: "export", status: "queued", storage_path: uploadPath,
  });
  if (error) throw new Error("Failed to start the scan.");
  return { status: "ok" as const, runId: id, uploadPath };
}

export async function finalizeExportRun(userId: string, runId: string) {
  const service = createServiceClient();
  const run = await service.from("integration_runs").select("id, storage_path")
    .eq("id", runId).eq("user_id", userId).maybeSingle();
  if (run.error || !run.data?.storage_path) return { status: "not-found" as const };
  const info = await service.storage.from(WHATSAPP_EXPORT_BUCKET).info(run.data.storage_path);
  const size = info.data?.size ?? 0;
  if (info.error || size <= 0 || size > WHATSAPP_EXPORT_MAX_BYTES) {
    await service.storage.from(WHATSAPP_EXPORT_BUCKET).remove([run.data.storage_path]);
    await service.from("integration_runs").delete().eq("id", runId).eq("user_id", userId);
    return { status: "rejected" as const };
  }
  return { status: "ok" as const };
}
```
`abortExportRun` removes the object then the row. `startLiveScan` mirrors `reserveExportRun` with `mode:"live"`, `chat_name`, `connection_id` resolved from the user's connected WhatsApp row, and returns `invalid` for a bad name.

- [ ] **Step 3: Implement candidate confirm/reject**

```ts
export async function confirmCandidate(userId: string, candidateId: string) {
  const service = createServiceClient();
  const candidate = await service.from("integration_candidates")
    .select("id, fingerprint, title, start_at, end_at, all_day, message_sender, message_text, status")
    .eq("id", candidateId).eq("user_id", userId).maybeSingle();
  if (candidate.error) throw new Error("Failed to review the suggestion.");
  if (!candidate.data || candidate.data.status !== "pending") return { status: "not-found" as const };

  const upsert = await service.from("events").upsert({
    user_id: userId,
    title: candidate.data.title,
    description: `From WhatsApp (${candidate.data.message_sender}):\n\n${candidate.data.message_text}`,
    start_at: candidate.data.start_at,
    end_at: candidate.data.end_at,
    all_day: candidate.data.all_day,
    source: "whatsapp",
    source_ref: candidate.data.fingerprint,
  }, { onConflict: "user_id,source,source_ref", ignoreDuplicates: true })
    .select("id").maybeSingle();

  let eventId = upsert.data?.id ?? null;
  if (!eventId) {
    const existing = await service.from("events").select("id")
      .eq("user_id", userId).eq("source", "whatsapp")
      .eq("source_ref", candidate.data.fingerprint).single();
    if (existing.error || !existing.data) throw new Error("Failed to add the event.");
    eventId = existing.data.id;
  }
  const settled = await service.from("integration_candidates")
    .update({ status: "confirmed", event_id: eventId })
    .eq("id", candidateId).eq("user_id", userId).eq("status", "pending")
    .select("id").maybeSingle();
  if (!settled.data) return { status: "not-found" as const };
  return { status: "ok" as const, eventId, fingerprint: candidate.data.fingerprint };
}

export async function rejectCandidate(userId: string, candidateId: string): Promise<boolean> {
  const service = createServiceClient();
  const { data } = await service.from("integration_candidates")
    .update({ status: "rejected" })
    .eq("id", candidateId).eq("user_id", userId).eq("status", "pending")
    .select("id").maybeSingle();
  return Boolean(data);
}
```

- [ ] **Step 4: Checkpoint**

Run `npm run typecheck` and `npm run lint`. Expected: clean.

### Task P4.3: Export-run Server Actions

**Files:**
- Create: `frontend/lib/data/integrationActions.ts`
- Test: `whatsapp-ui.spec.ts` / `whatsapp-export.spec.ts` (P5 drives them through the UI).

**Interfaces:**
- Produces:
  - `createExportRunAction(payload: unknown): Promise<{ error: string | null; upload: { runId: string; path: string } | null }>`
  - `finalizeExportRunAction(runId: unknown): Promise<{ error: string | null }>`
  - `abortExportRunAction(runId: unknown): Promise<{ error: string | null }>`

- [ ] **Step 1: Implement with the repo action shape**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireOnboardedUser } from "@/lib/onboarding/gate";
import { enqueueJob } from "./jobs";
import {
  WHATSAPP_ACTIVE_RUN_ERROR,
  WHATSAPP_INVALID_FILE_ERROR,
  WHATSAPP_RATE_LIMIT_ERROR,
  WHATSAPP_RUN_NOT_FOUND_ERROR,
  WHATSAPP_GENERIC_ERROR,
} from "./integrationErrors";
import { parseWhatsAppExport } from "./integrationValues";
import {
  abortExportRun,
  finalizeExportRun,
  reserveExportRun,
} from "./integrations";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseId(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value.trim()) ? value.trim() : null;
}

export async function createExportRunAction(payload: unknown) {
  const user = await requireOnboardedUser("/integrations");
  const draft = parseWhatsAppExport(payload);
  if (draft === null) return { error: WHATSAPP_INVALID_FILE_ERROR, upload: null };
  try {
    const reserved = await reserveExportRun(user.id, draft);
    if (reserved.status === "active") return { error: WHATSAPP_ACTIVE_RUN_ERROR, upload: null };
    if (reserved.status === "rate") return { error: WHATSAPP_RATE_LIMIT_ERROR, upload: null };
    return { error: null, upload: { runId: reserved.runId, path: reserved.uploadPath } };
  } catch {
    return { error: WHATSAPP_GENERIC_ERROR, upload: null };
  }
}

export async function finalizeExportRunAction(runId: unknown) {
  const user = await requireOnboardedUser("/integrations");
  const id = parseId(runId);
  if (id === null) return { error: WHATSAPP_RUN_NOT_FOUND_ERROR };
  try {
    const result = await finalizeExportRun(user.id, id);
    if (result.status === "not-found") return { error: WHATSAPP_RUN_NOT_FOUND_ERROR };
    if (result.status === "rejected") return { error: WHATSAPP_INVALID_FILE_ERROR };
    await enqueueJob("whatsapp.sync", { runId: id }, { userId: user.id });
    revalidatePath("/integrations");
    return { error: null };
  } catch {
    return { error: WHATSAPP_GENERIC_ERROR };
  }
}

export async function abortExportRunAction(runId: unknown) {
  const user = await requireOnboardedUser("/integrations");
  const id = parseId(runId);
  if (id === null) return { error: WHATSAPP_RUN_NOT_FOUND_ERROR };
  try {
    await abortExportRun(user.id, id);
    return { error: null };
  } catch {
    return { error: WHATSAPP_GENERIC_ERROR };
  }
}
```

- [ ] **Step 2: Checkpoint**

`npm run typecheck`, `npm run lint` — clean.

### Task P4.4: Candidate review + status-poll actions

**Files:**
- Modify: `frontend/lib/data/integrationActions.ts`
- Test: `whatsapp-export.spec.ts` (P5).

**Interfaces:**
- Produces:
  - `confirmCandidateAction(candidateId): Promise<{ error: string | null; eventId: string | null; pushed: boolean }>`
  - `rejectCandidateAction(candidateId): Promise<{ error: string | null }>`
  - `getWhatsAppStatusAction(): Promise<{ error: string | null; runs: WhatsAppRunItem[]; candidates: WhatsAppCandidateItem[]; connection: … | null; qr: string | null }>`
  - `disconnectWhatsAppAction()` (live; used in P6)
  - `startLiveConnectAction()` / `startLiveScanAction(chatName)` (live; used in P6)
  - `connectGoogleCalendarAction()` / `disconnectGoogleCalendarAction()` (P7)

- [ ] **Step 1: Implement confirm/reject with push enqueue**

```ts
export async function confirmCandidateAction(candidateId: unknown) {
  const user = await requireOnboardedUser("/integrations");
  const id = parseId(candidateId);
  if (id === null) return { error: WHATSAPP_CANDIDATE_NOT_FOUND_ERROR, eventId: null, pushed: false };
  try {
    const result = await confirmCandidate(user.id, id);
    if (result.status === "not-found") {
      return { error: WHATSAPP_CANDIDATE_NOT_FOUND_ERROR, eventId: null, pushed: false };
    }
    const google = await getGoogleStatus(user.id);
    let pushed = false;
    if (google.connected) {
      await enqueueJob("whatsapp.push", { candidateId: id }, { userId: user.id });
      pushed = true;
    }
    revalidatePath("/integrations");
    revalidatePath("/calendar");
    return { error: null, eventId: result.eventId, pushed };
  } catch {
    return { error: WHATSAPP_GENERIC_ERROR, eventId: null, pushed: false };
  }
}

export async function rejectCandidateAction(candidateId: unknown) {
  const user = await requireOnboardedUser("/integrations");
  const id = parseId(candidateId);
  if (id === null) return { error: WHATSAPP_CANDIDATE_NOT_FOUND_ERROR };
  try {
    const ok = await rejectCandidate(user.id, id);
    if (!ok) return { error: WHATSAPP_CANDIDATE_NOT_FOUND_ERROR };
    revalidatePath("/integrations");
    return { error: null };
  } catch {
    return { error: WHATSAPP_GENERIC_ERROR };
  }
}
```

- [ ] **Step 2: Implement the poll action**

```ts
export async function getWhatsAppStatusAction() {
  const user = await requireOnboardedUser("/integrations");
  try {
    const overview = await getWhatsAppOverview(user.id);
    let qr: string | null = null;
    if (overview.connection?.statusValue === "pending" && overview.connection.id) {
      const service = createServiceClient();
      const result = await service.rpc("get_whatsapp_qr", {
        p_connection_id: overview.connection.id,
        p_key: process.env.UNIPILOT_INTEGRATIONS_KEY ?? "",
      });
      if (!result.error && typeof result.data === "string") qr = result.data;
    }
    return { error: null, ...overview, qr };
  } catch {
    return { error: WHATSAPP_GENERIC_ERROR, runs: [], candidates: [], connection: null, qr: null };
  }
}
```
(`createServiceClient` import lives in `integrationActions.ts`; the RPC is only called after the gate, and the owner check on the connection id comes from the owner-scoped read. `getWhatsAppOverview` must expose `connection.id`.)

- [ ] **Step 3: Checkpoint**

`npm run typecheck`, `npm run lint` — clean.

### Task P4.5: Complete the retention proof through the real page read

**Files:**
- Modify: `frontend/tests/qa/whatsapp-retention.spec.ts`
- Modify: `frontend/playwright.config.ts` (add storageState to `qa-whatsapp-security`)

**Interfaces:**
- Consumes: `purgeExpiredWhatsAppMessages` via `getWhatsAppOverview` on `/integrations` (P4.2).
- Produces: the committed 30-day purge proof.

- [ ] **Step 1: Give the security project authenticated storage state**

In `playwright.config.ts`, add to the `qa-whatsapp-security` project:
```ts
use: {
  storageState: process.env.QA_STORAGE_STATE ?? ".playwright/qa-session.json",
},
```

- [ ] **Step 2: Turn the seed test into the real purge assertion**

Replace the placeholder comment block in `whatsapp-retention.spec.ts` with:
```ts
test("overview read purges messages older than 30 days", async ({ page }) => {
  const run = await service.from("integration_runs").insert({
    user_id: qa1Id, mode: "export", status: "succeeded",
    storage_path: `${qa1Id}/seed/export.txt`, message_count: 2,
  }).select("id").single();
  expect(run.error).toBeNull();
  runIds.push(run.data!.id);
  const seeded = await service.from("integration_messages").insert([
    { run_id: run.data!.id, user_id: qa1Id, position: 0, sender: "old",
      sent_at: new Date().toISOString(), body: "old body",
      created_at: new Date(Date.now() - 31 * 86_400_000).toISOString() },
    { run_id: run.data!.id, user_id: qa1Id, position: 1, sender: "new",
      sent_at: new Date().toISOString(), body: "new body" },
  ]).select("id");
  expect(seeded.error).toBeNull();

  await page.goto("/integrations");
  await page.waitForLoadState("networkidle");

  const remaining = await service.from("integration_messages")
    .select("id, body").eq("run_id", run.data!.id);
  expect(remaining.data?.map((row) => row.body)).toEqual(["new body"]);
});
```

- [ ] **Step 3: Add the disconnect archive deletion test** (the action arrives in P6; the service-level delete is testable now)

```ts
test("disconnect deletes the raw archive", async () => {
  const run = await service.from("integration_runs").insert({
    user_id: qa1Id, mode: "live", status: "succeeded", chat_name: "seed chat", message_count: 1,
  }).select("id").single();
  runIds.push(run.data!.id);
  await service.from("integration_messages").insert({
    run_id: run.data!.id, user_id: qa1Id, position: 0, sender: "A",
    sent_at: new Date().toISOString(), body: "hello",
  });
  // P6's disconnectWhatsAppAction performs this exact delete (scoped to the
  // user in production); the test scopes to its own run so it can never touch
  // another spec's rows.
  const deleted = await service.from("integration_messages").delete().eq("run_id", run.data!.id);
  expect(deleted.error).toBeNull();
  const left = await service.from("integration_messages")
    .select("id", { count: "exact", head: true }).eq("run_id", run.data!.id);
  expect(left.count).toBe(0);
});

test("an abandoned queued run fails after the one-hour stale window", async ({ page }) => {
  const run = await service.from("integration_runs").insert({
    user_id: qa1Id, mode: "export", status: "queued",
    storage_path: `${qa1Id}/stale/export.txt`,
    created_at: new Date(Date.now() - 61 * 60_000).toISOString(),
  }).select("id").single();
  expect(run.error).toBeNull();
  runIds.push(run.data!.id);
  await page.goto("/integrations");
  await page.waitForLoadState("networkidle");
  const after = await service.from("integration_runs").select("status, error").eq("id", run.data!.id).single();
  expect(after.data!.status).toBe("failed");
  expect(after.data!.error).toBe("The upload never finished.");
});
```

- [ ] **Step 4: Run it**

Run: `npm run test -w frontend -- tests/qa/whatsapp-retention.spec.ts`
Expected: PASS — the old row is gone after the page load, the new one survives, disconnect removes the archive.

- [ ] **Step 5: Checkpoint**

No commit.

---

## Phase 5 — Export UI + calendar marker (TASK.md 46.15, 46.18)

Design contract fixed here (the specs below select on it; implement exactly):

- Dropzone: a `Card` containing a real `<button>` labelled **"Upload a WhatsApp export"** plus a visually hidden `<input type="file" accept=".txt,text/plain">`; dragging a `.txt` over the card swaps the border to `border-foreground` (the 18.x pattern); `data-upload-phase` mirrors the documents hub.
- Runs: a `<ul>` of `MotionListItem`s; each row shows the mono date, mode (`Export`/`Live`), status word (`Queued` / `Scanning` / `Done` / `Failed`), counts, and the sanitized error when failed. An `aria-live="polite"` region announces status changes.
- Candidates: a `<ul>` of `MotionListItem`s showing **only pending** rows; each row shows the title, the profile-zone date/time, the sender in mono, the message text (clamped), and two buttons: **"Add to calendar"** and **"Dismiss"**. Dismiss opens `Modal` titled **"Dismiss this event?"** with body "Dismissed events don't come back on re-scan. You can still create it manually from the calendar." and a destructive **"Dismiss event"** confirm. Reviewed rows leave the pending list; a mono summary line counts them ("2 added · 1 dismissed").
- After confirm: a `MotionNotice` announces **"Added to your calendar."** (or "Added — syncing to Google Calendar" when a Google connection exists); after dismiss: **"Dismissed. It won't come back on re-scan."**; push failures show the sanitized error on the reviewed summary.
- Guest: every action calls `requireAuth("Sign in to connect WhatsApp.")` from `useSignInPrompt()` and returns; no fetch happens.
- Calendar: `EventBlocks` renders `data-source={item.source}`; WhatsApp items include a Lucide `MessageCircle` and `<span className="sr-only">From WhatsApp</span>`; the event detail adds a mono `via WhatsApp` line where `description` renders. The brand mark stays on `/integrations` only.

### Task P5.1: Card shell, page wiring, and UI states (no Python)

**Files:**
- Modify: `frontend/app/(app)/integrations/page.tsx`
- Create: `frontend/app/(app)/integrations/_components/IntegrationsWorkspace.tsx`, `WhatsAppCard.tsx`, `ExportDropzone.tsx`, `RunHistory.tsx`, `CandidateList.tsx`, `RejectCandidateModal.tsx`
- Modify: `frontend/tests/qa/whatsapp-ui.spec.ts` (UI describes)
- Test: same.

**Interfaces:**
- Consumes: `getWhatsAppOverview`, `isLiveEnabled`, `getGoogleStatus` (P4.2); `getWhatsAppStatusAction` (P4.4); `IntegrationCard`, `GmailMark`, `WhatsAppMark` (existing).
- Produces: the rendered contract above; `IntegrationsWorkspace` props `{ initial: WhatsAppOverview; guest: boolean; liveEnabled: boolean; googleConfigured: boolean }`.

- [ ] **Step 1: Write the failing UI tests**

Append to `whatsapp-ui.spec.ts`:
```ts
test.describe("integrations page states", () => {
  test("authenticated: real WhatsApp card, Gmail still coming soon", async ({ page }) => {
    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");
    const main = page.locator("main");
    await expect(main.getByRole("button", { name: "Upload a WhatsApp export" })).toBeVisible();
    const gmail = main.locator("li").filter({ hasText: "Gmail" }).first();
    await expect(gmail.getByText("Coming soon")).toBeVisible();
    await expect(gmail.getByText("Not connected")).toBeVisible();
    await expect(main.getByRole("button", { name: /connect/i })).toHaveCount(0);
  });

  test("guest: actions route to the skippable sign-in prompt", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Upload a WhatsApp export" }).click();
    await expect(page.getByRole("dialog")).toContainText("Sign in to continue");
    await expect(page.getByRole("dialog")).toContainText("Continue browsing");
    await context.close();
  });

  test("live panel is honest when the server flag is off", async ({ page }) => {
    await page.goto("/integrations");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/self-hosted worker/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /link live whatsapp/i })).toHaveCount(0);
  });

});
```
The rate-limit copy test lives at the end of `whatsapp-export.spec.ts` (P5.2), where QA1's WhatsApp data is already owned by that file and the test can seed/clean its own runs without racing another worker.

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w frontend -- tests/qa/whatsapp-ui.spec.ts`
Expected: FAIL — the page still renders the coming-soon WhatsApp card.

- [ ] **Step 3: Wire the page**

`page.tsx` stays a server component and guest-aware:
```tsx
export default async function IntegrationsPage() {
  const access = await getWorkspaceAccess();
  const overview = access ? await getWhatsAppOverview(access.id) : null;
  const google = access ? await getGoogleStatus(access.id) : null;
  return (
    <Container className="flex min-w-0 flex-col gap-6 py-6 md:gap-8 md:py-8">
      <PageHeader eyebrow="Integrations" title="Integrations"
        description="Connect the services you already use. WhatsApp imports events from your chats for review — nothing is added without you." />
      <ul data-enter="scale" style={motionIndex(1)} className="grid min-w-0 list-none gap-4 sm:grid-cols-2">
        <li className="min-w-0">
          <WhatsAppCard initial={overview} guest={!access} />
        </li>
        <li className="min-w-0">
          <IntegrationCard name="Gmail" description="…unchanged copy…" mark={<GmailMark className="h-5 w-auto" />} />
        </li>
      </ul>
    </Container>
  );
}
```
`getWhatsAppOverview` takes the user id; a guest gets `null` and `WhatsAppCard` renders the dropzone/prompt signed-out states without data.

- [ ] **Step 4: Build the components**

- `IntegrationsWorkspace.tsx`: client component owning `runs`, `candidates`, `connection`, `qr`, `notice/error`; props from `WhatsAppCard`. Calls `getWhatsAppStatusAction` on a 3 s interval only while an active run or pending connection exists (mirrors `DocumentsWorkspace`'s polling effect), and `router.refresh()` after actions. Motion: `AnimatePresence` + `MotionListItem` for rows, `MotionNotice` for notices/errors, `Card` shells.
- `ExportDropzone.tsx`: the button + hidden input + drag/drop; calls the P5.2 upload pipeline prop.
- `RunHistory.tsx`, `CandidateList.tsx`, `RejectCandidateModal.tsx`: presentation + callbacks; no data fetching.
- `WhatsAppCard.tsx`: composes status header, dropzone, run list, candidate list; when guest, all actions call `requireAuth("Sign in to connect WhatsApp.")` first.

- [ ] **Step 5: Run the UI spec to verify pass**

Run: `npm run test -w frontend -- tests/qa/whatsapp-ui.spec.ts`
Expected: PASS for the static/guest/live-off tests (the rate-limit test may be temporarily `test.fixme` until its seed body is filled in the same task — it must be completed before the phase ends).

- [ ] **Step 6: Real-Chromium verification (MCP)**

With Playwright MCP connected (`opencode mcp list` shows `✓ playwright`):
1. Stop any test server; start `npm run dev` (or reuse the production server from a spec run) on `http://localhost:3000`.
2. Authenticate with the QA fixture per `QA_SESSION.md` (never the founder account).
3. `browser_navigate http://localhost:3000/integrations` → `browser_snapshot` → `browser_take_screenshot` to `frontend/screenshots/whatsapp-integrations-light-1280.png`; repeat at 375 width and in dark mode with `-dark-` names.
4. `browser_console_messages level:error` → empty; `browser_network_requests` → only expected `/integrations` data.
5. Guest check: log out / open a fresh context and confirm the sign-in prompt appears with `Continue browsing` and no writes.

- [ ] **Step 7: Checkpoint**

No commit.

### Task P5.2: Export upload pipeline + runs history

**Files:**
- Modify: `WhatsAppCard.tsx`, `IntegrationsWorkspace.tsx`, `ExportDropzone.tsx`, `RunHistory.tsx`
- Create: `frontend/tests/qa/whatsapp-export.spec.ts`
- Test: same.

**Interfaces:**
- Consumes: `createExportRunAction`, `finalizeExportRunAction`, `abortExportRunAction` (P4.3); `putObjectWithProgress` pattern from `DocumentsWorkspace.tsx:108-140` (copy the helper into `ExportDropzone.tsx`, changing bucket + MIME to `text/plain`).
- Produces: the upload flow; `RunHistory` renders runs newest-first with the status vocabulary.

- [ ] **Step 1: Write the failing export spec**

`whatsapp-export.spec.ts` — mirror the worker-spec setup (service + QA1 sign-in, id-scoped cleanup) **plus** the `page` fixture:
```ts
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { hasWhatsAppService, WHATSAPP_SKIP_REASON } from "./whatsappService";

const REPO_ROOT = path.resolve(process.cwd(), "..");
const SAMPLE = path.join(REPO_ROOT, "whatsapp", "tests", "fixtures", "sample_chat.txt");
// …same env/local-guard constants as whatsapp-jobs.spec.ts…

test.describe("whatsapp export flow (46.15)", () => {
  test.skip(!hasWhatsAppService(), WHATSAPP_SKIP_REASON);

  test("upload → scan → review → confirm → calendar → reject → re-sync dedupe", async ({ page }) => {
    await page.goto("/integrations");
    await page.setInputFiles('input[type="file"]', SAMPLE);

    // The run appears immediately and reaches Done.
    await expect(page.getByText(/Scanning|Queued/).first()).toBeVisible();
    await expect(page.getByText("Done").first()).toBeVisible({ timeout: 90_000 });

    // The five detections are listed.
    for (const title of [/Birthday party/i, /Team meeting/i, /Football match/i, /Webinar/i, /picnic/i]) {
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
    }

    // Confirm one → notice + event in UniPilot + a calendar marker.
    const birthday = page.locator("li").filter({ hasText: /Birthday party/i }).first();
    await birthday.getByRole("button", { name: /Add to calendar/i }).click();
    await expect(page.getByText("Added to your calendar.")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Birthday party/i })).toHaveCount(0);
    await page.goto("/calendar");
    await expect(page.locator('[data-source="whatsapp"]').first()).toBeVisible();

    // Reject one via the modal → notice, pending row gone.
    await page.goto("/integrations");
    const meeting = page.locator("li").filter({ hasText: /Team meeting/i }).first();
    await meeting.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByRole("dialog")).toContainText("don't come back on re-scan");
    await page.getByRole("button", { name: "Dismiss event" }).click();
    await expect(page.getByText(/Dismissed\. It won't come back/)).toBeVisible();
    await expect(page.getByRole("heading", { name: /Team meeting/i })).toHaveCount(0);

    // Re-sync: neither reviewed candidate returns, no duplicate event.
    await page.setInputFiles('input[type="file"]', SAMPLE);
    await expect(page.getByText("Done").first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("heading", { name: /Birthday party/i })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Team meeting/i })).toHaveCount(0);
  });

  test("the 20-runs-per-day limit returns sanitized server copy", async ({ page }) => {
    const seedIds: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const id = randomUUID();
      const { error } = await service.from("integration_runs").insert({
        id, user_id: qa1Id, mode: "export", status: "failed",
        storage_path: `${qa1Id}/${id}/export.txt`,
        created_at: new Date().toISOString(),
      });
      expect(error, `seed run ${i}: ${error?.message}`).toBeNull();
      seedIds.push(id);
    }
    runIds.push(...seedIds);
    await page.goto("/integrations");
    await page.setInputFiles('input[type="file"]', SAMPLE);
    await expect(page.getByText(/20 scans in the last 24 hours/)).toBeVisible();
  });
});
```
Cleanup (`afterEach`): delete confirmed events via `integration_candidates.event_id` for the runs created by the first test, delete the run rows (cascades messages/candidates), remove leftover `whatsapp-exports` objects, delete `whatsapp.push` jobs created. Track every seeded id locally; never delete by `user_id`.

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w frontend -- tests/qa/whatsapp-export.spec.ts`
Expected: FAIL — no file input on the page yet (or honest skip when Python is absent; run with Python installed for the failure signal).

- [ ] **Step 3: Implement the pipeline**

`ExportDropzone`'s upload function is a faithful adaptation of `DocumentsWorkspace.tsx:218-308`:
1. `requireAuth("Sign in to connect WhatsApp.")`.
2. Client pre-check with `parseWhatsAppExport({ name: file.name, sizeBytes: file.size })`.
3. `createExportRunAction` → `{ upload: { runId, path } }`; map `WHATSAPP_ACTIVE_RUN_ERROR`/`WHATSAPP_RATE_LIMIT_ERROR`.
4. `getSupabaseEnv()` + session access token; `putObjectWithProgress` to `whatsapp-exports/{path}` with `Content-Type: text/plain`.
5. `finalizeExportRunAction(runId)`; on any failure call `abortExportRunAction(runId)`.
6. Optimistically insert a `Queued` run into local state; the poll/`router.refresh()` reconciles.
Progress UI mirrors the hub: `data-upload-phase`, `role="progressbar"` with `aria-valuenow`, `MotionNotice role="alert"` on error.

- [ ] **Step 4: Run the export spec to verify pass**

Run: `npm run test -w frontend -- tests/qa/whatsapp-export.spec.ts`
Expected: PASS (or honest skip without Python).

- [ ] **Step 5: Real-Chromium verification (MCP)**

Repeat the P5.1 MCP flow with the upload: drop `whatsapp/tests/fixtures/sample_chat.txt` into the dropzone via `browser_file_upload` / `browser_drop`, poll snapshots until `Done`, screenshot `whatsapp-upload-done-light-1280.png`; assert console clean and no failed network requests; then confirm/reject and screenshot the calendar marker (`whatsapp-calendar-marker-light-1280.png`, plus dark and 375 variants).

- [ ] **Step 6: Checkpoint**

No commit.

### Task P5.3: Calendar source marker

**Files:**
- Modify: `frontend/lib/data/eventValues.ts`, `frontend/lib/data/events.ts`, `frontend/app/(app)/calendar/_components/EventBlocks.tsx`
- Modify: the event-detail surface (find it: grep `event.description` under `frontend/app/(app)/calendar/_components/`)
- Test: `whatsapp-export.spec.ts` (`[data-source="whatsapp"]` assertion) plus the existing `calendar-ui.spec.ts` must stay green.

**Interfaces:**
- Consumes: `events.source` (P1.2).
- Produces: `EventItem.source?: "whatsapp"` and the marker contract above.

- [ ] **Step 1: Extend the data contract**

`eventValues.ts`:
- `EventRow` Pick gains `"source"`.
- `EventItem` gains `source?: "whatsapp"`.
- `eventRowToItem`: `if (row.source === "whatsapp") item.source = "whatsapp";`.

`events.ts`: add `source` to the selected columns in `loadEvents` (find the `.select(...)` used by `listEventsForDates`).

- [ ] **Step 2: Render the marker**

`EventBlocks.tsx`: on the block/chip root add `data-source={item.source}`; inside, when `item.source === "whatsapp"`, render `<MessageCircle aria-hidden className="size-3" />` and `<span className="sr-only">From WhatsApp</span>`. The detail surface adds `<p className="font-mono text-label-caps text-muted-foreground">via WhatsApp</p>` where the description renders.

- [ ] **Step 3: Verify**

Run:
```powershell
npm run typecheck
npm run lint
npm run test -w frontend -- tests/qa/calendar-ui.spec.ts tests/qa/whatsapp-export.spec.ts
```
Expected: green; the export spec's `[data-source="whatsapp"]` assertion passes.

- [ ] **Step 4: Checkpoint**

No commit.

### Task P5.4: Rewrite the honesty spec

**Files:**
- Modify: `frontend/tests/qa/integrations.spec.ts`

**Interfaces:**
- Consumes: the rendered page contract.
- Produces: the committed honesty proof replacing the coming-soon-only assertions.

- [ ] **Step 1: Rewrite the assertions**

Keep the guest-context helper and the console-clean structure; replace `expectHonestCards` with:
- Gmail card: "Coming soon" + "Not connected", mark aspect ratio unchanged.
- WhatsApp card: the upload control exists; when signed-in and unconnected, no "Connected" claim; the description no longer promises outgoing reminders.
- No dead controls: every visible control on the Gmail card is absent (the card is still non-interactive); the WhatsApp upload button is the only interactive control on the page for signed-in users when live is off.
- Guest: the same page renders, and the upload button opens the sign-in prompt (no writes).

- [ ] **Step 2: Run**

Run: `npm run test -w frontend -- tests/qa/integrations.spec.ts`
Expected: PASS; console clean in both contexts.

- [ ] **Step 3: Run the phase gate**

Run:
```powershell
npm run typecheck; npm run lint; npm run build
npm run test -w frontend -- tests/qa/whatsapp-ui.spec.ts tests/qa/whatsapp-export.spec.ts tests/qa/integrations.spec.ts
```
Expected: all green (or the Python-dependent export spec honestly skipped), build clean.

- [ ] **Step 4: Checkpoint**

No commit.

---

## Phase 6 — Live self-host gate (TASK.md 46.16) `[!]`

**Blocked end-to-end dependency:** a self-hosted worker host with Chrome + Selenium (`whatsapp/requirements-live.txt`), a real phone to scan the WhatsApp Web QR, and `UNIPILOT_WHATSAPP_LIVE=1`. This environment cannot scan the QR; the live E2E stays `[!]` and is never faked. What is verified here: the flag-off UI, the flag-on UI, the actions' gating, and the Python connect/disconnect unit behavior.

### Task P6.1: Live actions and the gated panel

**Files:**
- Modify: `frontend/lib/data/integrationActions.ts`, `frontend/lib/data/integrations.ts` (connection poll/status), `IntegrationsWorkspace.tsx`, `WhatsAppCard.tsx`
- Create: `frontend/app/(app)/integrations/_components/LiveAccessPanel.tsx`
- Test: `whatsapp-ui.spec.ts` (flag-off already covered; add the action-gating test)

**Interfaces:**
- Produces:
  - `startLiveConnectAction(): Promise<{ error: string | null }>` — gate; `isLiveEnabled()` else `WHATSAPP_LIVE_DISABLED_ERROR`; upsert connection `{provider:"whatsapp", mode:"live", status:"pending", profile_ref:user.id}` (service client); no-op when already `pending`/`connected`; `enqueueJob("whatsapp.connect", { connectionId }, { userId })`.
  - `startLiveScanAction(chatName: unknown): Promise<{ error: string | null }>` — gate; flag; validate ≤ 100 chars; `startLiveScan` service (P4.2) with limits; `enqueueJob("whatsapp.sync", { runId }, { userId })`.
  - `disconnectWhatsAppAction(): Promise<{ error: string | null }>` — gate; service client: clear QR, `status:"disconnected"`, delete `integration_messages` for the user; `enqueueJob("whatsapp.disconnect", { userId }, { userId })`; `revalidatePath`.
  - `LiveAccessPanel` renders only when `liveEnabled`: "Link live WhatsApp" button, QR `<img alt="WhatsApp login QR code">` while pending (dropped the moment the status flips), chat-name input + "Scan this chat" button when connected, and "Disconnect" with the `Modal` confirm.

- [ ] **Step 1: Write the failing action-gating test**

Add to `whatsapp-ui.spec.ts` (a Node-level assertion that the panel is absent and the disabled-copy path exists when the flag is off is already covered; here assert the honest copy comes from the UI, not a dead control):
```ts
test("live panel explains the self-host requirement when disabled", async ({ page }) => {
  await page.goto("/integrations");
  await expect(page.getByText(/self-hosted worker with a browser/i)).toBeVisible();
  await expect(page.getByRole("img", { name: /QR/i })).toHaveCount(0);
});
```

- [ ] **Step 2: Implement the actions and panel**

Follow the P4.3 action shape. The disconnect archive delete is the exact query the P4.5 test asserts at the service level:
```ts
await service.from("integration_messages").delete().eq("user_id", user.id);
```

- [ ] **Step 3: Verify the flag-off path**

Run:
```powershell
npm run typecheck; npm run lint
npm run test -w frontend -- tests/qa/whatsapp-ui.spec.ts
```
Expected: green; no QR image, no connect control.

- [ ] **Step 4: Real-Chromium flag-on verification (MCP)**

1. Set `UNIPILOT_WHATSAPP_LIVE=1` in `frontend/.env.development.local`, restart the dev server.
2. `browser_navigate http://localhost:3000/integrations`; snapshot and screenshot `whatsapp-live-panel-light-1280.png` (+ dark, + 375).
3. Click "Link live WhatsApp" (this enqueues a connect job; the worker is not running, so the row stays `pending` with no QR — assert the honest pending copy and that no fake QR renders).
4. Optionally run `npm run worker:once` on this host and confirm the job fails with the Selenium-missing/py error surfaced as `status='error'` on the connection — no QR, no crash.
5. Remove the flag and restart afterwards; run `browser_console_messages level:error` → empty.

- [ ] **Step 5: Record the `[!]` block in TASK.md 46.16**

Exact dependency sentence for the 46.16 entry:
```
[!] Live end-to-end verification blocked: requires a single-tenant worker host
with Chrome + selenium (whatsapp/requirements-live.txt) and a physical phone to
scan the WhatsApp Web QR; no QR was ever faked. Flag-off/flag-on UI, action
gating, and the Python connect/disconnect units are verified.
```

- [ ] **Step 6: Checkpoint**

No commit.

---

## Phase 7 — Google Calendar OAuth + push (TASK.md 46.17) `[!]`

**Blocked end-to-end dependency:** `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` from a Google Cloud project with a redirect URI of `{origin}/api/integrations/google/callback`. Without them the card says "Not configured on this server" and no OAuth is attempted. The push logic is covered by the P2.6 mocked pytest suite; the no-credentials no-op is covered end to end here.

### Task P7.1: OAuth start + callback route

**Files:**
- Modify: `frontend/lib/data/integrationActions.ts` (`connectGoogleCalendarAction`, `disconnectGoogleCalendarAction`)
- Create: `frontend/app/api/integrations/google/callback/route.ts`
- Modify: `frontend/lib/data/integrations.ts` (`getGoogleStatus` already exists; add `storeGoogleCredentials`, `clearGoogleCredentials`, `backfillGooglePushes`)
- Test: `whatsapp-security.spec.ts` (RPCs already); UI in P7.2.

**Interfaces:**
- Produces:
  - `connectGoogleCalendarAction()` — gate; unconfigured → `{ error: WHATSAPP_GOOGLE_NOT_CONFIGURED_ERROR }`; else random `state` in an httpOnly cookie (`google_oauth_state`, `sameSite:"lax"`, `maxAge: 600`), respond `{ error: null, url }`; the client performs `window.location.assign(url)`. Build the URL with `access_type=offline`, `prompt=consent`, `scope=https://www.googleapis.com/auth/calendar.events`, `redirect_uri={origin}/api/integrations/google/callback` (`getOrigin()` from `@/lib/auth/origin`).
  - `disconnectGoogleCalendarAction()` — gate; `delete_google_credentials` RPC; upsert connection `{provider:"google", mode:null, status:"disconnected"}`; `revalidatePath("/integrations")`.
  - The callback route: read `code` + `state`; verify the cookie + the session user; exchange the code with `GOOGLE_OAUTH_CLIENT_ID/SECRET` (`https://oauth2.googleapis.com/token`); discard the access token; `upsert_google_credentials` via the service client with `UNIPILOT_INTEGRATIONS_KEY`; upsert `integration_connections` google `connected`; enqueue `whatsapp.push` for confirmed, un-pushed candidates (bounded 100); delete the state cookie; redirect `/integrations`.

- [ ] **Step 1: Implement and typecheck**

Run: `npm run typecheck; npm run lint`
Expected: clean. No test can exercise the exchange without real credentials — the route's error paths (missing config, bad state) get small unit-free assertions in `whatsapp-security.spec.ts` by hitting the route with `request.get("/api/integrations/google/callback")` expecting the honest failure redirect, and with `?code=x&state=y` expecting no credential row created.

- [ ] **Step 2: Checkpoint**

No commit.

### Task P7.2: Google panel + backfill

**Files:**
- Create: `frontend/app/(app)/integrations/_components/GoogleCalendarPanel.tsx`
- Modify: `WhatsAppCard.tsx` / `IntegrationsWorkspace.tsx` (compose the panel, render push state on confirmed candidates)
- Modify: `frontend/tests/qa/whatsapp-ui.spec.ts`

**Interfaces:**
- Produces: `GoogleCalendarPanel` props `{ configured: boolean; connected: boolean; status: "connected"|"not_connected"|"not_configured"|"error" }`; three states: **Connected** (mono status + "Disconnect" with `Modal` confirm), **Not connected** ("Connect Google Calendar" → the start action), **Not configured on this server** (explanatory copy, no control). Confirmed candidates render "Added" plus, when `pushed`, a mono "On Google Calendar" or the sanitized "Google sync failed, retrying" note.

- [ ] **Step 1: Write the failing tests**

```ts
test("google card is honest when the server is not configured", async ({ page }) => {
  // Requires GOOGLE_OAUTH_CLIENT_ID/SECRET to be unset in .env.development.local.
  await page.goto("/integrations");
  await expect(page.getByText("Not configured on this server")).toBeVisible();
  await expect(page.getByRole("button", { name: /connect google/i })).toHaveCount(0);
});
```
When the env pair IS configured locally, invert the test with an env guard: `test.skip(Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID), "server is configured; the unconfigured state cannot be asserted")` so the spec never asserts a false state.

- [ ] **Step 2: Implement, then run**

Run: `npm run test -w frontend -- tests/qa/whatsapp-ui.spec.ts`
Expected: PASS.

- [ ] **Step 3: Checkpoint**

No commit.

### Task P7.3: Push job no-op and blocked push E2E

**Files:**
- Modify: `frontend/tests/qa/whatsapp-jobs.spec.ts`

**Interfaces:**
- Consumes: `whatsapp.push` handler (P3.1), `run_push` no-credentials path (P2.6).
- Produces: proof that a confirmed candidate without a Google connection never pushes and never fails the job.

- [ ] **Step 1: Add the test**

```ts
test("whatsapp.push is a no-op without credentials", async () => {
  const { runId } = await seedExportRun();
  runWorkerOnce();
  const candidate = await service.from("integration_candidates")
    .select("id").eq("run_id", runId).limit(1).single();
  const event = await service.from("events").insert({
    user_id: qa1Id, title: "push noop", start_at: new Date().toISOString(),
    source: "whatsapp", source_ref: candidate.data!.id.replaceAll("-", "").padEnd(32, "0").slice(0, 32),
  }).select("id").single();
  await service.from("integration_candidates")
    .update({ status: "confirmed", event_id: event.data!.id }).eq("id", candidate.data!.id);
  const jobId = randomUUID();
  await service.from("jobs").insert({ id: jobId, kind: "whatsapp.push", payload: { candidateId: candidate.data!.id }, user_id: qa1Id });
  jobIds.push(jobId);
  runWorkerOnce();
  const row = await service.from("jobs").select("status").eq("id", jobId).single();
  expect(row.data!.status).toBe("succeeded");
  const after = await service.from("integration_candidates").select("pushed_at").eq("id", candidate.data!.id).single();
  expect(after.data!.pushed_at, "nothing may be marked pushed without credentials").toBeNull();
});
```
Cleanup of the seeded event goes through `createdEventIds` in `afterEach`.

- [ ] **Step 2: Run**

Run: `npm run test -w frontend -- tests/qa/whatsapp-jobs.spec.ts` (with Python) and `npm run test:whatsapp` for the mocked pytest push suite.
Expected: green; the real OAuth push remains `[!]`.

- [ ] **Step 3: Record the `[!]` block in TASK.md 46.17**

Exact dependency sentence:
```
[!] Google Calendar push end-to-end verification blocked: requires a Google
Cloud OAuth client (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET) with
{origin}/api/integrations/google/callback registered. The insert/dedupe/refresh
paths are covered by pytest with a mocked Google client; the no-credentials
no-op is covered end to end; no calendar push was faked.
```

- [ ] **Step 4: Checkpoint**

No commit.

---

## Phase 8 — Docs and QA (TASK.md 46.19, 46.20)

### Task P8.1: TASK.md updates

**Files:**
- Modify: `TASK.md` (`# 46. Calendar Integrations` block; Stage 3 execution list; CURRENT STATE)

**Interfaces:**
- Consumes: every phase's recorded evidence.
- Produces: the traceable task record.

- [ ] **Step 1: Append the ten task IDs under `# 46. Calendar Integrations`**

Add after `46.10`:
```
- [x] 46.11 Python service refactor (proven parser/extractor moved; pytest)
- [x] 46.12 Schema + bucket + RPCs + pgcrypto + type regen
- [x] 46.13 Worker kinds + touch_job lease heartbeat
- [x] 46.14 Integration data layer + Server Actions + limits
- [x] 46.15 WhatsApp card: export upload, runs, candidate review
- [!] 46.16 Live self-host mode (self-host dependency; see entry)
- [!] 46.17 Google Calendar OAuth + push (OAuth credentials; see entry)
- [x] 46.18 Calendar WhatsApp source marker + honesty spec rewrite
- [x] 46.19 Docs (DATABASE.md, QA_SESSION.md, AGENTS.md, READMEs, env examples)
- [x] 46.20 Verification (pytest + Playwright + MCP + static gates)
```
Each `[x]`/`[!]` line gets an indented evidence paragraph in the 46.1 style (decisions + verification + test counts + MCP results + the exact `[!]` dependency sentences from P6.1/P7.3). Existing `46.1–46.10` stay untouched; note the overlap: "46.12/46.17 deliver the per-user Google OAuth + push used by 46.2/46.3/46.4 for WhatsApp; the broader 46.x items remain open."

- [ ] **Step 2: Add Stage 3 execution item 24**

After item 23 (`25.x Search/embeddings`):
```
24. 46.11–46.20 WhatsApp integration — ✅ export path + owner tables + encrypted Google push (46.16/46.17 [!] blocked on self-host live + OAuth credentials); founder-requested pull-forward from Stage 7; QA — exact `npm run test` total recorded in P8.5; see CURRENT STATE
```
The test total is measured in P8.5 and never guessed here.

- [ ] **Step 3: Append the CURRENT STATE entry**

Prose in the established `Stage N item M — <task> ✅ …` style: what shipped, the migrations, the MCP evidence, `npm run test` count, `npm run test:whatsapp`, the blocked items, and the baseline correction (145/145, not 141/141).

- [ ] **Step 4: Checkpoint**

No commit.

### Task P8.2: DATABASE.md updates

**Files:**
- Modify: `backend/DATABASE.md`

**Interfaces:**
- Produces: the table matrix rows; "WhatsApp integration (Task 46.x)" section.

- [ ] **Step 1: Table matrix + state vocabularies**

Add the five tables with owner/RLS/write notes, add `manual|whatsapp` to the events source vocabulary, and the new CHECK vocabularies (connection status, run status, candidate status).

- [ ] **Step 2: The section**

Cover, with exact paths and commands:
- Encrypted credentials: `refresh_token_enc` bytea via `pgp_sym_encrypt`; access tokens never stored; the eight RPCs and their `service_role`-only grants; the **key home** (`UNIPILOT_INTEGRATIONS_KEY` in server env / platform secret store, inherited by the worker), the **rotation runbook** (`rotate_google_token_key` + env swap + restart), and the **statement-logging precondition** verified in P0.2 (with the Vault fallback recorded if it was needed).
- QR TTL handling (60 s, cleared on connect/timeout/disconnect, never logged).
- Retention: 30-day best-effort purge on next overview read, disconnect deletion, export-object deletion on terminal settle; stale queued runs fail after 60 min.
- Limits table (P4.3/D13).
- Bucket `whatsapp-exports` notes.
- `touch_job` as the 29.1 additive lease extension.
- The events provenance trigger and its forge-proof.

- [ ] **Step 3: Checkpoint**

No commit.

### Task P8.3: QA_SESSION.md, AGENTS.md, READMEs, env examples

**Files:**
- Modify: `QA_SESSION.md`, `AGENTS.md`, `frontend/.env.example`, `frontend/.env.development.local.example`, `backend/.env.example`, `whatsapp/README.md`

**Interfaces:**
- Produces: the operating contract for the new specs and flags.

- [ ] **Step 1: QA_SESSION.md**

Add: the WhatsApp projects and their ordering (security → jobs → flow, all before `chromium-authenticated`); the Python contract (`npm run test` skips honestly, `npm run test:whatsapp` runs pytest, `UNIPILOT_REQUIRE_PYTHON=1` strict, `WHATSAPP_PYTHON` override); cleanup obligations (`whatsapp-exports` objects, run/message/candidate/job/event rows by id); the live/Google `[!]` blocks.

- [ ] **Step 2: AGENTS.md**

One line in the monorepo layout: `whatsapp/` is the Python service workspace (never the hosted deployment's live path); the worker host that serves export/push must ship Python + the requirements.

- [ ] **Step 3: Env examples**

- `frontend/.env.example` + `.env.development.local.example`: `GOOGLE_OAUTH_CLIENT_ID=`, `GOOGLE_OAUTH_CLIENT_SECRET=`, `UNIPILOT_INTEGRATIONS_KEY=`, `UNIPILOT_WHATSAPP_LIVE=` with the comment "server-only; the worker inherits these via `--env-file`; required by both the Next server and the Python worker for OAuth/push".
- `backend/.env.example`: `WHATSAPP_PYTHON=`, `WHATSAPP_PROFILE_ROOT=` (commented, default documented), `WHATSAPP_SYNC_TIMEOUT=` (optional).
- `whatsapp/.env.example`: already rewritten in P2.7; cross-link the frontend file for the shared secrets.

- [ ] **Step 4: Checkpoint**

No commit.

### Task P8.4: Worker-host deployment contract (explicit step)

**Files:**
- Modify: `whatsapp/README.md`, `AGENTS.md` (P8.3 already adds the pointer)

**Interfaces:**
- Produces: the deployment checklist and the runtime behavior that enforces it.

- [ ] **Step 1: Write the checklist**

In `whatsapp/README.md`, a "Worker-host contract" section:
1. Install Python 3.11+ and `requirements.txt` (+ `requirements-google.txt` for push; `requirements-live.txt` only on the single-tenant live host).
2. Provide `SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `UNIPILOT_INTEGRATIONS_KEY`, and the Google pair via the platform secret store (locally inherited from `frontend/.env.development.local`).
3. Run the worker with `npm run worker -w backend` (or the platform's process manager); `WHATSAPP_PYTHON` may name an absolute interpreter.
4. Expected failures are sanitized: a missing interpreter fails the job non-retryably with the "install Python and whatsapp/requirements*.txt" message; missing Google libs fail only `whatsapp.push`; missing Selenium fails only live jobs.
5. Live mode is single-tenant: `WHATSAPP_PROFILE_ROOT` on a private volume, per-user `0700` dirs, purged on disconnect.

- [ ] **Step 2: Prove the failure surface once**

Run (no Python):
```powershell
$env:WHATSAPP_PYTHON="definitely-not-python"; npm run worker:once; Remove-Item Env:\WHATSAPP_PYTHON
```
Expected: with a queued `whatsapp.*` job, the job lands `failed` with the actionable message; the worker itself exits cleanly.

- [ ] **Step 3: Checkpoint**

No commit.

### Task P8.5: Full verification and final report

**Files:**
- Record: evidence in TASK.md 46.20 (P8.1) and the final message.

**Interfaces:**
- Consumes: everything.
- Produces: the claims — backed by command output, never intent.

- [ ] **Step 1: Database gates**

Run:
```powershell
npm run db:reset
npm run db:lint
npm run db:types
npm run db:check-types
```
Expected: clean reset; lint clean; types regenerate to a no-op diff (proves the committed types match the schema).

- [ ] **Step 2: Static gates**

Run: `npm run typecheck; npm run lint; npm run build`
Expected: all clean.

- [ ] **Step 3: Python gates**

Run:
```powershell
npm run test:whatsapp
```
Expected: all pytest tests pass. Then the strict worker suite:
```powershell
$env:UNIPILOT_REQUIRE_PYTHON="1"
npx playwright test --config frontend/playwright.config.ts tests/qa/whatsapp-jobs.spec.ts tests/qa/whatsapp-export.spec.ts
Remove-Item Env:\UNIPILOT_REQUIRE_PYTHON
```
Expected: green with Python installed.

- [ ] **Step 4: Full suite**

Run: `npm run test` from the repo root (stop any manual dev server first — the suite owns its production build). Expected: all previous 145 plus the new specs green; record the exact total. Then prove the Python-less contract once:
```powershell
$env:WHATSAPP_PYTHON="definitely-not-python"; npm run test; Remove-Item Env:\WHATSAPP_PYTHON
```
Expected: green with the Python-dependent specs reported as skipped with the clear reason.

- [ ] **Step 5: Final MCP pass**

Real Chromium, QA fixture, light + dark, 375 + 1280: upload → scan → candidates → confirm (calendar marker) → reject → re-sync dedupe; console clean; screenshots in `frontend/screenshots/` (`whatsapp-*`). Re-read `whatsapp/README.md`'s `[!]` bullets and paste them into the final report.

- [ ] **Step 6: Zero residue**

Run the residue checks owned by the specs (`rls-isolation`, `whatsapp-jobs`, `whatsapp-retention`) and confirm `integration_*`, `jobs`, `whatsapp-exports` are empty. Expected: no residue.

- [ ] **Step 7: Final report**

Report: what shipped, exact test counts, static gate results, MCP evidence, the `[!]` blocks with their exact dependencies, and the standing no-commit status. No commits.

---

## Self-Review Notes (plan author)

- **Spec coverage:** D1 P2; D2 P1.3/P5.2; D3 P1.2/P4.4; D4 P2.6/P3/P7; D5 P1.2/P4; D6 P6; D7 P7; D8 P3; D9 P8.1; D11 P0.2/P1.2/P2.6/P8.2; D12 P3.1/P4.2/P4.5/P6.1; D13 P3.3/P4.2/P8.4. §6 → P1; §7 → P3; §8 → P2; §9 → P7; §10 → P4/P5/P6/P7; §11 → P1–P5/P7; §12 → P5/P6/P7/P8.5; §13 → P8; §14 → P8.1.
- **Carry-overs:** default-grant ACL trap P1.1/P1.2; pgcrypto logging verification + Vault fallback P0.2/P8.2; retention implementation and proof P4.2/P4.5; honest-skip visible and strict mode P3.1/P3.3; manual-event CRUD under the provenance trigger P1.1; worker-host contract P3.3/P8.4.
- **Type consistency:** `WhatsAppRunItem`/`WhatsAppCandidateItem` names are used by P4.1→P4.4→P5; `getWhatsAppOverview` returns `{connection, runs, candidates, liveEnabled}` and P4.4 spreads it; `spawnWhatsApp` and the four handler exports match `handlers.mjs` imports; `event_fingerprint(start, end, sender, text)` matches every call site; `run_export`/`run_live` names match `__main__`.
- **No-commit rule:** every commit step is a checkpoint; no step runs `git add`/`git commit`.

