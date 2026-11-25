-- OQ-4 follow-up — BCV automatic synchronization status/history.
--
-- Additive migration on top of 001-014. Records every automatic BCV sync
-- attempt (success or failure) so administrators can inspect the latest sync
-- state, last successful retrieval, provider timestamps, and sanitized errors.
-- The worker writes through the service role; no public/client insert/update/
-- delete path exists. Automatic ingestion is narrowly authorized by the
-- DECISIONS #1 BCV automatic sync amendment and does not affect OQ-16 SLA behavior.
--
-- No remote apply, deployment or secret change is performed here.

create table public.bcv_sync_attempts (
  id                    bigint generated always as identity primary key,
  attempted_at          timestamptz not null default now(),
  status                text not null,
  source                text not null,
  schedule_slot         text not null,
  effective_date        date,
  provider_updated_at   timestamptz,
  retrieved_at          timestamptz,
  rate_ves_per_usd      numeric(12,4),
  error_code            text,
  error_detail          text,
  idempotency_key       text not null,
  registered_rate_id    bigint references public.exchange_rates (id) on delete set null,
  created_at            timestamptz not null default now(),

  constraint bcv_sync_attempts_status_check
    check (status in ('success', 'failure', 'skipped', 'manual_overridden')),
  constraint bcv_sync_attempts_rate_positive_check
    check (rate_ves_per_usd is null or rate_ves_per_usd > 0),
  constraint bcv_sync_attempts_rate_scale_check
    check (rate_ves_per_usd is null or rate_ves_per_usd = pg_catalog.round(rate_ves_per_usd, 4)),
  constraint bcv_sync_attempts_error_detail_length_check
    check (error_detail is null or length(error_detail) <= 500),
  constraint bcv_sync_attempts_error_code_length_check
    check (error_code is null or length(error_code) <= 120),
  constraint bcv_sync_attempts_source_length_check
    check (length(btrim(source)) > 0 and length(source) <= 120),
  constraint bcv_sync_attempts_slot_length_check
    check (length(btrim(schedule_slot)) > 0 and length(schedule_slot) <= 120),
  constraint bcv_sync_attempts_idempotency_key_key unique (idempotency_key),
  constraint bcv_sync_attempts_success_fields_check
    check (
      status <> 'success'
      or (
        effective_date is not null
        and retrieved_at is not null
        and rate_ves_per_usd is not null
        and error_code is null
        and error_detail is null
      )
    ),
  constraint bcv_sync_attempts_failure_fields_check
    check (
      status <> 'failure'
      or (
        error_code is not null
        and registered_rate_id is null
      )
    )
);

comment on table public.bcv_sync_attempts is
  'Append-only automatic BCV synchronization attempts. Service-role writes only; admins read through RLS.';
comment on column public.bcv_sync_attempts.attempted_at is
  'When our worker attempted the synchronization.';
comment on column public.bcv_sync_attempts.retrieved_at is
  'When our worker successfully received and validated the provider payload.';
comment on column public.bcv_sync_attempts.provider_updated_at is
  'Provider-reported update timestamp from BCV Today, kept separate from retrieved_at.';
comment on column public.bcv_sync_attempts.error_detail is
  'Sanitized operator-facing error detail. Never store secrets, tokens, or raw payloads.';

create index bcv_sync_attempts_attempted_at_idx
  on public.bcv_sync_attempts (attempted_at desc, id desc);
create index bcv_sync_attempts_status_attempted_at_idx
  on public.bcv_sync_attempts (status, attempted_at desc, id desc);
create index bcv_sync_attempts_registered_rate_id_idx
  on public.bcv_sync_attempts (registered_rate_id)
  where registered_rate_id is not null;

alter table public.bcv_sync_attempts enable row level security;
alter table public.bcv_sync_attempts force row level security;

-- Administrators can inspect sync history/status. No client writes.
create policy bcv_sync_attempts_admin_select
  on public.bcv_sync_attempts
  for select
  to authenticated
  using ((select private.is_admin()));

revoke all on table public.bcv_sync_attempts from public, anon, authenticated;
grant select on table public.bcv_sync_attempts to authenticated;
grant select, insert on table public.bcv_sync_attempts to service_role;

