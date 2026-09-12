<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Monorepo note

This Next.js app lives in `frontend/`. The repo root holds the npm-workspaces
orchestration (`package.json`) and the shared project docs (`../TASK.md`,
`../DESIGN.md`, `../MOTION.md`, `../AUTH_ARCHITECTURE.md`, `../QA_SESSION.md`).
Under npm workspaces the `next` package is hoisted to the repo root, so the
guides referenced above resolve from `frontend/node_modules/next/dist/docs/`
when present, otherwise from the hoisted `../node_modules/next/dist/docs/` at
the repo root; `node_modules/next/dist/server/lib/generate-agent-files.js` is
found the same way.

Project rules (Motion system, QA session) stay in the root `AGENTS.md`.
