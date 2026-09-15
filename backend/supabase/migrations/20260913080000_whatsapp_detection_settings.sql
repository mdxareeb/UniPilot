-- =============================================================================
-- Task 46.26 — WhatsApp detection settings: date order + relative dates
-- =============================================================================
--
-- Per-user (connection-level) detection preferences:
--   date_order: how to read ambiguous numeric mentions in message TEXT
--     ("9/10" -> DMY = 9 Oct, MDY = Sep 10). The export ENVELOPE is parsed
--     with its own inferred order (majority signal), never with this setting.
--   detect_relative_dates: opt-in, conservative detection of weekday/relative
--     mentions ("friday", "tomorrow", "next week") ONLY when the message also
--     contains a clock time or an academic keyword (submission/submit/exam/
--     deadline/presentation/class/test/quiz/assignment/viva/due). All-day when
--     no time. Off by default; time-only messages stay rejected either way.

alter table public.integration_connections
  add column date_order text not null default 'DMY'
    constraint integration_connections_date_order_check
    check (date_order in ('DMY', 'MDY'));

comment on column public.integration_connections.date_order is
  'User preference for ambiguous numeric dates in message TEXT (DMY default, IST-appropriate). The export envelope uses its own inferred order.';

alter table public.integration_connections
  add column detect_relative_dates boolean not null default false;

comment on column public.integration_connections.detect_relative_dates is
  'Opt-in conservative detection of weekday/relative mentions paired with a clock time or an academic keyword; all-day without a time.';
