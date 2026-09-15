/**
 * Task 20.10 — Playwright project config for QA against the local dev stack.
 *
 * The authenticated fixture lives in `tests/qa/auth.setup.ts`. It logs in
 * once through the REAL login UI (http://localhost:3000/login) using the QA
 * identity seeded by `backend/supabase/qa/seed-qa-identity.mjs`, and persists the
 * session as a Playwright storage-state file. Every later test or QA run
 * then starts already authenticated by pointing `storageState` at that file.
 *
 * The storage-state path is configurable (`QA_STORAGE_STATE`) and git-ignored
 * (.gitignore ignores `.playwright/`).
 *
 * ⚠ Non-production only: this config targets the LOCAL Supabase stack. The
 * `next dev` server must run with `frontend/.env.development.local` (see
 * QA_SESSION.md) so localhost:3000 talks to 127.0.0.1:54321, never to the
 * hosted project.
 */
import { defineConfig } from "@playwright/test";

/**
 * Loads `.env.development.local` into process.env if present, without
 * overriding variables already set in the shell. Keeps the QA credentials
 * server-side (Node process) only — no test ever bundles them to a browser
 * beyond typing them into the real login form.
 */
try {
  process.loadEnvFile(".env.development.local");
} catch {
  // File absent — variables must then come from the shell. The fixture
  // reports a clear, actionable error when they are missing.
}

