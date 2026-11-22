# WhatsApp group live sync (Stage 1): status and plan

Source of truth for what is built, what is verified, and what is left. The
design rules live in `backend/DATABASE.md` ("WhatsApp group live sync"),
`whatsapp-bridge/README.md` and `whatsapp/README.md` (runbook and live
checklist). Update this file when a line below changes.

Last updated 2026-11-22. The baseline is committed locally (not pushed): the
migrations/worker, bridge, web API and mobile screens each have their own
commit.

## Decisions (approved)

- Extend existing tables (`subjects`, `tasks`, `events`, `documents`,
  `integration_candidates`); no `courses` / `academic_tasks` / `course_materials`.
- Gemini for extraction and vision; `GEMINI_MODEL` and `GEMINI_API_KEY` are env.
- Baileys, local-only first; read-only by construction (allowlist socket).
- Confidence >= 0.85 (inclusive, env-tunable) is added automatically; the rest
  goes to the review queue; a proposed new course is created only on approval.
- Images: memes/selfies/casual photos are discarded; exam schedules, notices and
  whiteboards are extracted. Raw text kept 30 days. A group switched on captures
  from that moment forward (no history back-fill for inactive groups).

## Built and verified

| # | Task | State | Evidence |
| --- | --- | --- | --- |
| 1 | Schema migrations (7 files) | done | `db:lint` clean, types regenerated and drift-checked, `qa/whatsapp-group-sync-schema-check.sql` |
| 2 | Encrypted session store RPCs | done | `qa/whatsapp-group-sync-rpc-check.sql` |
| 3 | `whatsapp-bridge` workspace, read-only socket, DB auth state, session manager | done | `npm run bridge:test` (98, incl. live DB), `npm run smoke -w whatsapp-bridge` (QR path, no phone) |
| 4 | Link flow UI + Server Actions | done | `tests/qa/whatsapp-groups.spec.ts` |
| 5 | Group discovery + toggles | done | bridge unit + live tests, spec |
| 6 | Message ingestion (`ingest_raw_messages`) | done | `qa/whatsapp-group-sync-ingest-check.sql`, bridge tests |
| 7 | Media capture (hash, dedupe, Storage, `documents`) | done | bridge tests, live store test |
| 8 | Extraction core (Gemini client, Zod, noise, PPTX, handler) | done | `npm run test:groupsync` (128), `test:groupsync:live`, live Gemini 2026-11-22 |
| 9 | Date resolver + image path | done | resolver table tests (DST, zones), image tests |
| 10 | Subject matching + persistence + review confirm | done | worker tests, live test, spec |
| 11 | Review queue, document card, task and event markers | done, see gaps | spec |
| 12 | Retention purge, docs | mostly done | see "Remaining" |
| 13 | Pairing-code link (DB, bridge, Bearer API) | done | `qa/whatsapp-group-sync-pairing-check.sql`, bridge tests (114), `tests/qa/whatsapp-api.spec.ts` |
| 14 | Mobile screens: WhatsApp groups, read-only Tasks and Calendar, Course materials | done | device-verified 2026-11-22 (`mobile-app/plan.md` §P); `mobile-app` jest 139, tsc, lint |

## Mobile app (pairing-code link)

A QR on the phone cannot be scanned by the same phone, so the app links with
WhatsApp's 8-character pairing code: the student enters their number (cleaned to
digits-only E.164 on the device and again on the server), the bridge asks
WhatsApp for the code, and the app shows it with a countdown and a Copy Code
button to paste under WhatsApp > Linked devices > Link with phone number.

- Server: Bearer routes under `frontend/app/api/integrations/whatsapp-groups/`
  (GET, link, disconnect, candidates confirm/reject); the QR is never sent to a
  Bearer caller. Details in `backend/DATABASE.md`.
- App: `mobile-app/src/features/whatsappGroups/` and
  `mobile-app/src/features/agenda/`; env `EXPO_PUBLIC_API_BASE_URL`.
- Not verified: any device run, the real clipboard, and a real pairing code from
  WhatsApp. `expo-clipboard` needs a new native build.

## Device verification (2026-11-22, emulator)

Built from the proven worktree recipe and installed in place over the permanent
identity (signer SHA-256 `bc51cd50…`, `usesCleartextTraffic=true`). The
authenticated identity was the **OAuth test user `lets.thryvee@gmail.com`**
(the phone signed in with Google, not the QA2 email form); the fixture rows
were seeded for that user. This is a recorded deviation from the QA1/QA2
convention, not a founder account. Recorded on the emulator
(`Pixel7_API36`), with a **mocked bridge heartbeat** (DB-only; no WhatsApp
connection):

