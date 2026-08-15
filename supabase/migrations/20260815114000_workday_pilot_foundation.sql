-- ApplyStronger Workday production-pilot foundation
-- IMPORTANT: this migration is intentionally inert after installation.
-- It creates no cron schedule and leaves Workday automation disabled/pending review.

begin;

alter table public.jobs
  add column if not exists source_content_hash text;

insert into public.job_sources (
  name, source_type, base_url, active, country_codes,
  supports_quick_apply, attribution_required, terms_url, updated_at
)
values (
  'Workday', 'ats', 'https://www.myworkdayjobs.com', true, array['US']::text[],
  false, false, null, now()
)
on conflict (name) do update set
  source_type = excluded.source_type,
  base_url = excluded.base_url,
  updated_at = now();

insert into public.job_source_ingestion_policies (
  source_id, provider, automation_enabled, authorization_status,
  expected_max_age, notes, updated_at
)
select
  s.id,
  'workday',
  false,
  'pending_review',
  interval '6 hours',
  'Workday pilot is installed but disabled. Commercial/terms review and benchmark approval are required before production collection is enabled.',
  now()
from public.job_sources s
where s.name = 'Workday'
on conflict (source_id) do update set
  provider = excluded.provider,
  automation_enabled = false,
  authorization_status = case
    when public.job_source_ingestion_policies.authorization_status = 'approved'
      and public.job_source_ingestion_policies.automation_enabled = true
      then public.job_source_ingestion_policies.authorization_status
    else 'pending_review'
  end,
  expected_max_age = excluded.expected_max_age,
  notes = excluded.notes,
  updated_at = now();

-- Registered pilot employers. The identifier format is host|tenant|site.
-- No collector can claim these employers while the Workday ingestion policy is disabled.
with pilot(name, career_site_url, ats_identifier) as (
  values
    ('Cardinal Health', 'https://cardinalhealth.wd1.myworkdayjobs.com/en-US/EXT', 'cardinalhealth.wd1.myworkdayjobs.com|cardinalhealth|EXT'),
    ('AdventHealth', 'https://adventhealth.wd12.myworkdayjobs.com/en-US/AH_External_Career_Site', 'adventhealth.wd12.myworkdayjobs.com|adventhealth|AH_External_Career_Site'),
    ('DaVita Kidney Care', 'https://davita.wd1.myworkdayjobs.com/en-US/DKC_External', 'davita.wd1.myworkdayjobs.com|davita|DKC_External'),
    ('Elevance Health', 'https://elevancehealth.wd1.myworkdayjobs.com/en-US/ANT', 'elevancehealth.wd1.myworkdayjobs.com|elevancehealth|ANT'),
    ('Johnson & Johnson', 'https://jj.wd5.myworkdayjobs.com/en-US/JJ', 'jj.wd5.myworkdayjobs.com|jj|JJ')
), inserted as (
  insert into public.employers (
    name, career_site_url, ats_type, ats_identifier, active,
    last_sync_status, updated_at
  )
  select
    p.name, p.career_site_url, 'workday', p.ats_identifier, true,
    'pending', now()
  from pilot p
  where not exists (
    select 1 from public.employers e where lower(e.name) = lower(p.name)
  )
  returning id
)
update public.employers e
set
  career_site_url = p.career_site_url,
  ats_type = 'workday',
  ats_identifier = p.ats_identifier,
  active = true,
  updated_at = now()
from pilot p
where lower(e.name) = lower(p.name);

update public.employer_coverage_registry r
set
  employer_id = e.id,
  careers_url = coalesce(r.careers_url, e.career_site_url),
  ats_identifier = e.ats_identifier,
  provider_confidence = 'high',
  coverage_status = case
    when r.coverage_status = 'covered' then r.coverage_status
    else 'validation_pending'
  end,
  updated_at = now()
from public.employers e
where lower(r.ats_provider) = 'workday'
  and lower(r.canonical_name) = lower(e.name)
  and lower(e.ats_type) = 'workday';

create or replace function public.applystronger_enqueue_workday_run(
  p_limit integer default 5
)
returns table(run_id uuid, queued_count integer, registered_employers integer, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 5), 100));
  v_run_id uuid;
  v_existing_run_id uuid;
  v_queued integer := 0;
  v_registered integer := 0;
