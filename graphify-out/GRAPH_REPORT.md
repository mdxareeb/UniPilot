# Graph Report - unipilot  (2026-09-28)

## Corpus Check
- 504 files · ~603,846 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4384 nodes · 10601 edges · 213 communities (194 shown, 19 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 106 edges (avg confidence: 0.57)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `83ac941e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- motionIndex
- FeatureGrid.tsx
- presentationJobs.mjs
- GlobalSearch.tsx
- OnboardingFlow.tsx
- editorOps.ts
- dashboard/page.tsx
- presentations-ui.spec.ts
- DeckEditor.tsx
- hydrateSlide.ts
- taskValues.ts
- presentations-renderer.spec.ts
- DeckStage.tsx
- Card.tsx
- TASK.md
- (app)/layout.tsx
- integrationValues.ts
- presenton.ts
- elements.ts
- dependencies
- ChartControls.tsx
- WhatsApp Integration Implementation Plan
- test_calendar_push.py
- ServiceError
- Presenton fork + re-theme â€” Implementation Plan
- joinUrl
- presentationValues.ts
- presentations.ts
- PresentationWorkspace.tsx
- CalendarWorkspace.tsx
- toolCatalog.ts
- test_sync.py
- features/page.tsx
- The shared Motion layer
- presentationActions.ts
- IconButton.tsx
- start-env.mjs
- documentProcessing.mjs
- textRuns.ts
- integrations.ts
- ChatPanel.tsx
- actionSchema.ts
- TaskBoard.tsx
- integrations/page.tsx
- ProPlanCard.tsx
- test_reader.py
- UniPilot database schema (ratified by Task 20.6)
- WhatsApp integration — design
- WhatsAppCard.tsx
- schema-contract.ts
- tableOps.ts
- Button.tsx
- icons.ts
- test_extractor.py
- types.ts
- whatsapp-export.spec.ts
- presentations-jobs.spec.ts
- compilerOptions
- StageContext.tsx
- eventValues.ts
- assistantActionLog.ts
- documents.ts
- sync.py
- scripts
- createClient
- Task 3.13 — Visual Foundation Amendment
- asset/route.ts
- Presentation generate/setup — redesign + honest model chooser
- calendarEvents.ts
- useAssistantTurn.ts
- redirects.ts
- engineApi
- EventBlocks.tsx
- SupabaseRest
- EditorRail.tsx
- TableElement.tsx
- scripts
- RISKS
- actions.ts
- assistant.ts
- command
- Presenton UI fork — re-theme and surface — design
- workerLock.ts
- assistant-backend.spec.ts
- AssistantWorkspace.tsx
- assistant-actions.spec.ts
- calendar/page.tsx
- whatsapp-jobs.spec.ts
- 0. GLOBAL RULES
- main
- DocumentsHub.tsx
- specimen/page.tsx
- TransformHandles.tsx
- Navbar.tsx
- seed-qa-identity.mjs
- onboarding.ts
- presentonConfig.ts
- InfographicElement.tsx
- requireOnboardedUser
- ConfirmEmail.tsx
- provider.ts
- whatsapp-security.spec.ts
- QA Session â€” the permitted authenticated environment (Task 20.10)
- documents-processing.spec.ts
- ImageControls.tsx
- onboarding.spec.ts
- rls-isolation.spec.ts
- UniPilot Authentication Architecture
- 3. The endpoints UniPilot calls (exact shapes)
- 7. Architecture
- layoutPaletteModel.ts
- assets.ts
- WhatsApp integration service
- 6. Slide representation and native rendering
- fonts.spec.ts
- Auth email delivery
- Phase D — Full editor parity
- Native presentation experience — design
- SubjectsStep
- documents-hub.spec.ts
- EXECUTION ORDER
- Protected-route strategy
- Presentation generate/setup redesign — implementation plan (T1–T4)
- chatActions.ts
- documents-search.spec.ts
- Native presentation experience — implementation plan (Phases A–F)
- Phase B — Deck viewer
- assistant-ui.spec.ts
- Phase A — Generate/setup + result
- 5. Presenton UI inventory — screen/feature matrix
- AssistantComposer.tsx
- database.types.ts
- jobs-runner.spec.ts
- Browser QA
- UniPilot
- 1. MOTION SYSTEM
- PART IX — TIER 2 TOOLS
- Email templates
- Phase C — Core editor
- Phase F — History / settings
- 10. Phases A–F
- 8. UniPilot-native mapping (DESIGN.md + MOTION.md)
- EventFormModal.tsx
- app/layout.tsx
- tasks-ui.spec.ts
- FUTURE DEVELOPMENT RULES
- searchBenchmark.mjs
- 20.6 schema must define
- Development: local Supabase, no real email
- Grid.tsx
- Tooltip.tsx
- design-313-capture.mjs
- structure.spec.ts
- 15. Dashboard `/dashboard`
- PART VIII — TIER 1 TOOLS
- AGENTS.md
- Implemented so far (Tasks 12.2–12.10, extended through 13.10/14.10/14.11)
- auth.setup.ts
- 4. Current state
- This is NOT the Next.js you know
- design-313-verify.mjs
- PART X — TIER 3 / RESEARCH
- 46. Calendar Integrations
- check-types.sh
- generate-types.sh
- eslint.config.mjs
- next.config.ts
- postcss.config.mjs
- screenshots.md
- design-313-diff.mjs
- design-313-focus2.mjs
- design-313-perf.mjs
- install-autostart.sh
- 13. STUDENT ONBOARDING
- 30. TOOL REGISTRY / TOOL PLATFORM
- 3. Design System
- UniPilot — Master Build Plan
- OnboardingFlow
- useDeckAutosave.ts
- isSupabaseConfigured
- presets.ts
- ProfileMenu.tsx
- edit/page.tsx
- gate.ts
- integrationActions.ts
- context.ts
- SemesterStep.tsx
- documents-ui.spec.ts
- PreferencesStep.tsx
- useSignInPrompt
- forgot-password/page.tsx
- PresentationTemplatePreviewPage

## God Nodes (most connected - your core abstractions)
1. `DeckEditor()` - 80 edges
2. `motionIndex()` - 79 edges
3. `createClient()` - 74 edges
4. `requireOnboardedUser()` - 65 edges
5. `Button()` - 59 edges
6. `Card()` - 50 edges
7. `readProfileTimeZone()` - 41 edges
8. `Container()` - 39 edges
9. `createServiceClient()` - 37 edges
10. `ServiceError` - 34 edges

## Surprising Connections (you probably didn't know these)
- `IntegrationsWorkspace()` --indirect_call--> `isWhatsAppRunActive()`  [INFERRED]
  frontend/app/(app)/integrations/_components/IntegrationsWorkspace.tsx → frontend/lib/data/integrationValues.ts
- `PreviewShell()` --calls--> `motionIndex()`  [EXTRACTED]
  frontend/app/(app)/tools/presentation/templates/[templateId]/page.tsx → frontend/components/motion/stagger.ts
- `BenchmarksPage()` --calls--> `motionIndex()`  [EXTRACTED]
  frontend/app/(marketing)/benchmarks/page.tsx → frontend/components/motion/stagger.ts
- `DevsNotePage()` --calls--> `motionIndex()`  [EXTRACTED]
  frontend/app/(marketing)/devs-note/page.tsx → frontend/components/motion/stagger.ts
- `FaqPage()` --calls--> `motionIndex()`  [EXTRACTED]
  frontend/app/(marketing)/faq/page.tsx → frontend/components/motion/stagger.ts

## Import Cycles
- None detected.

## Communities (213 total, 19 thin omitted)

### Community 0 - "motionIndex"
Cohesion: 0.06
Nodes (59): ConversationSidebar(), ConversationSidebarProps, AIInsightCard(), AIInsightCardProps, DashboardInsight, DashboardGreeting(), DashboardGreetingProps, DashboardStudent (+51 more)

### Community 1 - "FeatureGrid.tsx"
Cohesion: 0.06
Nodes (28): Feature, MarqueeRow(), marqueeStyle(), rowFour, rowOne, rowThree, AskStepPreview(), IndexStepPreview() (+20 more)

### Community 2 - "presentationJobs.mjs"
Cohesion: 0.06
Nodes (72): CHUNK_OVERLAP_CHARS, CHUNK_TARGET_CHARS, chunkText(), findBoundary(), permanent(), readDocumentId(), REINDEX_COPY, reindexDocument() (+64 more)

### Community 3 - "GlobalSearch.tsx"
Cohesion: 0.21
Nodes (14): GlobalSearch(), searchDocumentChunks(), SearchRow, semanticSearchStatus(), toHit(), searchAction(), SearchActionResult, SEARCH_ERROR (+6 more)

### Community 4 - "OnboardingFlow.tsx"
Cohesion: 0.13
Nodes (25): CourseStep(), validateCourse(), InstitutionStep(), validateInstitution(), INITIAL_ONBOARDING_DATA, OnboardingData, OnboardingErrors, RequiredField (+17 more)

### Community 5 - "editorOps.ts"
Cohesion: 0.05
Nodes (80): clearElementClipboard(), cloneElementForClipboard(), cloneJson(), createElementClipboard(), deleteElements(), duplicateElements(), ELEMENT_CLIPBOARD_MIME, ELEMENT_CLIPBOARD_PREFIX (+72 more)

### Community 6 - "dashboard/page.tsx"
Cohesion: 0.27
Nodes (11): formatDashboardDate(), formatter, InitialDashboard(), DashboardPage(), firstWord(), sessionFirstName(), academicYearLabel(), labelOf() (+3 more)

### Community 7 - "presentations-ui.spec.ts"
Cohesion: 0.03
Nodes (34): ChatRaceTarget, clipboardScratchComponent(), createdDocumentIds, createdDocumentPaths, createdExportJobIds, createdPresentationIds, deckSlide(), EditorImageTarget (+26 more)

### Community 8 - "DeckEditor.tsx"
Cohesion: 0.06
Nodes (62): DeckEditor(), DeckEditorProps, freshId(), HitBox, ROOT_COMPONENT, SavedBaseline, swatchColors(), TransformGesture (+54 more)

### Community 9 - "hydrateSlide.ts"
Cohesion: 0.07
Nodes (69): TemplatePreview(), TemplatePreviewProps, buildTemplatePreviewDeck(), renderableTemplateLayouts(), templatePreviewDeckId(), TemplatePreviewDeckInput, appendTemplateTextRun(), applyChartContent() (+61 more)

### Community 10 - "taskValues.ts"
Cohesion: 0.07
Nodes (52): TaskDeleteModal(), TaskDetailModal(), TaskFormModal(), DetailState, onOptimisticResult(), sortTasks(), TaskFormValues, TasksContext (+44 more)

### Community 11 - "presentations-renderer.spec.ts"
Cohesion: 0.04
Nodes (38): CHART_COLOR_LIMIT, deckFontKind, applyImageBorderRadius(), applyImageCrop(), applyImageFit(), applyImageFlip(), applyImageOpacity(), applyImageSource() (+30 more)

### Community 12 - "DeckStage.tsx"
Cohesion: 0.12
Nodes (36): ChartElement(), stageGraphTheme(), ContainerElement(), containerOverflow(), ElementProps, FlexElement(), GridElement(), GroupElement() (+28 more)

### Community 13 - "Card.tsx"
Cohesion: 0.07
Nodes (33): IntegrationCardProps, ClosingCTA(), FeatureGrid(), highlights, HomeBenchmarksSection(), HomeDevsNoteSection(), faqs, HomeFaqSection() (+25 more)

### Community 14 - "TASK.md"
Cohesion: 0.04
Nodes (55): 10. FAQ `/faq`, 11. Dev's Note `/devs-note`, 12. Authentication, 14. AUTHENTICATED APP SHELL, 16. TASKS `/tasks`, 17. CALENDAR `/calendar`, 18. DOCUMENTS `/documents`, 19. ASSISTANT `/assistant` (+47 more)

### Community 15 - "(app)/layout.tsx"
Cohesion: 0.12
Nodes (21): metadata, SidebarPlanPanel(), SidebarUser(), SidebarUserFallback(), WorkspaceMobileNav(), isActiveNavPath(), WORKSPACE_NAV, WorkspaceNavItem (+13 more)

### Community 16 - "integrationValues.ts"
Cohesion: 0.06
Nodes (38): REVIEW_MODE_SENTENCES, WhatsAppUploadPhase, getCandidatePoll(), getConnectionPoll(), activeRunCount(), connectionRowToItem(), integrationCandidateRowToItem(), integrationRunRowToItem() (+30 more)

### Community 17 - "presenton.ts"
Cohesion: 0.05
Nodes (53): buildGenerationRequestBody(), buildPresentationUpdateBody(), buildSlidesReplaceBody(), buildSlideUpdateBody(), buildTemplateListQuery(), normalizeChatConversation(), normalizeChatHistory(), normalizeChatMessage() (+45 more)

### Community 18 - "elements.ts"
Cohesion: 0.08
Nodes (55): ComponentFrame(), ASSET_PREFIXES, categoryColors(), CHART_JS_TYPES, chartConfig(), chartDataLabelAlign(), chartDataLabelAnchor(), ChartDatasetConfig (+47 more)

### Community 19 - "dependencies"
Cohesion: 0.04
Nodes (48): chart.js, chartjs-plugin-datalabels, eslint, eslint-config-next, dependencies, chart.js, chartjs-plugin-datalabels, lucide-react (+40 more)

### Community 20 - "ChartControls.tsx"
Cohesion: 0.12
Nodes (43): ChartControls(), ChartControlsProps, ChartTypeOption, chartTypeOptions(), addChartRow(), addChartSeries(), applyChartField(), categoryPlaceholder() (+35 more)

### Community 21 - "WhatsApp Integration Implementation Plan"
Cohesion: 0.04
Nodes (47): Global Constraints, Phase 0 — Security/ACL baseline, Phase 1 — Schema, bucket, RPCs, type regeneration, Phase 2 — Python service refactor + pytest (TASK.md 46.11), Phase 3 — Worker job kinds + `touch_job` heartbeat (TASK.md 46.13), Phase 4 — Data layer + Server Actions (TASK.md 46.14), Phase 5 — Export UI + calendar marker (TASK.md 46.15, 46.18), Phase 6 — Live self-host gate (TASK.md 46.16) `[!]` (+39 more)

### Community 22 - "test_calendar_push.py"
Cohesion: 0.09
Nodes (34): candidate(), event(), FakeAuthError, FakeClient, FakeEventsResource, FakeRequest, FakeService, Exception (+26 more)

### Community 23 - "ServiceError"
Cohesion: 0.08
Nodes (42): settings_for(), test_missing_chrome_is_non_retryable(), Settings, _capture_qr(), _clean_text(), collect_messages(), _dedup_key(), _find_all() (+34 more)

### Community 24 - "Presenton fork + re-theme â€” Implementation Plan"
Cohesion: 0.04
Nodes (44): Execution log, File Structure (created / modified), Global Constraints, P0 â€” completed 2026-09-15 (except a founder-gated provider fix), P0 â€” Fork, wiring, baseline (no styling), P1 â€” completed 2026-09-15, P1 â€” Theme foundation, P2 â€” completed 2026-09-15 (+36 more)

### Community 25 - "joinUrl"
Cohesion: 0.29
Nodes (31): assertSafeSegment(), classifyHttpFailure(), deletePresentation(), deletePresentationImage(), downloadPresentationExport(), fetchEngineAssetBytes(), fetchWithTimeout(), generatePresentationImage() (+23 more)

### Community 26 - "presentationValues.ts"
Cohesion: 0.06
Nodes (42): FORMAT_OPTIONS, GenerateHero(), GenerateHeroProps, LANGUAGE_OPTIONS, SLIDE_COUNT_OPTIONS, togglePillClasses(), TONE_LABELS, TONE_OPTIONS (+34 more)

### Community 27 - "presentations.ts"
Cohesion: 0.12
Nodes (26): DocumentsPage(), DeckDeleteBody(), confirm(), onSubmit(), GUEST_MODELS, PresentationToolPage(), SOURCE_MIME_TYPES, PresentationTemplatesPage() (+18 more)

### Community 28 - "PresentationWorkspace.tsx"
Cohesion: 0.07
Nodes (36): DeckDeleteModal(), DeckRow(), DecksList(), onDelete(), onDownload(), DecksListProps, deleteDescription(), slideCountLabel() (+28 more)

### Community 29 - "CalendarWorkspace.tsx"
Cohesion: 0.15
Nodes (23): CalendarContext, CalendarContextValue, CalendarView, CalendarWorkspace(), DetailState, onOptimisticResult(), sortEvents(), VIEWS (+15 more)

### Community 30 - "toolCatalog.ts"
Cohesion: 0.07
Nodes (34): FAMILIES, FAMILY_TOOLS, FAMILIES, ToolsPage(), MarqueeCard(), FileConvertersSection(), ToolCatalogueSection(), ToolCard() (+26 more)

### Community 31 - "test_sync.py"
Cohesion: 0.16
Nodes (34): automatic_client(), automatic_run(), FakeClient, parametrize, run_row(), test_all_day_candidate_stores_exclusive_end(), test_auto_confirm_chunks_the_ignored_events_lookup(), test_auto_confirm_chunks_the_pending_candidates_lookup() (+26 more)

### Community 32 - "features/page.tsx"
Cohesion: 0.06
Nodes (54): BenchmarksClosingCTA(), aiRows, BarRow, BenchmarksPage(), processingRows, searchRows, DevsNotePage(), metadata (+46 more)

### Community 33 - "The shared Motion layer"
Cohesion: 0.05
Nodes (37): `action-arrow` (utility), Adding motion, `[data-collapsible]` — disclosure panels, `[data-enter]` — page entrance, `data-scroll-behavior="smooth"` on `<html>`, Document and layout contracts, Duration, Easing (+29 more)

### Community 34 - "presentationActions.ts"
Cohesion: 0.07
Nodes (68): onModelChange(), IconPickerModal(), ImagePickerModal(), CreatePresentationResult, deletePresentationImageAction(), DeletePresentationResult, EditorActionResult, editorFailureCopy() (+60 more)

### Community 35 - "IconButton.tsx"
Cohesion: 0.18
Nodes (15): clamp(), DeckViewer(), DeckViewerProps, isEditableTarget(), targetOwnsSpace(), PresentMode(), PresentModeProps, SlideRail() (+7 more)

### Community 36 - "start-env.mjs"
Cohesion: 0.12
Nodes (32): parseEnvFile(), resolveSetting(), buildPresentonRunArgs(), toWslPath(), wslExecArgs(), BACKEND_DIR, distro, dockerVersion() (+24 more)

### Community 37 - "documentProcessing.mjs"
Cohesion: 0.12
Nodes (28): bigrams(), DEFAULT_DIR, extractText(), HERE, main(), parseArgs(), similarity(), classify() (+20 more)

### Community 38 - "textRuns.ts"
Cohesion: 0.16
Nodes (33): captureRange(), focusCaretEnd(), InlineRunsEditor(), InlineRunsEditorProps, readRuns(), renderRuns(), restoreRange(), RUN_KEY_CHORDS (+25 more)

### Community 39 - "integrations.ts"
Cohesion: 0.16
Nodes (21): GET(), sameOriginRedirect(), abortExportRun(), backfillGooglePushes(), confirmCandidate(), ConfirmCandidateResult, finalizeExportRun(), FinalizeExportRunResult (+13 more)

### Community 40 - "ChatPanel.tsx"
Cohesion: 0.13
Nodes (32): ChatPanel(), ChatPanelProps, conversationLabel(), PanelEntry, PanelReview, reasonCopy(), applyChatFrame(), CHAT_ERROR_COPY (+24 more)

### Community 41 - "actionSchema.ts"
Cohesion: 0.12
Nodes (31): ASSISTANT_ACTION_STATUSES, ASSISTANT_ACTION_TYPES, AssistantAction, AssistantActionExecution, AssistantActionStatus, AssistantActionType, EventCreatePayload, formatClock() (+23 more)

### Community 42 - "TaskBoard.tsx"
Cohesion: 0.09
Nodes (18): QuickAddTask(), COLUMNS, FILTERS, StatusFilter, TaskBoard(), handleDrop(), handleMove(), NEXT (+10 more)

### Community 43 - "integrations/page.tsx"
Cohesion: 0.16
Nodes (15): BrandMarkProps, GmailMark(), WhatsAppMark(), IntegrationCard(), PresentonCard(), PresentonCardState, probePresenton, STATUS_COPY (+7 more)

### Community 44 - "ProPlanCard.tsx"
Cohesion: 0.12
Nodes (17): SlideRailProps, Plan, PlanSelector(), PricingCards(), PricingCardsProps, freeFeatures, FreePlanCard(), FreePlanCardProps (+9 more)

### Community 45 - "test_reader.py"
Cohesion: 0.12
Nodes (28): test_envelope_order_override_pins_the_same_day_year(), test_colon_inside_message_text_is_kept(), test_filter_ignored_is_case_insensitive_substring(), test_infer_date_order_ignores_year_first_envelopes(), test_infer_date_order_is_dmy_when_first_components_exceed_12(), test_infer_date_order_is_mdy_when_second_components_exceed_12(), test_infer_date_order_is_none_when_all_components_are_ambiguous(), test_infer_date_order_ties_without_signals() (+20 more)

### Community 46 - "UniPilot database schema (ratified by Task 20.6)"
Cohesion: 0.06
Nodes (31): ACL audit (Task 24.x step 0), Assistant action engine (Task 27.x), Assistant backend (Task 26.x), Background jobs (Task 29.1), Column mapping (`20260911020549_backfill_legacy_profiles.sql`), Decision, Decisions (TASK.md 20.6), Document processing (Task 24.x) (+23 more)

### Community 47 - "WhatsApp integration — design"
Cohesion: 0.06
Nodes (31): 10.1 Data layer (documents split), 10.2 Page and components (`frontend/app/(app)/integrations/`), 10.3 Calendar marker, 10. Frontend, 11. Testing, 12. Verification plan (real Chromium via Playwright MCP), 13. Docs and task updates, 14. Risks and blocked items (+23 more)

### Community 48 - "WhatsAppCard.tsx"
Cohesion: 0.12
Nodes (14): CandidateList(), confirm(), focusAfterRemoval(), useIntegrations(), LiveAccessPanel(), MODE_LABELS, RunHistory(), WhatsAppCard() (+6 more)

### Community 49 - "schema-contract.ts"
Cohesion: 0.06
Nodes (31): AllRequiredTablesPresent, Assert, DocumentChunksHaveDocument, DocumentsHaveStatus, EventsHaveStart, HasKey, MessagesHaveConversation, NotificationsHaveReadAt (+23 more)

### Community 50 - "tableOps.ts"
Cohesion: 0.18
Nodes (28): TableControls(), TableControlsProps, addTableColumn(), addTableRow(), clamp(), declaredBound(), locateCell(), LocatedCell (+20 more)

### Community 51 - "Button.tsx"
Cohesion: 0.07
Nodes (41): ConversationPanelHeaderProps, EventDeleteModalProps, DocumentCardProps, LiveAccessPanelProps, TaskDeleteModalProps, TaskFormModalProps, IconPickerModalProps, WEIGHT_OPTIONS (+33 more)

### Community 52 - "icons.ts"
Cohesion: 0.14
Nodes (26): recolorCache, RecoloredIconSource, rememberRecoloredIcon(), useRecoloredIconSource(), normalizePresentonIcon(), applyIconColor(), applyIconSource(), escapeRegExp() (+18 more)

### Community 53 - "test_extractor.py"
Cohesion: 0.11
Nodes (24): extract(), extract_mdy(), test_birthday_is_september_12_at_19_00(), test_candidate_cap_stops_at_the_limit(), test_duplicate_messages_dedupe_by_start_and_title(), test_mdy_envelope_relative_off_keeps_only_explicit_dates(), test_noise_and_keyword_only_messages_are_ignored(), test_picnic_october_2_is_all_day() (+16 more)

### Community 54 - "types.ts"
Cohesion: 0.05
Nodes (51): BoxStyledElement, FontStyleOptions, componentIdWithSuffix(), defaultInfographicElement(), INFOGRAPHIC_CAPABILITIES, INFOGRAPHIC_INSERT_DEFAULTS, INFOGRAPHIC_INSERT_POSITION, INFOGRAPHIC_NATURAL_SIZE (+43 more)

### Community 55 - "whatsapp-export.spec.ts"
Cohesion: 0.12
Nodes (9): BACKEND_DIR, bucketPaths, connectionIds, eventIds, jobIds, MDY_SAMPLE, REPO_ROOT, runIds (+1 more)

### Community 56 - "presentations-jobs.spec.ts"
Cohesion: 0.07
Nodes (19): PresentationRow, createdDocumentIds, createdDocumentPaths, createdJobIds, createdPresentationIds, everCreatedDocumentIds, everCreatedDocumentPaths, everCreatedJobIds (+11 more)

### Community 57 - "compilerOptions"
Cohesion: 0.07
Nodes (28): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+20 more)

### Community 58 - "StageContext.tsx"
Cohesion: 0.15
Nodes (18): cssString(), DeckFontFace(), fontFormat(), DeckStage(), slideUi(), DeckStageAssetUrl, DeckStageContext, DeckStageContextValue (+10 more)

### Community 59 - "eventValues.ts"
Cohesion: 0.10
Nodes (41): createEvent(), EventRange, EventServiceOptions, EventUpdate, listEvents(), listEventsForDates(), loadEvents(), toWritable() (+33 more)

### Community 60 - "assistantActionLog.ts"
Cohesion: 0.13
Nodes (23): AssistantActionExecutionContext, AssistantActionExecutionResult, assistantActionIdempotencyKey(), AssistantActionKeyInput, AssistantActionLogRow, AssistantActionServiceOptions, confirmAssistantAction(), executeAssistantAction() (+15 more)

### Community 61 - "documents.ts"
Cohesion: 0.06
Nodes (67): DocumentsContext, DocumentsContextValue, DocumentsWorkspace(), PreviewResult, putObjectWithProgress(), resolveFileMime(), UploadPhase, abortDocumentAction() (+59 more)

### Community 62 - "sync.py"
Cohesion: 0.12
Nodes (21): test_profile_timezone_beats_default(), test_settings_defaults_are_the_documented_ones(), test_changes_with_sender_time_or_text(), test_is_32_lowercase_hex_chars(), test_is_stable_for_identical_inputs(), test_message_time_falls_back_when_unparseable(), test_message_time_parses_chat_timestamp_with_date_order(), event_fingerprint() (+13 more)

### Community 63 - "scripts"
Cohesion: 0.08
Nodes (25): dependencies, mammoth, pdfjs-dist, @supabase/supabase-js, devDependencies, fflate, pdf-lib, @supabase/supabase-js (+17 more)

### Community 64 - "createClient"
Cohesion: 0.10
Nodes (42): AssistantWorkspace(), AssistantPage(), metadata, providerStatus, ASSISTANT_COPY, AssistantTurnResult, listAssistantActions(), ConversationActionResult (+34 more)

### Community 65 - "Task 3.13 — Visual Foundation Amendment"
Cohesion: 0.08
Nodes (24): Brand & Style, Colors, Components, Elevation & Depth, Layout & Spacing, Nested Surfaces (depth by fill, not by shadow), Shapes, Task 3.13 — Visual Foundation Amendment (+16 more)

### Community 66 - "asset/route.ts"
Cohesion: 0.23
Nodes (13): engineFailure(), GET(), jsonError(), engineFailure(), GET(), jsonError(), fetchPresentationAsset(), fetchPresentationTemplateAsset() (+5 more)

### Community 67 - "Presentation generate/setup — redesign + honest model chooser"
Cohesion: 0.08
Nodes (23): 1. Goal, scope, non-goals, 2.1 What the engine accepts, 2.2 How the model is actually resolved, 2.3 The only write path, and who may use it, 2.4 Live probe (local engine, 2026-09-21), 2.5 What the chooser can honestly promise, 2.6 Recorded limits (`[!]` — carried into TASK.md by T4), 2. Model selection — the exact mechanism and its limits (+15 more)

### Community 68 - "calendarEvents.ts"
Cohesion: 0.11
Nodes (24): allDayEventsForDate(), BlockPlacement, blockShowsMetadata(), compareForDate(), eventCoversDate(), eventDateSpan(), eventsForDate(), EventTypeChoice (+16 more)

### Community 69 - "useAssistantTurn.ts"
Cohesion: 0.17
Nodes (20): ASSISTANT_TURN_DEADLINE_MS, belongsToSelection(), composeDeadline(), hasParsedAssistantAction(), readErrorCopy(), useAssistantTurn(), UseAssistantTurnOptions, collectStructuredActions() (+12 more)

### Community 70 - "redirects.ts"
Cohesion: 0.15
Nodes (18): SignInPrompt(), AUTHENTICATED_REDIRECT_PATHS, PROTECTED_PREFIXES, PUBLIC_AUTH_PATHS, assertMatcherCoversProtectedRoutes(), hasControlChars(), isAuthenticatedRedirectPath(), isProtectedPath() (+10 more)

### Community 71 - "engineApi"
Cohesion: 0.16
Nodes (22): collectElementAssetPaths(), createBlankEngineDeck(), deleteCreatedEngineDecks(), deleteNewEngineConversations(), discoverBrowserTemplates(), discoverChatRaceTarget(), discoverCustomTheme(), discoverDeckAssets() (+14 more)

### Community 72 - "EventBlocks.tsx"
Cohesion: 0.12
Nodes (14): BlockProps, EVENT_KIND_META, EVENT_LEGEND_ITEMS, eventAccessibleName(), EventBlock(), EventBlockFor(), EventChip(), eventKind (+6 more)

### Community 73 - "SupabaseRest"
Cohesion: 0.17
Nodes (10): client(), FakeResponse, parametrize, test_client_errors_are_non_retryable(), test_patch_defaults_to_minimal_and_returns_no_rows(), test_patch_representation_returns_rows_and_sends_prefer(), test_server_errors_are_retryable(), test_timeout_and_rate_limit_are_retryable() (+2 more)

### Community 74 - "EditorRail.tsx"
Cohesion: 0.07
Nodes (30): RejectCandidateModal(), EditorRailProps, STRUCTURAL_EDITING_REASON, InfographicPalette(), InfographicPaletteProps, LayoutPalette(), LayoutPaletteProps, LayoutPaletteGroup (+22 more)

### Community 75 - "TableElement.tsx"
Cohesion: 0.15
Nodes (27): NormalizedRun, normalizeTextRun(), TextRuns(), useDeckFontFamily(), fontTextStyle(), horizontalAlign(), shadowCss(), textAlign() (+19 more)

### Community 76 - "scripts"
Cohesion: 0.09
Nodes (21): name, private, scripts, build, db:lint, db:reset, db:types, dev (+13 more)

### Community 77 - "RISKS"
Cohesion: 0.09
Nodes (22): R10 — Email deliverability, R11 — Prompt injection, R12 — Accessibility deferred too long, R13 — Malicious/copyrighted uploads, R14 — Academic integrity backlash, R15 — Timezone/DST bugs, R16 — Design drift, R17 — Schema drift (+14 more)

### Community 78 - "actions.ts"
Cohesion: 0.16
Nodes (18): AUTH_CONFIRM_PATH, RESET_PASSWORD_PATH, AuthNoticeCode, CREDENTIALS_REQUIRED, EMAIL_ALREADY_REGISTERED, EMAIL_REQUIRED, GENERIC_ERROR, INVALID_CREDENTIALS (+10 more)

### Community 79 - "assistant.ts"
Cohesion: 0.22
Nodes (19): resolveChatProvider(), withTimeoutAndRetries(), appendAssistantMessage(), ASSISTANT_MONTHLY_TOKEN_BUDGET, ASSISTANT_RATE_LIMIT_PER_MINUTE, AssistantTurnInput, buildProviderMessages(), checkAssistantLimits() (+11 more)

### Community 80 - "command"
Cohesion: 0.10
Nodes (19): instructions, mcp, playwright, command, enabled, type, $schema, AGENTS.md (+11 more)

### Community 81 - "Presenton UI fork — re-theme and surface — design"
Cohesion: 0.11
Nodes (18): 10. Phases and evidence, 11. Risks, 12. Open questions, 13. Out of scope / recorded gaps, 1. Summary, 2. Goal / non-goals, 3. Decisions, 4. Fork setup and engine wiring (+10 more)

### Community 82 - "workerLock.ts"
Cohesion: 0.19
Nodes (10): expectHonestPage(), expectMarkAspect(), GOOGLE_CONFIGURED, integrationCard(), PRESENTON_CONFIGURED, messageIds, runIds, acquireWorkerLock() (+2 more)

### Community 83 - "assistant-backend.spec.ts"
Cohesion: 0.17
Nodes (13): ASSISTANT_SYSTEM_PROMPT, AssistantContextChunk, buildChatMessages(), quoteChunk(), sanitizeQuotedText(), WORKSPACE_DATA_CLOSE, WORKSPACE_DATA_OPEN, ChatMessage (+5 more)

### Community 84 - "AssistantWorkspace.tsx"
Cohesion: 0.10
Nodes (32): AssistantWorkspaceProps, ConversationBodyProps, AssistantActionCard(), AssistantActionCardProps, AssistantAvatar(), AssistantComposer(), AssistantPanelChatProps, AssistantBubble() (+24 more)

### Community 85 - "assistant-actions.spec.ts"
Cohesion: 0.12
Nodes (11): STRUCTURED_ACTION_INSTRUCTION, registerAssistantProposals(), createdActionIds, createdConversationIds, createdDocumentIds, createdEventIds, createdJobIds, createdPresentationIds (+3 more)

### Community 86 - "calendar/page.tsx"
Cohesion: 0.33
Nodes (13): addDays(), dayNumber(), formatIsoDate(), monthGrid(), parseIso(), periodLabel(), startOfWeek(), toIso() (+5 more)

### Community 87 - "whatsapp-jobs.spec.ts"
Cohesion: 0.12
Nodes (10): bucketPaths, connectionIds, eventIds, jobIds, REPO_ROOT, runIds, SAMPLE, hasWhatsAppService() (+2 more)

### Community 88 - "0. GLOBAL RULES"
Cohesion: 0.11
Nodes (18): 0.10 — No throwaway persistence, 0.11 — Feature registry, 0.12 — Tool registry single source of truth, 0.13 — Blocked-task protocol, 0.14 — Secrets, 0.15 — Database changes, 0.16 — Real data architecture, 0.17 — Guest Dashboard policy (+10 more)

### Community 89 - "main"
Cohesion: 0.21
Nodes (14): _boom(), test_invalid_json_is_non_retryable(), test_main_defaults_to_sys_argv(), test_unexpected_failure_logs_traceback_and_sanitizes_stdout(), test_unknown_action_from_argv_wins_over_payload(), test_unknown_action_is_non_retryable(), _env(), _float() (+6 more)

### Community 90 - "DocumentsHub.tsx"
Cohesion: 0.14
Nodes (10): DocumentCard(), DocumentsHub(), FILTERS, PreviewState, StatusFilter, useDocuments(), DocumentUploadButton(), dissolveVariants() (+2 more)

### Community 91 - "specimen/page.tsx"
Cohesion: 0.15
Nodes (10): metadata, BentoGrid(), BentoGridProps, BentoItem(), BentoItemProps, LoadingState(), LoadingStateProps, Metric() (+2 more)

### Community 92 - "TransformHandles.tsx"
Cohesion: 0.16
Nodes (13): SelectionLayer(), SelectionLayerProps, SelectionOverlayFrame, CORNER_HANDLES, cursorForHandle(), EDGE_HANDLES, HANDLE_CENTERS, HANDLE_LABELS (+5 more)

### Community 93 - "Navbar.tsx"
Cohesion: 0.13
Nodes (16): metadata, Footer(), FooterProps, linkGroups, Navbar(), NavbarProps, navLinks, MotionMenu() (+8 more)

### Community 94 - "seed-qa-identity.mjs"
Cohesion: 0.23
Nodes (14): adminApi(), createUser(), describe(), ensureConfirmed(), ensureQa1Onboarded(), IDENTITIES, listUsers(), main() (+6 more)

### Community 95 - "onboarding.ts"
Cohesion: 0.17
Nodes (20): CompleteOnboardingInput, OnboardingState, parseOnboardingPayload(), ProfileRow, readLabel(), readSubjects(), readText(), ACADEMIC_YEAR_OPTIONS (+12 more)

### Community 96 - "presentonConfig.ts"
Cohesion: 0.21
Nodes (16): applyPresentationModel(), buildModelOptions(), degradedModels(), listPresentationModels(), presentonEditUrl(), probeProviderSettings(), readEngineModelSetting(), readModelField() (+8 more)

### Community 97 - "InfographicElement.tsx"
Cohesion: 0.17
Nodes (21): finiteNumber(), frameBox(), FUNNEL_DESIGN, funnelStageValue(), GAUGE_FALLBACK_SIZE, GaugeInfographic(), InfographicElement(), InfographicPlaceholder() (+13 more)

### Community 98 - "requireOnboardedUser"
Cohesion: 0.14
Nodes (28): IntegrationsContext, IntegrationsContextValue, IntegrationsWorkspace(), putObjectWithProgress(), abortExportRunAction(), confirmCandidateAction(), createExportRunAction(), disconnectWhatsAppAction() (+20 more)

### Community 99 - "ConfirmEmail.tsx"
Cohesion: 0.16
Nodes (11): ConfirmEmail(), FragmentTokens, parseFragmentTokens(), metadata, GET(), sameOriginRedirect(), AUTH_CALLBACK_PATH, AUTH_ERROR_REDIRECT (+3 more)

### Community 100 - "provider.ts"
Cohesion: 0.14
Nodes (13): ASSISTANT_API_KEY_ENV, ASSISTANT_MODEL_ENV, ASSISTANT_PROVIDER_DEPENDENCY, ASSISTANT_PROVIDER_ENV, ASSISTANT_UNCONFIGURED_COPY, ChatProvider, ChatRole, PROVIDER_MAX_ATTEMPTS (+5 more)

### Community 101 - "whatsapp-security.spec.ts"
Cohesion: 0.14
Nodes (13): GOOGLE_PUSH_RETRY_WINDOW_MS, BackfillSeed, cleanupBackfillRows(), createdCandidateIds, createdConnectionIds, createdCredentialUserIds, createdEventIds, createdExportPaths (+5 more)

### Community 102 - "QA Session â€” the permitted authenticated environment (Task 20.10)"
Cohesion: 0.13
Nodes (14): Daily usage, [!] Google Calendar push E2E is blocked in this environment, [!] Live mode E2E is blocked in this environment, One-time setup (already done on this machine, listed for a fresh machine), One writer at a time (2026-09-12 stabilisation), QA Session â€” the permitted authenticated environment (Task 20.10), Seeding / resetting, The QA identities (two users since Task 20.9) (+6 more)

### Community 103 - "documents-processing.spec.ts"
Cohesion: 0.14
Nodes (3): createdDocumentIds, createdJobIds, REPO_ROOT

### Community 104 - "ImageControls.tsx"
Cohesion: 0.06
Nodes (28): FIT_OPTIONS, ImageControls(), ImageControlsProps, InspectorPanel(), InspectorPanelProps, ALIGNMENT_OPTIONS, commitNumber(), RunFormatToolbar() (+20 more)

### Community 105 - "onboarding.spec.ts"
Cohesion: 0.15
Nodes (6): ANSWERS, continueStep(), fillAndSubmitOnboarding(), PERSISTED_PROFILE, RPC_ARGS, SUBJECTS

### Community 106 - "rls-isolation.spec.ts"
Cohesion: 0.18
Nodes (10): affectedRows(), DELETE_CAPABLE, expectAllowed(), insertOne(), OWNED_TABLES, OwnedTable, RESIDUE_TABLES, Result (+2 more)

### Community 107 - "UniPilot Authentication Architecture"
Cohesion: 0.15
Nodes (13): Authentication flow overview, Email delivery, Environment variables, Explicitly NOT implemented yet, Integration points for Tasks 12.2–12.12, Onboarding persistence (Task 13.10) — implemented, Relation to future profile data, Security considerations (+5 more)

### Community 108 - "3. The endpoints UniPilot calls (exact shapes)"
Cohesion: 0.14
Nodes (13): 1. Environment variables (UniPilot side — server-only, never `NEXT_PUBLIC_*`), 2. Running Presenton locally (separate service), 3.1 Start generation — `POST /api/v1/ppt/presentation/generate/async`, 3.2 Poll — `GET /api/v1/ppt/presentation/status/{taskId}`, 3.3 Download the export — `GET {path}`, 3.4 Upload a source document — `POST /api/v1/ppt/files/upload`, 3.5 Templates — `GET /api/v1/ppt/template/all`, 3.6 Editor — the native editor, with the wrapper as the Smart fallback (+5 more)

### Community 109 - "7. Architecture"
Cohesion: 0.15
Nodes (13): 7.0 Stack and plumbing (reused — nothing new is introduced), 7.10 One writer, 7.11 Honest capability matrix, 7.1 Diagram, 7.2 Server-mediated access (D2), 7.3 Reads, 7.4 Writes — mutation map, 7.5 Structural writes (the full-array PATCH) (+5 more)

### Community 110 - "layoutPaletteModel.ts"
Cohesion: 0.21
Nodes (14): asRecord(), CONSTRAINT_KEYS, CONTENT_TYPE_SET, itemSignature(), JsonRecord, leafSignature(), needsTopLevelGroupExpansion(), objectSignature() (+6 more)

### Community 111 - "assets.ts"
Cohesion: 0.22
Nodes (11): TemplateThumb(), ASSET_CONTENT_TYPES, ASSET_PREFIXES, assetContentType(), AssetPathVerdict, classifyAssetPath(), deckTemplateIds(), templateAssetUrl() (+3 more)

### Community 112 - "WhatsApp integration service"
Cohesion: 0.15
Nodes (12): Detection settings, Environment, Export vs live, [!] Google Calendar push is unverified in this repository's environment, Install, Job protocol, [!] Live mode is blocked in this repository's environment, Privacy and retention (+4 more)

### Community 113 - "6. Slide representation and native rendering"
Cohesion: 0.17
Nodes (12): 6.10 Smart HTML decks, 6.11 What “no Presenton CSS” means concretely, 6.1 Template V2 model (exact shapes), 6.2 Element types in real decks (measured), 6.3 Stage and coordinate model, 6.4 Text, runs, lists, tables, 6.5 Images, icons, vectors, 6.6 Charts (+4 more)

### Community 114 - "fonts.spec.ts"
Cohesion: 0.19
Nodes (9): APP, AUTHORIZED, expectAuthorizedOnly(), expectNoMissingGlyphFallback(), expectRoles(), MARKETING, normalize(), PlatformFont (+1 more)

### Community 115 - "Auth email delivery"
Cohesion: 0.18
Nodes (11): Auth email delivery, Blocking prerequisites, Domain and DNS requirements, Known gaps, Production: hosted Supabase Auth → custom SMTP, Rate limits, Redirect URL allowlist, Secrets (+3 more)

### Community 116 - "Phase D — Full editor parity"
Cohesion: 0.18
Nodes (11): Phase D — Full editor parity, Task D10: Capability checklist + phase D gate, Task D1: Selection, drag/resize/rotate, z-order, group/ungroup, Task D2: Rich text runs, Task D3: Images, Task D4: Icons, Task D5: Charts/tables data editors, Task D6: Blocks (template layout insertion) (+3 more)

### Community 117 - "Native presentation experience — design"
Cohesion: 0.18
Nodes (10): 11. Risks, 12. Decisions, 13. Open questions (for review), 14. Recorded gaps / out of scope, 15. Next step, 1. Summary, 2. Goal / non-goals, 3. Binding rules (+2 more)

### Community 118 - "SubjectsStep"
Cohesion: 0.67
Nodes (3): SubjectsStep(), add(), onKeyDown()

### Community 119 - "documents-hub.spec.ts"
Cohesion: 0.18
Nodes (3): createdDocumentIds, createdJobIds, REPO_ROOT

### Community 120 - "EXECUTION ORDER"
Cohesion: 0.18
Nodes (11): CURRENT STATE, EXECUTION ORDER, STAGE 1 — INTEGRITY / ARCHITECTURE RECONCILIATION, STAGE 2 — DATABASE FOUNDATION, STAGE 3 — REAL CORE DATA, STAGE 4 — AI, STAGE 5 — DASHBOARD INTELLIGENCE, STAGE 6 — TIER 1 TOOLS (+3 more)

### Community 121 - "Protected-route strategy"
Cohesion: 0.20
Nodes (10): 14.11 verification (monorepo + MCP Chromium), Behaviour, Cookie preservation, Defence in depth, Guest-viewable workspace (0.17, extended to the app routes), Narrow matcher scope, Protected-route strategy, Redirect-destination safety (+2 more)

### Community 122 - "Presentation generate/setup redesign — implementation plan (T1–T4)"
Cohesion: 0.20
Nodes (9): Final acceptance checklist, Global constraints (every task), Presentation generate/setup redesign — implementation plan (T1–T4), Review + commit protocol, T0 — Investigation + spec (**done; stop for review**), T1 — Adapter: model listing + service-managed selection, T2 — Layout: reference-shape generate page, T3 — Model dropdown wiring (honest states) (+1 more)

### Community 123 - "chatActions.ts"
Cohesion: 0.30
Nodes (11): ChatConversationsActionResult, ChatDeckActionResult, chatFailureCopy(), ChatMessagesActionResult, getChatMessagesAction(), getPresentationDeckAction(), isRecord(), listChatConversationsAction() (+3 more)

### Community 124 - "documents-search.spec.ts"
Cohesion: 0.24
Nodes (5): buildPdf(), REPO_ROOT, SearchRow, seedIndexedDocument(), worker()

### Community 125 - "Native presentation experience — implementation plan (Phases A–F)"
Cohesion: 0.22
Nodes (8): Execution notes, Global constraints (every task), Native presentation experience — implementation plan (Phases A–F), Phase E — Templates browser, Self-review record (spec coverage), Task E1: Adapter pagination + template reads, Task E2: Browser + preview routes, Task E3: Phase E gate

### Community 126 - "Phase B — Deck viewer"
Cohesion: 0.22
Nodes (9): Phase B — Deck viewer, Task B0: Decision gate — chart engine (spec Q1) — APPROVED 2026-09-16, Task B1: Wire types + adapter reads + pure helpers, Task B2: Owner-gated asset proxy, Task B3: Renderer — stage + elements, Task B4: Viewer route + rail + present mode, Task B5: Charts + infographics, Task B6: Smart-deck fallback (+1 more)

### Community 127 - "assistant-ui.spec.ts"
Cohesion: 0.10
Nodes (11): HeldAssistantNavigation, SOURCE_A, SOURCE_B, ASSISTANT_TURN_ROUTE, AssistantTurnRequest, AssistantTurnStub, AssistantTurnStubOptions, parseTurnRequest() (+3 more)

### Community 128 - "Phase A — Generate/setup + result"
Cohesion: 0.25
Nodes (8): Phase A — Generate/setup + result, Task A1: `presentations` request fields migration, Task A2: Parser + vocabulary (`presentationValues.ts`), Task A3: Adapter request builder, Task A4: Server Action + data layer (multi-source, new fields), Task A5: Worker pass-through + stub-engine test, Task A6: Generate form — advanced settings + multi-source, Task A7: Phase A verification gate

### Community 129 - "5. Presenton UI inventory — screen/feature matrix"
Cohesion: 0.25
Nodes (8): 5.1 Matrix, 5.2 Generation/setup detail (Phase A scope), 5.3 Outline (recorded, deferred), 5.4 Editor operations inventory (Phases B–D scope), 5.5 Templates detail, 5.6 History / settings / admin detail, 5.7 Smart mode, 5. Presenton UI inventory — screen/feature matrix

### Community 130 - "AssistantComposer.tsx"
Cohesion: 0.15
Nodes (6): ConversationPanelHeader(), ACTION_CHIPS, AssistantComposerProps, Textarea(), TextareaProps, MESSAGE_CONTENT_MAX_LENGTH

### Community 131 - "database.types.ts"
Cohesion: 0.18
Nodes (10): CompositeTypes, Constants, Database, DatabaseWithoutInternals, DefaultSchema, Enums, Json, Tables (+2 more)

### Community 132 - "jobs-runner.spec.ts"
Cohesion: 0.25
Nodes (3): createdIds, everCreatedIds, REPO_ROOT

### Community 133 - "Browser QA"
Cohesion: 0.25
Nodes (7): Auth Safety, Available Tools (Playwright MCP 0.0.79, chromium --isolated --caps vision), Browser QA, Fallback, Requirement, Screenshots, Workflow

### Community 134 - "UniPilot"
Cohesion: 0.25
Nodes (7): Database / WSL, Deployment (Vercel), Environment, Layout, One-command local environment, Root scripts, UniPilot

### Community 135 - "1. MOTION SYSTEM"
Cohesion: 0.25
Nodes (8): 1.1 — Motion.dev is the primary animation library, 1.2 — Existing Motion architecture, 1.3 — Animation quality, 1.4 — Animation must never control content existence, 1.5 — Page entry vs viewport reveal, 1.6 — Reduced motion, 1.7 — Chromium animation verification, 1. MOTION SYSTEM

### Community 136 - "PART IX — TIER 2 TOOLS"
Cohesion: 0.25
Nodes (8): 31. Presentation Generator, 32. Document Editor / Maker, 33. PDF Operations, 34. Spreadsheet Editor / Maker, 35. File Converters, 36. Background Remover, 42. Mind Maps, PART IX — TIER 2 TOOLS

### Community 137 - "Email templates"
Cohesion: 0.29
Nodes (7): Email templates, Installing the two Supabase templates, Layout, Rules for editing these files, Subjects, Template variables, The welcome template

### Community 138 - "Phase C — Core editor"
Cohesion: 0.29
Nodes (7): Phase C — Core editor, Task C1: Export mirror migration + `presentation.export` job, Task C2: Hydration module (`hydrateSlide.ts`), Task C3: Adapter mutations + pure bodies, Task C4: Editor surface, Task C5: Deck E2E spec, Task C6: Phase C verification gate

### Community 139 - "Phase F — History / settings"
Cohesion: 0.29
Nodes (7): Phase F — History / settings, Task F1: Tool-page decks list, Task F2: `/documents` provenance + Open deck, Task F3: `/integrations` Presenton card, Task F4: Delete deck, Task F5: Fork retirement checklist + docs, Task F6: Phase F gate

### Community 140 - "10. Phases A–F"
Cohesion: 0.29
Nodes (7): 10. Phases A–F, A. Generate/setup + result, B. Deck viewer, C. Core editor, D. Full editor parity, E. Templates browser, F. History/settings

### Community 141 - "8. UniPilot-native mapping (DESIGN.md + MOTION.md)"
Cohesion: 0.29
Nodes (7): 8.1 Routes and shell, 8.2 Component mapping, 8.3 Motion mapping, 8.4 Prohibitions honoured, 8.5 Accessibility, 8.6 Branding (chrome is UniPilot's; deck content is the deck's), 8. UniPilot-native mapping (DESIGN.md + MOTION.md)

### Community 142 - "EventFormModal.tsx"
Cohesion: 0.18
Nodes (10): AddEventButton(), eventFormValues, useCalendar(), EventDeleteBody(), EventFormFields(), EventFormModal(), EventFormModalProps, EVENT_LOCATION_MAX_LENGTH (+2 more)

### Community 143 - "app/layout.tsx"
Cohesion: 0.33
Nodes (4): geistMono, geistSans, metadata, MotionProvider()

### Community 145 - "FUTURE DEVELOPMENT RULES"
Cohesion: 0.29
Nodes (7): Data rule, FUTURE DEVELOPMENT RULES, Guest rule, Motion rule, Testing rule, Tool rule, UI rule

### Community 146 - "searchBenchmark.mjs"
Cohesion: 0.47
Nodes (5): DEFAULT_DIR, HERE, main(), parseArgs(), readEnvironment()

### Community 147 - "20.6 schema must define"
Cohesion: 0.33
Nodes (6): 20.6 schema must define, 20. Supabase / Database Foundation, Core product data, `profiles`, Status, `subjects`

### Community 148 - "Development: local Supabase, no real email"
Cohesion: 0.40
Nodes (5): Development: local Supabase, no real email, Environment separation, Local testing checklist, Pointing at a separately-run Mailpit instead, Prerequisites and start-up

### Community 149 - "Grid.tsx"
Cohesion: 0.40
Nodes (3): columnClasses, GridColumns, GridProps

### Community 150 - "Tooltip.tsx"
Cohesion: 0.40
Nodes (3): sideClasses, TooltipProps, TooltipSide

### Community 151 - "design-313-capture.mjs"
Cohesion: 0.40
Nodes (4): outDir, STORAGE, surfaces, widths

### Community 153 - "15. Dashboard `/dashboard`"
Cohesion: 0.40
Nodes (5): 15.10, 15.11, 15.12, 15.9, 15. Dashboard `/dashboard`

### Community 154 - "PART VIII — TIER 1 TOOLS"
Cohesion: 0.40
Nodes (5): 38. QR Generator, 39. Flashcards, 40. Quiz / MCQ, 43. Data Tables, PART VIII — TIER 1 TOOLS

### Community 155 - "AGENTS.md"
Cohesion: 0.50
Nodes (3): Monorepo layout, Motion, QA authenticated session (Task 20.10)

### Community 156 - "Implemented so far (Tasks 12.2–12.10, extended through 13.10/14.10/14.11)"
Cohesion: 0.50
Nodes (4): Email verification notes (verified live), Google OAuth configuration (verified live), Implemented so far (Tasks 12.2–12.10, extended through 13.10/14.10/14.11), Local Google OAuth — configured and provider-verified (2026-09-13)

### Community 160 - "4. Current state"
Cohesion: 0.67
Nodes (3): 4.1 Post-fork runtime behaviour (verified 2026-09-15/16), 4.2 Exact data shapes (re-verified 2026-09-16), 4. Current state

### Community 163 - "PART X — TIER 3 / RESEARCH"
Cohesion: 0.67
Nodes (3): 37. Photo / Video Editor, 41. Handwritten Notes Generator, PART X — TIER 3 / RESEARCH

### Community 164 - "46. Calendar Integrations"
Cohesion: 0.67
Nodes (3): 46. Calendar Integrations, 47. Academic Integrations, 48. Notifications

### Community 198 - "OnboardingFlow"
Cohesion: 0.33
Nodes (8): hasErrors(), OnboardingFlow(), advance(), commit(), finish(), leave(), skip(), submit()

### Community 199 - "useDeckAutosave.ts"
Cohesion: 0.22
Nodes (10): DeckAutosave, PendingEntry, rebasePendingAfterAck(), SaveOutcome, SaveStatus, SaveTarget, StructuralAckBinding, targetKey() (+2 more)

### Community 200 - "isSupabaseConfigured"
Cohesion: 0.33
Nodes (10): LogoutButton(), isValidEmail(), normalizeEmail(), requestPasswordReset(), signInWithEmail(), signInWithGoogle(), signOut(), signUpWithEmail() (+2 more)

### Community 201 - "presets.ts"
Cohesion: 0.08
Nodes (33): OnboardingProgress(), OnboardingProgressProps, pad(), OnboardingShell(), OnboardingShellProps, SkipOnboarding(), AssistantLauncher(), LauncherMetrics (+25 more)

### Community 202 - "ProfileMenu.tsx"
Cohesion: 0.46
Nodes (3): chipLines(), ProfileMenu(), SessionViewer

### Community 203 - "edit/page.tsx"
Cohesion: 0.36
Nodes (5): EditDeckFrame(), EditPresentationPage(), hasPendingPresentationExport(), isStructuralEditingEnabled(), isSmartDeck()

### Community 204 - "gate.ts"
Cohesion: 0.11
Nodes (27): POST(), jsonError(), POST(), engineFailure(), extensionOf(), isUploadedFile(), jsonError(), POST() (+19 more)

### Community 205 - "integrationActions.ts"
Cohesion: 0.13
Nodes (24): GOOGLE_ONE_WAY_NOTE, GoogleCalendarPanel(), GoogleCalendarPanelProps, STATUS_COPY, WHATSAPP_AUTH_REASON, configuredSiteOrigin(), getTrustedSiteOrigin(), hostnameOf() (+16 more)

### Community 206 - "context.ts"
Cohesion: 0.25
Nodes (8): CHARS_PER_TOKEN_APPROX, CONTEXT_MAX_CHARS, CONTEXT_MAX_CHUNKS, CONTEXT_TOKEN_BUDGET, contextUsage(), selectContextChunks(), truncateAtWord(), retrieveContext()

### Community 207 - "SemesterStep.tsx"
Cohesion: 0.33
Nodes (5): OnboardingField, SelectField(), SemesterStep(), ACADEMIC_YEAR_LABELS, SEMESTER_LABELS

### Community 208 - "documents-ui.spec.ts"
Cohesion: 0.33
Nodes (3): cleanup(), seededPresentationIds, sweepStorage()

### Community 209 - "PreferencesStep.tsx"
Cohesion: 0.40
Nodes (4): ChoiceField(), PreferencesStep(), PLANNING_STYLE_LABELS, REMINDER_LEAD_LABELS

### Community 210 - "useSignInPrompt"
Cohesion: 0.50
Nodes (4): ExportDropzone(), onDrop(), receive(), useSignInPrompt()

### Community 211 - "forgot-password/page.tsx"
Cohesion: 0.40
Nodes (3): ForgotPasswordForm(), resetRequestAction(), metadata

### Community 212 - "PresentationTemplatePreviewPage"
Cohesion: 0.67
Nodes (3): PresentationTemplatePreviewPage(), resolveTemplateTheme(), isSafeSegment()

## Knowledge Gaps
- **1452 isolated node(s):** `name`, `private`, `db:reset`, `db:lint`, `db:types` (+1447 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Card()` connect `motionIndex` to `FeatureGrid.tsx`, `DeckEditor.tsx`, `hydrateSlide.ts`, `Card.tsx`, `integrationValues.ts`, `presentationValues.ts`, `PresentationWorkspace.tsx`, `toolCatalog.ts`, `features/page.tsx`, `IconButton.tsx`, `ProPlanCard.tsx`, `WhatsAppCard.tsx`, `Button.tsx`, `EditorRail.tsx`, `edit/page.tsx`, `ProfileMenu.tsx`, `forgot-password/page.tsx`, `AssistantWorkspace.tsx`, `specimen/page.tsx`, `ConfirmEmail.tsx`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `Button()` connect `Button.tsx` to `motionIndex`, `AssistantComposer.tsx`, `DeckEditor.tsx`, `EventFormModal.tsx`, `integrationValues.ts`, `ChartControls.tsx`, `presentationValues.ts`, `PresentationWorkspace.tsx`, `features/page.tsx`, `IconButton.tsx`, `ChatPanel.tsx`, `TaskBoard.tsx`, `ProPlanCard.tsx`, `tableOps.ts`, `EventBlocks.tsx`, `presets.ts`, `EditorRail.tsx`, `integrationActions.ts`, `AssistantWorkspace.tsx`, `DocumentsHub.tsx`, `specimen/page.tsx`, `ImageControls.tsx`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `createClient()` connect `createClient` to `GlobalSearch.tsx`, `OnboardingFlow.tsx`, `database.types.ts`, `integrationValues.ts`, `presentations.ts`, `CalendarWorkspace.tsx`, `presentationActions.ts`, `integrations.ts`, `integrations/page.tsx`, `eventValues.ts`, `assistantActionLog.ts`, `documents.ts`, `isSupabaseConfigured`, `edit/page.tsx`, `gate.ts`, `actions.ts`, `assistant.ts`, `AssistantWorkspace.tsx`, `calendar/page.tsx`, `onboarding.ts`, `requireOnboardedUser`, `ConfirmEmail.tsx`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **What connects `name`, `private`, `db:reset` to the rest of the system?**
  _1452 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `motionIndex` be split into smaller, more focused modules?**
  _Cohesion score 0.06413730803974707 - nodes in this community are weakly interconnected._
- **Should `FeatureGrid.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.06201550387596899 - nodes in this community are weakly interconnected._
- **Should `presentationJobs.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05994710549515134 - nodes in this community are weakly interconnected._