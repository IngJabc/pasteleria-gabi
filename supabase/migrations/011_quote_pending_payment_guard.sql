-- 011_quote_pending_payment_guard.sql
-- Additive hardening: prevent payment registration/evidence while an online
-- delivery order in a requires_quote zone has no confirmed quote, and block
-- quote changes after evidence was submitted (already in 010). Also block
-- payments before quote acceptance when OQ-17 applies (quote set but not accepted).

create or replace function private.order_requires_quote_pending(p_order public.orders)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p_order.channel = 'online'
    and p_order.fulfillment_type = 'delivery'
    and p_order.delivery_zone_id is not null
    and p_order.delivery_fee_usd is null
    and exists (
      select 1 from public.delivery_zones z
      where z.id = p_order.delivery_zone_id and z.requires_quote
    );
$$;

create or replace function private.order_requires_quote_acceptance(p_order public.orders)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p_order.channel = 'online'
    and p_order.fulfillment_type = 'delivery'
    and p_order.delivery_zone_id is not null
    and p_order.delivery_fee_usd is not null
    and p_order.quote_accepted_at is null
    and p_order.receipt_attempts = 0
    and exists (
      select 1 from public.delivery_zones z
      where z.id = p_order.delivery_zone_id and z.requires_quote
    );
$$;

revoke execute on function private.order_requires_quote_pending(public.orders) from public, anon, authenticated;
revoke execute on function private.order_requires_quote_acceptance(public.orders) from public, anon, authenticated;

