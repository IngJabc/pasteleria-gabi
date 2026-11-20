-- Phase 5 (payments module; roadmap calls it Phase 4) — Payment records,
-- evidence linkage and administrator verification.
--
-- Implements the design in docs/DATABASE_DESIGN.md §8/§11 and the boundaries in
-- docs/SECURITY_DESIGN.md §4/§5/§7/§8, without changing SPEC business rules:
--   * Supported methods are EXACTLY pago_movil (VES), cash_usd (USD),
--     binance_pay (USDT) and binance_transfer (USDT). These are the two Binance
--     modalities already named in SPEC §5 and docs/DATABASE_DESIGN.md §8.1; no
--     third method or currency is invented. The specific Binance identifier and
--     receipt data remain an open discovery item (SPEC §19).
--   * A payment is one component of an order. Several components and several
--     currencies may coexist on one order; amounts are NEVER summed across
--     currencies (`get_order_payment_summary` aggregates per currency only).
--   * A receipt is evidence, never automatic confirmation. `payments.status`
--     is the single financial history; `receipt_submissions` keeps the OQ-16
--     review/SLA history and is explicitly linked to the payment it evidences
--     through `receipt_submissions.payment_id`. There is no competing history.
--     Cash payments create NO submission and never increment
--     `orders.receipt_attempts`.
--   * Verification is separate from fulfillment: approving a payment changes
--     only payment state (+ the SLA submission). It never writes an order
--     status, a reservation, a movement or physical stock. The existing M3
--     RPCs `hold_order_reservations` and `open_order_correction_window` remain
--     the ONLY implementation of the two-receipt rule, the single 20-minute
--     correction window and the automatic second-rejection cancellation; this
--     migration calls them, it does not reimplement them.
--   * Exchange-rate/rounding rules are unchanged. OQ-4 (rate write path),
--     OQ-5 (rounding rule) and the missing USDT→USD conversion mean that a
--     cross-currency "fully paid" decision cannot be derived here; no such
--     value is stored or invented. The summary RPC reports per-currency facts
--     only, so order confirmation stays in its own domain flow.
--
-- Security: all new RPCs are SECURITY INVOKER, VOLATILE where mutating, with
-- `search_path = ''` and explicit EXECUTE grants. They are service-role-only
-- except the read-only `get_order_payment_summary`. A passed `p_admin_id` is
-- never client-supplied: the server action verifies the session against the
-- active `administrators` row, and `private.require_active_admin` re-checks
-- that the id is active inside every RPC. No RPC assumes `auth.uid()`.
--
-- Storage: the private `payment-receipts` bucket admits administrator SELECT
-- only; there are deliberately no client INSERT/UPDATE/DELETE policies. The
-- server action validates MIME type/size and uploads with the service role.
--
-- Concurrency: `payments.idempotency_key` and
-- `payment_refunds.idempotency_key` are UNIQUE; the submission link has a
-- partial UNIQUE key for open submissions; mutating RPCs lock payment → order
-- (and delegate reservation locks to the existing M3 RPCs); the POS/refund
-- paths take a transaction-scoped advisory lock keyed by the idempotency key /
-- payment id. Repeats are idempotent no-ops, never double writes.
--
-- Status: NOT applied to any remote Supabase project — validated locally only.
-- Migrations 001–005 are untouched; this file only ADDS objects and replaces
-- no existing function body.

-- 1. Tables -------------------------------------------------------------------

