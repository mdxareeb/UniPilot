# Monorepo layout

- `frontend/` — the Next.js app (read `frontend/AGENTS.md` before touching it).
- `backend/` — the Supabase project (migrations, seed, templates, ops) and the
  backend docs (`backend/DATABASE.md`, `backend/EMAIL.md`,
  `backend/supabase/MIGRATIONS.md`).
- `whatsapp/` — the Python service workspace behind the worker's `whatsapp.*`
  jobs (export parser/extractor, self-host live driver). The worker host that
  serves export/push must ship Python >= 3.11 and `whatsapp/requirements.txt`
  (plus `requirements-google.txt` for push; `requirements-live.txt` only on the
  self-host live host); live mode is single-tenant (Chrome + phone QR). See
  `whatsapp/README.md`.
- Root scripts orchestrate the workspaces:
  `npm run dev` = the one-command local environment (`scripts/start-env.mjs`:
  WSL/Docker → Presenton → Supabase → worker → Next; `npm run dev:web` is Next
  alone, Windows host only — see README.md §"One-command local environment"),
  `npm run build|start|lint|typecheck|test` (frontend),
  `npm run test:scripts` (root `scripts/` Node tests) and
  `npm run db:reset|db:lint|db:types|seed:qa|worker|worker:once|test:whatsapp`
  (backend). See README.md.

# Motion

Motion.dev is UniPilot's primary animation library.

Before creating a new animation:
1. Inspect existing shared Motion primitives.
2. Reuse existing variants/transitions.
3. Choose animation based on the UI's purpose.
4. Avoid fade-only animation when a more meaningful Motion interaction is appropriate.
5. Preserve reduced-motion behavior.
6. Ensure animation never controls content existence.
7. Verify the result in Chromium.
8. Do not create page-specific animation systems unless there is a demonstrated technical reason.

Every future popup, dropdown, modal, panel, card interaction, tool page, editor, section reveal and selection state must reuse the global Motion system (`frontend/components/motion/`, vocabulary in `frontend/components/motion/presets.ts`). See MOTION.md.

# QA authenticated session (Task 20.10)

Tasks needing a real authenticated browser session use the QA fixture — never
the founder account, never a task-invented identity:

- Identity: `qa.unipilot@unipilot.test` (seeded, email-confirmed, no
  application data) — password lives in `UNIPILOT_QA_PASSWORD` in
  `frontend/.env.development.local` (git-ignored).
- Environment: the LOCAL Supabase stack (Docker in `kali-linux` WSL) — the
  hosted project is never written to; the seed refuses non-local targets.
- One-liner: `npm run test` from the repo root (local stack up; the suite builds
  and owns its production server, so stop any manual `npm run dev` first —
  equivalent to `npx playwright test` from `frontend/`) → storage state at
  `frontend/.playwright/qa-session.json`; any test/QA run may start from it.
- Full contract — env start/stop, seeding, reset, MCP-browser login,
  exclusions: **QA_SESSION.md** (read it before the first authenticated QA
  task).
