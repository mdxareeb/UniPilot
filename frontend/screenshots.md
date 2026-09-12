# Verification screenshots

`frontend/screenshots/` is the single home for ad-hoc verification screenshots
(Playwright MCP and one-off Chromium probes). It is git-ignored on purpose:
evidence stays reviewable on disk without ever entering the repository.

Convention:

- Playwright MCP is launched with `--output-dir frontend/screenshots`
  (`opencode.json`), so screenshots taken without an explicit path land here.
- When passing a filename, use `frontend/screenshots/<name>.png`.
- Keep run artifacts that belong to a test run — storage state, traces,
  `test-results/` — under `frontend/.playwright/` (also git-ignored). Never mix
  the two.
- Prefer already-prefixed, self-describing names
  (`<task>-<surface>-<theme>-<width>.png`).
