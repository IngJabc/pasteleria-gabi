-- M2 — Inventory foundation (Phase 2)
--
-- Implements, without deviation:
--   * docs/DATABASE_DESIGN.md  §6.1 (inventory_batches), §6.3 (inventory_movements),
--     §10.2 (audit actions), §11 (adjust_inventory, get_product_stock)
--   * docs/SECURITY_DESIGN.md  §4.1/§4.2 (RLS matrix + append-only policies),
--     §5 (EXECUTE grants)
--   * docs/DECISIONS.md        #18 (batches + movements), #21 (append-only at
--     policy level), #24 (reservation timings — documented, NOT implemented here)
--
-- Scope (M2 only — no M3 leakage):
--   * Physical stock batches + append-only movements + atomic admin RPCs.
--   * `inventory_reservations`, `orders`, checkout and sale movements belong to
--     M3: the `inventory_movements.order_id` column, its FK and its index are
--     intentionally absent and will be added together with `orders`.
--   * Reservation timing (20-minute initial window, 15-minute correction
--     window) is a Phase 3/4 concern — no timing logic exists in this file.
--     The 24-hour figure is a dashboard SLA, never a reservation duration
--     (DECISIONS #24).
--
-- Open question honored, not resolved (TASKS OQ-9): `inventory_movements.admin_id`
-- is nullable per DESIGN §6.3, but every movement created by M2 is a recorded
-- administrator action, so `admin_id` is always written here. The
-- "null = system-initiated" semantics are not relied upon or confirmed yet.
--
-- Invariant (DESIGN §6.1): `remaining_quantity` is maintained only by the RPCs
-- below, each paired with a matching `inventory_movements` row (signed sum per
-- batch = remaining). CHECK constraints backstop the value ranges; the
-- movement-sum pairing is enforced by the code path, as the design specifies
-- (a constraint trigger remains an explicit later option).
--
-- Status: NOT applied to any remote Supabase project — validated locally only.
-- RLS is the row-level boundary (SECURITY_DESIGN §2); Supabase default table
-- grants are left in place by design.

-- 1. Tables -------------------------------------------------------------------

-- Physical lots of ready-made portions (SPEC §8): FIFO reads oldest-first
-- (production_date, then id). production_date is administrative only and is
-- never served to the storefront (stock goes through get_product_stock).
create table public.inventory_batches (
  id                 bigint generated always as identity primary key,
  product_id         bigint not null references public.products (id) on delete restrict,
  initial_quantity   integer not null,
  remaining_quantity integer not null,
  production_date    date not null,
  created_by         uuid not null references public.administrators (id) on delete restrict,
  created_at         timestamptz not null default now(),
  constraint inventory_batches_initial_quantity_check check (initial_quantity > 0),
  constraint inventory_batches_remaining_quantity_check
    check (remaining_quantity >= 0 and remaining_quantity <= initial_quantity)
);

-- FIFO scan order and the batch-lookup join (leading product_id).
create index inventory_batches_product_fifo_idx
  on public.inventory_batches (product_id, production_date, id);

-- Fast "is there anything sellable for this product" probe.
create index inventory_batches_available_idx
  on public.inventory_batches (product_id, id)
  where remaining_quantity > 0;

-- Append-only history of every stock change (SPEC §8): entries (positive,
-- new batches), sales (negative, M3) and signed adjustments with a mandatory
-- reason. `order_id` (M3) is deliberately not present yet.
create table public.inventory_movements (
  id         bigint generated always as identity primary key,
  batch_id   bigint not null references public.inventory_batches (id) on delete restrict,
  type       text not null,
  quantity   integer not null,
  reason     text,
  admin_id   uuid references public.administrators (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_movements_type_check
    check (type in ('entry', 'sale', 'adjustment')),
  constraint inventory_movements_quantity_check check (quantity <> 0),
  constraint inventory_movements_entry_quantity_check check (type <> 'entry' or quantity > 0),
  constraint inventory_movements_adjustment_reason_check
    check (type <> 'adjustment' or reason is not null)
);

create index inventory_movements_batch_id_idx on public.inventory_movements (batch_id);
create index inventory_movements_created_at_idx on public.inventory_movements (created_at desc);
-- inventory_movements_order_id_idx arrives in M3 with the order_id FK.

-- 2. Row Level Security (enabled + forced) ------------------------------------

alter table public.inventory_batches  enable row level security;
alter table public.inventory_batches  force row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_movements force row level security;

-- 3. Policies (SECURITY_DESIGN §4.1/§4.2) --------------------------------------
-- No `TO anon` policy on either table: public stock is served exclusively by
-- get_product_stock (service role, §5). Movements are append-only for every
-- client role (DECISIONS #21): SELECT + INSERT, never UPDATE/DELETE.

create policy inventory_batches_admin_all on public.inventory_batches
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy inventory_movements_select on public.inventory_movements
  for select to authenticated
  using ((select private.is_admin()));

create policy inventory_movements_insert on public.inventory_movements
  for insert to authenticated
  with check ((select private.is_admin()));

-- 4. Atomic inventory RPCs ------------------------------------------------------
-- All three are SECURITY INVOKER: they run with the caller's privileges, so
-- the RLS policies above apply to every row they touch, and the explicit
-- internal is_admin() gate (SECURITY_DESIGN §5) rejects non-administrators
-- with a clear error before any write is attempted. search_path is pinned.

-- Entry path: registers a freshly baked batch together with its `entry`
-- movement and the audit record, in one transaction (atomic — either all three
-- rows exist or none do). Replenishment is simply another batch for the same
-- product; FIFO order comes from (production_date, id).
create or replace function public.create_inventory_batch(
  p_product_id bigint,
  p_initial_quantity integer,
  p_production_date date default current_date
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch_id bigint;
begin
  if not (select private.is_admin()) then
    raise exception 'create_inventory_batch: administrator required'
      using errcode = '42501';
  end if;

  if p_product_id is null then
    raise exception 'create_inventory_batch: product id is required'
      using errcode = '22023';
  end if;

  if p_initial_quantity is null or p_initial_quantity <= 0 then
    raise exception 'create_inventory_batch: initial_quantity must be greater than zero'
      using errcode = '22023';
  end if;

  if p_production_date is null then
    raise exception 'create_inventory_batch: production_date is required'
      using errcode = '22023';
  end if;

  insert into public.inventory_batches
    (product_id, initial_quantity, remaining_quantity, production_date, created_by)
  values
    (p_product_id, p_initial_quantity, p_initial_quantity, p_production_date,
     (select auth.uid()))
  returning id into v_batch_id;

  insert into public.inventory_movements (batch_id, type, quantity, reason, admin_id)
  values (v_batch_id, 'entry', p_initial_quantity, null, (select auth.uid()));

  insert into public.audit_log (admin_id, action, entity_type, entity_id, data)
  values (
    (select auth.uid()),
    'inventory.batch_create',
    'inventory_batch',
    v_batch_id::text,
    jsonb_build_object(
      'product_id', p_product_id,
      'initial_quantity', p_initial_quantity,
      'production_date', p_production_date
    )
  );

  return v_batch_id;
end;
$$;

-- Adjustment path: a signed correction on an existing batch (negative for
-- damage/internal consumption/losses, positive for recounts — SPEC §8). The
-- batch row is locked FOR UPDATE first, so concurrent callers serialise and
-- each one re-reads the committed quantity: two simultaneous reductions can
-- never both succeed against the same units, and remaining_quantity can never
-- leave [0, initial_quantity]. The movement row and the audit record are
-- written in the same transaction. Returns the new remaining_quantity.
create or replace function public.adjust_inventory(
  p_batch_id bigint,
  p_quantity integer,
  p_reason text
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_initial   integer;
  v_remaining integer;
  v_new       integer;
begin
  if not (select private.is_admin()) then
    raise exception 'adjust_inventory: administrator required'
      using errcode = '42501';
  end if;

  if p_batch_id is null then
    raise exception 'adjust_inventory: batch id is required'
      using errcode = '22023';
  end if;

  if p_quantity is null or p_quantity = 0 then
    raise exception 'adjust_inventory: quantity must be a non-zero signed integer'
      using errcode = '22023';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'adjust_inventory: a reason is required for every adjustment'
      using errcode = '22023';
  end if;

  select b.initial_quantity, b.remaining_quantity
    into v_initial, v_remaining
  from public.inventory_batches b
  where b.id = p_batch_id
  for update; -- serialises concurrent adjustments on the same batch

  if not found then
    raise exception 'adjust_inventory: inventory batch % does not exist', p_batch_id
      using errcode = 'P0002';
  end if;

  v_new := v_remaining + p_quantity;

  if v_new < 0 then
    raise exception
      'adjust_inventory: insufficient stock on batch % (% remaining, % requested)',
      p_batch_id, v_remaining, p_quantity
      using errcode = 'P0001';
  end if;

  if v_new > v_initial then
    raise exception
      'adjust_inventory: result would exceed the initial quantity of batch %',
      p_batch_id
      using errcode = 'P0001';
  end if;

  update public.inventory_batches
  set remaining_quantity = v_new
  where id = p_batch_id;

  insert into public.inventory_movements (batch_id, type, quantity, reason, admin_id)
  values (p_batch_id, 'adjustment', p_quantity, p_reason, (select auth.uid()));

  insert into public.audit_log (admin_id, action, entity_type, entity_id, data)
  values (
    (select auth.uid()),
    'inventory.adjust',
    'inventory_batch',
    p_batch_id::text,
    jsonb_build_object(
      'quantity', p_quantity,
      'reason', p_reason,
      'remaining_before', v_remaining,
      'remaining_after', v_new
    )
  );

  return v_new;
end;
$$;

-- Read path: the only way stock reaches the storefront — aggregates keep
-- production_date (administrative only) away from the public entirely
-- (SPEC §8, DESIGN §11). Service role only (SECURITY_DESIGN §5): PostgREST
-- callers with anon/authenticated get "permission denied". `available` equals
-- `remaining` and `reserved` is 0 until M3 introduces inventory_reservations,
-- at which point this function is replaced to subtract active reservations.
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
         coalesce(sum(b.remaining_quantity), 0)::integer,
         0::integer
  from public.inventory_batches b
  where b.product_id = p_product_id;
$$;

-- 5. EXECUTE grants (SECURITY_DESIGN §5) ---------------------------------------
-- Revoke from `public` first so no role keeps the default PUBLIC grant.

revoke execute on function public.create_inventory_batch(bigint, integer, date)
  from public, anon, service_role;
grant  execute on function public.create_inventory_batch(bigint, integer, date)
  to authenticated;

revoke execute on function public.adjust_inventory(bigint, integer, text)
  from public, anon, service_role;
grant  execute on function public.adjust_inventory(bigint, integer, text)
  to authenticated;

revoke execute on function public.get_product_stock(bigint)
  from public, anon, authenticated;
grant  execute on function public.get_product_stock(bigint)
  to service_role;

-- No seeds: batches and movements are runtime data created by administrators
-- through the RPCs above (no confirmed inventory exists yet).
