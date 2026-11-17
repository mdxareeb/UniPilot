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
| `npm run dev` | the full local environment (see below); `npm run dev:web` is Next alone |
| `npm run build` / `start` | `frontend` (Next.js) |
| `npm run lint` / `typecheck` / `test` | `frontend` (`test` = the Playwright QA suite) |
| `npm run test:scripts` | the repo-root `scripts/` Node tests (`node --test`) |
| `npm run db:reset` / `db:lint` / `db:types` / `seed:qa` | `backend` (Supabase CLI / QA seed, via WSL) |

Workspace-scoped commands work too, e.g. `npm run test -w frontend` or
`npm run db:reset -w backend`. `npm run db:check-types -w backend` verifies the
generated database types are in sync with the local schema.

## Environment

Exactly two env files — one per side, both git-ignored:

- `frontend/.env` — the frontend: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (test/seed tooling
  only), the QA passwords, the Google/WhatsApp/assistant server-only keys, the
  Presenton pair and — when introduced — future *public* keys. Next.js loads it,
  and `playwright.config.ts` loads it explicitly for the QA suite.
- `backend/.env` — the backend: `SUPABASE_URL` (the backend-side alias of the
  same public URL), the public pair the worker reads directly, the service-role
  key, the Presenton pair, the QA passwords and the WhatsApp worker knobs. The
  worker and the backend scripts load it with `node --env-file=.env`; the worker
  keeps its own copy on purpose (separate process).

Copy from the two tracked templates (`frontend/.env.example`,
`backend/.env.example`). Do not create `.env.local` /
`.env.development.local` variants — they would silently override the single
file.

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

## One-command local environment

`npm run dev` (repo root, PowerShell — the Windows host) brings up everything
the app needs, in order and idempotently:

1. **WSL + Docker** — probes `docker info` inside the distro (booting it on
   first contact) and starts the daemon if it is down. Distro name:
   `UNIPILOT_WSL_DISTRO` (default `kali-linux`).
2. **Presenton** — `ghcr.io/presenton/presenton:latest` on port 5001 with
   `DISABLE_AUTH=true`, the `presenton-main/app_data` volume and
   `--restart unless-stopped`: skipped when running, started when stopped,
   created with those documented flags when missing (its `presenton-main/.env`
   is passed through when present — the file itself is never read or printed).
   `PRESENTON_URL` is probed.
3. **Supabase** — skipped when `supabase status` says it is already running,
   otherwise `supabase start` from `backend/` as root. The configured
   `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` is probed.
4. **Worker** — `backend/worker/run.mjs` with
   `backend/.env`; skipped when an instance is already
   running.
5. **Next dev** — the frontend's `next dev` (what `npm run dev -w frontend`
   runs), skipped when something already serves `:3000`.
6. **presenton-ui (optional)** — the re-themed fork of Presenton's frontend
   (`presenton-ui/`, git-ignored, its own repo; see
   `docs/superpowers/specs/2026-09-15-presenton-fork-theme-design.md`).
   Skipped when the checkout is absent; started on `:5002` (`PRESENTON_UI_PORT`)
   against `PRESENTON_ENGINE_URL` when present. A failed start or a crash only
   warns — the edit wrapper falls back to the engine's own editor
   (`resolveEditorUrl`), so the link is never dead. Manual command:
   `cd presenton-ui && npm run dev`.

URLs resolve environment → `frontend/.env` → defaults
(`http://127.0.0.1:54937`, `http://localhost:5001`); no secret value is ever
printed. **Honest degradation:** every infrastructure step only *warns* on
failure — if Docker or Presenton cannot start, the app still runs and
`/tools/presentation` keeps its existing blocked state. Only Next's exit ends
the run; Ctrl+C stops the worker and the dev server.

**Boot hook (optional; installed on this machine).**
`scripts/wsl/unipilot-stack.service` plus the idempotent installer enable
`supabase start` on WSL boot (Docker is already enabled in the distro):

```powershell
wsl -d kali-linux -u root -e bash /mnt/c/<checkout>/scripts/wsl/install-autostart.sh /mnt/c/<checkout>/backend
```

The oneshot unit exits once the stack is up, so `systemctl start
unipilot-stack` re-runs it on demand; `systemctl status unipilot-stack` shows
the last exit. Remove it with `systemctl disable --now unipilot-stack && rm
/etc/systemd/system/unipilot-stack.service`.

**Caveats** — nothing survives a WSL restart by itself: Docker and the stack go
down with the distro; the boot hook restores the stack, and Presenton revives
through its restart policy as soon as Docker is back (unless it was stopped by
hand). Windows `winnat` reserves TCP ranges at boot and any Supabase/Studio
port that lands inside one stops forwarding from Windows into WSL while the
stack stays healthy — check `netsh interface ipv4 show excludedportrange
protocol=tcp` in an elevated shell and see `QA_SESSION.md` §"WSL2
port-forwarding workaround" for the 54937 move and how to free a range. WSL2
network MTU mismatches (host adapter vs `docker0`) can stall large responses
instead of failing them; if container traffic hangs, compare `ip link show
eth0` / `ip link show docker0` in the distro, pin the Docker MTU in
`/etc/docker/daemon.json` (`"mtu"`) if they differ, then restart Docker. Run
`npm run dev` from PowerShell: from inside WSL the frontend's Linux
`node_modules`/SWC and the WSL networking assumptions differ (the runner warns
and continues).

## Deployment (Vercel)

Not configured by this repo. When Vercel is set up, its **Root Directory must
become `frontend/`** — the Next app and `next.config.ts` live there; the repo
root is the workspace orchestrator, not a deployable Next.js project.
