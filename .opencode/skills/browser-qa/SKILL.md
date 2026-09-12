---
name: browser-qa
description: Enforce live Playwright MCP browser verification for any UI/UX task - dev server, real clicks/keyboard, responsive checks, console/network inspection, snapshots/screenshots.
---

# Browser QA

Use for any UI/UX task in UniPilot when live verification is required. Prefer browser evidence over source-only reasoning.

## Requirement

For any UI/UX task, use the configured Playwright MCP browser tools for live verification whenever available.

Required for relevant UI tasks:
- start/use the local dev server (auto-start `npm run dev` on `http://localhost:3000` if not running)
- navigate to the actual route under test
- interact with the UI using real clicks (`browser_click` with `target` + `element`) and keyboard input (`browser_type`, `browser_press_key`, `browser_fill_form`)
- verify responsive layouts at requested widths (`browser_resize`)
- inspect browser console for errors (`browser_console_messages level:error` and `level:warning`)
- inspect network requests when relevant (`browser_network_requests`)
- use `browser_snapshot` for accessibility/DOM verification
- use `browser_take_screenshot` when visual verification matters — screenshots go to `frontend/screenshots/` (see Screenshots below)

## Screenshots

All verification screenshots live in `frontend/screenshots/` — a single
git-ignored folder at the frontend workspace root (convention documented in
`frontend/screenshots.md`). The Playwright MCP server is launched with
`--output-dir frontend/screenshots` (see `opencode.json`), so a screenshot
without an explicit path lands there by default. When passing a filename, use
`frontend/screenshots/<name>.png`. Never save evidence into the repo root,
`frontend/` root, or `.playwright/` (that folder is for run artifacts: storage
state, traces, `test-results/`).

## Auth Safety

For authenticated behavior:
- use an already available authenticated browser session only when explicitly permitted
- never create test users unless the task explicitly allows it
- never touch or modify the founder account
- never expose credentials, tokens, cookies, or private data in logs/screenshots/reports

## Fallback

If browser tooling is unavailable (`opencode mcp list` shows disconnected), clearly report that limitation and fall back to structural QA. Do not silently skip verification.

## Available Tools (Playwright MCP 0.0.79, chromium --isolated --caps vision)

- `browser_navigate` `{"url": "http://localhost:3000/<route>"}`
- `browser_snapshot` `{}`
- `browser_click` `{"element": "human desc", "target": "ref"}`
- `browser_type` `{"element": "desc", "target": "ref", "text": "...", "submit": false}`
- `browser_fill_form` `{"fields": [{"target":"ref","name":"...","type":"textbox","value":"..."}]}`
- `browser_press_key` `{"key": "Escape"}` (also Enter, Tab, ArrowLeft etc)
- `browser_resize` `{"width": 1280, "height": 720}` (test 375, 768, 1280, 1440)
- `browser_take_screenshot` `{"type": "png", "filename": "frontend/screenshots/<name>.png"}` (default output dir is `frontend/screenshots/`)
- `browser_console_messages` `{"level": "error"}` / `{"level":"info","all":true}`
- `browser_network_requests` `{"static": false}` + `browser_network_request` for body
- `browser_evaluate` `{"function": "()=>document.title"}`
- `browser_tabs` `{"action":"list"}`
- `browser_handle_dialog`, `browser_wait_for`, `browser_evaluate`, `browser_navigate_back`

## Workflow

1. `opencode mcp list` — confirm `✓ playwright connected`
2. Ensure dev server: `curl http://localhost:3000` or `npm run dev`
3. `browser_navigate` → `browser_snapshot` → `browser_take_screenshot` before change (baseline)
4. Make code change
5. `browser_navigate` again → verify via `browser_snapshot` + `browser_take_screenshot` + `browser_console_messages` + `browser_network_requests`
6. For responsive: loop `browser_resize` at 375/768/1280 + snapshot/screenshot each
7. Report evidence: include URLs, snapshot snippets, console/network summary; never paste secrets