begin
  select count(*)::integer into v_registered
  from public.employers e
  where coalesce(e.active, false) = true
    and lower(coalesce(e.ats_type, '')) = 'workday'
    and nullif(btrim(e.ats_identifier), '') is not null;

  if not public.applystronger_collector_enabled('workday') then
    return query select
      null::uuid,
      0,
      v_registered,
      'Workday collector is disabled by job_source_ingestion_policies; no run was created.'::text;
    return;
  end if;

  select r.id into v_existing_run_id
  from public.job_ingestion_runs r
  where lower(r.provider) = 'workday'
    and r.status in ('queued', 'running')
  order by r.created_at desc
  limit 1;

  if v_existing_run_id is not null then
    select count(*)::integer into v_queued
    from public.job_ingestion_queue q
    where q.run_id = v_existing_run_id;

    return query select
      v_existing_run_id,
      v_queued,
      v_registered,
      'An active Workday run already exists; it was returned instead of creating overlap.'::text;
    return;
  end if;

  insert into public.job_ingestion_runs(provider, status, requested_limit, note)
  values ('workday', 'queued', v_limit, 'Queued by applystronger_enqueue_workday_run.')
  returning id into v_run_id;

  with candidates as (
    select e.id::text as employer_id
    from public.employers e
    where coalesce(e.active, false) = true
      and lower(coalesce(e.ats_type, '')) = 'workday'
      and nullif(btrim(e.ats_identifier), '') is not null
      and (e.last_sync_at is null or e.last_sync_at < now() - interval '6 hours')
      and not exists (
        select 1
        from public.job_ingestion_queue q
        where q.provider = 'workday'
          and q.employer_id = e.id::text
          and q.status in ('queued', 'running')
      )
    order by e.last_sync_at asc nulls first, e.id
    limit v_limit
  )
  insert into public.job_ingestion_queue(run_id, provider, employer_id, status, available_at)
  select v_run_id, 'workday', c.employer_id, 'queued', now()
  from candidates c
  on conflict on constraint job_ingestion_queue_run_employer_uniq do nothing;

  get diagnostics v_queued = row_count;

  update public.job_ingestion_runs
  set
    queued_count = v_queued,
    status = case when v_queued = 0 then 'completed' else 'queued' end,
    finished_at = case when v_queued = 0 then now() else null end,
    note = format('Queued %s refresh-due Workday employers.', v_queued),
    updated_at = now()
  where id = v_run_id;

  return query select
    v_run_id,
    v_queued,
    v_registered,
    format('Queued %s Workday employers.', v_queued)::text;
end;
$$;

create or replace function public.applystronger_claim_workday_queue(
  p_worker_id text,
  p_limit integer default 1
)
returns table(
  queue_id bigint,
  run_id uuid,
  employer_id text,
  employer_name text,
  industry text,
  ats_identifier text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 1), 2));
  v_worker_id text := left(coalesce(nullif(btrim(p_worker_id), ''), gen_random_uuid()::text), 200);
  v_run_id uuid;
