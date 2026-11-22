# WhatsApp group live sync (Stage 1): status and plan

Source of truth for what is built, what is verified, and what is left. The
design rules live in `backend/DATABASE.md` ("WhatsApp group live sync"),
`whatsapp-bridge/README.md` and `whatsapp/README.md` (runbook and live
checklist). Update this file when a line below changes.

Last updated 2026-11-19. Nothing here is committed or pushed yet.

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
| 8 | Extraction core (Gemini client, Zod, noise, PPTX, handler) | done | `npm run test:groupsync` (123), `test:groupsync:live` |
| 9 | Date resolver + image path | done | resolver table tests (DST, zones), image tests |
| 10 | Subject matching + persistence + review confirm | done | worker tests, live test, spec |
| 11 | Review queue, document card, task and event markers | done, see gaps | spec |
| 12 | Retention purge, docs | mostly done | see "Remaining" |
| 13 | Pairing-code link (DB, bridge, Bearer API) | done | `qa/whatsapp-group-sync-pairing-check.sql`, bridge tests (114), `tests/qa/whatsapp-api.spec.ts` |
| 14 | Mobile screens: WhatsApp groups, read-only Tasks and Calendar | code complete, not run on a device | `mobile-app` jest (127), tsc, lint; record in `mobile-app/plan.md` section P |

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
6. Commit in scoped commits (none made).

## Known gaps and risks

- **Gemini is unverified live** (no key). Request/response shapes follow Google's
  docs and are covered only by mocked-fetch tests. First real call may need a
  tweak to the request body; `GEMINI_MODEL` must be set to a current model name.
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
