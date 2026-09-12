#!/usr/bin/env node
/**
 * Task 20.10 / 20.9 — Seeds the LOCAL Supabase QA identities.
 *
 * Two identities, both created the same sanctioned way:
 *
 *   QA1  qa.unipilot@unipilot.test   password: UNIPILOT_QA_PASSWORD   "QA"
 *   QA2  qa2.unipilot@unipilot.test  password: UNIPILOT_QA2_PASSWORD  "QA 2"
 *
 * QA1 backs the authenticated Playwright fixture (`frontend/tests/qa/auth.setup.ts`);
 * QA2 exists only so `frontend/tests/qa/rls-isolation.spec.ts` can prove two real users
 * cannot see each other's rows. Both are authenticated users with no
 * application data at rest — the isolation spec creates the rows it needs and
 * deletes them again.
 *
 * This script is the only sanctioned way to create either identity. It is
 * versioned, re-runnable and idempotent: running it twice must not error and
 * must not create duplicates. It replaces the founder account as the
 * authenticated session for QA — the founder account is never used, read
 * or modified by this script.
 *
 * Usage (run from backend/, with the local stack running):
 *
 *   node --env-file=../frontend/.env.development.local supabase/qa/seed-qa-identity.mjs
 *
 * Or from the repo root: `npm run seed:qa`.
 *
 * Reset (destroys and recreates both identities):
 *
 *   node --env-file=../frontend/.env.development.local supabase/qa/seed-qa-identity.mjs --reset
 *
 * Full environment reset (destroys the identities along with everything else):
 *
 *   wsl -d kali-linux -u root -e sh -c \
 *     "cd /mnt/c/Users/moham/OneDrive/Desktop/Projects/unipilot/unipilot/backend && supabase stop --no-backup && supabase start"
 *   ...then re-run this seed.
 *
 * Credentials: each password is read from its environment variable
 * (server-side only; git-ignored in frontend/.env.development.local). They are never
 * hardcoded here, never logged, and never written to a NEXT_PUBLIC_* variable.
 * The emails are deterministic, visibly synthetic and use the reserved `.test`
 * TLD, so they cannot collide with any real person.
 */

/**
 * The two QA identities. `emailHistory` lists every address this project has
 * ever used for the identity, so `--reset` purges stale variants too and the
 * local stack is left with exactly the current pair.
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

const isReset = process.argv.includes("--reset");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ---------------------------------------------------------------------------
// Guard 1 — refuse anything that is not the local stack. This seed must never
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
// Guard 2 — every required secret must be present in the environment.
// ---------------------------------------------------------------------------
if (!serviceRoleKey) {
  console.error(
    "Missing SUPABASE_SERVICE_ROLE_KEY. Set it in frontend/.env.development.local (server-side only).",
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

async function deleteUser(user) {
  const response = await adminApi(`/users/${user.id}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Admin delete failed: HTTP ${response.status}`);
  }
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

let users = await listUsers();

if (isReset) {
  for (const identity of IDENTITIES) {
    const historical = users.filter((user) =>
      identity.emailHistory.includes(user.email.toLowerCase()),
    );
    for (const user of historical) {
      await deleteUser(user);
      console.log(`reset: deleted ${identity.email} (${describe(user)})`);
    }
  }
  users = await listUsers();
}

for (const identity of IDENTITIES) {
  const existing = users.find(
    (user) => user.email.toLowerCase() === identity.email.toLowerCase(),
  );

  if (existing) {
    const ensured = await ensureConfirmed(existing);
    console.log(
      `${identity.email}: already present — no duplicate created (${describe(ensured)})`,
    );
  } else {
    const created = await createUser(identity);
    console.log(`${identity.email}: created (${describe(created)})`);
  }
}

console.log("");
console.log("QA identities ready (no application data):");
for (const identity of IDENTITIES) {
  console.log(`  ${identity.email}  "${identity.displayName}"`);
}
