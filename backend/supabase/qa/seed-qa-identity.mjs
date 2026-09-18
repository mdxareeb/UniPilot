#!/usr/bin/env node
/**
 * Task 20.10 / 20.9 â€” Seeds the LOCAL Supabase QA identities.
 *
 * Two identities, both created the same sanctioned way:
 *
 *   QA1  qa.unipilot@unipilot.test   password: UNIPILOT_QA_PASSWORD   "QA"
 *   QA2  qa2.unipilot@unipilot.test  password: UNIPILOT_QA2_PASSWORD  "QA 2"
 *
 * QA1 backs the authenticated Playwright fixture (`frontend/tests/qa/auth.setup.ts`)
 * and is left in the standard onboarded fixture state: the seed signs in as
 * QA1 with the real password grant and, when incomplete, completes the real
 * `complete_onboarding` RPC with the answers the onboarding spec asserts. When
 * QA1 is already complete the seed writes nothing. QA2 exists only so
 * `frontend/tests/qa/rls-isolation.spec.ts` can prove two real users cannot see
 * each other's rows; QA2 stays without application data at rest â€” the
 * isolation spec creates the rows it needs and deletes them again. The
 * onboarding spec (`frontend/tests/qa/onboarding.spec.ts`) still resets QA1
 * itself before proving the flow end to end, so seed pre-onboarding is
 * compatible with it.
 *
 * This script is the only sanctioned way to create either identity. It is
 * versioned, re-runnable and idempotent: running it twice must not error and
 * must not create duplicates. It replaces the founder account as the
 * authenticated session for QA â€” the founder account is never used, read
 * or modified by this script.
 *
 * Usage (run from backend/, with the local stack running):
 *
 *   node --env-file=../frontend/.env.development.local supabase/qa/seed-qa-identity.mjs
 *
 * Or from the repo root: `npm run seed:qa`.
 *
 * Reset (re-writes both identities' passwords and confirmation in place):
 *
 *   node --env-file=../frontend/.env.development.local supabase/qa/seed-qa-identity.mjs --reset
 *
 * Full environment reset (destroys the identities along with everything else):
 *
 *   wsl -d kali-linux -u root -e sh -c \
 *     "cd /mnt/c/<checkout>/backend && supabase stop --no-backup && supabase start"
 *   ...then re-run this seed.
 *
 * Credentials: each password is read from its environment variable
 * (server-side only; git-ignored in frontend/.env.development.local). They are never
 * hardcoded here, never logged, and never written to a NEXT_PUBLIC_* variable.
 * The emails are deterministic, visibly synthetic and use the reserved `.test`
 * TLD, so they cannot collide with any real person.
 */

/**
 * The two QA identities. `emailHistory` records every address this project has
 * ever used for the identity. It is documentation only: the identities carry
 * no application data, so `--reset` updates them in place and never deletes.
 * A stale historical variant must be removed by hand if one is ever found.
 */
const IDENTITIES = [
  {
    email: "qa.unipilot@unipilot.test",
    displayName: "QA",
    passwordEnv: "UNIPILOT_QA_PASSWORD",
    password: process.env.UNIPILOT_QA_PASSWORD,
    emailHistory: ["qa.unipilot@unipilot.test", "qa.unipilot@localhost"],
  },
  {
    email: "qa2.unipilot@unipilot.test",
    displayName: "QA 2",
    passwordEnv: "UNIPILOT_QA2_PASSWORD",
    password: process.env.UNIPILOT_QA2_PASSWORD,
    emailHistory: ["qa2.unipilot@unipilot.test", "qa2.unipilot@localhost"],
  },
];

// `--reset` can arrive as an argv flag (direct `node ... --reset`) or as npm
// config env (`npm run seed:qa -- --reset` from the repo root: the root script
// forwards through `npm run seed:qa -w backend`, where npm turns the unknown
// flag into npm_config_reset instead of passing argv through).
const isReset =
  process.argv.includes("--reset") || process.env.npm_config_reset === "true";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// ---------------------------------------------------------------------------