create table public.payments (
  id                  bigint generated always as identity primary key,
  order_id            bigint not null
    references public.orders (id) on delete cascade,
  method              text not null,
  currency            text not null,
  amount              numeric(14,2) not null,
  reference           text,
  receipt_path        text,
  amount_tendered_usd numeric(10,2),
  status              text not null default 'pending',
  registered_by       uuid
    references public.administrators (id) on delete set null,
  verified_by         uuid
    references public.administrators (id) on delete set null,
  verified_at         timestamptz,
  idempotency_key     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- SPEC §5 method/currency pairs; no invented method or exchange rule.
  constraint payments_method_check
    check (method in ('pago_movil', 'cash_usd', 'binance_pay', 'binance_transfer')),
  constraint payments_currency_check
    check (currency in ('USD', 'VES', 'USDT')),
  constraint payments_method_currency_check check (
    (method = 'pago_movil'     and currency = 'VES') or
    (method = 'cash_usd'       and currency = 'USD') or
    (method = 'binance_pay'    and currency = 'USDT') or
    (method = 'binance_transfer' and currency = 'USDT')
  ),
  constraint payments_amount_check check (amount > 0),
  -- Digital methods need a reference and an evidence object; cash needs neither.
  constraint payments_reference_check
    check (method = 'cash_usd' or reference is not null),
  constraint payments_receipt_path_check
    check (method = 'cash_usd' or receipt_path is not null),
  constraint payments_amount_tendered_check check (
    (method = 'cash_usd' and (amount_tendered_usd is null or amount_tendered_usd >= 0))
    or (method <> 'cash_usd' and amount_tendered_usd is null)
  ),
  constraint payments_status_check check (
    status in ('pending', 'in_review', 'approved', 'rejected',
               'refunded_partial', 'refunded_full')
  ),
  -- A finished payment must be attributed to an administrator; an unfinished
  -- one must not carry a verification stamp.
  constraint payments_verification_check check (
    (status in ('pending', 'in_review')
       and verified_by is null and verified_at is null)
    or (status in ('approved', 'rejected', 'refunded_partial', 'refunded_full')
       and verified_by is not null and verified_at is not null)
  ),
  -- Database-level idempotency: concurrent duplicates collapse to one row.
  constraint payments_idempotency_key_key unique (idempotency_key)
);

create table public.payment_refunds (
  id              bigint generated always as identity primary key,
  payment_id      bigint not null
    references public.payments (id) on delete cascade,
  amount          numeric(14,2) not null,
  currency        text not null,
  -- OQ-7: SPEC §12 requires a method field but not its value domain. The
  -- server records a non-empty free-text method; no CHECK is invented.
  method          text not null,
  reason          text not null,
  admin_id        uuid not null
    references public.administrators (id) on delete restrict,
  idempotency_key text,
  created_at      timestamptz not null default now(),

  constraint payment_refunds_amount_check check (amount > 0),
  constraint payment_refunds_currency_check
    check (currency in ('USD', 'VES', 'USDT')),
  constraint payment_refunds_method_check check (length(trim(method)) > 0),
  constraint payment_refunds_reason_check check (length(trim(reason)) > 0),
  constraint payment_refunds_idempotency_key_key unique (idempotency_key)
);

-- Explicit, one-way evidence link. `payments` stays the financial spine; a
-- submission is the review/SLA history belonging to ONE payment component.
alter table public.receipt_submissions
  add column payment_id bigint
    references public.payments (id) on delete set null;

create index payments_order_id_idx on public.payments (order_id);
create index payments_registered_by_idx on public.payments (registered_by);
create index payments_verified_by_idx on public.payments (verified_by);
create index payments_review_queue_idx
  on public.payments (created_at desc)
  where status in ('pending', 'in_review');

create index payment_refunds_payment_id_idx on public.payment_refunds (payment_id);
create index payment_refunds_admin_id_idx on public.payment_refunds (admin_id);
create index receipt_submissions_payment_id_idx
  on public.receipt_submissions (payment_id);

-- At most one OPEN submission may evidence a given payment, and at most one
-- open submission may exist for an order. Together with the M3/M5 UNIQUE
-- (order_id, attempt_number) and the two-receipt cap, this forbids competing
-- histories and duplicate parallel evidence submissions.
create unique index receipt_submissions_pending_payment_key
  on public.receipt_submissions (payment_id)
  where review_status = 'pending' and payment_id is not null;
create unique index receipt_submissions_pending_order_key
  on public.receipt_submissions (order_id)
  where review_status = 'pending';

create trigger payments_updated_at
  before update on public.payments
  for each row execute function private.set_updated_at();

-- 2. RLS and storage -----------------------------------------------------------

alter table public.payments enable row level security;
alter table public.payments force row level security;
alter table public.payment_refunds enable row level security;
alter table public.payment_refunds force row level security;

create policy payments_admin_all on public.payments
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy payment_refunds_admin_all on public.payment_refunds
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- Financial tables are read-only to authenticated clients and RLS limits those
-- reads to administrators. All writes flow through the service-role RPCs below;
-- anon has no table access at all (least privilege beyond the row-level policy).
revoke all on public.payments, public.payment_refunds from anon, authenticated;
grant select on public.payments, public.payment_refunds to authenticated;

