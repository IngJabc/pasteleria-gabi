-- OQ-16 — Receipt-review SLA notifications (Phase 6)
--
-- Implements the confirmed rule in docs/DECISIONS.md #25, as amended for the
-- dedicated worker authorized by the amendment to #1:
--   * Every receipt submission starts its OWN 24-hour SLA. The correction
--     receipt is a second, independent submission with its own clock.
--   * At the first worker run after 24 hours, one durable in-app notification is
--     created for every ACTIVE administrator. Further runs create one more per
--     15-minute interval while that specific receipt is still pending review.
--   * Review (approve OR reject) closes exactly the pending submission in the
--     SAME transaction as the business action; notifications then stop.
--   * SLA processing is strictly additive: it only READS receipt/order-shaped
--     history and INSERTS notification rows. It never writes orders, payments,
--     inventory, reservations or any expiration timestamp.
--
-- Why a history table instead of columns on `orders`: `orders.receipt_attempts`
-- is only a 0..2 counter, and there is at most one submitted receipt under
-- review at a time. Stamping a single timestamp on the order would force a
-- rewrite (or a ambiguous "last submission" column) when the correction
-- arrives. One immutable row per attempt is the only representation that keeps
-- both 24-hour clocks exact and preserves history after review. Timestamps are
-- NEVER reset or overwritten; review only appends reviewed_at/review_status.
--
-- Integration points (verified against migration 003):
--   * `hold_order_reservations` is the actual receipt-submission RPC. The new
--     history row is inserted immediately after the guarded atomic increment of
--     `receipt_attempts` (0 -> 1 -> 2). Idempotent repeats do not increment, so
--     they do not insert. The global lock order reservations -> orders is kept,
--     and the new table is touched last.
--   * `open_order_correction_window` is the actual rejection RPC. It closes the
--     pending submission in the same transaction as the correction-window /
--     automatic-cancel side effects, with the same lock order.
--   * Approval has no RPC in migrations 001-004 (payment verification is a later
--     phase). `approve_receipt_submission` is the narrow service-role primitive
--     the future approval flow must call in its own transaction; it only closes
--     the SLA submission and changes no business state.
--
-- Notification inbox vs. outbox: `admin_notifications` IS the delivery. There
-- is no external provider configured in this repository, so no outbox, email,
-- Slack or WhatsApp integration is introduced. A row means "the administrator
-- has a pending in-app notification", never "an external message was sent".
--
-- Idempotency / concurrency: UNIQUE (receipt_submission_id, admin_id,
-- interval_bucket) plus INSERT ... ON CONFLICT DO NOTHING is the final,
-- database-enforced guarantee. Overlapping worker instances cannot duplicate a
-- notification; the bucket is derived from the (nullable, service-role-only)
-- processing clock, aligned to Unix-epoch 15-minute boundaries. A delayed run
-- only creates the CURRENT bucket's rows — missed intervals are not replayed.
--
-- Security: all new/replaced RPCs are SECURITY INVOKER with a pinned
-- search_path and granted to `service_role` only. RLS is enabled and forced on
-- both new tables; administrators can read receipt history and read/update only
-- their own notifications. No client write path exists for either table.
--
-- Status: NOT applied to any remote Supabase project — validated locally only.
-- Migrations 001-004 are not modified; this file replaces two function bodies
-- with identical signatures using CREATE OR REPLACE, as documented in §11.

-- 1. Tables -------------------------------------------------------------------

-- One immutable row per actual receipt submission (original + one correction).
create table public.receipt_submissions (
  id             bigint generated always as identity primary key,
  order_id       bigint not null references public.orders (id) on delete cascade,
  attempt_number smallint not null,
  submitted_at   timestamptz not null default now(),
  reviewed_at    timestamptz,
  review_status  text not null default 'pending',
  constraint receipt_submissions_attempt_number_check check (attempt_number in (1, 2)),
  constraint receipt_submissions_review_status_check
    check (review_status in ('pending', 'approved', 'rejected')),
  constraint receipt_submissions_review_check
    check ((review_status = 'pending') = (reviewed_at is null)),
  constraint receipt_submissions_reviewed_after_submitted_check
    check (reviewed_at is null or reviewed_at >= submitted_at),
  -- Backstop: a retried/idempotent submission must never create a second row.
  constraint receipt_submissions_order_attempt_key unique (order_id, attempt_number)
);

-- Durable in-app inbox. One row per (submission, recipient, 15-minute interval).
create table public.admin_notifications (
  id                    bigint generated always as identity primary key,
  receipt_submission_id bigint not null
    references public.receipt_submissions (id) on delete cascade,
  admin_id              uuid not null
    references public.administrators (id) on delete cascade,
  interval_bucket       bigint not null,
  created_at            timestamptz not null default now(),
  read_at               timestamptz,
  constraint admin_notifications_interval_bucket_check check (interval_bucket >= 0),
  constraint admin_notifications_read_after_created_check
    check (read_at is null or read_at >= created_at),
  constraint admin_notifications_unique
    unique (receipt_submission_id, admin_id, interval_bucket)
);