begin
  if not public.applystronger_collector_enabled('workday') then
    return;
  end if;

  update public.job_ingestion_queue q
  set
    status = case when q.attempt_count >= q.max_attempts then 'failed' else 'queued' end,
    available_at = case when q.attempt_count >= q.max_attempts then q.available_at else now() end,
    claimed_at = null,
    claim_expires_at = null,
    worker_id = null,
    last_error = coalesce(q.last_error, 'Worker lease expired; automatically recovered.'),
    finished_at = case when q.attempt_count >= q.max_attempts then now() else null end,
    updated_at = now()
  where q.provider = 'workday'
    and q.status = 'running'
    and q.claim_expires_at < now();

  update public.job_ingestion_queue q
  set
    status = 'failed',
    last_error = 'Employer is no longer an active registered Workday site.',
    finished_at = now(),
    updated_at = now()
  where q.provider = 'workday'
    and q.status = 'queued'
    and not exists (
      select 1
      from public.employers e
      where e.id::text = q.employer_id
        and coalesce(e.active, false) = true
        and lower(coalesce(e.ats_type, '')) = 'workday'
        and nullif(btrim(e.ats_identifier), '') is not null
    );

  for v_run_id in
    select distinct q.run_id
    from public.job_ingestion_queue q
    join public.job_ingestion_runs r on r.id = q.run_id
    where q.provider = 'workday'
      and q.status in ('queued', 'running')
      and r.status <> 'cancelled'
  loop
    perform public.careerpilot_refresh_ingestion_run(v_run_id);
  end loop;

  return query
  with claimable as (
    select q.id
    from public.job_ingestion_queue q
    join public.employers e on e.id::text = q.employer_id
    join public.job_ingestion_runs r on r.id = q.run_id
    where q.provider = 'workday'
      and q.status = 'queued'
      and q.available_at <= now()
      and q.attempt_count < q.max_attempts
      and r.status in ('queued', 'running')
      and coalesce(e.active, false) = true
      and lower(coalesce(e.ats_type, '')) = 'workday'
      and nullif(btrim(e.ats_identifier), '') is not null
    order by q.available_at, q.id
    for update of q skip locked
    limit v_limit
  ), claimed as (
    update public.job_ingestion_queue q
    set
      status = 'running',
      attempt_count = q.attempt_count + 1,
      claimed_at = now(),
      claim_expires_at = now() + interval '4 minutes',
      worker_id = v_worker_id,
      updated_at = now()
    from claimable c
    where q.id = c.id
    returning q.*
  ), run_update as (
    update public.job_ingestion_runs r
    set
      status = 'running',
      started_at = coalesce(r.started_at, now()),
      finished_at = null,
      updated_at = now()
    where r.id in (select distinct c.run_id from claimed c)
    returning r.id
  )
  select
    c.id,
    c.run_id,
    c.employer_id,
    e.name::text,
    e.industry::text,
    e.ats_identifier::text,
    c.attempt_count
  from claimed c
  join public.employers e on e.id::text = c.employer_id
  order by c.id;
end;
$$;

create or replace function public.applystronger_finish_workday_queue(
  p_queue_id bigint,
  p_success boolean,
  p_error text default null,
  p_jobs_fetched integer default 0,
  p_jobs_saved integer default 0,
  p_jobs_retired integer default 0,
  p_jobs_skipped integer default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
begin
  update public.job_ingestion_queue q
  set
    status = case
      when coalesce(p_success, false) then 'succeeded'
      when q.attempt_count < q.max_attempts then 'queued'
      else 'failed'
    end,
    available_at = case
      when coalesce(p_success, false) or q.attempt_count >= q.max_attempts then q.available_at
      else now() + make_interval(mins => least(60, greatest(1, power(2, q.attempt_count)::integer)))
    end,
    claimed_at = null,
    claim_expires_at = null,
    worker_id = null,
    last_error = case when coalesce(p_success, false) then null else left(coalesce(p_error, 'Unknown Workday ingestion error.'), 4000) end,
    jobs_fetched = greatest(0, coalesce(p_jobs_fetched, 0)),
    jobs_saved = greatest(0, coalesce(p_jobs_saved, 0)),
    jobs_retired = greatest(0, coalesce(p_jobs_retired, 0)),
    jobs_skipped = greatest(0, coalesce(p_jobs_skipped, 0)),
    finished_at = case when coalesce(p_success, false) or q.attempt_count >= q.max_attempts then now() else null end,
    updated_at = now()
  where q.id = p_queue_id
    and q.provider = 'workday'
    and q.status = 'running'
  returning q.run_id into v_run_id;

  if v_run_id is not null then
    perform public.careerpilot_refresh_ingestion_run(v_run_id);
  end if;
end;
$$;

revoke all on function public.applystronger_enqueue_workday_run(integer) from public, anon, authenticated;
revoke all on function public.applystronger_claim_workday_queue(text, integer) from public, anon, authenticated;
revoke all on function public.applystronger_finish_workday_queue(bigint, boolean, text, integer, integer, integer, integer) from public, anon, authenticated;

grant execute on function public.applystronger_enqueue_workday_run(integer) to service_role;
grant execute on function public.applystronger_claim_workday_queue(text, integer) to service_role;
grant execute on function public.applystronger_finish_workday_queue(bigint, boolean, text, integer, integer, integer, integer) to service_role;

commit;
