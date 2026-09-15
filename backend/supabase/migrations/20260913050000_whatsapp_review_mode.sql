-- =============================================================================
-- Task 46.21 — WhatsApp review mode: Manual (review each event) or Automatic
-- =============================================================================
--
-- Mirrors the original tool's ASK_BEFORE_PUSH. The connection row carries the
-- user's default choice; each run records the mode it used. Manual keeps the
-- existing pending-candidate flow; automatic auto-confirms the run's detected
-- events into `events` (source_ref fingerprint dedupe) and enqueues the Google
-- push when a Google connection is active. No RLS/grant changes: the columns
-- live on tables whose owner-SELECT / server-write policies already apply.

alter table public.integration_connections
  add column review_mode text not null default 'manual'
    constraint integration_connections_review_mode_check
    check (review_mode in ('manual', 'automatic'));

comment on column public.integration_connections.review_mode is
  'Default review behaviour for this user''s WhatsApp imports: manual = candidates await review; automatic = detected events are added on sync completion. Meaningful for provider=whatsapp.';

alter table public.integration_runs
  add column review_mode text not null default 'manual'
    constraint integration_runs_review_mode_check
    check (review_mode in ('manual', 'automatic'));

comment on column public.integration_runs.review_mode is
  'The review behaviour this run used (recorded per run; defaults to the connection''s choice at upload time).';