create index receipt_submissions_order_id_idx
  on public.receipt_submissions (order_id);
create index receipt_submissions_pending_due_idx
  on public.receipt_submissions (submitted_at) where review_status = 'pending';

create index admin_notifications_receipt_submission_id_idx
  on public.admin_notifications (receipt_submission_id);
create index admin_notifications_admin_id_idx
  on public.admin_notifications (admin_id, read_at, created_at desc);

-- 2. Row Level Security (enabled + forced, as everywhere else) -----------------

alter table public.receipt_submissions enable row level security;
alter table public.receipt_submissions force row level security;
alter table public.admin_notifications enable row level security;
alter table public.admin_notifications force row level security;

-- Receipt history is readable by admins only; it is append-only for clients.
create policy receipt_submissions_admin_select on public.receipt_submissions
  for select to authenticated
  using ((select private.is_admin()));

-- Notifications are individually addressed: an admin sees and marks read ONLY
-- their own rows. There are no INSERT/DELETE policies for client roles.
create policy admin_notifications_admin_select on public.admin_notifications
  for select to authenticated
  using (admin_id = (select auth.uid()) and (select private.is_admin()));

create policy admin_notifications_admin_update_own on public.admin_notifications
  for update to authenticated
  using (admin_id = (select auth.uid()) and (select private.is_admin()))
  with check (admin_id = (select auth.uid()) and (select private.is_admin()));

-- 3. Immutable history guard ---------------------------------------------------

-- The identity and submission clock of a history row must never be rewritten:
-- rewriting either would silently restart an SLA or erase which attempt it was.
-- Only review_status/reviewed_at may be appended by the review primitives.
create or replace function private.enforce_receipt_submission_immutability()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if new.order_id is distinct from old.order_id
     or new.attempt_number is distinct from old.attempt_number
     or new.submitted_at is distinct from old.submitted_at then
    raise exception 'receipt submission history is immutable'
      using errcode = '23000';
  end if;
  return new;
end;
$$;

revoke execute on function private.enforce_receipt_submission_immutability()
  from public, anon, authenticated;
grant  execute on function private.enforce_receipt_submission_immutability()
  to service_role;

create trigger receipt_submissions_immutable
  before update on public.receipt_submissions
  for each row execute function private.enforce_receipt_submission_immutability();

-- 4. Shared review primitive ---------------------------------------------------

-- Closes exactly the still-pending submission of an order. Called from the
-- rejection RPC and the approval RPC inside their transactions; repeated calls
-- are no-ops because the UPDATE matches only review_status = 'pending'.
create or replace function private.close_pending_receipt_submission(
  p_order_id bigint,
  p_outcome text
)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_closed integer;
begin
  if p_outcome not in ('approved', 'rejected') then
    raise exception 'close_pending_receipt_submission: invalid review outcome'
      using errcode = '22023';
  end if;

  update public.receipt_submissions s
     set review_status = p_outcome,
         reviewed_at = now()
   where s.order_id = p_order_id
     and s.review_status = 'pending';
  get diagnostics v_closed = row_count;

  return v_closed;
end;
$$;

revoke execute on function private.close_pending_receipt_submission(bigint, text)
  from public, anon, authenticated;
grant  execute on function private.close_pending_receipt_submission(bigint, text)
  to service_role;

-- 5. Receipt submission — migration 003 behavior + one history insert ----------

-- Signature and return type are unchanged from migration 003. Everything below
-- is the original body except the single INSERT after the guarded increment and
-- the "reservations -> orders -> receipt history" locking/insertion order.
create or replace function public.hold_order_reservations(p_order_id bigint)
returns integer
language plpgsql
volatile
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

  -- Lock the active rows FIRST (global order: reservations -> orders).
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

  -- A NEW submission = deadline still running, or no attempt ever counted
  -- (quote-pending rows arrive held). Already-held repeats consume no attempt
  -- and therefore create no history row.
  if v_unheld > 0 or v_attempts = 0 then
    update public.orders o
       set receipt_attempts = o.receipt_attempts + 1
     where o.id = p_order_id
       and o.receipt_attempts < 2;
    get diagnostics v_counted = row_count;
    if v_counted = 0 then
      raise exception 'hold_order_reservations: order % has already used its two receipt attempts', p_order_id
        using errcode = 'P0001';
    end if;

    -- One immutable row per ACTUAL submission; attempt_number is the new value
    -- of the counter. The UNIQUE constraint is a backstop against duplicates.
    insert into public.receipt_submissions (order_id, attempt_number, submitted_at)
    values (p_order_id, v_attempts + 1, now());
  end if;

  update public.inventory_reservations r
     set expires_at = null
   where r.order_id = p_order_id and r.status = 'active' and r.expires_at is not null;

  return v_active;