-- Patch register_payment: after order lock/state check, block quote-pending and
-- quote-not-yet-accepted for requires_quote delivery orders.
create or replace function public.register_payment(
  p_order_id           bigint,
  p_method             text,
  p_currency           text,
  p_amount             numeric,
  p_reference          text,
  p_receipt_path       text,
  p_amount_tendered_usd numeric,
  p_idempotency_key    text,
  p_registered_by      uuid default null,
  p_collected          boolean default false
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_existing  public.payments;
  v_order     public.orders;
  v_id        bigint;
  v_status    text;
  v_verified  timestamptz;
  v_change    numeric(10,2);
begin
  if p_order_id is null then
    raise exception 'register_payment: order id is required' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'register_payment: idempotency key is required' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'register_payment: amount must be positive' using errcode = '22023';
  end if;
  if p_method not in ('pago_movil', 'cash_usd', 'binance_pay', 'binance_transfer')
     or p_currency not in ('USD', 'VES', 'USDT')
     or (p_method = 'pago_movil' and p_currency <> 'VES')
     or (p_method = 'cash_usd' and p_currency <> 'USD')
     or (p_method in ('binance_pay', 'binance_transfer') and p_currency <> 'USDT') then
    raise exception 'register_payment: unsupported method/currency pair' using errcode = '22023';
  end if;
  if p_amount <> round(p_amount, 2) then
    raise exception 'register_payment: amount must have at most two decimals' using errcode = '22023';
  end if;
  if p_method <> 'cash_usd' and (p_reference is null or p_receipt_path is null) then
    raise exception 'register_payment: digital payments require a reference and a receipt' using errcode = '22023';
  end if;
  if p_method = 'cash_usd' and p_amount_tendered_usd is not null
     and p_amount_tendered_usd < 0 then
    raise exception 'register_payment: amount tendered cannot be negative' using errcode = '22023';
  end if;
  if p_amount_tendered_usd is not null and p_amount_tendered_usd <> round(p_amount_tendered_usd, 2) then
    raise exception 'register_payment: amount tendered must have at most two decimals' using errcode = '22023';
  end if;
  if p_collected and p_registered_by is null then
    raise exception 'register_payment: collected cash must be attributed to an administrator' using errcode = '42501';
  end if;
  if p_registered_by is not null then
    perform private.require_active_admin(p_registered_by);
  end if;

  select * into v_existing
  from public.payments p
  where p.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'payment_id', v_existing.id,
      'order_id', v_existing.order_id,
      'status', v_existing.status,
      'idempotent', true
    );
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;
  if not found then
    raise exception 'register_payment: order % does not exist', p_order_id using errcode = 'P0002';
  end if;
  if v_order.status in ('canceled', 'expired') then
    raise exception 'register_payment: order % is %', p_order_id, v_order.status
      using errcode = 'P0001';
  end if;
  if private.order_requires_quote_pending(v_order) then
    raise exception 'register_payment: delivery quote is pending for order %', p_order_id
      using errcode = 'P0001';
  end if;
  if private.order_requires_quote_acceptance(v_order) then
    raise exception 'register_payment: delivery quote must be accepted before payment for order %', p_order_id
      using errcode = 'P0001';
  end if;

  v_status := case when p_collected then 'approved' else 'pending' end;
  v_verified := case when p_collected then now() else null end;
  v_change := case
    when p_method = 'cash_usd' and p_amount_tendered_usd is not null
      then p_amount_tendered_usd - v_order.total_usd
    else null
  end;

  insert into public.payments (
    order_id, method, currency, amount, reference, receipt_path,
    amount_tendered_usd, status, registered_by, verified_by, verified_at,
    idempotency_key
  )
  values (
    p_order_id, p_method, p_currency, p_amount, p_reference, p_receipt_path,
    p_amount_tendered_usd, v_status, p_registered_by,
    case when p_collected then p_registered_by else null end,
    v_verified, p_idempotency_key
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    select p.id, p.order_id, p.status into v_id, v_order.id, v_status
    from public.payments p
    where p.idempotency_key = p_idempotency_key;
    return jsonb_build_object(
      'payment_id', v_id,
      'order_id', v_order.id,
      'status', v_status,
      'idempotent', true
    );
  end if;

  insert into public.audit_log (admin_id, action, entity_type, entity_id, data)
  values (
    p_registered_by,
    'payment.register',
    'payment',
    v_id::text,
    jsonb_build_object(
      'order_id', p_order_id,
      'method', p_method,
      'currency', p_currency,
      'amount', p_amount,
      'collected', p_collected
    )
  );

  return jsonb_build_object(
    'payment_id', v_id,
    'order_id', p_order_id,
    'status', v_status,
    'change_usd', v_change,
    'idempotent', false
  );
end;
$$;

-- submit_payment_evidence also blocks quote-pending/acceptance-pending before
-- creating evidence/submission.
create or replace function public.submit_payment_evidence(p_payment_id bigint)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_payment      public.payments;
  v_order        public.orders;
  v_submission   public.receipt_submissions;
  v_other        public.receipt_submissions;
  v_window       timestamptz;
  v_attempts_before integer;
  v_active       integer;
  v_status       text;
begin
  if p_payment_id is null then
    raise exception 'submit_payment_evidence: payment id is required' using errcode = '22023';
  end if;

  select * into v_payment
  from public.payments p
  where p.id = p_payment_id
  for update;
  if not found then
    raise exception 'submit_payment_evidence: payment % does not exist', p_payment_id
      using errcode = 'P0002';
  end if;
  if v_payment.method = 'cash_usd' then
    raise exception 'submit_payment_evidence: cash payments do not require a receipt'
      using errcode = 'P0001';
  end if;
  if v_payment.status not in ('pending', 'in_review') then
    raise exception 'submit_payment_evidence: payment % is not pending review', p_payment_id
      using errcode = 'P0001';
  end if;
  if v_payment.receipt_path is null then
    raise exception 'submit_payment_evidence: payment % has no evidence path', p_payment_id
      using errcode = 'P0001';
  end if;

  select * into v_order
  from public.orders o
  where o.id = v_payment.order_id
  for update;
  if v_order.status in ('canceled', 'expired') then
    raise exception 'submit_payment_evidence: order % is %', v_order.id, v_order.status
      using errcode = 'P0001';
  end if;
  if private.order_requires_quote_pending(v_order) then
    raise exception 'submit_payment_evidence: delivery quote is pending for order %', v_order.id
      using errcode = 'P0001';
  end if;
  if private.order_requires_quote_acceptance(v_order) then
    raise exception 'submit_payment_evidence: delivery quote must be accepted before payment for order %', v_order.id
      using errcode = 'P0001';
  end if;

  select * into v_other
  from public.receipt_submissions s
  where s.order_id = v_order.id
    and s.review_status = 'pending'
    and (s.payment_id is null or s.payment_id <> p_payment_id)
  limit 1;
  if found then
    raise exception 'submit_payment_evidence: order % already has pending evidence for another payment',
      v_order.id using errcode = 'P0001';
  end if;

  select * into v_submission
  from public.receipt_submissions s
  where s.payment_id = p_payment_id and s.review_status = 'pending'
  order by s.id desc
  limit 1;
  if found then
    return jsonb_build_object(
      'payment_id', p_payment_id,
      'order_id', v_order.id,
      'submission_id', v_submission.id,
      'attempt_number', v_submission.attempt_number,
      'idempotent', true
    );
  end if;

  select max(r.correction_window_ends_at) into v_window
  from public.inventory_reservations r
  where r.order_id = v_order.id and r.status = 'active';
  if v_order.receipt_attempts > 0 and v_window is not null and now() > v_window then
    update public.inventory_reservations r
       set status = 'released', closed_at = now()
     where r.order_id = v_order.id and r.status = 'active';
    update public.orders o set status = 'expired', updated_at = now() where o.id = v_order.id;
    raise exception 'submit_payment_evidence: the correction window for order % has closed', v_order.id
      using errcode = 'P0001';
  end if;

  v_attempts_before := v_order.receipt_attempts;
  perform public.hold_order_reservations(v_order.id);

  select * into v_submission
  from public.receipt_submissions s
  where s.order_id = v_order.id and s.review_status = 'pending'
  order by s.id desc
  limit 1;
  if not found then
    raise exception 'submit_payment_evidence: submission for order % was not created', v_order.id
      using errcode = 'P0001';
  end if;

  if v_submission.payment_id is not null and v_submission.payment_id <> p_payment_id then
    raise exception 'submit_payment_evidence: submission % already evidences another payment', v_submission.id
      using errcode = 'P0001';
  end if;

  update public.receipt_submissions s
     set payment_id = p_payment_id
   where s.id = v_submission.id and (s.payment_id is null or s.payment_id = p_payment_id);

  update public.payments p
     set status = 'in_review', verified_by = null, verified_at = null
   where p.id = p_payment_id and p.status = 'pending'
  returning p.status into v_status;
  if v_status is null then
    raise exception 'submit_payment_evidence: payment % changed while submitting evidence', p_payment_id
      using errcode = 'P0001';
  end if;

  select count(*) into v_active
  from public.inventory_reservations r
  where r.order_id = v_order.id and r.status = 'active';

  return jsonb_build_object(
    'payment_id', p_payment_id,
    'order_id', v_order.id,
    'submission_id', v_submission.id,
    'attempt_number', v_submission.attempt_number,
    'active_reservations', v_active,
    'idempotent', false
  );
end;
$$;

-- Keep grants as before (006 already granted service_role). Re-assert for clarity.
revoke execute on function public.register_payment(bigint, text, text, numeric, text, text, numeric, text, uuid, boolean) from public, anon, authenticated;
grant  execute on function public.register_payment(bigint, text, text, numeric, text, text, numeric, text, uuid, boolean) to service_role;
revoke execute on function public.submit_payment_evidence(bigint) from public, anon, authenticated;
grant  execute on function public.submit_payment_evidence(bigint) to service_role;
