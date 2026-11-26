-- P6 — General in-app administrator notifications.
--
-- Additive only. This migration creates a dedicated `public.admin_general_notifications`
-- table for four new event families: online orders, payment receipts, receipt
-- corrections and product reviews. The existing SLA notification inbox, its
-- worker, its 24h/15min semantics and every RPC from earlier migrations are left
-- untouched. No external delivery channel is introduced: these rows are the
-- complete delivery mechanism.
--
-- Security boundary:
--   * RLS is enabled and forced. Authenticated administrators can SELECT and
--     UPDATE only their own rows, and only while `private.is_admin()` holds.
--   * Direct table privileges are revoked from public/anon/authenticated; only
--     SELECT and UPDATE(read_at) are granted to authenticated. All other writes
--     flow through SECURITY DEFINER helpers, triggers and service_role.
--   * Every function has a pinned empty search_path and is executable only by
--     service_role (or by the database as a trigger).
--
-- Deterministic keys are event-prefixed and derived from the originating row:
--   new_order:<order_id>
--   payment_receipt:<receipt_submission_id>
--   receipt_correction:<receipt_submission_id>
--   product_review:<review_id>
-- UNIQUE(event_key, admin_id) and ON CONFLICT DO NOTHING make retries, repeated
-- triggers and concurrent transactions idempotent. Triggers run in the
-- originating transaction, so no worker or polling is needed.
--
-- Receipt events are emitted from the user-visible evidence-link transition in
-- the current `submit_payment_evidence()` (introduced by migration 006 and most
-- recently replaced by migration 011): a submission's NULL payment_id becomes
-- the real payment. Plain submission INSERTs in `hold_order_reservations()` are
-- deliberately ignored.
--
-- Realtime uses the default replica identity. INSERT events carry the full new
-- row and are the source of truth for new notifications; Supabase does not
-- promise reliable old-record fields under RLS, so REPLICA IDENTITY FULL would
-- only enlarge WAL records without improving authorization. The client must not
-- depend on payload.old or on UPDATE delivery for correctness.
--
-- This file is local-only: no remote migration, no deployed change, no seed.

-- 1. Table --------------------------------------------------------------------

create table public.admin_general_notifications (
  id                    bigint generated always as identity primary key,
  event_type            text not null,
  event_key             text not null,
  admin_id              uuid not null
    references public.administrators (id) on delete cascade,
  order_id              bigint null
    references public.orders (id) on delete cascade,
  receipt_submission_id bigint null
    references public.receipt_submissions (id) on delete cascade,
  payment_id            bigint null
    -- Immutable receipt history keeps its payment reference; deleting a payment
    -- with linked receipt notifications is blocked.
    references public.payments (id) on delete restrict,
  review_id             bigint null
    references public.product_reviews (id) on delete cascade,
  product_id            bigint null
    references public.products (id) on delete restrict,
  summary               text not null,
  created_at            timestamptz not null default now(),
  read_at               timestamptz null,
  constraint admin_general_notifications_event_type_check
    check (event_type in ('new_order', 'payment_receipt', 'receipt_correction', 'product_review')),
  constraint admin_general_notifications_event_key_check
    check (
      (event_type = 'new_order'
       and order_id is not null
       and event_key = 'new_order:' || order_id::text)
      or (event_type = 'payment_receipt'
          and receipt_submission_id is not null
          and event_key = 'payment_receipt:' || receipt_submission_id::text)
      or (event_type = 'receipt_correction'
          and receipt_submission_id is not null
          and event_key = 'receipt_correction:' || receipt_submission_id::text)
      or (event_type = 'product_review'
          and review_id is not null
          and event_key = 'product_review:' || review_id::text)
    ),
  constraint admin_general_notifications_summary_check
    check (char_length(btrim(summary)) > 0),
  constraint admin_general_notifications_read_after_created_check
    check (read_at is null or read_at >= created_at),
  constraint admin_general_notifications_event_key_admin_key
    unique (event_key, admin_id),
  constraint admin_general_notifications_event_target_check
    check (
      (
        event_type = 'new_order'
        and order_id is not null
        and receipt_submission_id is null
        and payment_id is null
        and review_id is null
        and product_id is null
      )
      or (
        event_type in ('payment_receipt', 'receipt_correction')
        and order_id is not null
        and receipt_submission_id is not null
        and payment_id is not null
        and review_id is null
        and product_id is null
      )
      or (
        event_type = 'product_review'
        and review_id is not null
        and product_id is not null
        and order_id is null
        and receipt_submission_id is null
        and payment_id is null
      )
    )
);