end;
$$;

-- 6. Receipt rejection — migration 003 behavior + close the pending submission -

-- Signature and return type are unchanged from migration 003. The only addition
-- is the close_pending_receipt_submission call under the same reservation locks.
create or replace function public.open_order_correction_window(p_order_id bigint)
returns integer
language plpgsql
volatile
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

  -- Lock order everywhere: reservations -> orders (then receipt history).
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

  -- The rejected receipt stops its own SLA in this same transaction, whether
  -- this is the first rejection (correction window) or the final one (cancel).
  perform private.close_pending_receipt_submission(p_order_id, 'rejected');

  if v_attempts >= 2 then
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

-- 7. Receipt approval primitive ------------------------------------------------
--
-- Approvals do not exist as an RPC in migrations 001-004 (payment verification
-- belongs to a later phase). This is the SLA side of that future flow: it closes
-- the pending submission only. It never changes order status, payment state,
-- inventory, reservations or deadlines. The future approval RPC must call it in
-- its own transaction. Repeating it is a safe no-op (submissions_closed = 0).
create or replace function public.approve_receipt_submission(p_order_id bigint)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_closed integer;
begin
  if p_order_id is null then
    raise exception 'approve_receipt_submission: order id is required'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'approve_receipt_submission: order % does not exist', p_order_id
      using errcode = 'P0002';
  end if;

  v_closed := private.close_pending_receipt_submission(p_order_id, 'approved');

  return jsonb_build_object(
    'order_id', p_order_id,
    'submissions_closed', v_closed,
    'processed_at', now()
  );
end;
$$;

-- 8. One complete SLA cycle ----------------------------------------------------
--
-- p_now is a nullable clock override (service-role only) used by behavioral
-- tests and deterministic backfills; production calls it with NULL (or omits
-- it) so now() is used. The interval bucket is floor(epoch / 900), i.e. aligned
-- to Unix-epoch 15-minute boundaries and independent of the server timezone.
-- Only the CURRENT bucket is inserted: a late worker never replays missed
-- intervals. ON CONFLICT DO NOTHING keeps concurrent instances idempotent, and
-- the CROSS JOIN never suppresses one administrator because another already
-- has a row. No business table is written by this function.
create or replace function public.process_sla_notifications(p_now timestamptz default null)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_now     timestamptz := coalesce(p_now, now());
  v_bucket  bigint;
  v_pending integer;
  v_due     integer;
  v_admins  integer;
  v_created integer;
begin
  v_bucket := floor(extract(epoch from v_now) / 900)::bigint;

  select count(*) into v_pending
  from public.receipt_submissions s
  where s.review_status = 'pending';

  select count(*) into v_due
  from public.receipt_submissions s
  where s.review_status = 'pending'
    and s.submitted_at <= v_now - interval '24 hours';

  select count(*) into v_admins
  from public.administrators a
  where a.is_active;

  insert into public.admin_notifications
    (receipt_submission_id, admin_id, interval_bucket, created_at)
  select s.id, a.id, v_bucket, v_now
  from public.receipt_submissions s
  cross join public.administrators a
  where s.review_status = 'pending'
    and s.submitted_at <= v_now - interval '24 hours'
    and a.is_active
  on conflict (receipt_submission_id, admin_id, interval_bucket) do nothing;
  get diagnostics v_created = row_count;

  return jsonb_build_object(
    'bucket', v_bucket,
    'pending_submissions', v_pending,
    'due_submissions', v_due,
    'active_administrators', v_admins,
    'notifications_created', v_created,
    'processed_at', v_now
  );
end;
$$;

-- 9. EXECUTE grants (SECURITY_DESIGN §5) ---------------------------------------

revoke execute on function public.hold_order_reservations(bigint)
  from public, anon, authenticated;
grant  execute on function public.hold_order_reservations(bigint)
  to service_role;

revoke execute on function public.open_order_correction_window(bigint)
  from public, anon, authenticated;
grant  execute on function public.open_order_correction_window(bigint)
  to service_role;

revoke execute on function public.approve_receipt_submission(bigint)
  from public, anon, authenticated;
grant  execute on function public.approve_receipt_submission(bigint)
  to service_role;

revoke execute on function public.process_sla_notifications(timestamptz)
  from public, anon, authenticated;
grant  execute on function public.process_sla_notifications(timestamptz)
  to service_role;

-- No seeds: submissions and notifications are runtime state written by the
-- receipt RPCs and the scheduled worker respectively.