export default defineConfig({
  testDir: "./tests",
  outputDir: "./.playwright/test-results",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  /**
   * The suite owns its server, and that server is a production build
   * (`next build && next start`) rather than `next dev`.
   *
   * Why own it: the suite used to depend on a dev server someone had started by
   * hand. When two servers were launched at once the loser exited or bound
   * another port, and in-flight requests were reset — the ECONNRESET /
   * ERR_CONNECTION_REFUSED failures. Playwright owning the process makes the
   * server's lifecycle part of the run: `reuseExistingServer: false` refuses to
   * attach to a server it did not start, so a manual `npm run dev` must be
   * stopped before `npm run test` (the error names the port).
   *
   * Why production: even with one owner, `next dev` tears down in-flight
   * streams when a client navigates away (`Error: The destination stream closed
   * early`, `Error: aborted … ECONNRESET` in its stderr) and resets keep-alive
   * connections during on-demand compiles; under the suite's parallel load that
   * surfaced as a transport `read ECONNRESET` in a route probe
   * (`auth-guards.spec.ts`) even though no assertion was wrong. `next start`
   * has no HMR, no compile-on-request and no dev stream churn — the same
   * requests settle deterministically and much faster.
   *
   * Environment: `next build` would otherwise read `.env.local`, which names the
   * hosted project; the local values loaded above from
   * `.env.development.local` are passed explicitly so the build and server can
   * only ever talk to the local stack.
   */
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      ...(process.env.NEXT_PUBLIC_SUPABASE_URL
        ? { NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL }
        : {}),
      ...(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        ? { NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY }
        : {}),
      ...(process.env.NEXT_PUBLIC_SITE_URL
        ? { NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL }
        : {}),
    },
  },
  use: {
    baseURL: process.env.QA_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "qa-auth-setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      // Task 13.10 owns the only destructive pass: it resets QA1, completes
      // onboarding through the real UI, and leaves QA1 completed so the
      // redirect gate lets the dependent workspace specs through. Every other
      // stateful project now depends on it (see below) because it is the only
      // one that deletes a `profiles` row and replaces a user's whole
      // `subjects` set — running the events-data pass beside it could have its
      // transient rows wiped mid-assertion.
      name: "qa-onboarding",
      testMatch: /onboarding\.spec\.ts/,
      dependencies: ["qa-auth-setup"],
      use: {
        storageState: process.env.QA_STORAGE_STATE ?? ".playwright/qa-session.json",
      },
    },
    {
      // Task 21.x — the tasks-data pass creates and removes task rows for both
      // QA users. It runs after onboarding (shared QA identities settle first)
      // and as its own project dependency (not alongside the workspace specs)
      // so its transient rows can never race the absolute residue counts in
      // rls-isolation.spec.ts.
      name: "qa-tasks-data",
      testMatch: /tasks-data\.spec\.ts/,
      dependencies: ["qa-auth-setup", "qa-onboarding"],
    },
    {
      // Task 16.x — the UI flows create/rename/delete/move real QA1 tasks.
      // It runs after the data pass (so the two task-mutating specs are never
      // concurrent) and before the parallel workspace specs (whose task
      // residue counts must not see these rows).
      name: "qa-tasks-ui",
      testMatch: /tasks-ui\.spec\.ts/,
      dependencies: ["qa-auth-setup", "qa-onboarding", "qa-tasks-data"],
      use: {
        storageState: process.env.QA_STORAGE_STATE ?? ".playwright/qa-session.json",
      },
    },
    {
      // Task 22.x — the events-data pass creates and removes event and subject
      // rows for both QA users. It runs after onboarding for the same reason
      // as tasks-data: onboarding replaces the QA subjects wholesale, and the
      // two passes must not interleave. Its own project dependency keeps those
      // transient rows out of the parallel workspace specs' residue counts.
      // It touches events/subjects only, so it may run beside tasks-ui.
      name: "qa-events-data",
      testMatch: /events-data\.spec\.ts/,
      dependencies: ["qa-auth-setup", "qa-onboarding"],
    },
    {
      // Task 17.x — the calendar UI flows create/rename/delete real QA1
      // events. It runs after the events-data pass (so the two
      // event-mutating specs are never concurrent) and before the parallel
      // workspace specs (whose event residue counts must not see these rows).
      name: "qa-events-ui",
      testMatch: /calendar-ui\.spec\.ts/,
      dependencies: ["qa-auth-setup", "qa-onboarding", "qa-events-data"],
      use: {
        storageState: process.env.QA_STORAGE_STATE ?? ".playwright/qa-session.json",
      },
    },
    {
      // Task 23.x — the documents data/storage pass creates and removes
      // objects and rows for both QA users. It runs after the existing data
      // projects *and their UI consumers* (23.11's ordering requirement), so
      // its transient objects can never race the residue counts or a
      // concurrent calendar/task flow, and before the parallel workspace
      // specs for the same reason.
      name: "qa-documents-data",
      testMatch: /documents-data\.spec\.ts/,
      dependencies: [
        "qa-auth-setup",
        "qa-onboarding",
        "qa-tasks-data",
        "qa-tasks-ui",
        "qa-events-data",
        "qa-events-ui",
      ],
    },
    {
      // Task 23.x — the upload pipeline's real UI flows. Sequential after
      // the data pass (same bucket and rows), before the parallel workspace
      // specs for the same reason.
      name: "qa-documents-ui",
      testMatch: /documents-ui\.spec\.ts/,
      dependencies: ["qa-auth-setup", "qa-onboarding", "qa-documents-data"],
      use: {
        storageState: process.env.QA_STORAGE_STATE ?? ".playwright/qa-session.json",
      },
    },
    {
      // Task 24.x — the document-processing pipeline. It drives the worker
      // against real uploads, so it runs after the documents UI flows and
      // before the jobs-runner spec (which also runs the worker) and the
      // parallel workspace specs.
      name: "qa-documents-processing",
      testMatch: /documents-processing\.spec\.ts/,
      dependencies: [
        "qa-auth-setup",
        "qa-onboarding",
        "qa-tasks-data",
        "qa-tasks-ui",
        "qa-events-data",
        "qa-events-ui",
        "qa-documents-data",
        "qa-documents-ui",
      ],
      use: {
        storageState: process.env.QA_STORAGE_STATE ?? ".playwright/qa-session.json",
      },
    },
    {
      // Task 18.x — the documents hub flows (cards, search/filters, preview,
      // retry, quota). It drives the worker and the list, so it runs after
      // the processing spec and before the jobs-runner spec (which also runs
      // the worker) and the parallel workspace specs.
      name: "qa-documents-hub",
      testMatch: /documents-hub\.spec\.ts/,
      dependencies: [
        "qa-auth-setup",
        "qa-onboarding",
        "qa-tasks-data",
        "qa-tasks-ui",
        "qa-events-data",
        "qa-events-ui",
        "qa-documents-data",
        "qa-documents-ui",
        "qa-documents-processing",
      ],
      use: {
        storageState: process.env.QA_STORAGE_STATE ?? ".playwright/qa-session.json",
      },
    },
    {
      // Task 25.x — retrieval: chunking/backfill, keyword search, RLS and the
      // search panel. It drives the worker and the real search function, so
      // it runs at the tail of the documents chain (after the hub) and before
      // the jobs-runner spec and the parallel workspace specs.
      name: "qa-documents-search",
      testMatch: /documents-search\.spec\.ts/,
      dependencies: [
        "qa-auth-setup",
        "qa-onboarding",
        "qa-tasks-data",
        "qa-tasks-ui",
        "qa-events-data",
        "qa-events-ui",
        "qa-documents-data",
        "qa-documents-ui",
        "qa-documents-processing",
        "qa-documents-hub",
      ],
      use: {
        storageState: process.env.QA_STORAGE_STATE ?? ".playwright/qa-session.json",
      },
    },
    {
      // Task 26.x — the assistant backend: provider honesty, persistence,
      // RAG isolation, limits and the streaming contract. It drives the real
      // turn endpoint and the worker, so it runs after the search chain and
      // before the jobs runner and the parallel workspace specs.
      name: "qa-assistant-backend",
      testMatch: /assistant-backend\.spec\.ts/,
      dependencies: [
        "qa-auth-setup",
        "qa-onboarding",
        "qa-tasks-data",
        "qa-tasks-ui",
        "qa-events-data",
        "qa-events-ui",
        "qa-documents-data",
        "qa-documents-ui",
        "qa-documents-processing",
        "qa-documents-hub",
        "qa-documents-search",
      ],
      use: {
        storageState: process.env.QA_STORAGE_STATE ?? ".playwright/qa-session.json",
      },
    },
    {
      // Task 29.1 — the generic background runner. It drives the worker
      // process against real jobs, so it runs at the tail of the mutating
      // projects (after every other data/UI consumer) and before the parallel
      // workspace specs, whose residue counts must not see its rows.
      name: "qa-jobs-runner",
      testMatch: /jobs-runner\.spec\.ts/,
      dependencies: [
        "qa-auth-setup",
        "qa-onboarding",
        "qa-tasks-data",
        "qa-tasks-ui",
        "qa-events-data",
        "qa-events-ui",
        "qa-documents-data",
        "qa-documents-ui",
        "qa-documents-processing",
        "qa-documents-hub",
        "qa-documents-search",
        "qa-assistant-backend",
      ],
    },
    {
      // Task 31.x — the presentation adapter + `presentation.generate` worker
      // wiring. In the GATE-1 environment (no Presenton configured) it proves
      // the honest blocked path end to end: adapter guards, a permanent
      // not-connected settle, RLS and the parser. It drives `worker/run.mjs`,
      // so it runs after the jobs runner and before the parallel workspace
      // specs; it also holds the shared worker lock for targeted runs.
      name: "qa-presentation-jobs",
      testMatch: /presentations-jobs\.spec\.ts/,
      timeout: 120_000,
      dependencies: [
        "qa-auth-setup",
        "qa-onboarding",
        "qa-tasks-data",
        "qa-tasks-ui",
        "qa-events-data",
        "qa-events-ui",
        "qa-documents-data",
        "qa-documents-ui",
        "qa-documents-processing",
        "qa-documents-hub",
        "qa-documents-search",
        "qa-assistant-backend",
        "qa-jobs-runner",
      ],
    },
    {
      // Task 46.12 — schema/ACL/retention proofs. DB-only; local stack only.
      // The raised timeout covers the cross-file worker lock wait (see
      // tests/qa/workerLock.ts): the security backfill proof and the retention
      // overview reads are two files of this project and serialize under a
      // targeted --no-deps run.
      name: "qa-whatsapp-security",
      testMatch: /whatsapp-(security|retention)\.spec\.ts/,
      timeout: 240_000,
      dependencies: [
        "qa-auth-setup",
        "qa-onboarding",
        "qa-tasks-data",
        "qa-tasks-ui",
        "qa-events-data",
        "qa-events-ui",
        "qa-documents-data",
        "qa-documents-ui",
        "qa-documents-processing",
        "qa-documents-hub",
        "qa-documents-search",
        "qa-jobs-runner",
        "qa-presentation-jobs",
      ],
      use: {
        storageState: process.env.QA_STORAGE_STATE ?? ".playwright/qa-session.json",
      },
    },
    {
      // Task 46.13 — the worker ↔ Python job proofs. Drives worker/run.mjs.
      // The raised timeout covers the cross-file worker lock wait (see
      // tests/qa/workerLock.ts) and Python startup; hooks use this timeout.
      name: "qa-whatsapp-jobs",
      testMatch: /whatsapp-jobs\.spec\.ts/,
      timeout: 240_000,
      dependencies: [
        "qa-auth-setup",
        "qa-onboarding",
        "qa-tasks-data",
        "qa-tasks-ui",
        "qa-events-data",
        "qa-events-ui",
        "qa-documents-data",
        "qa-documents-ui",
        "qa-documents-processing",
        "qa-documents-hub",
        "qa-documents-search",
        "qa-jobs-runner",
        "qa-whatsapp-security",
      ],
    },
    {
      // Task 46.15 — export upload + candidate review + calendar marker.
      // The raised timeout covers the cross-file worker lock wait (see
      // tests/qa/workerLock.ts), worker startup and the 90 s settle polls.
      name: "qa-whatsapp-flow",
      testMatch: /whatsapp-(ui|export)\.spec\.ts/,
      timeout: 240_000,
      dependencies: [
        "qa-auth-setup",
        "qa-onboarding",
        "qa-tasks-data",
        "qa-tasks-ui",
        "qa-events-data",
        "qa-events-ui",
        "qa-documents-data",
        "qa-documents-ui",
        "qa-documents-processing",
        "qa-documents-hub",
        "qa-documents-search",
        "qa-jobs-runner",
        "qa-whatsapp-security",
        "qa-whatsapp-jobs",
      ],
      use: {
        storageState: process.env.QA_STORAGE_STATE ?? ".playwright/qa-session.json",
      },
    },
    {
      name: "chromium-authenticated",
      testMatch:
        /(authenticated|structure|fonts|tool-registry|integrations|rls-isolation|finish-setup|auth-guards|guest-browsing)\.spec\.ts/,
      dependencies: [
        "qa-auth-setup",
        "qa-onboarding",
        "qa-tasks-data",
        "qa-tasks-ui",
        "qa-events-data",
        "qa-events-ui",
        "qa-documents-data",
        "qa-documents-ui",
        "qa-documents-processing",
        "qa-documents-hub",
        "qa-documents-search",
        "qa-assistant-backend",
        "qa-jobs-runner",
        "qa-whatsapp-security",
        "qa-whatsapp-jobs",
        "qa-whatsapp-flow",
        "qa-presentation-jobs",
      ],
      use: {
        // Start every test already authenticated (real session obtained by
        // the setup project through the app's own login path — never forged).
        storageState: process.env.QA_STORAGE_STATE ?? ".playwright/qa-session.json",
      },
    },
  ],
});