-- Allow the narrow automatic BCV worker (service-role only) to register rates
-- without a human administrator id. Manual/admin registration behavior remains
-- unchanged and still requires an active administrator.
create or replace function public.register_bcv_rate(
  p_rate_ves_per_usd numeric,
  p_source           text,
  p_admin_id         uuid,
  p_observed_at      timestamptz default null,
  p_supersedes_id    bigint default null,
  p_note             text default null,
  p_idempotency_key  text default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_now        timestamptz := now();
  v_observed   timestamptz;
  v_id         bigint;
  v_existing   bigint;
  v_superseded bigint;
  v_source     text := nullif(btrim(p_source), '');
begin
  if p_admin_id is null then
    -- Only the service-role execution path may register a system rate.
    -- The function remains revoked from public/anon/authenticated.
    if current_user <> 'service_role' then
      perform private.require_active_admin(p_admin_id);
    end if;
    if v_source is null or v_source not like 'automatic:%' then
      raise exception 'register_bcv_rate: automatic registration requires an automatic source'
        using errcode = '22023';
    end if;
    if p_supersedes_id is not null then
      raise exception 'register_bcv_rate: automatic registration cannot supersede rates'
        using errcode = '22023';
    end if;
  else
    perform private.require_active_admin(p_admin_id);
  end if;

  if p_rate_ves_per_usd is null or p_rate_ves_per_usd <= 0 then
    raise exception 'register_bcv_rate: rate must be positive' using errcode = '22023';
  end if;
  if p_rate_ves_per_usd <> pg_catalog.round(p_rate_ves_per_usd, 4) then
    raise exception 'register_bcv_rate: rate must have at most four decimals' using errcode = '22023';
  end if;
  if v_source is null or length(v_source) > 120 then
    raise exception 'register_bcv_rate: source is required (max 120 chars)' using errcode = '22023';
  end if;
  if p_note is not null and length(p_note) > 500 then
    raise exception 'register_bcv_rate: note is too long' using errcode = '22023';
  end if;

  v_observed := coalesce(p_observed_at, v_now);

  if p_idempotency_key is not null then
    select e.id into v_existing
    from public.exchange_rates e
    where e.idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object(
        'rate_id', v_existing,
        'idempotent', true
      );
    end if;
  end if;

  insert into public.exchange_rates (
    rate_ves_per_usd, observed_at, source, is_active,
    registered_by, supersedes_id, note, idempotency_key, created_at
  )
  values (
    p_rate_ves_per_usd, v_observed, v_source, true,
    p_admin_id, p_supersedes_id, p_note, p_idempotency_key, v_now
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    select e.id into v_id
    from public.exchange_rates e
    where e.idempotency_key = p_idempotency_key;
    return jsonb_build_object('rate_id', v_id, 'idempotent', true);
  end if;

  if p_supersedes_id is not null then
    select e.id into v_superseded
    from public.exchange_rates e
    where e.id = p_supersedes_id and e.is_active
    for update;
    if not found then
      raise exception 'register_bcv_rate: rate % to correct does not exist or is inactive', p_supersedes_id
        using errcode = 'P0002';
    end if;
    update public.exchange_rates e
       set is_active = false
     where e.id = v_superseded;
  end if;

  insert into public.audit_log (admin_id, action, entity_type, entity_id, data)
  values (
    p_admin_id,
    'exchange_rate.register',
    'exchange_rate',
    v_id::text,
    jsonb_build_object(
      'rate_ves_per_usd', p_rate_ves_per_usd,
      'observed_at', v_observed,
      'source', v_source,
      'supersedes_id', p_supersedes_id
    )
  );

  return jsonb_build_object(
    'rate_id', v_id,
    'rate_ves_per_usd', p_rate_ves_per_usd,
    'observed_at', v_observed,
    'idempotent', false
  );
end;
$$;

revoke execute on function public.register_bcv_rate(numeric, text, uuid, timestamptz, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.register_bcv_rate(numeric, text, uuid, timestamptz, bigint, text, text)
  to service_role;
