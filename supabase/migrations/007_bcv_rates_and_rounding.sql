-- Phase 5b — OQ-4 (BCV exchange rates) and OQ-5 (monetary rounding).
--
-- Additive follow-up to 001–006. Migration 006 is already applied in staging;
-- this file is the NEXT migration (007) and never rewrites earlier files.
--
-- Verified baseline this builds on:
--   * 003 created `public.exchange_rates` (rate_ves_per_usd numeric(12,4),
--     observed_at UNIQUE, source) with anon SELECT + admin ALL and NO write
--     path, and created the nullable per-order snapshot columns
--     `bcv_rate_ves`, `bcv_rate_at`, `total_ves` and `rounding_rule`.
--   * 006 left those columns NULL at checkout, reports payment amounts per
--     currency only, and added `private.require_active_admin(uuid)` plus the
--     `audit_log` convention used below.
--
-- Scope (approved OQ-4/OQ-5 decisions — see docs/DECISIONS.md #33/#34):
--   * BCV rates are administered MANUALLY through service-role RPCs fed by a
--     server action. Automatic BCV ingestion is NOT implemented or assumed:
--     no network call, credential, cron or worker is added here. A future
--     ingestion job can reuse `register_bcv_rate` with a machine `source`.
--   * Rates are append-only historical rows with an explicit `is_active`
--     state. A correction deactivates the old row and inserts a new one that
--     points at it through `supersedes_id`; nothing is ever deleted or edited
--     in place.
--   * The latest ACTIVE rate at or before a point in time is the only rate a
--     quotation may use. If none exists, the operation FAILS with an explicit
--     error — an unknown rate is never substituted (SPEC §4).
--   * Rounding is `round_half_up` (PostgreSQL numeric round = half away from
--     zero) applied ONCE to the final VES total, never per item and never to
--     declared payment components. USD/VES/USDT amounts keep 2 decimals;
--     the BCV rate keeps 4. No cross-currency sum or fully-paid rule exists.
--
-- Integration hardening (focused follow-up audit):
--   * `create_online_order_with_bcv` is the canonical checkout path. It calls
--     the UNCHANGED `create_online_order` (003) and resolves/snapshots the BCV
--     rate in the SAME transaction. No client-supplied rate or timestamp is
--     accepted. With no active rate it returns the USD-only order with all BCV
--     fields NULL instead of inventing a value.
--   * A database trigger rejects any `pago_movil` (VES) payment whose order
--     lacks a complete BCV snapshot. This covers guest, admin, direct-RPC and
--     POS entry points; USD/USDT payments are unaffected.
--   * Existing snapshots are immutable through every exposed write path.
--   * Stale-rate threshold remains an UNRESOLVED business decision: `is_stale`
--     is informational only and no maximum age is invented here.
--
-- No seeds. No remote apply, deployment or secret change is performed here.

-- 1. Schema additions --------------------------------------------------------

-- `exchange_rates` stays the append-only history. The new columns are all
-- nullable/defaulted so existing staging rows remain valid without a backfill.
alter table public.exchange_rates
  add column is_active        boolean not null default true,
  add column registered_by    uuid
    references public.administrators (id) on delete set null,
  add column supersedes_id    bigint
    references public.exchange_rates (id) on delete restrict,
  add column note             text,
  add column idempotency_key  text;

alter table public.exchange_rates
  add constraint exchange_rates_source_check
    check (source is null or length(btrim(source)) > 0),
  add constraint exchange_rates_note_check
    check (note is null or length(note) <= 500),
  add constraint exchange_rates_idempotency_key_key unique (idempotency_key);

-- Serves "latest active rate at/before X" without pruning history.
create index exchange_rates_active_lookup_idx
  on public.exchange_rates (is_active, observed_at desc);

-- OQ-5: the only rule this system applies, recorded on each snapped order.
-- Existing rows keep NULL (it would be false to claim a rule was applied to
-- an order that never snapped a rate). New snapshots always write this value.
alter table public.orders
  add constraint orders_rounding_rule_check
    check (rounding_rule is null or rounding_rule = 'round_half_up');

-- 2. Rate reads --------------------------------------------------------------

-- Human/action-facing view: the latest ACTIVE rate at or before `p_as_of`,
-- including its age in seconds. Returns SQL NULL when no such rate exists.
-- Read-only and RLS-visible to the same roles that could already SELECT the
-- public `exchange_rates` table (anon, admins via their policies, service).
create or replace function public.get_bcv_rate(p_as_of timestamptz default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when r.id is null then null::jsonb
    else jsonb_build_object(
      'rate_ves_per_usd', r.rate_ves_per_usd,
      'observed_at',      r.observed_at,
      'source',           r.source,
      'is_stale',         (extract(epoch from (coalesce(p_as_of, now()) - r.observed_at)) > 86400),
      'age_seconds',      extract(epoch from (coalesce(p_as_of, now()) - r.observed_at))::bigint,
      'as_of',            coalesce(p_as_of, now())
    )
  end
  from (
    select e.id, e.rate_ves_per_usd, e.observed_at, e.source
    from public.exchange_rates e
    where e.is_active
      and e.observed_at <= coalesce(p_as_of, now())
    order by e.observed_at desc, e.id desc
    limit 1
  ) r;
$$;

-- Server-side primitive used when snapshotting an order. Numeric only; no
-- fallback value is invented when the table has no active rate.
create or replace function public.get_last_ves_per_usd()
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select e.rate_ves_per_usd
  from public.exchange_rates e
  where e.is_active and e.observed_at <= now()
  order by e.observed_at desc, e.id desc
  limit 1;
$$;

-- 3. Manual administration ---------------------------------------------------

-- Register a rate, or atomically replace an existing one. `p_supersedes_id`
-- marks a correction: the old row is deactivated only AFTER the new row is
-- inserted successfully, so a losing concurrent replay cannot disable a rate.
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
begin
  perform private.require_active_admin(p_admin_id);

  if p_rate_ves_per_usd is null or p_rate_ves_per_usd <= 0 then
    raise exception 'register_bcv_rate: rate must be positive' using errcode = '22023';
  end if;
  if p_rate_ves_per_usd <> pg_catalog.round(p_rate_ves_per_usd, 4) then
    raise exception 'register_bcv_rate: rate must have at most four decimals' using errcode = '22023';
  end if;
  if p_source is null or length(btrim(p_source)) = 0 or length(btrim(p_source)) > 120 then
    raise exception 'register_bcv_rate: source is required (max 120 chars)' using errcode = '22023';
  end if;
  if p_note is not null and length(p_note) > 500 then
    raise exception 'register_bcv_rate: note is too long' using errcode = '22023';
  end if;

  v_observed := coalesce(p_observed_at, v_now);

  -- Sequential replay: return the original row without a second insert.
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
    p_rate_ves_per_usd, v_observed, btrim(p_source), true,
    p_admin_id, p_supersedes_id, p_note, p_idempotency_key, v_now
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  -- A racing transaction with the same key won: report its row, change nothing.
  if v_id is null then
    select e.id into v_id
    from public.exchange_rates e
    where e.idempotency_key = p_idempotency_key;
    return jsonb_build_object('rate_id', v_id, 'idempotent', true);
  end if;

  if p_supersedes_id is not null then
    -- Re-check under a row lock: a concurrent correction may have deactivated
    -- the target already, in which case this whole transaction rolls back.
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
      'source', btrim(p_source),
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

-- Standalone deactivation (e.g. a bad manual entry with no replacement yet).
-- Idempotent when the row is already inactive; fails when it does not exist.
create or replace function public.deactivate_bcv_rate(p_rate_id bigint, p_admin_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_updated bigint;
  v_exists  bigint;
begin
  perform private.require_active_admin(p_admin_id);
  if p_rate_id is null then
    raise exception 'deactivate_bcv_rate: rate id is required' using errcode = '22023';
  end if;

  update public.exchange_rates e
     set is_active = false
   where e.id = p_rate_id and e.is_active
  returning e.id into v_updated;

  if v_updated is null then
    select e.id into v_exists from public.exchange_rates e where e.id = p_rate_id;
    if not found then
      raise exception 'deactivate_bcv_rate: rate % does not exist', p_rate_id using errcode = 'P0002';
    end if;
    return jsonb_build_object('rate_id', p_rate_id, 'idempotent', true);
  end if;

  insert into public.audit_log (admin_id, action, entity_type, entity_id, data)
  values (p_admin_id, 'exchange_rate.deactivate', 'exchange_rate', p_rate_id::text, '{}'::jsonb);

  return jsonb_build_object('rate_id', p_rate_id, 'idempotent', false);
end;
$$;

-- 4. Order snapshot (OQ-4 + OQ-5 together) -----------------------------------

-- Single implementation of the SPEC §4 snapshot. Called only by the two
-- service-role wrappers below. Existing snapshots are NEVER overwritten, so
-- correcting a rate cannot rewrite history.
create or replace function private.snapshot_bcv_rate(p_order_id bigint, p_admin_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_order   public.orders;
  v_rate    numeric(12,4);
  v_rate_at timestamptz;
  v_age     bigint;
  v_total   numeric(14,2);
begin
  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;
  if not found then
    raise exception 'snapshot_bcv_rate: order % does not exist', p_order_id using errcode = 'P0002';
  end if;
  if v_order.status in ('canceled', 'expired') then
    raise exception 'snapshot_bcv_rate: order % is %', p_order_id, v_order.status
      using errcode = 'P0001';
  end if;

  -- Idempotent replay preserves the exact rate and time already used.
  if v_order.bcv_rate_ves is not null then
    return jsonb_build_object(
      'order_id', p_order_id,
      'bcv_rate_ves', v_order.bcv_rate_ves,
      'bcv_rate_at', v_order.bcv_rate_at,
      'total_ves', v_order.total_ves,
      'rounding_rule', v_order.rounding_rule,
      'applied', false
    );
  end if;

  select e.rate_ves_per_usd,
         e.observed_at,
         extract(epoch from (now() - e.observed_at))::bigint
    into v_rate, v_rate_at, v_age
  from public.exchange_rates e
  where e.is_active and e.observed_at <= now()
  order by e.observed_at desc, e.id desc
  limit 1;

  -- SPEC §4: never use an unknown rate. The caller maps this to a Spanish
  -- message and the order simply stays in its original USD currency.
  if v_rate is null then
    raise exception 'snapshot_bcv_rate: no active BCV rate is available'
      using errcode = 'P0001';
  end if;

  -- OQ-5: one rounding step, on the final total only. numeric round() is
  -- half-away-from-zero, which for non-negative amounts is round_half_up.
  v_total := pg_catalog.round(v_order.total_usd * v_rate, 2);

  update public.orders o
     set bcv_rate_ves = v_rate,
         bcv_rate_at  = v_rate_at,   -- the rate's own time, not "now"
         total_ves    = v_total,
         rounding_rule = 'round_half_up',
         updated_at   = now()
   where o.id = p_order_id;

  -- SPEC §16 audits administrative operations; a guest checkout is not one.
  if p_admin_id is not null then
    insert into public.audit_log (admin_id, action, entity_type, entity_id, data)
    values (
      p_admin_id,
      'order.apply_bcv_rate',
      'order',
      p_order_id::text,
      jsonb_build_object(
        'bcv_rate_ves', v_rate,
        'bcv_rate_at', v_rate_at,
        'total_ves', v_total,
        'rounding_rule', 'round_half_up'
      )
    );
  end if;

  return jsonb_build_object(
    'order_id', p_order_id,
    'bcv_rate_ves', v_rate,
    'bcv_rate_at', v_rate_at,
    'total_ves', v_total,
    'rounding_rule', 'round_half_up',
    'applied', true,
    'age_seconds', v_age
  );
end;
$$;

-- Guest checkout wrapper: only the private tracking token identifies the order.
create or replace function public.apply_bcv_rate_for_tracking(p_token text)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_hash     text;
  v_order_id bigint;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'apply_bcv_rate_for_tracking: invalid tracking token' using errcode = '22023';
  end if;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  select o.id into v_order_id
  from public.orders o
  where o.tracking_token_hash = v_hash;
  if not found then
    raise exception 'apply_bcv_rate_for_tracking: no order matches the tracking token'
      using errcode = 'P0002';
  end if;
  return private.snapshot_bcv_rate(v_order_id, null);
end;
$$;

-- Administrator wrapper, for orders that still need an explicit snapshot.
create or replace function public.apply_bcv_rate_to_order(p_order_id bigint, p_admin_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  perform private.require_active_admin(p_admin_id);
  return private.snapshot_bcv_rate(p_order_id, p_admin_id);
end;
$$;

-- 4b. Atomic order creation (canonical checkout path) --------------------------

-- The standalone wrappers above remain ONLY as legacy/manual tools for orders
-- that predate this migration or were created through the 003 RPC directly;
-- they cannot overwrite an existing snapshot. The canonical path is here:
-- `create_online_order` is invoked unchanged, so every validation, inventory
-- lock/reservation, tracking token and error is preserved, and the BCV snapshot
-- is resolved and written in the SAME PostgreSQL transaction. The signature
-- deliberately has NO rate or timestamp parameter: the server decides, never
-- the client. When no active rate exists the order is still created with all
-- four BCV fields NULL (the approved USD-only flow).
create or replace function public.create_online_order_with_bcv(
  p_customer_name           text,
  p_customer_phone          text,
  p_fulfillment_type        text,
  p_delivery_zone_id        bigint,
  p_address_line            text,
  p_address_references      text,
  p_additional_instructions text,
  p_items                   jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_result      jsonb;
  v_order_id    bigint;
  v_total_usd   numeric(10,2);
  v_rate        numeric(12,4);
  v_rate_at     timestamptz;
  v_total_ves   numeric(14,2);
  v_age_seconds bigint;
begin
  -- One and only one call to the existing creation logic: nothing below
  -- re-implements validation, locking, reservations or token generation.
  v_result := public.create_online_order(
    p_customer_name, p_customer_phone, p_fulfillment_type,
    p_delivery_zone_id, p_address_line, p_address_references,
    p_additional_instructions, p_items
  );

  v_order_id := (v_result ->> 'order_id')::bigint;

  -- Lock the freshly inserted row so no other writer can touch the snapshot
  -- between resolution and the single UPDATE below.
  select o.total_usd into v_total_usd
  from public.orders o
  where o.id = v_order_id
  for update;
  if not found then
    raise exception 'create_online_order_with_bcv: order % was not created', v_order_id
      using errcode = 'P0002';
  end if;

  -- Resolve the active rate inside the database, with exactly the same
  -- "latest active at/before now()" rule as public.get_last_ves_per_usd().
  -- No fallback and no cross-currency invention: NULL means USD-only.
  select e.rate_ves_per_usd,
         e.observed_at,
         extract(epoch from (now() - e.observed_at))::bigint
    into v_rate, v_rate_at, v_age_seconds
  from public.exchange_rates e
  where e.is_active and e.observed_at <= now()
  order by e.observed_at desc, e.id desc
  limit 1;

  if v_rate is null then
    return v_result || jsonb_build_object(
      'bcv_rate_ves', null,
      'bcv_rate_at', null,
      'total_ves', null,
      'rounding_rule', null,
      'bcv_applied', false
    );
  end if;

  -- OQ-5: ONE rounding step on the final calculated total, no per-item
  -- rounding. PostgreSQL numeric round() is half-away-from-zero, which for
  -- non-negative amounts is exactly round_half_up.
  v_total_ves := pg_catalog.round(v_total_usd * v_rate, 2);

  update public.orders o
     set bcv_rate_ves = v_rate,
         bcv_rate_at  = v_rate_at,   -- the rate's own time, not "now"
         total_ves    = v_total_ves,
         rounding_rule = 'round_half_up',
         updated_at   = now()
   where o.id = v_order_id;

  return v_result || jsonb_build_object(
    'bcv_rate_ves', v_rate,
    'bcv_rate_at', v_rate_at,
    'total_ves', v_total_ves,
    'rounding_rule', 'round_half_up',
    'bcv_applied', true,
    'age_seconds', v_age_seconds
  );
end;
$$;

-- 4c. Pago Móvil requires a complete BCV snapshot ------------------------------

-- Database-level backstop covering EVERY payment entry point (guest, admin,
-- direct RPC and POS). Method/currency pairs are already constrained by 006;
-- here we additionally require that a VES payment's order has a complete,
-- immutable snapshot and a computed VES total. USD and USDT flows are untouched.
-- The message is stable so the Server Action can map it to clear Spanish text.
create or replace function private.require_ves_payment_snapshot()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  if new.method = 'pago_movil' or new.currency = 'VES' then
    select * into v_order
    from public.orders o
    where o.id = new.order_id;
    if not found
       or v_order.bcv_rate_ves is null
       or v_order.bcv_rate_at is null
       or v_order.total_ves is null
       or v_order.rounding_rule is distinct from 'round_half_up' then
      raise exception 'pago_movil requires a BCV snapshot and VES total'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger payments_require_ves_snapshot
  before insert on public.payments
  for each row execute function private.require_ves_payment_snapshot();

-- Snapshot immutability is enforced at the table level as well, so even a
-- privileged direct UPDATE cannot rewrite a historical snapshot. Legitimate
-- updates (status, SLA, quote fee, etc.) leave these columns untouched and are
-- unaffected. The initial NULL -> value write performed by the atomic creation
-- path and the legacy manual wrappers is allowed exactly once.
create or replace function private.enforce_bcv_snapshot_immutability()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if old.bcv_rate_ves is not null and (
       new.bcv_rate_ves is distinct from old.bcv_rate_ves
    or new.bcv_rate_at is distinct from old.bcv_rate_at
    or new.total_ves is distinct from old.total_ves
    or new.rounding_rule is distinct from old.rounding_rule
  ) then
    raise exception 'BCV snapshot is immutable and cannot be overwritten'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger orders_bcv_snapshot_immutable
  before update on public.orders
  for each row execute function private.enforce_bcv_snapshot_immutability();

-- 5. EXECUTE grants (SECURITY_DESIGN §5) --------------------------------------

-- Writes and snapshots: service role only. private.* helpers are never client
-- reachable. Rate reads mirror the already-public SELECT on exchange_rates.
revoke execute on function public.get_last_ves_per_usd() from public, anon, authenticated;
grant  execute on function public.get_last_ves_per_usd() to service_role;

revoke execute on function public.get_bcv_rate(timestamptz) from public;
grant  execute on function public.get_bcv_rate(timestamptz) to anon, authenticated, service_role;

revoke execute on function public.register_bcv_rate(numeric, text, uuid, timestamptz, bigint, text, text)
  from public, anon, authenticated;
grant  execute on function public.register_bcv_rate(numeric, text, uuid, timestamptz, bigint, text, text)
  to service_role;

revoke execute on function public.deactivate_bcv_rate(bigint, uuid)
  from public, anon, authenticated;
grant  execute on function public.deactivate_bcv_rate(bigint, uuid)
  to service_role;

revoke execute on function private.snapshot_bcv_rate(bigint, uuid) from public, anon, authenticated;
grant  execute on function private.snapshot_bcv_rate(bigint, uuid) to service_role;

revoke execute on function public.apply_bcv_rate_for_tracking(text)
  from public, anon, authenticated;
grant  execute on function public.apply_bcv_rate_for_tracking(text)
  to service_role;

revoke execute on function public.apply_bcv_rate_to_order(bigint, uuid)
  from public, anon, authenticated;
grant  execute on function public.apply_bcv_rate_to_order(bigint, uuid)
  to service_role;

-- Canonical checkout path: service role only, exactly like create_online_order.
revoke execute on function public.create_online_order_with_bcv(
  text, text, text, bigint, text, text, text, jsonb
) from public, anon, authenticated;
grant  execute on function public.create_online_order_with_bcv(
  text, text, text, bigint, text, text, text, jsonb
) to service_role;

-- Internal trigger backstops: no direct client grant; the migration role owns them.
revoke execute on function private.require_ves_payment_snapshot() from public, anon, authenticated;
revoke execute on function private.enforce_bcv_snapshot_immutability() from public, anon, authenticated;

-- No seeds: rates are runtime data registered by an administrator. Canonical
-- snapshots are written atomically by create_online_order_with_bcv; the two
-- legacy wrappers above remain immutable, service-role-only manual tools.
