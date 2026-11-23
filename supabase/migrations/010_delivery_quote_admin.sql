-- 010_delivery_quote_admin.sql
--
-- Admin-set manual delivery quote for requires_quote zones.
-- Additive follow-up to 001-009; does not rewrite prior migrations.
--
-- Scope:
--   * Allow admins to set delivery_fee_usd on pending online delivery orders
--     whose zone requires_quote. Server recalculates total_usd = subtotal + fee.
--   * If a BCV snapshot exists, recalculate total_ves from the immutable rate
--     using the same round_half_up-once rule (OQ-5). bcv_rate_ves/bcv_rate_at/
--     rounding_rule remain unchanged.
--   * BCV snapshot fields are immutable after first write (007 trigger). This
--     migration replaces that trigger function to allow a controlled rewrite of
--     total_ves ONLY when the caller sets app.allow_bcv_snapshot_rewrite = 'on'
--     in the same transaction and only total_ves changes (rate/at/rule unchanged).
--   * Confirmation remains blocked by application/server checks until quote set.
--   * Inventory reservations remain held (expires_at NULL) while quote pending;
--     this RPC does not touch reservations.
--   * get_order_for_tracking is extended to expose delivery zone requires_quote
--     and whether a quote has been set, without PII.

-- 1. Controlled BCV total_ves rewrite path ------------------------------------
create or replace function private.enforce_bcv_snapshot_immutability()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_allow text;
begin
  if old.bcv_rate_ves is not null and (
       new.bcv_rate_ves is distinct from old.bcv_rate_ves
    or new.bcv_rate_at is distinct from old.bcv_rate_at
    or new.total_ves is distinct from old.total_ves
    or new.rounding_rule is distinct from old.rounding_rule
  ) then
    v_allow := current_setting('app.allow_bcv_snapshot_rewrite', true);
    if v_allow = 'on'
       and new.bcv_rate_ves is not distinct from old.bcv_rate_ves
       and new.bcv_rate_at is not distinct from old.bcv_rate_at
       and new.rounding_rule is not distinct from old.rounding_rule
       and new.total_ves is distinct from old.total_ves
       and new.total_ves is not null
       and new.total_ves = pg_catalog.round(new.total_usd * old.bcv_rate_ves, 2)
    then
      return new;
    end if;
    raise exception 'BCV snapshot is immutable and cannot be overwritten'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- 2. Admin quote setter -------------------------------------------------------
create or replace function public.admin_set_delivery_quote(
  p_order_id bigint,
  p_delivery_fee_usd numeric,
  p_admin_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_order public.orders;
  v_zone_requires_quote boolean;
  v_fee numeric(10,2);
  v_total_usd numeric(10,2);
  v_total_ves numeric(14,2);
  v_old_fee numeric(10,2);
  v_old_total numeric(10,2);
begin
  perform private.require_active_admin(p_admin_id);

  if p_order_id is null then
    raise exception 'admin_set_delivery_quote: order id is required' using errcode = '22023';
  end if;
  if p_delivery_fee_usd is null or p_delivery_fee_usd < 0 then
    raise exception 'admin_set_delivery_quote: delivery fee must be zero or positive'
      using errcode = '22023';
  end if;
  if p_delivery_fee_usd <> pg_catalog.round(p_delivery_fee_usd, 2) then
    raise exception 'admin_set_delivery_quote: delivery fee must have at most two decimals'
      using errcode = '22023';
  end if;

  v_fee := pg_catalog.round(p_delivery_fee_usd, 2);

  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;
  if not found then
    raise exception 'admin_set_delivery_quote: order % does not exist', p_order_id
      using errcode = 'P0002';
  end if;

  if v_order.status <> 'pending' then
    raise exception 'admin_set_delivery_quote: only pending orders can receive a delivery quote'
      using errcode = 'P0001';
  end if;
  if v_order.channel <> 'online' or v_order.fulfillment_type <> 'delivery' or v_order.delivery_zone_id is null then
    raise exception 'admin_set_delivery_quote: order % is not an online delivery order', p_order_id
      using errcode = 'P0001';
  end if;

  select z.requires_quote into v_zone_requires_quote
  from public.delivery_zones z
  where z.id = v_order.delivery_zone_id;
  if not coalesce(v_zone_requires_quote, false) then
    raise exception 'admin_set_delivery_quote: delivery zone does not require a manual quote'
      using errcode = 'P0001';
  end if;

  if v_order.receipt_attempts <> 0 then
    raise exception 'admin_set_delivery_quote: cannot change quote after receipt submission'
      using errcode = 'P0001';
  end if;

  v_old_fee := v_order.delivery_fee_usd;
  v_old_total := v_order.total_usd;
  v_total_usd := pg_catalog.round(v_order.subtotal_usd + v_fee, 2);

  if v_order.bcv_rate_ves is not null then
    perform set_config('app.allow_bcv_snapshot_rewrite', 'on', true);
    v_total_ves := pg_catalog.round(v_total_usd * v_order.bcv_rate_ves, 2);
    update public.orders o
       set delivery_fee_usd = v_fee,
           total_usd = v_total_usd,
           total_ves = v_total_ves,
           updated_at = now()
     where o.id = p_order_id;
  else
    update public.orders o
       set delivery_fee_usd = v_fee,
           total_usd = v_total_usd,
           updated_at = now()
     where o.id = p_order_id;
  end if;

  insert into public.audit_log (admin_id, action, entity_type, entity_id, data)
  values (
    p_admin_id,
    'order.set_delivery_quote',
    'order',
    p_order_id::text,
    jsonb_build_object(
      'previous_delivery_fee_usd', v_old_fee,
      'delivery_fee_usd', v_fee,
      'previous_total_usd', v_old_total,
      'total_usd', v_total_usd,
      'total_ves', coalesce(v_total_ves, v_order.total_ves)
    )
  );

  return jsonb_build_object(
    'order_id', p_order_id,
    'delivery_fee_usd', v_fee,
    'total_usd', v_total_usd,
    'total_ves', coalesce(v_total_ves, v_order.total_ves),
    'idempotent', (v_old_fee is not distinct from v_fee and v_old_total is not distinct from v_total_usd)
  );
end;
$$;

-- 3. Tracking projection extension --------------------------------------------
-- Add delivery zone requires_quote flag and quote-set state; no PII.
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
        where r.order_id = o.id and r.status = 'active'
          and r.expires_at is null
          and r.correction_window_ends_at is null
          and r.quote_acceptance_expires_at is null
      ),
    'delivery_requires_quote',
      exists (
        select 1 from public.delivery_zones z
        where z.id = o.delivery_zone_id and z.requires_quote
      ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_name', i.product_name,
        'unit_price_usd', i.unit_price_usd,
        'quantity', i.quantity
      ) order by i.id)
      from public.order_items i
      where i.order_id = o.id
    ), '[]'::jsonb),
    'cancellation_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'status', c.status,
        'created_at', c.created_at,
        'resolved_at', c.resolved_at
      ) order by c.created_at desc)
      from public.cancellation_requests c
      where c.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  where o.tracking_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

-- 4. Grants -------------------------------------------------------------------
revoke execute on function public.admin_set_delivery_quote(bigint, numeric, uuid) from public, anon, authenticated;
grant  execute on function public.admin_set_delivery_quote(bigint, numeric, uuid) to service_role;

-- get_order_for_tracking keeps same service_role-only grant as 003/004.
revoke execute on function public.get_order_for_tracking(text) from public, anon, authenticated;
grant  execute on function public.get_order_for_tracking(text) to service_role;
