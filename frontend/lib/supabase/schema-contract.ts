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