comment on table public.admin_general_notifications is
  'Individually addressed general in-app administrator events. Immutable except read_at.';

create index admin_general_notifications_admin_created_idx
  on public.admin_general_notifications (admin_id, created_at desc, id desc);

create index admin_general_notifications_unread_admin_created_idx
  on public.admin_general_notifications (admin_id, created_at desc, id desc)
  where read_at is null;

-- 2. Row Level Security and privileges ----------------------------------------

alter table public.admin_general_notifications enable row level security;
alter table public.admin_general_notifications force row level security;

create policy admin_general_notifications_admin_select
  on public.admin_general_notifications
  for select
  to authenticated
  using (admin_id = (select auth.uid()) and (select private.is_admin()));

create policy admin_general_notifications_admin_update_own
  on public.admin_general_notifications
  for update
  to authenticated
  using (admin_id = (select auth.uid()) and (select private.is_admin()))
  with check (admin_id = (select auth.uid()) and (select private.is_admin()));

revoke all on table public.admin_general_notifications from public, anon, authenticated;
grant select on table public.admin_general_notifications to authenticated;
grant update (read_at) on table public.admin_general_notifications to authenticated;
grant all on table public.admin_general_notifications to service_role;

-- 3. Read-state guard ----------------------------------------------------------

-- A row's identity, event shape, summary and creation timestamp are permanent.
-- Only read_at may change, and it can never precede created_at.
create or replace function private.enforce_admin_general_notification_immutability()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.event_type is distinct from old.event_type
     or new.event_key is distinct from old.event_key
     or new.admin_id is distinct from old.admin_id
     or new.order_id is distinct from old.order_id
     or new.receipt_submission_id is distinct from old.receipt_submission_id
     or new.payment_id is distinct from old.payment_id
     or new.review_id is distinct from old.review_id
     or new.product_id is distinct from old.product_id
     or new.summary is distinct from old.summary
     or new.created_at is distinct from old.created_at then
    raise exception 'Los campos de la notificación general son inmutables.'
      using errcode = '23000';
  end if;

  if new.read_at is not null and new.read_at < old.created_at then
    raise exception 'La hora de lectura no puede ser anterior a la creación.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_admin_general_notification_immutability()
  from public, anon, authenticated;
grant execute on function private.enforce_admin_general_notification_immutability()
  to service_role;

create trigger admin_general_notifications_immutable
  before update on public.admin_general_notifications
  for each row execute function private.enforce_admin_general_notification_immutability();

-- 4. Fan-out helper ------------------------------------------------------------

