-- =============================================================================
-- Task 29.1 — the durable background job store and its worker protocol
-- =============================================================================
--
-- The generic runner 24.x's document pipeline registers into. One table, one
-- claim function, one finish function; everything the future phases need to
-- enqueue work, survive a crash and report a terminal state.
--
-- Design decisions (recorded here per 0.15):
--
-- * Durability, not queues in memory: a job is a row. `status` is the closed
--   vocabulary `queued | running | succeeded | failed | dead_letter`.
--   `failed` is a *handler-declared permanent* failure (non-retryable);
--   `dead_letter` is a job that exhausted its attempts. `attempts` increments
--   at claim time, so a worker that dies mid-run still counts the attempt.
-- * Atomic claim: `claim_jobs` uses `SELECT ... FOR UPDATE SKIP LOCKED`, so
--   two workers can never hold the same row — no advisory locks, no polling
--   races. It also reclaims stale `running` rows whose lock lease expired (a
--   stuck-worker safeguard) before handing out new work.
-- * Retry with backoff: a retryable failure returns the job to `queued` with
--   `run_after = now() + least(2^(attempts-1) * 30s, 1h)` (30s, 1m, 2m, 4m …
--   capped at one hour) until `max_attempts`, then `dead_letter` with the
--   last error. `last_error` is truncated, never a raw dump.
-- * Server-only state: RLS grants the owner `SELECT` on their own jobs and
--   nothing else. No client role may INSERT/UPDATE/DELETE — enqueue and every
--   state change run as the service role (the frontend's `jobs.ts` helper and
--   the worker), which is why the functions are revoked from
--   `public`/`anon`/`authenticated`. `anon` gets no policy and no grant.
-- * Ownership: `user_id` is nullable for system jobs (a future nightly sweep)
--   and cascades with the user otherwise. The worker's `ctx` receives it, but
--   the payload carries no secrets by contract (documented in the worker).
--
-- Indexes (two partial indexes matching exactly the worker's predicates, so
-- the claim and reclaim scans stay small as history grows):
--   - jobs_claim_idx   on (run_after)   where status = 'queued'
--   - jobs_reclaim_idx on (locked_at)   where status = 'running'
-- plus jobs_user_id_idx for the owner's RLS read.
--
-- Rollback (reference; the workflow is forward-only):
--   drop function public.finish_job(uuid, text, text, boolean);
--   drop function public.claim_jobs(text, integer);
--   drop table public.jobs;
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The table
-- -----------------------------------------------------------------------------

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  -- NULL = a system job (not owned by a student); cascades with the user.
  user_id uuid references auth.users (id) on delete cascade,
  kind text not null
    constraint jobs_kind_check
    check (length(trim(kind)) > 0),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    constraint jobs_status_check
    check (status in ('queued', 'running', 'succeeded', 'failed', 'dead_letter')),
  attempts integer not null default 0
    constraint jobs_attempts_check
    check (attempts >= 0),
  max_attempts integer not null default 5
    constraint jobs_max_attempts_check
    check (max_attempts between 1 and 100),
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table public.jobs is
  'Task 29.1: the durable background job store. Enqueue and state changes are
   service-role only; owners may SELECT their own jobs (RLS).';
comment on column public.jobs.kind is
  'Handler registry key (e.g. noop.test). Never empty.';
comment on column public.jobs.status is
  'queued → running → succeeded | failed (permanent) | dead_letter (attempts exhausted).';
comment on column public.jobs.run_after is
  'Earliest time the job may be claimed; a retry pushes this forward by the backoff.';
comment on column public.jobs.locked_by is
  'The worker id currently holding the lease; cleared on every terminal/retry transition.';

create trigger set_jobs_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Indexes — the claim/reclaim predicates, documented above.
-- -----------------------------------------------------------------------------

create index jobs_claim_idx
  on public.jobs (run_after)
  where status = 'queued';

create index jobs_reclaim_idx
  on public.jobs (locked_at)
  where status = 'running';

create index jobs_user_id_idx on public.jobs (user_id);

-- -----------------------------------------------------------------------------
-- 3. RLS — owner reads only; every write is server-side.
-- -----------------------------------------------------------------------------

alter table public.jobs enable row level security;

create policy "jobs_select_own"
  on public.jobs for select to authenticated
  using (auth.uid() = user_id);

-- Explicit grants: authenticated may read (RLS filters), anon gets nothing,
-- and the service role owns every write path. The blanket revoke also removes
-- the Supabase bootstrap's default table grants (ALL to authenticated), so
-- even a future RLS mistake cannot open a client write path.
revoke all on public.jobs from anon, authenticated;
grant select on public.jobs to authenticated;
grant all on public.jobs to service_role;

