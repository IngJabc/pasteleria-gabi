-- OQ-17 — Quote acceptance starts one fixed reservation window (Phase 4)
--
-- Implements the confirmed rule in docs/DECISIONS.md #26 and SPEC.md §6/§8:
--   * A manual-quote delivery remains HELD (expires_at = NULL) while the quote
--     is pending (migration 003 behavior, unchanged).
--   * The customer's EXPLICIT acceptance of the quoted delivery fee starts a
--     NEW, fixed 20-minute reservation deadline, written ONCE.
--   * The historical `initial_expires_at` is never rewritten: it keeps the
--     original creation-time value (created_at + 20 minutes) for the record.
--     The new deadline lives in the separate
--     `inventory_reservations.quote_acceptance_expires_at` column.
--   * The 24-hour receipt-review SLA (OQ-16) and the one 20-minute receipt
--     correction window (OQ-14) are independent and untouched by this file.
--
-- Scope: only the two documented columns, a safe extension of the existing
-- expires_at CHECK, one service-role acceptance primitive, one token-based
-- wrapper for the private tracking link, and the PII-free tracking projection
-- updated with the new acceptance fields. No OQ-16 notifications/scheduler,
-- no payment tables, no receipt storage and no client write path.
--
-- Security: every RPC is SECURITY INVOKER with a pinned search_path and is
-- granted to `service_role` only. The order-id primitive is internal server
-- infrastructure; customer calls MUST use
-- `accept_quote_fee_for_tracking(p_token)`, which resolves the sha256 digest of
-- the private tracking token in the same transaction. An order id alone is
-- never accepted as customer authorization (DECISIONS #17, SECURITY_DESIGN §6).
--
-- Concurrency: every operation locks this order's reservation rows first,
-- ordered by id, and only then the orders row (global lock order
-- reservations -> orders). That serialises acceptance against receipt
-- submission, rejection, consumption, release and lazy expiry.
--
-- Idempotency: repeated acceptance returns the original timestamp/deadline and
-- writes nothing. Closed (released/expired/consumed) rows are never revived.
-- The first acceptance inserts one `order.quote_accept` audit_log row in the
-- SAME transaction; admin_id is NULL because the actor is the customer, not an
-- administrator. The audit payload carries no token or customer PII.
--
-- Status: NOT applied to any remote Supabase project — validated locally only.
-- Migrations 001-003 are untouched.

-- 1. Columns ------------------------------------------------------------------

alter table public.orders
  add column quote_accepted_at timestamptz null;

alter table public.inventory_reservations
  add column quote_acceptance_expires_at timestamptz null;

-- Historical deadlines stay auditable: a quote acceptance deadline is a new
-- point in time, not a mutation of the original creation-time deadline.
create index orders_quote_accepted_at_idx
  on public.orders (quote_accepted_at desc) where quote_accepted_at is not null;

-- 2. Operative deadline invariant ---------------------------------------------
--
-- `expires_at` remains the single operative deadline used by availability,
-- lazy expiry and the existing RPCs. Its CHECK now covers exactly four cases,
-- in precedence order:
--   1. NULL                            -> held (quote pending / receipt review)
--   2. correction_window_ends_at set   -> operative deadline is the correction
--                                         window (OQ-14, even after acceptance)
--   3. quote_acceptance_expires_at set -> operative deadline is the new
--                                         fixed 20-minute acceptance window
--   4. otherwise                       -> the original initial_expires_at
-- The initial-deadline CHECK from migration 003 is deliberately NOT changed.
alter table public.inventory_reservations
  drop constraint inventory_reservations_expires_at_check,
  add constraint inventory_reservations_expires_at_check
    check (
      expires_at is null
      or case
           when correction_window_ends_at is not null
             then expires_at = correction_window_ends_at
           when quote_acceptance_expires_at is not null
             then expires_at = quote_acceptance_expires_at
           else expires_at = initial_expires_at
         end
    );

-- Defensive value-domain check: the acceptance clock always ends strictly
-- after the reservation was created. The exact +20 minute offset is written by
-- accept_quote_fee below; this CHECK only rejects impossible historical data.
alter table public.inventory_reservations
  add constraint inventory_reservations_quote_acceptance_expires_at_check
    check (quote_acceptance_expires_at is null
           or quote_acceptance_expires_at > created_at);

-- 3. Quote acceptance primitive ------------------------------------------------
--
-- Returns {order_id, quote_accepted_at, quote_acceptance_expires_at,
-- reservations_updated, idempotent}. A repeat returns the original values and
-- idempotent = true; it never writes, never extends and never revives rows.
create or replace function public.accept_quote_fee(p_order_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now                timestamptz := now();
  v_deadline           timestamptz;
  v_status             text;
  v_accepted_at        timestamptz;
  v_attempts           integer;
  v_channel            text;
  v_fulfillment        text;
  v_zone_id            bigint;
  v_requires_quote     boolean;
  v_fee                numeric(10,2);
  v_subtotal           numeric(10,2);
  v_total              numeric(10,2);
  v_active             integer := 0;
  v_held               integer := 0;
  v_pristine           integer := 0;
  v_updated            integer;
begin
  v_deadline := v_now + interval '20 minutes';

  if p_order_id is null then
    raise exception 'accept_quote_fee: order id is required'
      using errcode = '22023';
  end if;

  -- Lock ALL this order's reservations first, in a stable id order. Closed rows
  -- are locked only to make the idempotent read consistent; they are never
  -- updated. The order row is locked afterwards (global lock order).
  select count(*) filter (where locked.status = 'active'),
         count(*) filter (where locked.status = 'active'
                            and locked.expires_at is null),
         count(*) filter (where locked.status = 'active'
                            and locked.expires_at is null
                            and locked.correction_window_ends_at is null
                            and locked.quote_acceptance_expires_at is null)
    into v_active, v_held, v_pristine
  from (
    select r.status, r.expires_at, r.correction_window_ends_at,
           r.quote_acceptance_expires_at
    from public.inventory_reservations r
    where r.order_id = p_order_id
    order by r.id
    for update
  ) locked;

  select o.status, o.quote_accepted_at, o.receipt_attempts, o.channel,
         o.fulfillment_type, o.delivery_zone_id, o.delivery_fee_usd,
         o.subtotal_usd, o.total_usd
    into v_status, v_accepted_at, v_attempts, v_channel, v_fulfillment,
         v_zone_id, v_fee, v_subtotal, v_total
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'accept_quote_fee: order % does not exist', p_order_id
      using errcode = 'P0002';
  end if;

  -- Idempotent replay: the acceptance timestamp is the source of truth. No
  -- validation of later inventory state is needed (a reservation may already
  -- have lapsed) and absolutely no row may be rewritten or revived.
  if v_accepted_at is not null then
    return jsonb_build_object(
      'order_id', p_order_id,
      'quote_accepted_at', v_accepted_at,
      'quote_acceptance_expires_at', v_accepted_at + interval '20 minutes',
      'reservations_updated', 0,
      'idempotent', true
    );
  end if;

  -- State machine: only a pending online quote delivery with no receipt yet.
  if v_status <> 'pending' then
    raise exception 'accept_quote_fee: order % is not pending', p_order_id
      using errcode = 'P0001';
  end if;
  if v_attempts <> 0 then
    raise exception 'accept_quote_fee: order % already has a submitted receipt', p_order_id
      using errcode = 'P0001';
  end if;
  if v_channel <> 'online' or v_fulfillment <> 'delivery' or v_zone_id is null then
    raise exception 'accept_quote_fee: order % is not a delivery quote order', p_order_id
      using errcode = 'P0001';
  end if;

  -- Quote availability: the zone must really be a manual-quote zone and the
  -- confirmed fee must already be snapshotted on the order by the server-side
  -- quote flow; a NULL fee means the quote has not been issued yet.
  select z.requires_quote into v_requires_quote
  from public.delivery_zones z
  where z.id = v_zone_id;
  if not coalesce(v_requires_quote, false) then
    raise exception 'accept_quote_fee: order % delivery zone does not require a quote', p_order_id
      using errcode = 'P0001';
  end if;
  if v_fee is null then
    raise exception 'accept_quote_fee: no confirmed delivery quote is available for order %', p_order_id
      using errcode = 'P0001';
  end if;
  if v_total is null
     or v_subtotal is null
     or v_total <> v_subtotal + v_fee then
    raise exception 'accept_quote_fee: quoted total does not match order %', p_order_id
      using errcode = 'P0001';
  end if;

  -- Reservation state: at least one active row, all active rows held and not
  -- already carrying a quote/correction deadline.
  if v_active = 0 then
    raise exception 'accept_quote_fee: order % has no active reservations', p_order_id
      using errcode = 'P0001';
  end if;
  if v_held <> v_active then
    raise exception 'accept_quote_fee: order % has active reservations with a running deadline', p_order_id
      using errcode = 'P0001';
  end if;
  if v_pristine <> v_active then
    raise exception 'accept_quote_fee: order % reservations are no longer awaiting quote acceptance', p_order_id
      using errcode = 'P0001';
  end if;

  -- One transaction: deadline, order marker and append-only audit record.
  -- initial_expires_at and correction_window_ends_at are deliberately absent
  -- from every UPDATE below.
  update public.inventory_reservations r
     set quote_acceptance_expires_at = v_deadline,
         expires_at = v_deadline
   where r.order_id = p_order_id
     and r.status = 'active';
  get diagnostics v_updated = row_count;

  if v_updated <> v_active then
    raise exception 'accept_quote_fee: reservation state changed while accepting order %', p_order_id
      using errcode = '40001';
  end if;

  update public.orders o
     set quote_accepted_at = v_now
   where o.id = p_order_id
     and o.quote_accepted_at is null;

  insert into public.audit_log (admin_id, action, entity_type, entity_id, data)
  values (
    null,
    'order.quote_accept',
    'order',
    p_order_id::text,
    jsonb_build_object(
      'source', 'tracking',
      'quote_accepted_at', v_now,
      'quote_acceptance_expires_at', v_deadline,
      'reservations_updated', v_updated
    )
  );

  return jsonb_build_object(
    'order_id', p_order_id,
    'quote_accepted_at', v_now,
    'quote_acceptance_expires_at', v_deadline,
    'reservations_updated', v_updated,
    'idempotent', false
  );
end;
$$;

-- 4. Customer-facing wrapper (private tracking token) -------------------------
--
-- This is the only function the server action calls. It resolves the order by
-- the sha256 of the high-entropy token exactly like get_order_for_tracking and
-- request_order_cancellation; no order id, customer name or phone is trusted.
create or replace function public.accept_quote_fee_for_tracking(p_token text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order_id bigint;
begin
  if p_token is null or btrim(p_token) = '' then
    raise exception 'accept_quote_fee_for_tracking: tracking token is required'
      using errcode = '22023';
  end if;

  select o.id into v_order_id
  from public.orders o
  where o.tracking_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');

  if v_order_id is null then
    raise exception 'accept_quote_fee_for_tracking: no order matches the tracking token'
      using errcode = 'P0002';
  end if;

  return public.accept_quote_fee(v_order_id);
end;
$$;

-- 5. PII-free tracking projection ---------------------------------------------
--
-- Same contract and grant as migration 003, plus the new acceptance fields so
-- the tracking page can decide whether to show the acceptance action. No name,
-- phone, address, instructions, token hash or token is exposed.
create or replace function public.get_order_for_tracking(p_token text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'order_id', o.id,
    'status', o.status,
    'fulfillment_type', o.fulfillment_type,
    'subtotal_usd', o.subtotal_usd,
    'delivery_fee_usd', o.delivery_fee_usd,
    'total_usd', o.total_usd,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'quote_accepted_at', o.quote_accepted_at,
    'quote_acceptance_expires_at', (
      select max(r.quote_acceptance_expires_at)
      from public.inventory_reservations r
      where r.order_id = o.id
    ),
    'quote_acceptance_available',
      o.status = 'pending'
      and o.quote_accepted_at is null
      and o.receipt_attempts = 0
      and o.delivery_fee_usd is not null
      and exists (
        select 1 from public.delivery_zones z
        where z.id = o.delivery_zone_id and z.requires_quote
      )
      and exists (
        select 1 from public.inventory_reservations r
        where r.order_id = o.id and r.status = 'active' and r.expires_at is null
      ),
    'items', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'product_name', i.product_name,
            'unit_price_usd', i.unit_price_usd,
            'quantity', i.quantity
          ) order by i.id
        ), '[]'::jsonb)
      from public.order_items i
      where i.order_id = o.id
    ),
    'cancellation_requests', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'status', c.status,
            'created_at', c.created_at,
            'resolved_at', c.resolved_at
          ) order by c.id
        ), '[]'::jsonb)
      from public.cancellation_requests c
      where c.order_id = o.id
    )
  )
  from public.orders o
  where o.tracking_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

-- 6. EXECUTE grants (SECURITY_DESIGN §5) ---------------------------------------
-- New RPCs are server-side only. The replaced tracking function keeps the
-- service-role grant from migration 003, but the explicit revoke is repeated
-- so the contract is self-contained and robust to grant drift.

revoke execute on function public.accept_quote_fee(bigint)
  from public, anon, authenticated;
grant  execute on function public.accept_quote_fee(bigint)
  to service_role;

revoke execute on function public.accept_quote_fee_for_tracking(text)
  from public, anon, authenticated;
grant  execute on function public.accept_quote_fee_for_tracking(text)
  to service_role;

revoke execute on function public.get_order_for_tracking(text)
  from public, anon, authenticated;
grant  execute on function public.get_order_for_tracking(text)
  to service_role;

-- No seeds: acceptance is runtime customer behavior and audit rows are written
-- by the RPC itself.