-- Private receipts bucket. No client write policy: uploads go through the
-- service role after server-side MIME/size validation (DECISIONS #20).
insert into storage.buckets (id, name, public)
values ('payment-receipts', 'payment-receipts', false)
on conflict (id) do nothing;

create policy payment_receipts_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'payment-receipts' and (select private.is_admin()));

-- 3. Shared admin check --------------------------------------------------------

-- The caller's identity is verified by the server action (session + active
-- administrators row). This helper rechecks ACTIVE status at the database
-- boundary; it never reads auth.uid(), which is meaningless for service role.
create or replace function private.require_active_admin(p_admin_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if p_admin_id is null then
    raise exception 'an active administrator is required'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.administrators a
    where a.id = p_admin_id and a.is_active
  ) then
    raise exception 'administrator % is not active', p_admin_id
      using errcode = '42501';
  end if;
end;
$$;

revoke execute on function private.require_active_admin(uuid)
  from public, anon, authenticated;
grant  execute on function private.require_active_admin(uuid)
  to service_role;

-- 4. Payment registration (idempotent) ----------------------------------------

-- Internal primitive called by the token wrapper, the cash registration action
-- and the POS sale flow. p_registered_by/p_collected are supplied by SERVER
-- CODE only after verifying the administrator; guests pass NULL/false.
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

  -- Idempotent replay: the UNIQUE key is the final arbiter, but reading first
  -- avoids a needless lock and gives a stable result for sequential retries.
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

  -- Lock the order before inserting so a concurrent cancellation/expiry cannot
  -- slip between the state check and the write.
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

  -- A racing transaction with the same key won the insert: report its row.
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