| Leg | Result | Evidence (`mobile-app/screenshots/`) |
| --- | --- | --- |
| Calendar + Tasks read live rows, subject tags, From WhatsApp badge, original-message snippet via owner-RLS `raw_messages` | PASS | `wg-m4-calendar-tags.png`, `wg-m4-calendar-original-message.png`, `wg-m4-tasks-markers.png`, `wg-m4-tasks-original-message.png` |
| Pairing-code card from a mocked `code_ready` session, live countdown, Copy Code | PASS ("✓ Copied" captured) | `wg-m4-pairing-code.png`, `wg-m4-pairing-code-copied.png` |
| Connected state, group switches (Supabase `is_active` + `activated_at`), review Add → task/event + proposed course created only on approval | PASS | `wg-m4-groups-connected.png`, `wg-m4-groups-both-active.png`, `wg-m4-review-added.png`, `wg-m4-tasks-after-approvals.png`, `wg-m4-calendar-after-approvals.png` |
| Course materials: type/size/summary/tags, From WhatsApp, subject filter, honest "File unavailable", open via signed URL in Chrome | PASS (storage 200, `application/pdf`) | `wg-m4-materials.png`, `wg-m4-materials-filter.png`, `wg-m4-materials-open-pdf.png` |
| Dark rendering | PASS | `wg-m4-materials-dark.png`, `wg-m4-groups-dark.png` |
| Reduced motion (scales 0/0/0, cold start) | PASS, all content rendered | `wg-m4-calendar-reduced-motion.png` |

Incidents recorded, not hidden: the emulator was memory-starved (host ~437 MB
free) and produced ANR dialogs and dropped taps; it was restarted with 2 GB.
`uiautomator dump` then failed with "could not get idle state" and returned a
stale hierarchy, which briefly looked like a frozen app; verification moved to
screenshots + Windows OCR. PowerShell `>` corrupts binary screenshots — captures
must use `cmd /c "adb exec-out screencap -p > file.png"`.

**Still `[!]` unverified:** real WhatsApp (pairing code from WhatsApp, group
discovery, live messages/files); live Gemini extraction (no key was set for
these legs, so the worker path was not exercised); and the diagnostics removal
found earlier is already in the baseline.

## Live Gemini verification (2026-11-22, host)

Run against the local stack with a real key. The model is pinned in
`backend/.env` as **`gemini-3.1-flash-lite`** (a cheap lite tier):
`gemini-2.5-flash` is retired for new keys (404), and `gemini-2.5-flash-lite`
and `gemini-3.8-flash-lite` are not servable to this key either.

Three live drifts were found and fixed in the client/pipeline, each with tests:

1. Google rejects the generated JSON Schema ("produces a constraint that has
   too many states"). The client already retried without it; it now remembers
   the rejection **process-wide**, so only the first job pays the 400. The
   prompt now carries an explicit JSON example (the schema fallback previously
   had no shape guidance), and the schema accepts a missing `relevant` (derived
   from the items), null `topic_tags`, and capitalised enum values
   ("Monday", "Assignment").
2. A text message: `whatsapp.extract` succeeded, `auto=1`, and wrote a task
   ("Assignment 5", due 2026-12-12 18:29 UTC = 23:59 IST, `source
   whatsapp_group`, matched CS301, one `gemini_extract` usage row).
3. A PDF: extraction wrote a real `ai_summary` and seven `topic_tags`, then
   the queued `document.process` indexed it (`pages=1 units=1`).
4. An exam-schedule image: vision classification passed, extraction wrote an
   exam event (2026-12-15 04:30 UTC = 10:00 IST, Hall B, CS301,
   `source whatsapp_group`); the image document was kept.

Model note: `GEMINI_MODEL` remains an env var because Google retires names;
re-run this check when the key or model changes.

## Remaining

1. **Regression, partly done.** With the flag on: onboarding, tasks (data, UI),
   events (data, UI), documents (data, UI), whatsapp-security, whatsapp-ui and
   the new group spec all pass (no failures after clearing a stale QA1 test
   document left by an earlier aborted run). NOT run: `qa-documents-hub`
   (needs the job worker, not running here), the worker-dependent whatsapp
   export/jobs specs, assistant specs, and the new spec with the flag OFF.
2. Remaining web gates: the group spec with the flag OFF, and the worker-dependent specs with the worker running. Final gates from a clean state: `db:lint`, `db:check-types`, frontend
   `typecheck`/`lint`/`build`, bridge and worker tests.
3. Visual check in Chromium (screenshots under `frontend/screenshots/`) of the
   card states, review rows and the document card; verify reduced motion.
4. `db:reset` from scratch was NOT run (it would wipe local data, including the
   founder's account). Needs the founder's go, or run it on a disposable stack.
5. Small docs: RLS matrix rows in `backend/DATABASE.md`, root `README.md` row.
6. Commits: baseline committed in scoped commits (backend, bridge, web, mobile);
   the mobile device verification and these docs are the next scoped commit.

## Known gaps and risks

- **Gemini is verified live (2026-11-22)** with `gemini-3.1-flash-lite`; see
  "Live Gemini verification" above for the model retirement and the three
  shape fixes. Re-check with a simple call whenever the key or model changes.
- **Real WhatsApp is unverified** (needs a spare number and test group): QR scan,
  group list, live messages, files, history at link time, reconnect. Checklist in
  `whatsapp/README.md`. Baileys is unofficial; use a throwaway number.
- `UNIPILOT_INTEGRATIONS_KEY` must be set in `backend/.env` (it is only in
  `frontend/.env` today) for the bridge and worker.
- Rotating `UNIPILOT_INTEGRATIONS_KEY` makes stored sessions unreadable (users
  re-link); there is no re-encrypt RPC for them yet.
- No subject filter or grouping on `/documents` yet (subject is shown on each
  card). 
- Windows `winnat` currently blocks the host from reaching the local API port;
  verification used a temporary host forwarder (not part of the repo).
