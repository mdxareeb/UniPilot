# UniPilot

npm-workspaces monorepo: the Next.js app in `frontend/`, the Supabase project
and its docs in `backend/`. One `npm install` at the repo root installs both
workspaces (hoisted to the root `node_modules/`) and keeps a single root
`package-lock.json`.

## Layout

```
frontend/   Next.js app — app/, components/, lib/, public/, tests/, scripts/,
            proxy.ts, next.config.ts, tsconfig.json, playwright.config.ts and
            its own .env files
backend/    Supabase project — supabase/ (config.toml, migrations/, seed.sql,
            qa/, ops/, templates/, MIGRATIONS.md), DATABASE.md, EMAIL.md
```

`TASK.md`, `DESIGN.md`, `MOTION.md`, `AUTH_ARCHITECTURE.md` and `QA_SESSION.md`
stay at the repo root as cross-cutting project docs.

## Root scripts

All orchestration runs from the repo root:

| Script | Runs |
| --- | --- |
| `npm run dev` / `build` / `start` | `frontend` (Next.js) |
| `npm run lint` / `typecheck` / `test` | `frontend` (`test` = the Playwright QA suite) |
| `npm run db:reset` / `db:lint` / `db:types` / `seed:qa` | `backend` (Supabase CLI / QA seed, via WSL) |

Workspace-scoped commands work too, e.g. `npm run test -w frontend` or
`npm run db:reset -w backend`. `npm run db:check-types -w backend` verifies the
generated database types are in sync with the local schema.

## Environment

- `frontend/.env.local` (hosted/default) and `frontend/.env.development.local`
  (local Supabase; loaded ahead of `.env.local` by `npm run dev`) hold
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` (test/seed tooling only), the QA passwords, and
  — when introduced — future *public* keys.
- `backend/.env.local` / `backend/.env.development.local` hold `SUPABASE_URL`
  (plus, later, server-only secrets).
- Copy from the matching `.example` templates. Every real `.env*` file is
  git-ignored; only the `.example` templates are tracked.

⚠ **URL invariant (never break it):** `backend`'s `SUPABASE_URL` must name the
same Supabase project as `frontend`'s `NEXT_PUBLIC_SUPABASE_URL`. Never put a
secret in a `NEXT_PUBLIC_*` variable.

## Database / WSL

The Supabase CLI and Docker run inside the `kali-linux` WSL2 distro. The distro
name is machine-specific — it is hardcoded in `backend/package.json`'s scripts
and documented in `QA_SESSION.md` / `DATABASE.md`; adjust it on another machine.
No Windows paths are hardcoded anywhere: `wsl` starts in the workspace directory
it is invoked from, so the backend scripts work from any checkout location.

```powershell
wsl -d kali-linux -u root -e supabase start   # run from backend/ (or use db:* scripts)
npm run db:reset                              # repo root → runs in backend/
npm run seed:qa                               # re-provision QA1 + QA2
```

The authenticated QA storage state lives in `frontend/.playwright/` (git-ignored;
full contract in `QA_SESSION.md`).

## Deployment (Vercel)

Not configured by this repo. When Vercel is set up, its **Root Directory must
become `frontend/`** — the Next app and `next.config.ts` live there; the repo
root is the workspace orchestrator, not a deployable Next.js project.
