-- M3 — Orders & inventory reservations (Phase 3)
--
-- Implements, without deviation:
--   * docs/DATABASE_DESIGN.md  §6.2 (inventory_reservations), §6.3 (order_id on
--     inventory_movements), §7.1 (orders), §7.2 (order_items), §9.1
--     (cancellation_requests), §10.1 (exchange_rates), §11 (create_online_order,
--     release_expired_reservations, consume_order_reservations,
--     get_order_for_tracking, request_order_cancellation; get_product_stock is
--     replaced so availability subtracts active reservations (design §11:
--     "reserved = 0 until M3 introduces reservations").
--   * docs/SECURITY_DESIGN.md  §4.1/§4.2 (RLS matrix + admin ALL policies),
--     §5 (service-role-only EXECUTE grants), §6 (hashed tracking tokens).
--   * docs/DECISIONS.md        #16 (one orders table for both channels), #17
--     (hashed tokens, guests never touch tables), #18 (batches + reservations +
--     movements with lazy expiry), #23 (value domains only — no transition
--     triggers), #24 (20-minute initial window + one bounded correction
--     window; the 24-hour SLA stays out of the schema — the window is 20
--     minutes and the receipt rules below follow the confirmed M3
--     correction, which supersedes the original 15-minute figure).
--   * SPEC §6/§7/§8/§11/§16 (server-side recompute, reservations, idempotency).
--
-- Scope (M3 only — no M4+ leakage):
--   * No payments/payment_refunds, no receipt storage, no verification logic:
--     receipt submit/reject/approve are Phase 4 events that will CALL the
--     reservation-side RPCs implemented here (hold_order_reservations,
--     open_order_correction_window).
--   * No delivery-quote confirmation workflow, no cancellation-resolution side
--     effects (approve/reject a request, refunds, order status machines stay
--     in server code per DECISIONS #23, at their phases). release_order_
--     reservations is the inventory-side release primitive of §6.2 only.
--   * No tracking/cancellation UI: get_order_for_tracking and
--     request_order_cancellation are the server-side (service role) primitives
--     of SECURITY_DESIGN §6.
--   * The 24-hour admin SLA (SPEC §14) is deliberately absent from the schema:
--     no interval, column or function encodes it (DECISIONS #24).
--
-- Reservation lifecycle (SPEC §8, DECISIONS #24 as amended by the confirmed
-- M3 reservation/payment-attempt rules — deadlines are materialized on the
-- row; clients can never write them):
--   created           -> status 'active', initial_expires_at = created_at +
--                        20 min (immutable; enforced by CHECK). Manual-quote
--                        deliveries are the exception confirmed for M3: they
--                        are created HELD (expires_at = NULL) so the stock
--                        stays reserved while the quote is being confirmed.
--   receipt submitted -> hold_order_reservations(): counts the attempt
--                        (orders.receipt_attempts 0 -> 1 -> 2; two receipts
--                        TOTAL — the original plus exactly one correction)
--                        and sets expires_at = NULL (held: the clock never
--                        runs while the receipt is in review — OQ-15
--                        confirmed). Repeating a hold on an already-held
--                        order is a no-op and consumes no attempt.
--   receipt rejected  -> open_order_correction_window():
--                          * first rejection (receipt_attempts = 1): opens
--                            the ONE correction window — expires_at =
--                            correction_window_ends_at = now() + 20 min,
--                            written ONCE: later rejections re-use it and
--                            never extend it, and rejections never add
--                            attempts (OQ-14 confirmed). Rejection NEVER
--                            releases inventory: status stays active.
--                          * second rejection (receipt_attempts = 2): there
--                            is no third receipt, so the order is canceled
--                            automatically (status 'canceled') and every
--                            active reservation is released ('released' +
--                            closed_at) in the same transaction. Availability
--                            is restored exactly once; physical stock is
--                            never touched and no movement is written.
--                        Rejecting an order that never submitted a receipt
--                        (receipt_attempts = 0) raises (P0001).
--   window lapses     -> release_expired_reservations(): lapsed rows are
--                        excluded from availability immediately (lazy); the
--                        cleanup flips them to 'expired' + closed_at and
--                        expires the pending order. No stock row is touched —
--                        expiry changes availability only, never
--                        remaining_quantity and never a movement.
--   order completed   -> consume_order_reservations(): 'consumed' + `sale`
--                        movements (negative, order_id set, admin_id NULL =
--                        system) + remaining_quantity decrement.
--   authorized cancel -> release_order_reservations(): 'released'; units
--                        available again; physical stock untouched.
--
-- Idempotency (SPEC §8: "reserva, venta y liberación ... atómicas e
-- idempotentes"): repeating consume/release/hold/window on the same state is a
-- safe no-op — a hold on an already-held order does not consume an attempt, a
-- repeated rejection inside the window changes nothing, and a repeated
-- second-rejection call returns 0 after the automatic cancel; only true state
-- violations (consume after release, holding a closed order, rejecting a
-- receipt that was never submitted, a third submission, ...) raise.
-- create_online_order is one transaction: validation, batch locks, allocation,
-- order, items and reservations all commit or roll back together.
--
-- Concurrency: every multi-batch lock is acquired `order by id` (create and
-- consume) so lock order is globally consistent — no deadlocks; the FOR UPDATE
-- on candidate batches serialises concurrent creators, so a second checkout
-- re-reads committed reservations and can never oversell. hold/open take the
-- order's reservation rows BEFORE touching the orders row (lock order
-- reservations -> orders everywhere), so parallel submissions, rejections,
-- consumptions and cleanups serialise instead of interleaving: the attempt
-- counter can never be double-incremented and a release can never happen twice.
--
-- Confirmed by the M3 reservation/payment-attempt correction:
--   * OQ-15 (confirmed): a submitted receipt holds the deadline for review.
--   * OQ-14 (confirmed): ONE 20-minute correction window for the single
--     allowed correction, at most two receipts total, second rejection
--     auto-cancels the order and releases every reservation.
--   * OQ-13 (resolved for the quote case): manual-quote deliveries are created
--     held and keep their inventory reserved while the quote is confirmed;
--     orders that never upload a receipt (cash on delivery) keep the plain
--     20-minute initial clock.
-- Still open (new question, Phase 4): when exactly the 20-minute countdown
--   starts for an order whose manual quote was just confirmed (tracked as
--   OQ-17 in docs/DATABASE_DESIGN.md §14).
-- Still open, honored not resolved:
--   * OQ-9: sale movements are written with admin_id = NULL (system, per
--     design §6.3) — the first movements where null actually occurs.
--   * OQ-4/OQ-5: bcv_rate_* / total_ves / rounding_rule stay NULL at checkout
--     (rate snapshot and rounding logic are Phase 4).
--
-- Audit: no audit_log rows are written here — SPEC §16 audits ADMINISTRATIVE
-- operations; guest checkout, lazy expiry and completion are system events
-- already traced by the order/reservation rows themselves plus the
-- append-only movements for every physical stock change. The admin-driven
-- audit actions (payment.verify, order.status_change, ...) belong to the
-- phases where those admin operations exist.
--
-- Status: NOT applied to any remote Supabase project — validated locally only.
-- Migration 002's file is untouched; evolving get_product_stock through
-- `create or replace` in this file is the documented upgrade path (§11).
-- RLS is the row-level boundary (SECURITY_DESIGN §2); Supabase default table
-- grants are left in place by design.

-- 1. Tables -------------------------------------------------------------------

-- One row per order, both channels (DECISIONS #16). The client never writes
-- this table: online rows are created only by create_online_order (service
-- role); anon has no policy at all (SECURITY_DESIGN §6).
create table public.orders (
  id                       bigint generated always as identity primary key,
  channel                  text not null default 'online',
  status                   text not null default 'pending',
  tracking_token_hash      text,
  customer_name            text,
  customer_phone           text,
  fulfillment_type         text,
  delivery_zone_id         bigint references public.delivery_zones (id) on delete restrict,
  address_line             text,
  address_references       text,
  additional_instructions  text,
  delivery_fee_usd         numeric(10,2),
  subtotal_usd             numeric(10,2) not null,
  total_usd                numeric(10,2) not null,
  bcv_rate_ves             numeric(12,4),
  bcv_rate_at              timestamptz,
  total_ves                numeric(14,2),
  rounding_rule            text,
  -- M3 correction (confirmed receipt rules): receipts submitted for this
  -- order, 0..2 — the original plus exactly one correction. hold_order_
  -- reservations increments it atomically; the second rejection keyed on 2
  -- cancels the order. Value domain only — the state machine stays in
  -- server code (DECISIONS #23).
  receipt_attempts         integer not null default 0,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint orders_channel_check check (channel in ('online', 'pos')),
  constraint orders_status_check
    check (status in ('pending', 'confirmed', 'ready', 'completed', 'canceled', 'expired')),
  constraint orders_fulfillment_type_check check (fulfillment_type in ('delivery', 'pickup')),
  constraint orders_tracking_token_hash_key unique (tracking_token_hash),
  constraint orders_delivery_fee_usd_check check (delivery_fee_usd is null or delivery_fee_usd >= 0),
  constraint orders_bcv_rate_ves_check check (bcv_rate_ves is null or bcv_rate_ves > 0),
  constraint orders_total_ves_check check (total_ves is null or total_ves >= 0),
  -- Row-level channel shapes (design §7.1): online rows carry the guest data
  -- and the hashed token; POS rows have no fulfillment step.
  constraint orders_online_check
    check (channel <> 'online' or
           (customer_name is not null and customer_phone is not null and
            fulfillment_type is not null and tracking_token_hash is not null)),
  constraint orders_pos_check
    check (channel <> 'pos' or fulfillment_type is null),
  constraint orders_pickup_check
    check (fulfillment_type <> 'pickup' or
           (delivery_zone_id is null and delivery_fee_usd is null)),
  constraint orders_delivery_check
    check (fulfillment_type <> 'delivery' or delivery_zone_id is not null),
  -- At most two receipts in total: the original plus exactly one correction.
  constraint orders_receipt_attempts_check
    check (receipt_attempts between 0 and 2)
);

-- Dashboard queues, pending queue, admin WhatsApp lookup, zone joins, private
-- tracking lookups and the activity feed (design §7.1).
create index orders_status_created_at_idx on public.orders (status, created_at desc);
create index orders_pending_idx on public.orders (created_at desc) where status = 'pending';
create index orders_customer_phone_idx on public.orders (customer_phone);
create index orders_delivery_zone_id_idx on public.orders (delivery_zone_id);
create index orders_created_at_idx on public.orders (created_at desc);

create trigger orders_updated_at
  before update on public.orders
  for each row execute function private.set_updated_at();

-- Ordered lines with price/name snapshots so history survives catalog edits
-- (design §7.2, SPEC §4). No timestamps by design.
create table public.order_items (
  id              bigint generated always as identity primary key,
  order_id        bigint not null references public.orders (id) on delete cascade,
  product_id      bigint not null references public.products (id) on delete restrict,
  product_name    text not null,
  unit_price_usd  numeric(10,2) not null,
  quantity        integer not null,
  constraint order_items_unit_price_usd_check check (unit_price_usd >= 0),
  constraint order_items_quantity_check check (quantity > 0)
);

create index order_items_order_id_idx on public.order_items (order_id);
create index order_items_product_id_idx on public.order_items (product_id);

-- Per-batch holds for an online order (design §6.2, DECISIONS #18/#24).
-- Deadlines are materialised: initial (immutable) + optional bounded correction
-- window + the current operative deadline (NULL = held). Availability excludes
-- active rows whose deadline has lapsed (lazy expiry, no workers).
create table public.inventory_reservations (
  id                       bigint generated always as identity primary key,
  order_id                 bigint not null references public.orders (id) on delete cascade,
  batch_id                 bigint not null references public.inventory_batches (id) on delete restrict,
  quantity                 integer not null,
  status                   text not null default 'active',
  initial_expires_at       timestamptz not null,
  correction_window_ends_at timestamptz,
  expires_at               timestamptz,
  created_at               timestamptz not null default now(),
  closed_at                timestamptz,
  constraint inventory_reservations_quantity_check check (quantity > 0),
  constraint inventory_reservations_status_check
    check (status in ('active', 'consumed', 'released', 'expired')),
  -- SPEC §8 / DECISIONS #24: the initial deadline is exactly 20 minutes.
  constraint inventory_reservations_initial_expires_at_check
    check (initial_expires_at = created_at + interval '20 minutes'),
  -- Documented invariant (§6.2): the operative deadline is either NULL (held)
  -- or exactly the correction window when granted, else the initial deadline.
  constraint inventory_reservations_expires_at_check
    check (expires_at is null or
           expires_at = coalesce(correction_window_ends_at, initial_expires_at))
);

create index inventory_reservations_order_id_idx on public.inventory_reservations (order_id);
create index inventory_reservations_active_batch_idx
  on public.inventory_reservations (batch_id) where status = 'active';
create index inventory_reservations_expiry_idx
  on public.inventory_reservations (expires_at) where status = 'active';

-- Guest cancellation requests (design §9.1, SPEC §11): inserting one changes
-- nothing about the order, inventory or payments; administrators resolve later.
create table public.cancellation_requests (
  id              bigint generated always as identity primary key,
  order_id        bigint not null references public.orders (id) on delete cascade,
  status          text not null default 'pending',
  source          text not null,
  customer_reason text,
  resolution_note text,
  resolved_by     uuid references public.administrators (id) on delete restrict,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  constraint cancellation_requests_status_check check (status in ('pending', 'approved', 'rejected')),
  constraint cancellation_requests_source_check check (source in ('tracking', 'whatsapp', 'admin')),
  constraint cancellation_requests_pending_check check ((status = 'pending') = (resolved_at is null)),
  constraint cancellation_requests_resolved_check check (status = 'pending' or resolved_by is not null)
);

-- At most one open request per order (SPEC §16 duplicate protection).
create unique index cancellation_requests_order_pending_key
  on public.cancellation_requests (order_id) where status = 'pending';
create index cancellation_requests_pending_idx
  on public.cancellation_requests (created_at desc) where status = 'pending';
create index cancellation_requests_order_id_idx on public.cancellation_requests (order_id);
create index cancellation_requests_resolved_by_idx on public.cancellation_requests (resolved_by);

-- BCV rate history (design §10.1). No write path in M3: how rates are
-- fetched/stored is OQ-4 (Phase 4) — this table receives no seeds and no RPC.
create table public.exchange_rates (
  id                bigint generated always as identity primary key,
  rate_ves_per_usd  numeric(12,4) not null,
  observed_at       timestamptz not null,
  source            text,
  created_at        timestamptz not null default now(),
  constraint exchange_rates_rate_ves_per_usd_check check (rate_ves_per_usd > 0),
  constraint exchange_rates_observed_at_key unique (observed_at)
);

-- M3 addition to inventory_movements (design §6.3): links sale movements to
-- their order; FK arrives together with `orders`, as migration 002 announced.
alter table public.inventory_movements
  add column order_id bigint references public.orders (id) on delete set null;

create index inventory_movements_order_id_idx on public.inventory_movements (order_id);

-- 2. Row Level Security (enabled + forced) ------------------------------------

alter table public.orders                  enable row level security;
alter table public.orders                  force row level security;
alter table public.order_items             enable row level security;
alter table public.order_items             force row level security;
alter table public.inventory_reservations  enable row level security;
alter table public.inventory_reservations  force row level security;
alter table public.cancellation_requests   enable row level security;
alter table public.cancellation_requests   force row level security;
alter table public.exchange_rates          enable row level security;
alter table public.exchange_rates          force row level security;

-- 3. Policies (SECURITY_DESIGN §4.1/§4.2) --------------------------------------
-- No `TO anon` policy on orders/order_items/inventory_reservations/
-- cancellation_requests: guests reach orders exclusively through the
-- service-role tracking functions (§6), never through PostgREST. The one ALL
-- policy per table is the representative shape documented in §4.2.

create policy orders_admin_all on public.orders
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy order_items_admin_all on public.order_items
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy inventory_reservations_admin_all on public.inventory_reservations
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy cancellation_requests_admin_all on public.cancellation_requests
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- exchange_rates: public BCV data (§4.2 documents this read-only anon policy)
-- plus the standard admin ALL policy.
create policy exchange_rates_public_select on public.exchange_rates
  for select to anon using (true);

create policy exchange_rates_admin_all on public.exchange_rates
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- 4. Order and reservation RPCs ------------------------------------------------
-- All eight are SECURITY INVOKER with a pinned search_path and are granted to
-- `service_role` ONLY (SECURITY_DESIGN §5): they run inside Next.js server
-- code, never through PostgREST from a client. Money and availability are
-- always re-read from the database (SPEC §7/§16 — client prices are ignored).

-- Checkout: validates the guest input, recomputes every total from
-- `products`/`delivery_zones`, allocates FIFO batches under row locks and
-- writes order + items + reservations in ONE transaction. Returns
-- {order_id, tracking_token}: the plaintext token exists only in this
-- response; only sha256(token) is stored (SECURITY_DESIGN §6).
create or replace function public.create_online_order(
  p_customer_name text,
  p_customer_phone text,
  p_fulfillment_type text,
  p_delivery_zone_id bigint,
  p_address_line text,
  p_address_references text,
  p_additional_instructions text,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now       timestamptz := now();
  v_token     text;
  v_hash      text;
  v_order_id  bigint;
  v_fee       numeric(10,2);
  v_subtotal  numeric(10,2) := 0;
  v_total     numeric(10,2);
  v_pids      bigint[] := '{}';
  v_qty       integer[] := '{}';
  v_names     text[] := '{}';
  v_prices    numeric(10,2)[] := '{}';
  v_products  bigint[];
  v_batch_ids bigint[] := '{}';
  v_elem      jsonb;
  v_pid       numeric;
  v_q         numeric;
  v_name      text;
  v_price     numeric(10,2);
  v_requires_quote boolean := false;
  v_short_pid bigint;
  v_short_name text;
  v_short_need integer;
  v_short_alloc integer;
begin
  -- Guest input (SPEC §7): name/phone are required for an online order and
  -- the fulfillment method fixes the shape the CHECKs will also enforce.
  if p_customer_name is null or btrim(p_customer_name) = '' then
    raise exception 'create_online_order: customer name is required'
      using errcode = '22023';
  end if;
  if p_customer_phone is null or btrim(p_customer_phone) = '' then
    raise exception 'create_online_order: customer phone is required'
      using errcode = '22023';
  end if;
  if p_fulfillment_type is null or p_fulfillment_type not in ('delivery', 'pickup') then
    raise exception 'create_online_order: fulfillment type must be delivery or pickup'
      using errcode = '22023';
  end if;

  v_fee := null;
  if p_fulfillment_type = 'delivery' then
    if p_delivery_zone_id is null then
      raise exception 'create_online_order: delivery zone is required for delivery'
        using errcode = '22023';
    end if;
    select z.requires_quote, z.fee_usd
      into v_requires_quote, v_fee
    from public.delivery_zones z
    where z.id = p_delivery_zone_id and z.is_active;
    if not found then
      raise exception 'create_online_order: delivery zone % does not exist or is inactive', p_delivery_zone_id
        using errcode = 'P0002';
    end if;
    -- Manual-quote zones snapshot a NULL fee until the quote is confirmed
    -- (design §7.1, SPEC §6); the total then simply excludes the pending fee.
    if v_requires_quote then
      v_fee := null;
    end if;
  else
    if p_delivery_zone_id is not null then
      raise exception 'create_online_order: pickup orders must not carry a delivery zone'
        using errcode = '22023';
    end if;
  end if;

  -- Cart lines: {product_id, quantity}[] (DECISIONS #15). Every line is
  -- validated and priced from the database before anything is written.
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'create_online_order: at least one cart line is required'
      using errcode = '22023';
  end if;

  for v_elem in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_elem) <> 'object'
       or v_elem -> 'product_id' is null
       or jsonb_typeof(v_elem -> 'product_id') <> 'number'
       or v_elem -> 'quantity' is null
       or jsonb_typeof(v_elem -> 'quantity') <> 'number' then
      raise exception 'create_online_order: each cart line needs numeric product_id and quantity'
        using errcode = '22023';
    end if;

    v_pid := (v_elem ->> 'product_id')::numeric;
    v_q   := (v_elem ->> 'quantity')::numeric;
    if v_pid <> trunc(v_pid) or v_q <> trunc(v_q) or v_q < 1 then
      raise exception 'create_online_order: product_id must be an integer and quantity at least 1'
        using errcode = '22023';
    end if;

    select p.name, p.price_usd into v_name, v_price
    from public.products p
    where p.id = v_pid::bigint and p.is_active;
    if not found then
      raise exception 'create_online_order: product % does not exist or is inactive', v_pid::bigint
        using errcode = 'P0002';
    end if;

    v_pids   := array_append(v_pids, v_pid::bigint);
    v_qty    := array_append(v_qty, v_q::integer);
    v_names  := array_append(v_names, v_name);
    v_prices := array_append(v_prices, v_price);
    v_subtotal := v_subtotal + v_price * v_q;
  end loop;

  select array_agg(distinct t.pid) into v_products
  from unnest(v_pids) as t(pid);

  -- Lock every candidate batch of every ordered product in one statement,
  -- globally ordered by id (deadlock-free against other creators/consumers).
  -- Concurrent creators serialise here and then re-read committed
  -- reservations, so two checkouts can never both take the same units.
  select coalesce(array_agg(x.id), '{}') into v_batch_ids
  from (
    select b.id
    from public.inventory_batches b
    where b.product_id = any(v_products)
      and b.remaining_quantity > 0
    order by b.id
    for update of b
  ) x;

  -- FIFO allocation (oldest production_date first) against
  -- available(batch) = remaining - active&unlapsed reservations (§6.2).
  -- Shortage in any product aborts the whole transaction (P0001).
  with res as (
    select r.batch_id, sum(r.quantity)::integer as reserved
    from public.inventory_reservations r
    where r.batch_id = any(v_batch_ids)
      and r.status = 'active'
      and (r.expires_at is null or r.expires_at > now())
    group by r.batch_id
  ),
  avail as (
    select b.id as batch_id, b.product_id, b.production_date,
           greatest(b.remaining_quantity - coalesce(res.reserved, 0), 0) as free_qty
    from public.inventory_batches b
    left join res on res.batch_id = b.id
    where b.id = any(v_batch_ids)
  ),
  needs as (
    select t.pid as product_id, sum(t.qty)::integer as need
    from unnest(v_pids, v_qty) as t(pid, qty)
    group by t.pid
  ),
  running as (
    select a.batch_id, a.product_id, a.free_qty, n.need,
           sum(a.free_qty) over (
             partition by a.product_id
             order by a.production_date, a.batch_id
             rows between unbounded preceding and current row
           ) - a.free_qty as before_qty
    from avail a
    join needs n on n.product_id = a.product_id
  ),
  alloc as (
    select batch_id, product_id,
           least(greatest(need - before_qty, 0), free_qty) as take
    from running
  )
  select n.product_id, p.name, n.need, coalesce(sum(a.take), 0)
    into v_short_pid, v_short_name, v_short_need, v_short_alloc
  from needs n
  join public.products p on p.id = n.product_id
  left join alloc a on a.product_id = n.product_id
  group by n.product_id, p.name, n.need
  having coalesce(sum(a.take), 0) < n.need
  limit 1;

  if v_short_pid is not null then
    raise exception
      'create_online_order: insufficient available stock for product "%" (% requested, % available)',
      v_short_name, v_short_need, v_short_alloc
      using errcode = 'P0001';
  end if;

  -- Tracking token: 32 random bytes (256 bits) hex-encoded (URL-safe); only
  -- the SHA-256 digest is persisted (DECISIONS #17).
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash  := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');
  v_total := v_subtotal + coalesce(v_fee, 0);

  insert into public.orders (
    channel, status, tracking_token_hash, customer_name, customer_phone,
    fulfillment_type, delivery_zone_id, address_line, address_references,
    additional_instructions, delivery_fee_usd, subtotal_usd, total_usd,
    created_at, updated_at
  ) values (
    'online', 'pending', v_hash, btrim(p_customer_name), btrim(p_customer_phone),
    p_fulfillment_type, p_delivery_zone_id, p_address_line, p_address_references,
    p_additional_instructions, v_fee, v_subtotal, v_total, v_now, v_now
  ) returning id into v_order_id;

  -- Line snapshots: one row per submitted line, priced from the values just
  -- read (subtotal and items share the exact same source).
  insert into public.order_items (order_id, product_id, product_name, unit_price_usd, quantity)
  select v_order_id, pid, name, price, qty
  from unnest(v_pids, v_qty, v_names, v_prices) as line(pid, qty, name, price);

  -- Reservations: the 20-minute initial deadline is materialised immediately
  -- (SPEC §8 / DECISIONS #24). Manual-quote deliveries are the exception
  -- confirmed for M3 (OQ-13): they are created HELD (expires_at = NULL) so
  -- the inventory stays reserved for as long as the quote takes to confirm.
  -- When the countdown starts again after the quote is confirmed is the new
  -- open question for Phase 4 (OQ-17).
  insert into public.inventory_reservations (
    order_id, batch_id, quantity, status, initial_expires_at, expires_at, created_at
  )
  select v_order_id, a.batch_id, a.take, 'active', v_now + interval '20 minutes',
         case when v_requires_quote then null else v_now + interval '20 minutes' end,
         v_now
  from (
    with res as (
      select r.batch_id, sum(r.quantity)::integer as reserved
      from public.inventory_reservations r
      where r.batch_id = any(v_batch_ids)
        and r.status = 'active'
        and (r.expires_at is null or r.expires_at > now())
      group by r.batch_id
    ),
    avail as (
      select b.id as batch_id, b.product_id, b.production_date,
             greatest(b.remaining_quantity - coalesce(res.reserved, 0), 0) as free_qty
      from public.inventory_batches b
      left join res on res.batch_id = b.id
      where b.id = any(v_batch_ids)
    ),
    needs as (
      select t.pid as product_id, sum(t.qty)::integer as need
      from unnest(v_pids, v_qty) as t(pid, qty)
      group by t.pid
    ),
    running as (
      select a.batch_id, a.product_id, a.free_qty, n.need,
             sum(a.free_qty) over (
               partition by a.product_id
               order by a.production_date, a.batch_id
               rows between unbounded preceding and current row
             ) - a.free_qty as before_qty
      from avail a
      join needs n on n.product_id = a.product_id
    )
    select batch_id, least(greatest(need - before_qty, 0), free_qty) as take
    from running
  ) a
  where a.take > 0;

  return jsonb_build_object('order_id', v_order_id, 'tracking_token', v_token);
end;
$$;

-- Receipt submitted (Phase 4 will call this): counts the receipt attempt and
-- suspends the operative deadline of every active reservation of the order
-- (OQ-15, confirmed — the customer has acted, the clock must not run during
-- review). Two receipts TOTAL (original + one correction): receipt_attempts
-- goes 0 -> 1 -> 2; a third submission is rejected with P0001 before anything
-- is written (backstopped by orders_receipt_attempts_check). Quote-pending
-- orders arrive already held, so their first submission is still counted
-- (0 -> 1). Idempotent: repeating the call while the reservations are already
-- held is a safe no-op that consumes no attempt.
create or replace function public.hold_order_reservations(p_order_id bigint)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_active   integer;
  v_unheld   integer;
  v_attempts integer;
  v_counted  integer;
begin
  if p_order_id is null then
    raise exception 'hold_order_reservations: order id is required'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'hold_order_reservations: order % does not exist', p_order_id
      using errcode = 'P0002';
  end if;

  -- Lock the active rows FIRST (lock order everywhere: reservations -> orders)
  -- so a concurrent consume/release/rejection on the same order cannot
  -- interleave, then read the attempt counter under those locks.
  select count(*), count(*) filter (where x.expires_at is not null)
    into v_active, v_unheld
  from (
    select r.expires_at from public.inventory_reservations r
    where r.order_id = p_order_id and r.status = 'active'
    for update
  ) x;

  if v_active = 0 then
    raise exception 'hold_order_reservations: order % has no active reservations to hold', p_order_id
      using errcode = 'P0001';
  end if;

  select o.receipt_attempts into v_attempts
  from public.orders o
  where o.id = p_order_id;

  -- A NEW submission = the deadline is still running (unheld rows), or no
  -- attempt was ever counted (quote-pending rows are held from creation).
  -- When every row is already held this is a repeat of the submission that is
  -- already under review: idempotent no-op, no attempt consumed.
  if v_unheld > 0 or v_attempts = 0 then
    -- Atomic increment guarded by the two-receipt cap: the WHERE clause and the
    -- counter move in one statement, so a third submission can never land (the
    -- row count is 0 -> P0001, transaction aborts, nothing was held).
    update public.orders o
       set receipt_attempts = o.receipt_attempts + 1
     where o.id = p_order_id
       and o.receipt_attempts < 2;
    get diagnostics v_counted = row_count;
    if v_counted = 0 then
      raise exception 'hold_order_reservations: order % has already used its two receipt attempts', p_order_id
        using errcode = 'P0001';
    end if;
  end if;

  update public.inventory_reservations r
     set expires_at = null
   where r.order_id = p_order_id and r.status = 'active' and r.expires_at is not null;

  return v_active;
end;
$$;

-- Receipt rejected (Phase 4 will call this): implements the confirmed
-- two-receipt rule (OQ-14).
--   * First rejection (receipt_attempts = 1): opens the ONE bounded 20-minute
--     correction window — expires_at = correction_window_ends_at, written at
--     most ONCE: repeated rejections re-use the recorded deadline, never
--     extend it, and never add attempts. Inventory is NOT released: the
--     reservations stay active and still counted as reserved.
--   * Second rejection (receipt_attempts = 2): no third receipt exists, so the
--     order is canceled automatically (status 'canceled') and every active
--     reservation is released ('released' + closed_at) in the same
--     transaction — availability restored exactly once, physical stock never
--     touched, no movement written.
-- Rejecting an order that never submitted a receipt (receipt_attempts = 0) is
-- a state violation (P0001). Idempotent: repeating the call after the
-- automatic cancel returns 0; repeating it inside the window changes nothing.
create or replace function public.open_order_correction_window(p_order_id bigint)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_active   integer;
  v_attempts integer;
  v_status   text;
begin
  if p_order_id is null then
    raise exception 'open_order_correction_window: order id is required'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'open_order_correction_window: order % does not exist', p_order_id
      using errcode = 'P0002';
  end if;

  -- Lock order everywhere: reservations -> orders. The FOR UPDATE serialises
  -- parallel rejections/submissions on this order, so the automatic cancel
  -- below can never fire twice nor race a submission.
  select count(*) into v_active
  from (
    select 1 from public.inventory_reservations r
    where r.order_id = p_order_id and r.status = 'active'
    for update
  ) locked;

  select o.status, o.receipt_attempts into v_status, v_attempts
  from public.orders o
  where o.id = p_order_id;

  if v_active = 0 then
    if v_status = 'canceled' then
      return 0; -- repeat of the automatic second-rejection cancel (SPEC §8)
    end if;
    raise exception 'open_order_correction_window: order % has no active reservations', p_order_id
      using errcode = 'P0001';
  end if;

  if v_attempts is null or v_attempts = 0 then
    raise exception 'open_order_correction_window: order % has no submitted receipt to reject', p_order_id
      using errcode = 'P0001';
  end if;

  if v_attempts >= 2 then
    -- Final rejection: cancel the order and release everything, atomically.
    -- No inventory movement and no remaining_quantity change — rejection only
    -- returns availability (design §6.2); DECISIONS #23 keeps the status
    -- transition explicit here rather than trigger-driven.
    update public.orders o
       set status = 'canceled'
     where o.id = p_order_id
       and o.status <> 'canceled';

    update public.inventory_reservations r
       set status = 'released', closed_at = now()
     where r.order_id = p_order_id and r.status = 'active';
    get diagnostics v_active = row_count;
    return v_active;
  end if;

  -- First rejection: single UPDATE — all SET expressions read the OLD row, so
  -- both columns get the same value — the existing window when already granted
  -- (never extended), otherwise now() + 20 minutes (the one correction window).
  update public.inventory_reservations r
     set correction_window_ends_at =
           coalesce(r.correction_window_ends_at, now() + interval '20 minutes'),
         expires_at =
           coalesce(r.correction_window_ends_at, now() + interval '20 minutes')
   where r.order_id = p_order_id and r.status = 'active';

  get diagnostics v_active = row_count;
  return v_active;
end;
$$;

-- Lazy expiry cleanup (DECISIONS #18): flips active reservations past their
-- operative deadline to 'expired' + closed_at, then expires the pending order
-- whose reservations are all gone. Availability already excluded lapsed rows
-- before this runs; physical stock is never touched (no movement, no
-- remaining_quantity change). Idempotent: a second call returns 0.
create or replace function public.release_expired_reservations()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.inventory_reservations r
     set status = 'expired', closed_at = now()
   where r.status = 'active'
     and r.expires_at is not null
     and r.expires_at <= now();

  get diagnostics v_count = row_count;

  -- Design §6.2/§7.1: pending -> expired fires when the order's reservation
  -- deadline lapsed (no held/approved payment keeps it alive). Only orders
  -- whose reservations are ALL expired qualify — a canceled/consumed order is
  -- never touched here (order state machines stay in server code, #23).
  update public.orders o
     set status = 'expired'
   where o.status = 'pending'
     and exists (
       select 1 from public.inventory_reservations r
       where r.order_id = o.id and r.status = 'expired'
     )
     and not exists (
       select 1 from public.inventory_reservations r
       where r.order_id = o.id and r.status <> 'expired'
     );

  return v_count;
end;
$$;

-- Completion (server code calls this when an order is completed): converts the
-- order's active reservations into `sale` movements and decrements physical
-- stock — the only path where remaining_quantity falls because of a sale.
-- admin_id is NULL (system-initiated, design §6.3 / OQ-9). Idempotent:
-- repeating the call finds no active reservations and returns 0 without a
-- second deduction.
create or replace function public.consume_order_reservations(p_order_id bigint)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_active integer;
  v_consumed integer := 0;
  v_has_consumed boolean;
  v_row record;
begin
  if p_order_id is null then
    raise exception 'consume_order_reservations: order id is required'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'consume_order_reservations: order % does not exist', p_order_id
      using errcode = 'P0002';
  end if;

  -- Lock this order's active reservations (blocks a concurrent consume of the
  -- same order; the batch rows are then locked in global id order below).
  select count(*) into v_active
  from (
    select 1 from public.inventory_reservations r
    where r.order_id = p_order_id and r.status = 'active'
    for update
  ) locked;

  if v_active = 0 then
    select exists (
      select 1 from public.inventory_reservations r
      where r.order_id = p_order_id and r.status = 'consumed'
    ) into v_has_consumed;
    if v_has_consumed then
      return 0; -- already consumed: idempotent repeat (SPEC §8)
    end if;
    raise exception 'consume_order_reservations: order % has no active reservations to consume', p_order_id
      using errcode = 'P0001';
  end if;

  -- Lock the touched batches in global id order (same convention as checkout:
  -- deadlock-free against creators, consumers and single-row adjusters).
  perform 1
  from (
    select b.id
    from public.inventory_batches b
    join public.inventory_reservations r on r.batch_id = b.id
    where r.order_id = p_order_id and r.status = 'active'
    order by b.id
    for update of b
  ) locked;

  for v_row in
    select r.id, r.batch_id, r.quantity
    from public.inventory_reservations r
    where r.order_id = p_order_id and r.status = 'active'
  loop
    update public.inventory_batches b
       set remaining_quantity = remaining_quantity - v_row.quantity
     where b.id = v_row.batch_id;

    insert into public.inventory_movements (batch_id, type, quantity, reason, admin_id, order_id)
    values (v_row.batch_id, 'sale', -v_row.quantity, null, null, p_order_id);

    update public.inventory_reservations c
       set status = 'consumed', closed_at = now()
     where c.id = v_row.id;

    v_consumed := v_consumed + 1;
  end loop;

  return v_consumed;
end;
$$;

-- Authorized cancellation (server code calls this after an administrator
-- approves — SPEC §11: nothing is released until the operation is authorized).
-- Releases the order's active reservations: units become available again
-- immediately (availability only — physical stock never moves on release).
-- Idempotent: repeating a completed release returns 0.
create or replace function public.release_order_reservations(p_order_id bigint)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_active integer;
  v_released integer;
  v_has_released boolean;
begin
  if p_order_id is null then
    raise exception 'release_order_reservations: order id is required'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'release_order_reservations: order % does not exist', p_order_id
      using errcode = 'P0002';
  end if;

  select count(*) into v_active
  from (
    select 1 from public.inventory_reservations r
    where r.order_id = p_order_id and r.status = 'active'
    for update
  ) locked;

  if v_active = 0 then
    select exists (
      select 1 from public.inventory_reservations r
      where r.order_id = p_order_id and r.status = 'released'
    ) into v_has_released;
    if v_has_released then
      return 0; -- already released: idempotent repeat (SPEC §8)
    end if;
    raise exception 'release_order_reservations: order % has no active reservations to release', p_order_id
      using errcode = 'P0001';
  end if;

  update public.inventory_reservations r
     set status = 'released', closed_at = now()
   where r.order_id = p_order_id and r.status = 'active';

  get diagnostics v_released = row_count;
  return v_released;
end;
$$;

-- Private tracking lookup (SECURITY_DESIGN §6): hashes the presented token
-- and matches the stored digest — a leaked dump yields no working link. The
-- result is a PII-free projection (no name, phone, address, instructions or
-- token hash), so a forwarded link exposes no customer information. Returns
-- NULL when the token matches nothing. Service role only; there is no
-- anonymous RPC surface.
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

-- The only guest write in the system (DECISIONS #17, SPEC §11): inserts a
-- PENDING cancellation request without touching the order, inventory or
-- payments — administrators resolve it later. At most one pending request per
-- order (partial unique index); duplicates are reported as 23505.
create or replace function public.request_order_cancellation(
  p_token text,
  p_reason text
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order_id bigint;
  v_id bigint;
begin
  if p_token is null or btrim(p_token) = '' then
    raise exception 'request_order_cancellation: tracking token is required'
      using errcode = '22023';
  end if;

  select o.id into v_order_id
  from public.orders o
  where o.tracking_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');

  if v_order_id is null then
    raise exception 'request_order_cancellation: no order matches the tracking token'
      using errcode = 'P0002';
  end if;

  begin
    insert into public.cancellation_requests (order_id, status, source, customer_reason)
    values (v_order_id, 'pending', 'tracking', nullif(btrim(p_reason), ''))
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'request_order_cancellation: a cancellation request is already pending for this order'
        using errcode = '23505';
  end;

  return v_id;
end;
$$;

-- M3 replacement of the migration-002 read path (design §11: "reserved = 0
-- until M3 introduces reservations"): available now subtracts the order's
-- active, unexpired reservations (held rows count, lapsed ones never do —
-- §6.2 availability rule). Signature and audience are unchanged (service role
-- only), so the existing grants still apply after CREATE OR REPLACE.
create or replace function public.get_product_stock(p_product_id bigint)
returns table (
  product_id          bigint,
  remaining_quantity  integer,
  available_quantity  integer,
  reserved_quantity   integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p_product_id,
         coalesce(sum(b.remaining_quantity), 0)::integer,
         coalesce(sum(b.remaining_quantity), 0)::integer - coalesce(max(res.reserved_qty), 0),
         coalesce(max(res.reserved_qty), 0)
  from public.inventory_batches b
  cross join (
    select coalesce(sum(r.quantity), 0)::integer as reserved_qty
    from public.inventory_reservations r
    join public.inventory_batches bb on bb.id = r.batch_id
    where bb.product_id = p_product_id
      and r.status = 'active'
      and (r.expires_at is null or r.expires_at > now())
  ) res
  where b.product_id = p_product_id;
$$;

-- 5. EXECUTE grants (SECURITY_DESIGN §5) ---------------------------------------
-- Every M3 function is server-side only: revoke the default PUBLIC grant and
-- grant `service_role` alone. Clients have no RPC surface to these operations.

revoke execute on function public.create_online_order(text, text, text, bigint, text, text, text, jsonb)
  from public, anon, authenticated;
grant  execute on function public.create_online_order(text, text, text, bigint, text, text, text, jsonb)
  to service_role;

revoke execute on function public.hold_order_reservations(bigint)
  from public, anon, authenticated;
grant  execute on function public.hold_order_reservations(bigint)
  to service_role;

revoke execute on function public.open_order_correction_window(bigint)
  from public, anon, authenticated;
grant  execute on function public.open_order_correction_window(bigint)
  to service_role;

revoke execute on function public.release_expired_reservations()
  from public, anon, authenticated;
grant  execute on function public.release_expired_reservations()
  to service_role;

revoke execute on function public.consume_order_reservations(bigint)
  from public, anon, authenticated;
grant  execute on function public.consume_order_reservations(bigint)
  to service_role;

revoke execute on function public.release_order_reservations(bigint)
  from public, anon, authenticated;
grant  execute on function public.release_order_reservations(bigint)
  to service_role;

revoke execute on function public.get_order_for_tracking(text)
  from public, anon, authenticated;
grant  execute on function public.get_order_for_tracking(text)
  to service_role;

revoke execute on function public.request_order_cancellation(text, text)
  from public, anon, authenticated;
grant  execute on function public.request_order_cancellation(text, text)
  to service_role;

-- No seeds: orders and reservations are runtime data, exchange_rates keeps its
-- write path for Phase 4 (OQ-4), and no product/admin/payment data is
-- invented here.