// Guard 1 â€” refuse anything that is not the local stack. This seed must never
// run against the hosted (production) project. The check is on the resolved
// URL, so "which environment" is proven per run and never assumed.
// ---------------------------------------------------------------------------
const target = (() => {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
})();

const isLocal =
  target !== null &&
  (target.hostname === "127.0.0.1" || target.hostname === "localhost");

if (!isLocal) {
  console.error("==============================================");
  console.error(" REFUSING TO RUN: non-local Supabase target");
  console.error("==============================================");
  console.error(
    `NEXT_PUBLIC_SUPABASE_URL resolves to ${target ? target.hostname : "(unset/invalid)"}, which is not 127.0.0.1 or localhost.`,
  );
  console.error(
    "This seed creates the QA identities and must only run against the local",
  );
  console.error(
    "Supabase stack. It will never be allowed to touch the hosted project.",
  );
  console.error("");
  console.error(
    "Fix: run `npm run seed:qa` from the repo root, or from backend/:",
  );
  console.error(
    "  node --env-file=../frontend/.env.development.local supabase/qa/seed-qa-identity.mjs",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Guard 2 â€” every required secret must be present in the environment.
// ---------------------------------------------------------------------------
if (!serviceRoleKey) {
  console.error(
    "Missing SUPABASE_SERVICE_ROLE_KEY. Set it in frontend/.env.development.local (server-side only).",
  );
  process.exit(1);
}

if (!anonKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY. Set it in frontend/.env.development.local (the QA1 password grant and onboarding RPC need the anon key).",
  );
  process.exit(1);
}

const missingPasswords = IDENTITIES.filter(
  ({ password }) => !password || password.length < 8,
).map(({ email, passwordEnv }) => `  ${passwordEnv} (for ${email})`);

if (missingPasswords.length > 0) {
  console.error(
    [
      "Missing or too-short QA password(s). Set each of the following (8+ chars) in frontend/.env.development.local:",
      ...missingPasswords,
      "Then re-run from the repo root:",
      "  npm run seed:qa",
    ].join("\n"),
  );
  process.exit(1);
}

/** GoTrue Admin API helper. Service-role key lives in this Node process only. */
async function adminApi(path, init = {}) {
  const response = await fetch(`${target.origin}/auth/v1/admin${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  return response;
}

async function listUsers() {
  const response = await adminApi("/users");
  if (!response.ok) {
    throw new Error(`Admin user list failed: HTTP ${response.status}`);
  }
  const body = await response.json();
  return body.users ?? [];
}

async function createUser(identity) {
  const response = await adminApi("/users", {
    method: "POST",
    body: JSON.stringify({
      email: identity.email,
      password: identity.password,
      // Mark email-confirmed at seed time using the supported server-side
      // mechanism (GoTrue Admin API), not by intercepting or faking a
      // confirmation link.
      email_confirm: true,
      user_metadata: { full_name: identity.displayName },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Admin create failed for ${identity.email}: HTTP ${response.status} ${text}`,
    );
  }
  return response.json();
}

/**
 * Reset path: update the existing identity in place through the supported
 * Admin API. The identities carry no application data, so deleting them adds
 * risk without value. The password is re-written from the environment and is
 * never logged.
 */