-- Guest wrapper: the private tracking token is the ONLY customer credential.
-- Method→currency is derived here; the client cannot choose a currency or an
-- order id, and no administrator id is involved.
create or replace function public.register_payment_for_tracking(
  p_token          text,
  p_method         text,
  p_amount         numeric,
  p_reference      text,
  p_receipt_path   text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_order_id bigint;
  v_currency text;
begin
  if p_token is null or p_method is null then
    raise exception 'register_payment_for_tracking: token and method are required'
      using errcode = '22023';
  end if;
  if p_method not in ('pago_movil', 'binance_pay', 'binance_transfer') then
    raise exception 'register_payment_for_tracking: unsupported guest payment method'
      using errcode = '22023';
  end if;

  select o.id into v_order_id
  from public.orders o
  where o.tracking_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found then
    raise exception 'no order matches the tracking token' using errcode = 'P0002';
  end if;

  v_currency := case
    when p_method = 'pago_movil' then 'VES'
    when p_method in ('binance_pay', 'binance_transfer') then 'USDT'
  end;

  return public.register_payment(
    v_order_id, p_method, v_currency, p_amount, p_reference, p_receipt_path,
    null, p_idempotency_key, null, false
  );
end;
$$;

-- 5. Evidence association -----------------------------------------------------

-- Reuses hold_order_reservations (M3/M5) so the receipt counter, hold semantics,
-- SLA row and two-receipt cap remain in exactly one implementation. This RPC
-- only links the already-uploaded evidence to the submission that was just
-- created and moves that payment into review.
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
  v_updated      integer;
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

  -- A pending submission is order-wide evidence and belongs to exactly one
  -- payment component. Never let a second payment hijack or compete with it.
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

  -- Idempotent repeat for THIS payment: the same pending submission is returned
  -- without touching reservation state or the attempt counter.
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

  -- A spent correction window must not be resurrected by a late resubmission.
  select min(r.correction_window_ends_at) into v_window
  from public.inventory_reservations r
  where r.order_id = v_order.id and r.status = 'active';
  if v_window is not null and now() > v_window then
    raise exception 'submit_payment_evidence: the correction window for order % has closed',
      v_order.id using errcode = 'P0001';
  end if;

  v_attempts_before := v_order.receipt_attempts;
  v_active := public.hold_order_reservations(v_order.id);

  -- The submission created by that RPC is uniquely identified by the new
  -- attempt number; the UNIQUE constraint is the duplicate backstop.
  select * into v_submission
  from public.receipt_submissions s
  where s.order_id = v_order.id
    and s.attempt_number = v_attempts_before + 1;
  if not found then
    raise exception 'submit_payment_evidence: submission for order % was not created',
      v_order.id using errcode = '40001';
  end if;

  update public.receipt_submissions s
     set payment_id = p_payment_id
   where s.id = v_submission.id
     and s.payment_id is null;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'submit_payment_evidence: submission % already evidences another payment',
      v_submission.id using errcode = 'P0001';
  end if;

  update public.payments p
     set status = 'in_review'
   where p.id = p_payment_id and p.status = 'pending';
  get diagnostics v_updated = row_count;
  if v_updated = 0 and v_payment.status <> 'in_review' then
    raise exception 'submit_payment_evidence: payment % changed while submitting evidence',
      p_payment_id using errcode = '40001';
  end if;

  insert into public.audit_log (admin_id, action, entity_type, entity_id, data)
  values (
    null,
    'payment.evidence_submit',
    'payment',
    p_payment_id::text,
    jsonb_build_object(
      'order_id', v_order.id,
      'submission_id', v_submission.id,
      'attempt_number', v_submission.attempt_number
    )
  );

  return jsonb_build_object(
    'payment_id', p_payment_id,
    'order_id', v_order.id,
    'submission_id', v_submission.id,
    'attempt_number', v_submission.attempt_number,
    'reservations_held', v_active,
    'idempotent', false
  );
end;
$$;

-- 6. Administrator review -----------------------------------------------------

create or replace function public.approve_payment(
  p_payment_id bigint,
  p_admin_id   uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_payment      public.payments;
  v_order        public.orders;
  v_pending_for  bigint;
  v_closed       integer := 0;
  v_order_status text;
begin
  perform private.require_active_admin(p_admin_id);

  select * into v_payment
  from public.payments p
  where p.id = p_payment_id
  for update;
  if not found then
    raise exception 'approve_payment: payment % does not exist', p_payment_id using errcode = 'P0002';
  end if;
  if v_payment.status in ('approved', 'refunded_partial', 'refunded_full') then
    return jsonb_build_object(
      'payment_id', p_payment_id,
      'order_id', v_payment.order_id,
      'status', v_payment.status,
      'idempotent', true,
      'order_status', (select o.status from public.orders o where o.id = v_payment.order_id)
    );
  end if;
  if v_payment.status not in ('pending', 'in_review') then
    raise exception 'approve_payment: payment % is rejected', p_payment_id using errcode = 'P0001';
  end if;

  select * into v_order
  from public.orders o
  where o.id = v_payment.order_id
  for update;
  if v_order.status in ('canceled', 'expired') then
    raise exception 'approve_payment: order % is %', v_order.id, v_order.status
      using errcode = 'P0001';
  end if;

  update public.payments p
     set status = 'approved',
         verified_by = p_admin_id,
         verified_at = now()
   where p.id = p_payment_id and p.status in ('pending', 'in_review');

  -- The order-wide SLA row must belong to THIS payment; otherwise approving a
  -- different component would silently close another payment's review clock.
  select s.payment_id into v_pending_for
  from public.receipt_submissions s
  where s.order_id = v_order.id and s.review_status = 'pending'
  limit 1;
  if v_pending_for is not null and v_pending_for <> p_payment_id then
    raise exception 'approve_payment: pending evidence for order % belongs to payment %',
      v_order.id, v_pending_for using errcode = 'P0001';
  end if;

  -- SLA side effect only: close the pending submission in the SAME transaction.
  if v_pending_for = p_payment_id then
    select (public.approve_receipt_submission(v_order.id) ->> 'submissions_closed')::integer
      into v_closed;
  end if;

  insert into public.audit_log (admin_id, action, entity_type, entity_id, data)
  values (
    p_admin_id,
    'payment.verify',
    'payment',
    p_payment_id::text,
    jsonb_build_object(
      'order_id', v_order.id,
      'from_status', v_payment.status,
      'to_status', 'approved',
      'submissions_closed', v_closed
    )
  );

  select o.status into v_order_status from public.orders o where o.id = v_order.id;
  return jsonb_build_object(
    'payment_id', p_payment_id,
    'order_id', v_order.id,
    'status', 'approved',
    'verified_at', (select p.verified_at from public.payments p where p.id = p_payment_id),
    'submissions_closed', v_closed,
    'order_status', v_order_status,
    'idempotent', false
  );
end;
$$;

-- Rejection delegates the correction window / second-rejection cancel to the
-- UNCHANGED M3/M5 RPC; no attempt is ever incremented here. Cash has no
-- submission, so no window is opened and no order state changes.
create or replace function public.reject_payment(
  p_payment_id bigint,
  p_admin_id   uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_payment      public.payments;
  v_order        public.orders;
  v_pending      integer := 0;
  v_pending_for  bigint;
  v_reservations integer := 0;
  v_order_status text;
begin
  perform private.require_active_admin(p_admin_id);

  select * into v_payment
  from public.payments p
  where p.id = p_payment_id
  for update;
  if not found then
    raise exception 'reject_payment: payment % does not exist', p_payment_id using errcode = 'P0002';
  end if;
  if v_payment.status = 'rejected' then
    return jsonb_build_object(
      'payment_id', p_payment_id,
      'order_id', v_payment.order_id,
      'status', 'rejected',
      'idempotent', true,
      'order_status', (select o.status from public.orders o where o.id = v_payment.order_id)
    );
  end if;
  if v_payment.status not in ('pending', 'in_review') then
    raise exception 'reject_payment: payment % is not pending review', p_payment_id using errcode = 'P0001';
  end if;

  select * into v_order
  from public.orders o
  where o.id = v_payment.order_id
  for update;
  if v_order.status in ('canceled', 'expired') then
    raise exception 'reject_payment: order % is %', v_order.id, v_order.status
      using errcode = 'P0001';
  end if;

  select count(*) into v_pending
  from public.receipt_submissions s
  where s.payment_id = p_payment_id and s.review_status = 'pending';

  -- open_order_correction_window closes the order's pending SLA row; reject only
  -- when that row belongs to the payment being reviewed.
  select s.payment_id into v_pending_for
  from public.receipt_submissions s
  where s.order_id = v_order.id and s.review_status = 'pending'
  limit 1;
  if v_pending > 0 and v_pending_for <> p_payment_id then
    raise exception 'reject_payment: pending evidence for order % belongs to payment %',
      v_order.id, v_pending_for using errcode = 'P0001';
  end if;
  if v_pending = 0 and v_pending_for is not null then
    raise exception 'reject_payment: payment % has no pending evidence to reject', p_payment_id
      using errcode = 'P0001';
  end if;

  update public.payments p
     set status = 'rejected',
         verified_by = p_admin_id,
         verified_at = now()
   where p.id = p_payment_id and p.status in ('pending', 'in_review');

  if v_pending > 0 then
    -- Existing domain rule (OQ-14): first rejection opens ONE bounded window,
    -- second rejection atomically cancels and releases. Never reimplemented.
    v_reservations := public.open_order_correction_window(v_order.id);
  end if;

  insert into public.audit_log (admin_id, action, entity_type, entity_id, data)
  values (
    p_admin_id,
    'payment.reject',
    'payment',
    p_payment_id::text,
    jsonb_build_object(
      'order_id', v_order.id,
      'from_status', v_payment.status,
      'to_status', 'rejected',
      'reservations_affected', v_reservations
    )
  );

  select o.status into v_order_status from public.orders o where o.id = v_order.id;
  return jsonb_build_object(
    'payment_id', p_payment_id,
    'order_id', v_order.id,
    'status', 'rejected',
    'reservations_affected', v_reservations,
    'order_status', v_order_status,
    'idempotent', false
  );
end;
$$;

-- 7. Offline / POS cash sale --------------------------------------------------

-- A walk-in sale is one order (channel='pos', no customer/tracking/fulfillment)
-- with immediately consumed inventory and one approved cash component. Prices
-- are re-read from products; a client-supplied price is never accepted. The
-- whole operation is one transaction and repeats by idempotency key are no-ops.
create or replace function public.register_pos_cash_sale(
  p_items              jsonb,
  p_amount_tendered_usd numeric,
  p_idempotency_key    text,
  p_admin_id           uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_existing      public.payments;
  v_order_id      bigint;
  v_payment_id    bigint;
  v_item          jsonb;
  v_items         jsonb;
  v_product       public.products;
  v_product_ids   bigint[] := '{}';
  v_pid           numeric;
  v_q             numeric;
  v_subtotal      numeric(10,2) := 0;
  v_short_pid     bigint;
  v_short_name    text;
  v_short_need    integer;
  v_short_alloc   integer;
  v_change        numeric(10,2);
begin
  perform private.require_active_admin(p_admin_id);
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'register_pos_cash_sale: idempotency key is required' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'register_pos_cash_sale: at least one item is required' using errcode = '22023';
  end if;
  if p_amount_tendered_usd is null or p_amount_tendered_usd < 0
     or p_amount_tendered_usd <> round(p_amount_tendered_usd, 2) then
    raise exception 'register_pos_cash_sale: amount tendered must be a non-negative money value'
      using errcode = '22023';
  end if;

  -- Serialise concurrent replays of the same checkout attempt before the
  -- UNIQUE idempotency key is reached.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_idempotency_key));

  select * into v_existing
  from public.payments p
  where p.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'order_id', v_existing.order_id,
      'payment_id', v_existing.id,
      'status', v_existing.status,
      'idempotent', true
    );
  end if;

  -- Validate and normalise the basket BEFORE writing anything. Repeated lines
  -- are aggregated so a duplicated product cannot bypass the stock check.
  for v_item in select value from pg_catalog.jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'product_id') <> 'number'
       or jsonb_typeof(v_item -> 'quantity') <> 'number' then
      raise exception 'register_pos_cash_sale: invalid item' using errcode = '22023';
    end if;
    v_pid := (v_item ->> 'product_id')::numeric;
    v_q   := (v_item ->> 'quantity')::numeric;
    if v_pid <> trunc(v_pid) or v_q <> trunc(v_q) or v_q < 1 then
      raise exception 'register_pos_cash_sale: product_id must be an integer and quantity at least 1'
        using errcode = '22023';
    end if;

    select * into v_product
    from public.products pr
    where pr.id = v_pid::bigint and pr.is_active;
    if not found then
      raise exception 'register_pos_cash_sale: product % is unavailable', v_pid::bigint
        using errcode = 'P0002';
    end if;

    v_product_ids := array_append(v_product_ids, v_pid::bigint);
    v_subtotal := v_subtotal + v_product.price_usd * v_q;
  end loop;

  if p_amount_tendered_usd < v_subtotal then
    raise exception 'register_pos_cash_sale: amount tendered is less than the sale total'
      using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(t.line), '[]'::jsonb) into v_items
  from (
    select jsonb_build_object(
             'product_id', (value ->> 'product_id')::bigint,
             'quantity', sum((value ->> 'quantity')::integer)::integer
           ) as line
    from pg_catalog.jsonb_array_elements(p_items)
    group by (value ->> 'product_id')::bigint
  ) t;

  -- Lock every candidate batch in global id order (the M3 convention) before
  -- re-reading availability, so concurrent sales cannot take the same units.
  perform 1
  from (
    select b.id
    from public.inventory_batches b
    where b.product_id = any(v_product_ids) and b.remaining_quantity > 0
    order by b.id
    for update of b
  ) locked;

  with res as (
    select r.batch_id, sum(r.quantity)::integer as reserved
    from public.inventory_reservations r
    where r.status = 'active'
      and (r.expires_at is null or r.expires_at > now())
    group by r.batch_id
  ),
  avail as (
    select b.id as batch_id, b.product_id, b.production_date,
           greatest(b.remaining_quantity - coalesce(res.reserved, 0), 0) as free_qty
    from public.inventory_batches b
    left join res on res.batch_id = b.id
    where b.product_id = any(v_product_ids) and b.remaining_quantity > 0
  ),
  needs as (
    select (line ->> 'product_id')::bigint as product_id,
           (line ->> 'quantity')::integer as need
    from pg_catalog.jsonb_array_elements(v_items) as lines(line)
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
      'register_pos_cash_sale: insufficient stock for product "%" (% requested, % available)',
      v_short_name, v_short_need, v_short_alloc using errcode = 'P0001';
  end if;

  insert into public.orders (channel, status, subtotal_usd, total_usd)
  values ('pos', 'pending', v_subtotal, v_subtotal)
  returning id into v_order_id;

  insert into public.order_items (order_id, product_id, product_name, unit_price_usd, quantity)
  select v_order_id, pr.id, pr.name, pr.price_usd, (line ->> 'quantity')::integer
  from pg_catalog.jsonb_array_elements(v_items) as lines(line)
  join public.products pr on pr.id = (line ->> 'product_id')::bigint;

  -- Held active reservations (expires_at NULL) are the documented input to the
  -- existing consume path; the initial deadline stays exactly 20 minutes.
  insert into public.inventory_reservations
    (order_id, batch_id, quantity, status, initial_expires_at, expires_at, created_at)
  select v_order_id, a.batch_id, a.take, 'active',
         now() + interval '20 minutes', null, now()
  from (
    with res as (
      select r.batch_id, sum(r.quantity)::integer as reserved
      from public.inventory_reservations r
      where r.status = 'active'
        and (r.expires_at is null or r.expires_at > now())
      group by r.batch_id
    ),
    avail as (
      select b.id as batch_id, b.product_id, b.production_date,
             greatest(b.remaining_quantity - coalesce(res.reserved, 0), 0) as free_qty
      from public.inventory_batches b
      left join res on res.batch_id = b.id
      where b.product_id = any(v_product_ids) and b.remaining_quantity > 0
    ),
    needs as (
      select (line ->> 'product_id')::bigint as product_id,
             (line ->> 'quantity')::integer as need
      from pg_catalog.jsonb_array_elements(v_items) as lines(line)
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

  -- The ONLY stock deduction path (M3): one sale movement per batch, no
  -- duplicate inventory for an online order.
  perform public.consume_order_reservations(v_order_id);

  update public.orders o
     set status = 'completed'
   where o.id = v_order_id and o.status = 'pending';

  v_change := p_amount_tendered_usd - v_subtotal;

  perform public.register_payment(
    v_order_id, 'cash_usd', 'USD', v_subtotal, null, null,
    p_amount_tendered_usd, p_idempotency_key, p_admin_id, true
  );

  select p.id into v_payment_id
  from public.payments p
  where p.idempotency_key = p_idempotency_key;

  return jsonb_build_object(
    'order_id', v_order_id,
    'payment_id', v_payment_id,
    'status', 'approved',
    'change_usd', v_change,
    'idempotent', false
  );
end;
$$;

-- 8. Refunds (append-only) ----------------------------------------------------

create or replace function public.record_refund(
  p_payment_id      bigint,
  p_amount          numeric,
  p_method          text,
  p_reason          text,
  p_admin_id        uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_payment   public.payments;
  v_existing  public.payment_refunds;
  v_refunded  numeric(14,2);
  v_new_total numeric(14,2);
  v_status    text;
  v_id        bigint;
begin
  perform private.require_active_admin(p_admin_id);
  if p_payment_id is null or p_amount is null or p_amount <= 0 then
    raise exception 'record_refund: payment id and a positive amount are required'
      using errcode = '22023';
  end if;
  if p_amount <> round(p_amount, 2) then
    raise exception 'record_refund: amount must have at most two decimals' using errcode = '22023';
  end if;
  if p_method is null or length(trim(p_method)) = 0 or p_reason is null
     or length(trim(p_reason)) = 0 then
    raise exception 'record_refund: method and reason are required' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'record_refund: idempotency key is required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(p_payment_id::bigint);

  select * into v_existing
  from public.payment_refunds r
  where r.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'refund_id', v_existing.id,
      'payment_id', v_existing.payment_id,
      'status', (select p.status from public.payments p where p.id = v_existing.payment_id),
      'idempotent', true
    );
  end if;

  select * into v_payment
  from public.payments p
  where p.id = p_payment_id
  for update;
  if not found then
    raise exception 'record_refund: payment % does not exist', p_payment_id using errcode = 'P0002';
  end if;
  if v_payment.status not in ('approved', 'refunded_partial', 'refunded_full') then
    raise exception 'record_refund: payment % was not approved', p_payment_id using errcode = 'P0001';
  end if;

  select coalesce(sum(r.amount), 0) into v_refunded
  from public.payment_refunds r
  where r.payment_id = p_payment_id;
  v_new_total := v_refunded + p_amount;
  if v_new_total > v_payment.amount then
    raise exception 'record_refund: refunds would exceed payment % amount', p_payment_id
      using errcode = 'P0001';
  end if;

  insert into public.payment_refunds
    (payment_id, amount, currency, method, reason, admin_id, idempotency_key)
  values
    (p_payment_id, p_amount, v_payment.currency, p_method, p_reason,
     p_admin_id, p_idempotency_key)
  returning id into v_id;

  v_status := case when v_new_total = v_payment.amount
                   then 'refunded_full' else 'refunded_partial' end;
  update public.payments p
     set status = v_status
   where p.id = p_payment_id;

  insert into public.audit_log (admin_id, action, entity_type, entity_id, data)
  values (
    p_admin_id,
    'refund.create',
    'payment',
    p_payment_id::text,
    jsonb_build_object(
      'refund_id', v_id,
      'amount', p_amount,
      'currency', v_payment.currency,
      'total_refunded', v_new_total,
      'to_status', v_status
    )
  );

  return jsonb_build_object(
    'refund_id', v_id,
    'payment_id', p_payment_id,
    'status', v_status,
    'total_refunded', v_new_total,
    'idempotent', false
  );
end;
$$;

-- 9. Per-currency read model ---------------------------------------------------

-- No cross-currency arithmetic: each currency is a separate object. USDT is
-- reported but never converted (no approved conversion/rounding rule exists).
create or replace function public.get_order_payment_summary(p_order_id bigint)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_object_agg(
               p.currency,
               jsonb_build_object(
                 'approved_amount', p.approved_amount,
                 'pending_amount', p.pending_amount,
                 'in_review_amount', p.in_review_amount,
                 'rejected_amount', p.rejected_amount,
                 'refunded_amount', p.refunded_amount,
                 'payment_count', p.payment_count
               )
             )
      from (
        select pay.currency as currency,
               coalesce(sum(pay.amount) filter (where pay.status = 'approved'), 0) as approved_amount,
               coalesce(sum(pay.amount) filter (where pay.status = 'pending'), 0) as pending_amount,
               coalesce(sum(pay.amount) filter (where pay.status = 'in_review'), 0) as in_review_amount,
               coalesce(sum(pay.amount) filter (where pay.status = 'rejected'), 0) as rejected_amount,
               coalesce(sum(r.refund_amount), 0) as refunded_amount,
               count(distinct pay.id) as payment_count
        from public.payments pay
        left join (
          select r.payment_id, sum(r.amount) as refund_amount
          from public.payment_refunds r
          group by r.payment_id
        ) r on r.payment_id = pay.id
        where pay.order_id = p_order_id
        group by pay.currency
      ) p
    ),
    '{}'::jsonb
  );
$$;

-- 10. EXECUTE grants (SECURITY_DESIGN §5) --------------------------------------

revoke execute on function public.register_payment(bigint, text, text, numeric, text, text, numeric, text, uuid, boolean)
  from public, anon, authenticated;
grant  execute on function public.register_payment(bigint, text, text, numeric, text, text, numeric, text, uuid, boolean)
  to service_role;

revoke execute on function public.register_payment_for_tracking(text, text, numeric, text, text, text)
  from public, anon, authenticated;
grant  execute on function public.register_payment_for_tracking(text, text, numeric, text, text, text)
  to service_role;

revoke execute on function public.submit_payment_evidence(bigint)
  from public, anon, authenticated;
grant  execute on function public.submit_payment_evidence(bigint)
  to service_role;

revoke execute on function public.approve_payment(bigint, uuid)
  from public, anon, authenticated;
grant  execute on function public.approve_payment(bigint, uuid)
  to service_role;

revoke execute on function public.reject_payment(bigint, uuid)
  from public, anon, authenticated;
grant  execute on function public.reject_payment(bigint, uuid)
  to service_role;

revoke execute on function public.register_pos_cash_sale(jsonb, numeric, text, uuid)
  from public, anon, authenticated;
grant  execute on function public.register_pos_cash_sale(jsonb, numeric, text, uuid)
  to service_role;

revoke execute on function public.record_refund(bigint, numeric, text, text, uuid, text)
  from public, anon, authenticated;
grant  execute on function public.record_refund(bigint, numeric, text, text, uuid, text)
  to service_role;

revoke execute on function public.get_order_payment_summary(bigint)
  from public, anon;
grant  execute on function public.get_order_payment_summary(bigint)
  to authenticated, service_role;

-- No seeds: payments, refunds and receipts are runtime state written by the
-- RPCs/server actions described above.