-- One row per currently active administrator. The helper is private and
-- service-role only; callers cannot choose a recipient. A repeated event key is
-- always a no-op for an administrator who already has that event.
create or replace function private.create_admin_general_notification(
  p_event_type text,
  p_event_key text,
  p_summary text,
  p_order_id bigint default null,
  p_receipt_submission_id bigint default null,
  p_payment_id bigint default null,
  p_review_id bigint default null,
  p_product_id bigint default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_created integer;
begin
  if p_event_type is null
     or p_event_type not in ('new_order', 'payment_receipt', 'receipt_correction', 'product_review') then
    raise exception 'Tipo de notificación general no válido.' using errcode = '22023';
  end if;
  if p_event_key is null
     or left(p_event_key, length(p_event_type) + 1) <> p_event_type || ':' then
    raise exception 'La clave de notificación general no es válida.' using errcode = '22023';
  end if;
  if p_summary is null or char_length(btrim(p_summary)) = 0 then
    raise exception 'El resumen de la notificación general es obligatorio.' using errcode = '22023';
  end if;

  insert into public.admin_general_notifications (
    event_type, event_key, admin_id, order_id, receipt_submission_id,
    payment_id, review_id, product_id, summary, created_at, read_at
  )
  select
    p_event_type, p_event_key, a.id, p_order_id, p_receipt_submission_id,
    p_payment_id, p_review_id, p_product_id, p_summary, now(), null
  from public.administrators a
  where a.is_active
  on conflict (event_key, admin_id) do nothing;

  get diagnostics v_created = row_count;
  return v_created;
end;
$$;

revoke all on function private.create_admin_general_notification(text, text, text, bigint, bigint, bigint, bigint, bigint)
  from public, anon, authenticated;
grant execute on function private.create_admin_general_notification(text, text, text, bigint, bigint, bigint, bigint, bigint)
  to service_role;

-- 5. Transactional event triggers ---------------------------------------------

-- Online orders only: POS orders have no customer inbox event. The event type
-- is part of the key, so retrying the same order never duplicates a row.
create or replace function private.general_notification_order_trigger()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.channel = 'online' then
    perform private.create_admin_general_notification(
      'new_order',
      'new_order:' || new.id::text,
      'Nuevo pedido online recibido.',
      new.id
    );
  end if;
  return new;
end;
$$;

create trigger admin_general_notifications_new_order
  after insert on public.orders
  for each row execute function private.general_notification_order_trigger();

-- Evidence is linked only when submit_payment_evidence() fills the NULL
-- payment_id left by hold_order_reservations(). The attempt number decides
-- whether this is the first comprobante or its correction; both share the
-- receipt submission as their deterministic target.
create or replace function private.general_notification_receipt_trigger()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event_type text;
  v_summary text;
begin
  if new.attempt_number = 1 then
    v_event_type := 'payment_receipt';
    v_summary := 'Nuevo comprobante de pago recibido.';
  elsif new.attempt_number = 2 then
    v_event_type := 'receipt_correction';
    v_summary := 'Comprobante corregido recibido.';
  else
    return new;
  end if;

  perform private.create_admin_general_notification(
    v_event_type,
    v_event_type || ':' || new.id::text,
    v_summary,
    new.order_id,
    new.id,
    new.payment_id
  );
  return new;
end;
$$;

create trigger admin_general_notifications_receipt_submission
  after update of payment_id on public.receipt_submissions
  for each row
  when (old.payment_id is null and new.payment_id is not null)
  execute function private.general_notification_receipt_trigger();

create or replace function private.general_notification_review_trigger()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.create_admin_general_notification(
    'product_review',
    'product_review:' || new.id::text,
    'Nueva reseña de producto recibida.',
    null,
    null,
    null,
    new.id,
    new.product_id
  );
  return new;
end;
$$;

create trigger admin_general_notifications_product_review
  after insert on public.product_reviews
  for each row execute function private.general_notification_review_trigger();

revoke all on function private.general_notification_order_trigger()
  from public, anon, authenticated;
grant execute on function private.general_notification_order_trigger()
  to service_role;

revoke all on function private.general_notification_receipt_trigger()
  from public, anon, authenticated;
grant execute on function private.general_notification_receipt_trigger()
  to service_role;

revoke all on function private.general_notification_review_trigger()
  from public, anon, authenticated;
grant execute on function private.general_notification_review_trigger()
  to service_role;

-- 6. Realtime publication -----------------------------------------------------

-- A missing `supabase_realtime` publication is a no-op on a plain local cluster.
-- Membership is checked from the catalog so this remains safely repeatable.
do $$
declare
  publication_name constant text := 'supabase_realtime';
  target_table constant regclass := 'public.admin_general_notifications'::regclass;
  is_member boolean;
begin
  if not exists (select 1 from pg_publication where pubname = publication_name) then
    raise notice 'Publication "%" does not exist; skipping realtime membership changes.', publication_name;
    return;
  end if;

  select exists (
    select 1
    from pg_publication p
    join pg_publication_rel pr on pr.prpubid = p.oid
    join pg_class c on c.oid = pr.prrelid
    join pg_namespace n on n.oid = c.relnamespace
    where p.pubname = publication_name
      and n.nspname = 'public'
      and c.relname = 'admin_general_notifications'
  ) into is_member;

  if not is_member then
    execute format('alter publication %I add table %s', publication_name, target_table::text);
  end if;
end;
$$;