-- -----------------------------------------------------------------------------
-- 4. claim_jobs — atomic claim + stale-lock reclaim
-- -----------------------------------------------------------------------------

create or replace function public.claim_jobs(
  p_worker_id text,
  p_limit integer default 1
)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 then
    raise exception 'claim_jobs requires a worker id';
  end if;

  -- Stuck-worker safeguard: a lock older than the lease is returned to the
  -- queue before this claim selects. The attempts counter already moved when
  -- the lost worker claimed it, so a crash still costs an attempt.
  update public.jobs
     set status = 'queued',
         locked_at = null,
         locked_by = null,
         run_after = v_now
   where status = 'running'
     and locked_at < v_now - interval '5 minutes';

  -- Claim: lock due rows skipping any row another worker holds, then flip
  -- them to running in the same statement. `limit` is clamped so one call can
  -- never sweep the whole table.
  return query
  update public.jobs j
     set status = 'running',
         locked_at = v_now,
         locked_by = p_worker_id,
         attempts = j.attempts + 1
   where j.id in (
     select id
       from public.jobs
      where status = 'queued'
        and run_after <= v_now
      order by run_after, created_at
      limit least(greatest(coalesce(p_limit, 1), 1), 50)
      for update skip locked
   )
   returning j.*;
end;
$$;

comment on function public.claim_jobs(text, integer) is
  'Task 29.1: atomically moves due queued jobs to running (attempts+1,
   locked_by/at) and reclaims running jobs whose 5-minute lease expired.
   Security definer; service-role only.';

-- -----------------------------------------------------------------------------
-- 5. finish_job — succeed / retry with backoff / fail / dead-letter
-- -----------------------------------------------------------------------------

create or replace function public.finish_job(
  p_job_id uuid,
  p_worker_id text,
  p_error text default null,
  p_retryable boolean default true
)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_backoff interval;
begin
  select * into v_job
    from public.jobs
   where id = p_job_id
   for update;

  if not found then
    raise exception 'finish_job: unknown job %', p_job_id;
  end if;

  -- A job can only be finished by the worker that currently holds it, so a
  -- response that arrives after the lock was reclaimed cannot overwrite the
  -- new owner's run.
  if v_job.status <> 'running' or v_job.locked_by is distinct from p_worker_id then
    raise exception 'finish_job: job % is not held by worker %', p_job_id, p_worker_id;
  end if;

  if p_error is null then
    update public.jobs
       set status = 'succeeded',
           last_error = null,
           locked_at = null,
           locked_by = null,
           completed_at = now()
     where id = p_job_id
     returning * into v_job;
  elsif not p_retryable then
    update public.jobs
       set status = 'failed',
           last_error = left(p_error, 2000),
           locked_at = null,
           locked_by = null,
           completed_at = now()
     where id = p_job_id
     returning * into v_job;
  elsif v_job.attempts >= v_job.max_attempts then
    update public.jobs
       set status = 'dead_letter',
           last_error = left(p_error, 2000),
           locked_at = null,
           locked_by = null,
           completed_at = now()
     where id = p_job_id
     returning * into v_job;
  else
    -- Exponential backoff, capped at one hour: 30s, 1m, 2m, 4m … The
    -- exponent is bounded so a large max_attempts cannot overflow the cast.
    v_backoff := least(
      (power(2, least(greatest(v_job.attempts - 1, 0), 11)))::integer
        * interval '30 seconds',
      interval '1 hour'
    );
    update public.jobs
       set status = 'queued',
           run_after = now() + v_backoff,
           last_error = left(p_error, 2000),
           locked_at = null,
           locked_by = null
     where id = p_job_id
     returning * into v_job;
  end if;

  return v_job;
end;
$$;

comment on function public.finish_job(uuid, text, text, boolean) is
  'Task 29.1: settles a claimed job. No error → succeeded; non-retryable →
   failed; retryable with attempts left → queued with exponential backoff;
   attempts exhausted → dead_letter. Security definer; service-role only.';

-- -----------------------------------------------------------------------------
-- 6. Grants — the worker (service role) is the only caller.
--
-- `revoke ... from public` is not enough here: the Supabase bootstrap grants
-- EXECUTE on new public-schema functions *directly* to `anon` and
-- `authenticated` (through ALTER DEFAULT PRIVILEGES), and a direct grant
-- survives a PUBLIC revoke. For a SECURITY DEFINER function that would let a
-- guest claim jobs as the owner, so both roles are revoked explicitly.
-- -----------------------------------------------------------------------------

revoke all on function public.claim_jobs(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_jobs(text, integer) to service_role;

revoke all on function public.finish_job(uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.finish_job(uuid, text, text, boolean)
  to service_role;
