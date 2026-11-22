/**
 * Compile-time contract for the generated database types (Task 20.8).
 *
 * `lib/supabase/database.types.ts` is generated from the LOCAL schema
 * (`backend/supabase/ops/generate-types.sh`) and must never be hand-edited. This file
 * is the guard that notices when a ratified table or column silently
 * disappears: each `Assert<...>` fails `tsc` when its expression is not `true`,
 * because `false` does not extend `true`.
 *
 * Types only — no runtime code and no queries. Stage 3 owns data access; 20.9
 * owns the two-user RLS test.
 */
import type { Database } from "./database.types";

type PublicTables = Database["public"]["Tables"];

type Assert<T extends true> = T;

/** `true` when `Key` exists on `Obj`. */
type HasKey<Obj, Key extends string> = Key extends keyof Obj ? true : false;

/** Every table ratified by DATABASE.md. */
type RequiredTable =
  | "profiles"
  | "subjects"
  | "documents"
  | "document_chunks"
  | "tasks"
  | "events"
  | "conversations"
  | "messages"
  | "tool_runs"
  | "notifications"
  | "subscriptions"
  | "usage_events";

/** Fails to compile if a ratified table is missing from the generated types. */
export type AllRequiredTablesPresent = Assert<
  Exclude<RequiredTable, keyof PublicTables> extends never ? true : false
>;

/** Row shape of a ratified table (a missing table already fails above). */
type Row<T extends RequiredTable> = PublicTables[T]["Row"];

/* Columns the schema contract and the named query patterns depend on. */
export type ProfilesHasTimezone = Assert<HasKey<Row<"profiles">, "timezone">>;
export type ProfilesHasFirstName = Assert<
  HasKey<Row<"profiles">, "first_name">
>;
export type ProfilesHasLastName = Assert<HasKey<Row<"profiles">, "last_name">>;
export type ProfilesHasInstitution = Assert<
  HasKey<Row<"profiles">, "institution">
>;
export type ProfilesHasProgram = Assert<
  HasKey<Row<"profiles">, "course_program">
>;
export type ProfilesHasYear = Assert<
  HasKey<Row<"profiles">, "academic_year">
>;
export type ProfilesHasSemester = Assert<HasKey<Row<"profiles">, "semester">>;
export type ProfilesHasPlanningStyle = Assert<
  HasKey<Row<"profiles">, "planning_style">
>;
export type ProfilesHasReminderLead = Assert<
  HasKey<Row<"profiles">, "reminder_lead">
>;
export type ProfilesHasCompletion = Assert<
  HasKey<Row<"profiles">, "onboarding_completed_at">
>;

export type SubjectsHaveName = Assert<HasKey<Row<"subjects">, "name">>;
export type DocumentsHaveStatus = Assert<HasKey<Row<"documents">, "status">>;
export type DocumentChunksHaveDocument = Assert<
  HasKey<Row<"document_chunks">, "document_id">
>;
export type TasksHaveDueDate = Assert<HasKey<Row<"tasks">, "due_date">>;
export type EventsHaveStart = Assert<HasKey<Row<"events">, "start_at">>;
export type MessagesHaveConversation = Assert<
  HasKey<Row<"messages">, "conversation_id">
>;
export type ToolRunsHaveToolId = Assert<HasKey<Row<"tool_runs">, "tool_id">>;
export type ToolRunsHaveStatus = Assert<HasKey<Row<"tool_runs">, "status">>;
export type NotificationsHaveReadAt = Assert<
  HasKey<Row<"notifications">, "read_at">
>;
export type SubscriptionsHavePlan = Assert<HasKey<Row<"subscriptions">, "plan">>;
export type SubscriptionsHaveStatus = Assert<
  HasKey<Row<"subscriptions">, "status">
>;
export type SubscriptionsHaveProvider = Assert<
  HasKey<Row<"subscriptions">, "provider">
>;
export type UsageEventsHaveKind = Assert<HasKey<Row<"usage_events">, "kind">>;
export type UsageEventsHaveQuantity = Assert<
  HasKey<Row<"usage_events">, "quantity">
>;
export type UsageEventsHaveOccurredAt = Assert<
  HasKey<Row<"usage_events">, "occurred_at">
>;

/* WhatsApp group live sync (Stage 1): the tables and columns the bridge, the
 * extraction worker and the UI depend on. Same rule as above: a regeneration
 * that drops one fails `tsc`. */
