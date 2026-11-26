-- P6 follow-up — move `new_order` administrator notifications from order draft
-- creation to checkout formalization.
--
-- Migration 016 emitted `new_order` from the AFTER INSERT trigger on
-- public.orders, which fires when DeliveryForm creates the draft at
-- /checkout/entrega. The confirmed business rule is that the order is only
-- formalized when the customer confirms it at /checkout/pago:
--   * Digital payment: `submit_payment_evidence()` links a receipt submission's
--     NULL payment_id to the real payment. A receipt-submissions UPDATE trigger
--     emits the event inside that same transaction. The row INSERT performed
--     earlier by `hold_order_reservations()` must NOT emit it.
--   * Pay in store: `confirmPayInStoreOrder()` calls the service-role-only RPC
--     below after validating the checkout cookie.
--
-- The event type, key (`new_order:<order_id>`) and summary are identical to 016,
-- so its UNIQUE(event_key, admin_id) + ON CONFLICT DO NOTHING still dedupes
-- retries across both paths. The old orders INSERT trigger and its function are
-- removed; no table, column, RLS policy, publication, replica identity, order,
-- payment, inventory, pricing or notification-table definition changes here.
-- The only writes remain inside the existing private fan-out helper.
--
-- This file is local-only: no remote apply, seed or deployment.

-- 1. Retire the draft-time notification --------------------------------------

drop trigger if exists admin_general_notifications_new_order on public.orders;
drop function if exists private.general_notification_order_trigger();

-- 2. Service-role-only formalization RPC -------------------------------------

create or replace function public.notify_online_order_formalized(p_order_id bigint)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_channel text;
  v_status  text;
  v_created integer;
begin
  if p_order_id is null or p_order_id <= 0 then
    raise exception 'notify_online_order_formalized: invalid order id'
      using errcode = '22023';
  end if;

  -- A shared row lock keeps the read of channel/status stable while the
  -- formalizing transaction is still committing its payment/receipt changes.
  select o.channel, o.status
    into v_channel, v_status
  from public.orders o
  where o.id = p_order_id
  for share;

  if not found or v_channel <> 'online' or v_status in ('canceled', 'expired') then
    return 0;
  end if;

  v_created := private.create_admin_general_notification(
    'new_order',
    'new_order:' || p_order_id::text,
    'Nuevo pedido online recibido.',
    p_order_id
  );
  return v_created;
end;
$$;

revoke all on function public.notify_online_order_formalized(bigint)
  from public, anon, authenticated;
grant execute on function public.notify_online_order_formalized(bigint)
  to service_role;

-- 3. Transactional digital-path trigger -------------------------------------

create or replace function private.general_notification_formalized_order_trigger()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.order_id is not null and new.order_id > 0 then
    perform public.notify_online_order_formalized(new.order_id);
  end if;
  return new;
end;
$$;

create trigger admin_general_notifications_formalized_order
  after update of payment_id on public.receipt_submissions
  for each row
  when (old.payment_id is null and new.payment_id is not null)
  execute function private.general_notification_formalized_order_trigger();

revoke all on function private.general_notification_formalized_order_trigger()
  from public, anon, authenticated;
grant execute on function private.general_notification_formalized_order_trigger()
  to service_role;