async function syncIdentity(user, identity) {
  const response = await adminApi(`/users/${user.id}`, {
    method: "PUT",
    body: JSON.stringify({
      password: identity.password,
      email_confirm: true,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Admin update failed for ${identity.email}: HTTP ${response.status} ${text}`,
    );
  }
  return response.json();
}

async function ensureConfirmed(user) {
  if (user.email_confirmed_at) return user;
  const response = await adminApi(`/users/${user.id}`, {
    method: "PUT",
    body: JSON.stringify({ email_confirm: true }),
  });
  if (!response.ok) {
    throw new Error(`Admin confirm failed: HTTP ${response.status}`);
  }
  return response.json();
}

function describe(user) {
  const confirmed = Boolean(user.email_confirmed_at);
  return `id=${user.id} confirmed=${confirmed}`;
}

/**
 * Identity sync: idempotent create-or-update. `--reset` re-writes each
 * identity's password and confirmation in place instead of deleting and
 * recreating: the identities carry no application data, so deletion adds
 * risk without value.
 */
async function seedIdentities() {
  const users = await listUsers();

  for (const identity of IDENTITIES) {
    const existing = users.find(
      (user) => user.email.toLowerCase() === identity.email.toLowerCase(),
    );

    if (existing) {
      const synced = isReset
        ? await syncIdentity(existing, identity)
        : await ensureConfirmed(existing);
      console.log(
        isReset
          ? `${identity.email}: reset in place — password and confirmation synced (${describe(synced)})`
          : `${identity.email}: already present — no duplicate created (${describe(synced)})`,
      );
    } else {
      const created = await createUser(identity);
      console.log(`${identity.email}: created (${describe(created)})`);
    }
  }
}

// ---------------------------------------------------------------------------
// QA1 onboarding fixture â€” leave QA1 in the standard onboarded state the
// workspace specs and manual QA expect. QA2 is deliberately never onboarded:
// the onboarding spec needs an incomplete second user for skip and isolation.
// When QA1 is already complete the seed must make no writes, so re-running it
// cannot re-stamp `onboarding_completed_at` or touch QA1's subjects.
// ---------------------------------------------------------------------------

const QA1 = IDENTITIES[0];

/** Real password grant â€” the same path the browser login uses. */
async function signInWithPassword(identity) {
  const response = await fetch(
    `${target.origin}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: identity.email,
        password: identity.password,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `QA1 sign-in failed: HTTP ${response.status}. Verify ${identity.passwordEnv} in frontend/.env.development.local and re-run \`npm run seed:qa\`.`,
    );
  }
  return response.json();
}

/** Service-role REST read (Node-only; the key never leaves this process). */
async function serviceGet(path) {
  return fetch(`${target.origin}/rest/v1${path}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
}

async function ensureQa1Onboarded(userId, accessToken) {
  const profileResponse = await serviceGet(
    `/profiles?id=eq.${userId}&select=onboarding_completed_at`,
  );
  if (!profileResponse.ok) {
    throw new Error(`QA1 profile read failed: HTTP ${profileResponse.status}`);
  }
  const profiles = await profileResponse.json();
  if (profiles.length > 0 && profiles[0].onboarding_completed_at) {
    console.log("QA1 onboarding: already complete (no change)");
    return;
  }

  const response = await fetch(
    `${target.origin}/rest/v1/rpc/complete_onboarding`,
    {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_first_name: "QA",
        p_last_name: "One",
        p_institution: "UniPilot Test University",
        p_course_program: "Computer Science",
        p_academic_year: 2,
        p_semester: 1,
        p_planning_style: "balanced",
        p_reminder_lead: "1_week",
        p_subjects: ["Linear Algebra", "Thermodynamics"],
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`QA1 complete_onboarding failed: HTTP ${response.status}`);
  }
  console.log("QA1 onboarding: completed (standard fixture written)");
}

/**
 * Top-level flow. The process exits explicitly and cleanly once every await
 * has settled: on Windows/Node >= 23, process.exit() called immediately after
 * fetch requests can race the runtime's own teardown and abort with
 * `Assertion failed: ... UV_HANDLE_CLOSING` (nodejs/node#56645, #58091; the
 * upstream fix #61999 has not shipped in Node 24.x). A short settle before
 * the explicit exit lets that teardown finish; the exit stays explicit, last,
 * and non-zero on failure.
 */
const EXIT_SETTLE_MS = 250;

async function exitWith(code) {
  await new Promise((resolve) => setTimeout(resolve, EXIT_SETTLE_MS));
  process.exit(code);
}

async function main() {
  await seedIdentities();

  const qa1Session = await signInWithPassword(QA1);
  await ensureQa1Onboarded(qa1Session.user.id, qa1Session.access_token);

  console.log("");
  console.log("QA identities ready:");
  console.log(
    `  ${IDENTITIES[0].email}  "${IDENTITIES[0].displayName}" — onboarded (standard fixture)`,
  );
  console.log(
    `  ${IDENTITIES[1].email}  "${IDENTITIES[1].displayName}" — no application data`,
  );

  return 0;
}

main()
  .then((code) => exitWith(code))
  .catch((error) => {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    return exitWith(1);
  });