type GroupSyncTable =
  | "whatsapp_sessions"
  | "whatsapp_session_secrets"
  | "whatsapp_auth_keys"
  | "monitored_groups"
  | "raw_messages";

export type GroupSyncTablesPresent = Assert<
  Exclude<GroupSyncTable, keyof PublicTables> extends never ? true : false
>;

type GroupRow<T extends GroupSyncTable> = PublicTables[T]["Row"];

export type SessionsHaveDesiredState = Assert<
  HasKey<GroupRow<"whatsapp_sessions">, "desired_state">
>;
export type SessionsHaveHeartbeat = Assert<
  HasKey<GroupRow<"whatsapp_sessions">, "bridge_heartbeat_at">
>;
export type SessionsHaveLinkMethod = Assert<
  HasKey<GroupRow<"whatsapp_sessions">, "link_method">
>;
export type GroupsHaveIsActive = Assert<
  HasKey<GroupRow<"monitored_groups">, "is_active">
>;
export type RawMessagesHaveFingerprint = Assert<
  HasKey<GroupRow<"raw_messages">, "fingerprint">
>;
export type RawMessagesHaveStatus = Assert<
  HasKey<GroupRow<"raw_messages">, "status">
>;

export type SubjectsHaveCourseCode = Assert<
  HasKey<Row<"subjects">, "course_code">
>;
export type SubjectsHaveAliases = Assert<HasKey<Row<"subjects">, "aliases">>;
export type TasksHaveSourceMessage = Assert<
  HasKey<Row<"tasks">, "source_message_id">
>;
export type TasksHaveSubject = Assert<HasKey<Row<"tasks">, "subject_id">>;
export type EventsHaveSourceMessage = Assert<
  HasKey<Row<"events">, "source_message_id">
>;
export type DocumentsHaveSourceMessage = Assert<
  HasKey<Row<"documents">, "source_message_id">
>;
export type DocumentsHaveFileSha = Assert<
  HasKey<Row<"documents">, "file_sha256">
>;
export type DocumentsHaveSummary = Assert<
  HasKey<Row<"documents">, "ai_summary">
>;

type CandidateRow = PublicTables["integration_candidates"]["Row"];
export type CandidatesHaveOrigin = Assert<HasKey<CandidateRow, "origin">>;
export type CandidatesHaveKind = Assert<HasKey<CandidateRow, "kind">>;
export type CandidatesHaveConfidence = Assert<
  HasKey<CandidateRow, "confidence">
>;
export type CandidatesHaveProposedSubject = Assert<
  HasKey<CandidateRow, "proposed_subject_name">
>;

/* Google Calendar integration: the tables and columns the OAuth flow, the
 * gcal.sync worker and the mobile screen depend on. */
type GcalTable = "google_oauth_states" | "google_calendars";

export type GcalTablesPresent = Assert<
  Exclude<GcalTable, keyof PublicTables> extends never ? true : false
>;

type GcalRow<T extends GcalTable> = PublicTables[T]["Row"];

export type OauthStatesHaveExpires = Assert<
  HasKey<GcalRow<"google_oauth_states">, "expires_at">
>;
export type OauthStatesHaveConsumed = Assert<
  HasKey<GcalRow<"google_oauth_states">, "consumed_at">
>;
export type OauthStatesHaveReturnScheme = Assert<
  HasKey<GcalRow<"google_oauth_states">, "return_scheme">
>;
export type GcalendarsHaveIsActive = Assert<
  HasKey<GcalRow<"google_calendars">, "is_active">
>;
export type GcalendarsHaveSyncCursor = Assert<
  HasKey<GcalRow<"google_calendars">, "sync_cursor">
>;

type ConnectionRow = PublicTables["integration_connections"]["Row"];
export type ConnectionsHaveLastSynced = Assert<
  HasKey<ConnectionRow, "last_synced_at">
>;
export type ConnectionsHaveAutoExport = Assert<
  HasKey<ConnectionRow, "auto_export_to_gcal">
>;
export type ConnectionsHaveExportCalendar = Assert<
  HasKey<ConnectionRow, "export_calendar_id">
>;

export type TasksHaveGoogleEvent = Assert<
  HasKey<Row<"tasks">, "google_event_id">
>;
export type EventsHaveGoogleEvent = Assert<
  HasKey<Row<"events">, "google_event_id">
>;

