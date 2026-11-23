-- 012_delivery_quote_post_acceptance_guard.sql
--
-- OQ-17 hardening: once a customer accepts a delivery quote, admins must not
-- change the quoted fee or resulting totals without an explicit re-acceptance
-- workflow (not implemented in this phase). This forward migration replaces
-- admin_set_delivery_quote with a post-acceptance guard.
--
-- Behavior:
--   * Locks the order row (FOR UPDATE) before inspecting quote_accepted_at.
--   * If quote_accepted_at IS NOT NULL and the requested fee produces different
--     fee/totals, raises an exception. No state, audit, or reservation changes.
--   * If quote_accepted_at IS NOT NULL and the request is an exact identical
--     retry (same fee and same resulting total), returns idempotent=true with no
--     writes.
--   * Preserves existing service_role-only EXECUTE, admin verification,
--     BCV snapshot rewrite guard, audit attribution, and reservation behavior.

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

  -- OQ-17: accepted quotes are immutable. Lock above serializes with acceptance.
  if v_order.quote_accepted_at is not null then
    if v_old_fee is not distinct from v_fee and v_old_total is not distinct from v_total_usd then
      return jsonb_build_object(
        'order_id', p_order_id,
        'delivery_fee_usd', v_fee,
        'total_usd', v_total_usd,
        'total_ves', v_order.total_ves,
        'idempotent', true
      );
    end if;
    raise exception 'admin_set_delivery_quote: cannot change quote after customer acceptance'
      using errcode = 'P0001';
  end if;

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

revoke execute on function public.admin_set_delivery_quote(bigint, numeric, uuid) from public, anon, authenticated;
grant  execute on function public.admin_set_delivery_quote(bigint, numeric, uuid) to service_role;
