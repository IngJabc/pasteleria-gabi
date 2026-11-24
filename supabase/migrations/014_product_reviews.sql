-- M9 — Public product reviews, moderation, aggregates and realtime publication.
--
-- Implements the public reviews feature:
--   * Public storefront visitors can submit reviews without registration/login.
--   * Required: active product, rating 1..5, non-empty comment.
--   * Optional: customer name. No email/phone/account required.
--   * Unverified public reviews are published immediately (is_hidden=false).
--   * Verified reviews are created only by a server-validated tracking token
--     flow: the token resolves through the existing SECURITY DEFINER tracking
--     RPC; the review is associated with the resolved order and marked verified.
--   * At most one verified review per product per order (DB-level), regardless
--     of item quantity. A product already reviewed for that order cannot be
--     reviewed again as verified for the same order.
--   * Admins can hide/restore reviews. Hidden reviews remain in the table for
--     administrators and audit history, but are excluded from public reads and
--     from all rating aggregates/ranking calculations.
--   * Aggregates are maintained in public.product_review_aggregates and updated
--     by DB trigger after insert/update of moderation-relevant fields.
--
-- Security boundary:
--   * RLS enabled + forced on product_reviews and product_review_aggregates.
--   * Public (anon/authenticated) can SELECT only published, non-hidden reviews
--     and aggregate rows for active products through narrow policies.
--   * Public direct table writes are revoked; submission goes through
--     public.submit_product_review(...) which validates inputs, rate-limits,
--     verifies tracking tokens server-side, and inserts with service-role logic.
--   * Admin read/moderation uses authenticated + private.is_admin() policies.
--   * Tracking tokens, private order data, and service-role credentials are never
--     exposed by public policies, views, or realtime payloads.
--
-- Realtime: product_reviews and product_review_aggregates are added to
-- supabase_realtime. Their RLS policies are the authorization boundary.
--
-- This migration is local-only until explicitly applied/verified in target
-- environments. It is additive and does not rewrite 001-013.

create table public.product_reviews (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.products (id) on delete restrict,
  order_id bigint references public.orders (id) on delete restrict,
  reviewer_name text,
  rating smallint not null,
  comment text not null,
  is_verified_purchase boolean not null default false,
  is_hidden boolean not null default false,
  hidden_at timestamptz,
  hidden_by uuid references public.administrators (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_reviews_rating_check check (rating between 1 and 5),
  constraint product_reviews_comment_check check (
    char_length(btrim(comment)) between 1 and 1000
  ),
  constraint product_reviews_reviewer_name_check check (
    reviewer_name is null or char_length(btrim(reviewer_name)) between 1 and 80
  ),
  constraint product_reviews_verified_order_check check (
    (is_verified_purchase = false and order_id is null)
    or (is_verified_purchase = true and order_id is not null)
  ),
  constraint product_reviews_hidden_state_check check (
    (is_hidden = false and hidden_at is null and hidden_by is null)
    or (is_hidden = true and hidden_at is not null)
  )
);

comment on table public.product_reviews is
  'Public product reviews. Published immediately unless hidden by admin. Verified reviews require server-validated tracking token/order context.';

create unique index product_reviews_verified_order_product_uidx
  on public.product_reviews (order_id, product_id)
  where is_verified_purchase = true and order_id is not null;

create index product_reviews_product_published_idx
  on public.product_reviews (product_id, created_at desc)
  where is_hidden = false;

create index product_reviews_created_at_idx
  on public.product_reviews (created_at desc);

create index product_reviews_hidden_idx
  on public.product_reviews (is_hidden, created_at desc);

create table public.product_review_aggregates (
  product_id bigint primary key references public.products (id) on delete cascade,
  review_count integer not null default 0 check (review_count >= 0),
  rating_sum integer not null default 0 check (rating_sum >= 0),
  average_rating numeric(4,2) not null default 0 check (average_rating >= 0 and average_rating <= 5),
  updated_at timestamptz not null default now()
);

comment on table public.product_review_aggregates is
  'Published (non-hidden) review aggregates per product. Maintained by trigger; used for public rating display and Bayesian ranking.';

create index product_review_aggregates_ranking_idx
  on public.product_review_aggregates (review_count desc, average_rating desc);

-- Simple server-side rate-limit ledger. Stores only a hash of the submitter key,
-- never raw IP or tracking token. Rows are pruned opportunistically.
create table private.product_review_rate_limits (
  id bigint generated always as identity primary key,
  submitter_hash text not null,
  created_at timestamptz not null default now()
);

create index product_review_rate_limits_hash_created_idx
  on private.product_review_rate_limits (submitter_hash, created_at desc);

alter table public.product_reviews enable row level security;
alter table public.product_reviews force row level security;
alter table public.product_review_aggregates enable row level security;
alter table public.product_review_aggregates force row level security;
alter table private.product_review_rate_limits enable row level security;
alter table private.product_review_rate_limits force row level security;

-- Public can read only published, non-hidden reviews for active products.
create policy product_reviews_public_select_published
  on public.product_reviews
  for select
  to anon, authenticated
  using (
    is_hidden = false
    and exists (
      select 1
      from public.products p
      where p.id = product_reviews.product_id
        and p.is_active = true
    )
  );

-- Administrators can read all reviews, including hidden.
create policy product_reviews_admin_select
  on public.product_reviews
  for select
  to authenticated
  using (private.is_admin());

-- No direct admin UPDATE policy. Moderation is allowed only through
-- public.set_product_review_hidden(...), which is audited and restricts
-- changes to hide/restore fields. This prevents direct modification of
-- review content, rating, product/order association, or verification state.

-- Public can read aggregates for active products.
create policy product_review_aggregates_public_select
  on public.product_review_aggregates
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.products p
      where p.id = product_review_aggregates.product_id
        and p.is_active = true
    )
  );

create policy product_review_aggregates_admin_select
  on public.product_review_aggregates
  for select
  to authenticated
  using (private.is_admin());

revoke all on table public.product_reviews from public, anon, authenticated;
revoke all on table public.product_review_aggregates from public, anon, authenticated;
revoke all on table private.product_review_rate_limits from public, anon, authenticated;

-- Anon gets safe published columns only. Authenticated gets full table select;
-- RLS restricts non-admin authenticated users to published active-product rows
-- and allows active admins to read all rows (needed for admin UI/realtime).
grant select (id, product_id, reviewer_name, rating, comment, is_verified_purchase, created_at)
  on table public.product_reviews to anon;
grant select on table public.product_reviews to authenticated;
grant select on table public.product_review_aggregates to anon, authenticated;
grant select on table public.product_review_aggregates to authenticated;

-- Aggregates maintenance -----------------------------------------------------

create or replace function private.refresh_product_review_aggregate(p_product_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_sum integer;
  v_avg numeric(4,2);
begin
  if p_product_id is null then
    return;
  end if;

  select
    count(*)::integer,
    coalesce(sum(r.rating), 0)::integer,
    coalesce(avg(r.rating), 0)::numeric(4,2)
  into v_count, v_sum, v_avg
  from public.product_reviews r
  where r.product_id = p_product_id
    and r.is_hidden = false;

  insert into public.product_review_aggregates (
    product_id, review_count, rating_sum, average_rating, updated_at
  ) values (
    p_product_id, v_count, v_sum, v_avg, now()
  )
  on conflict (product_id) do update
  set review_count = excluded.review_count,
      rating_sum = excluded.rating_sum,
      average_rating = excluded.average_rating,
      updated_at = now();
end;
$$;

revoke all on function private.refresh_product_review_aggregate(bigint) from public, anon, authenticated;
grant execute on function private.refresh_product_review_aggregate(bigint) to service_role;

create or replace function private.product_reviews_aggregate_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.refresh_product_review_aggregate(new.product_id);
    return new;
  elsif tg_op = 'UPDATE' then
    if new.product_id is distinct from old.product_id
       or new.is_hidden is distinct from old.is_hidden
       or new.rating is distinct from old.rating then
      perform private.refresh_product_review_aggregate(old.product_id);
      perform private.refresh_product_review_aggregate(new.product_id);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    perform private.refresh_product_review_aggregate(old.product_id);
    return old;
  end if;
  return null;
end;
$$;

revoke all on function private.product_reviews_aggregate_trigger() from public, anon, authenticated;

drop trigger if exists product_reviews_aggregate_refresh on public.product_reviews;
create trigger product_reviews_aggregate_refresh
after insert or update or delete on public.product_reviews
for each row execute function private.product_reviews_aggregate_trigger();

-- Admin moderation -----------------------------------------------------------

create or replace function public.set_product_review_hidden(
  p_review_id bigint,
  p_hidden boolean
)
returns public.product_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid;
  v_row public.product_reviews;
  v_action text;
begin
  v_admin_id := auth.uid();
  if v_admin_id is null then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  perform private.require_active_admin(v_admin_id);

  if p_review_id is null or p_review_id <= 0 then
    raise exception 'Reseña inválida.' using errcode = '22023';
  end if;
  if p_hidden is null then
    raise exception 'Estado de moderación inválido.' using errcode = '22023';
  end if;

  select * into v_row
  from public.product_reviews
  where id = p_review_id
  for update;

  if not found then
    raise exception 'La reseña no existe.' using errcode = 'P0002';
  end if;

  if v_row.is_hidden is not distinct from p_hidden then
    return v_row;
  end if;

  update public.product_reviews
  set is_hidden = p_hidden,
      hidden_at = case when p_hidden then now() else null end,
      hidden_by = case when p_hidden then v_admin_id else null end,
      updated_at = now()
  where id = p_review_id
  returning * into v_row;

  v_action := case when p_hidden then 'product_review.hide' else 'product_review.restore' end;

  insert into public.audit_log (admin_id, action, entity_type, entity_id, data)
  values (
    v_admin_id,
    v_action,
    'product_review',
    p_review_id::text,
    jsonb_build_object(
      'product_id', v_row.product_id,
      'order_id', v_row.order_id,
      'is_verified_purchase', v_row.is_verified_purchase,
      'is_hidden', v_row.is_hidden
    )
  );

  return v_row;
end;
$$;

revoke all on function public.set_product_review_hidden(bigint, boolean) from public, anon, authenticated;
grant execute on function public.set_product_review_hidden(bigint, boolean) to authenticated;

-- Public submission ----------------------------------------------------------

create or replace function public.submit_product_review(
  p_product_id bigint,
  p_rating smallint,
  p_comment text,
  p_reviewer_name text default null,
  p_tracking_token text default null,
  p_submitter_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_name text;
  v_comment text;
  v_token text;
  v_submitter text;
  v_hash text;
  v_recent_count integer;
  v_tracking jsonb;
  v_item record;
  v_order_id bigint;
  v_verified boolean := false;
  v_review public.product_reviews;
  v_item_product_id bigint;
begin
  if p_product_id is null or p_product_id <= 0 then
    raise exception 'Selecciona un producto válido.' using errcode = '22023';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'La calificación debe estar entre 1 y 5 estrellas.' using errcode = '22023';
  end if;

  v_comment := btrim(coalesce(p_comment, ''));
  if char_length(v_comment) < 1 or char_length(v_comment) > 1000 then
    raise exception 'El comentario es obligatorio y debe tener hasta 1000 caracteres.' using errcode = '22023';
  end if;

  v_name := nullif(btrim(coalesce(p_reviewer_name, '')), '');
  if v_name is not null and char_length(v_name) > 80 then
    raise exception 'El nombre debe tener hasta 80 caracteres.' using errcode = '22023';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
    and is_active = true;

  if not found then
    raise exception 'El producto seleccionado no está disponible.' using errcode = '22023';
  end if;

  -- Rate limit: per submitter key (IP/UA hash from server), fallback to coarse key.
  -- Serialized per submitter hash to reduce concurrent bypass/race.
  v_submitter := nullif(btrim(coalesce(p_submitter_key, '')), '');
  if v_submitter is null then
    v_submitter := 'anonymous';
  end if;
  v_hash := encode(extensions.digest(v_submitter, 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('product_review_submit:' || v_hash));

  delete from private.product_review_rate_limits
  where created_at < now() - interval '2 hours';

  select count(*) into v_recent_count
  from private.product_review_rate_limits
  where submitter_hash = v_hash
    and created_at > now() - interval '1 hour';

  if v_recent_count >= 5 then
    raise exception 'Has enviado varias reseñas recientemente. Intenta nuevamente más tarde.' using errcode = 'P0001';
  end if;

  v_token := nullif(btrim(coalesce(p_tracking_token, '')), '');
  if v_token is not null then
    if v_token !~ '^[0-9a-f]{64}$' then
      raise exception 'El enlace de seguimiento no es válido.' using errcode = '22023';
    end if;

    v_tracking := public.get_order_for_tracking(v_token);

    if v_tracking is null or v_tracking ->> 'order_id' is null then
      raise exception 'No pudimos validar el pedido para esta reseña verificada.' using errcode = '22023';
    end if;
    if v_tracking ->> 'status' not in ('completed', 'delivered') then
      raise exception 'Solo puedes dejar una reseña verificada para pedidos completados o entregados.' using errcode = '22023';
    end if;

    v_order_id := (v_tracking ->> 'order_id')::bigint;

    select (item ->> 'product_id')::bigint
    into v_item_product_id
    from jsonb_array_elements(coalesce(v_tracking -> 'items', '[]'::jsonb)) as item
    where (item ->> 'product_id') ~ '^[0-9]+$'
      and (item ->> 'product_id')::bigint = p_product_id
    limit 1;

    if v_item_product_id is null then
      raise exception 'Este pedido no incluye el producto seleccionado.' using errcode = '22023';
    end if;

    perform 1
    from public.product_reviews
    where order_id = v_order_id
      and product_id = p_product_id
      and is_verified_purchase = true;

    if found then
      raise exception 'Ya existe una reseña verificada para este producto en este pedido.' using errcode = '23505';
    end if;

    v_verified := true;
  end if;

  insert into public.product_reviews (
    product_id, order_id, reviewer_name, rating, comment, is_verified_purchase, is_hidden
  ) values (
    p_product_id, v_order_id, v_name, p_rating, v_comment, v_verified, false
  )
  returning * into v_review;

  insert into private.product_review_rate_limits (submitter_hash)
  values (v_hash);

  return jsonb_build_object(
    'ok', true,
    'review_id', v_review.id,
    'product_id', v_review.product_id,
    'order_id', v_review.order_id,
    'is_verified_purchase', v_review.is_verified_purchase,
    'is_hidden', v_review.is_hidden,
    'created_at', v_review.created_at
  );
exception
  when unique_violation then
    if v_verified then
      raise exception 'Ya existe una reseña verificada para este producto en este pedido.' using errcode = '23505';
    end if;
    raise;
end;
$$;

revoke all on function public.submit_product_review(bigint, smallint, text, text, text, text) from public;
grant execute on function public.submit_product_review(bigint, smallint, text, text, text, text) to service_role;

-- Tracking projection extension ----------------------------------------------
-- Add product_id to tracking items so verified review submission can confirm
-- the selected product belongs to the tracked order without exposing PII.
-- Existing fields and grants are preserved.

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
        'product_id', i.product_id,
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
  where o.tracking_token_hash = encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
$$;

revoke execute on function public.get_order_for_tracking(text) from public, anon, authenticated;
grant  execute on function public.get_order_for_tracking(text) to service_role;

-- Realtime publication -------------------------------------------------------

do $$
declare
  publication_name constant text := 'supabase_realtime';
  realtime_tables constant regclass[] := array[
    'public.product_reviews'::regclass,
    'public.product_review_aggregates'::regclass
  ];
  target_table regclass;
  is_member boolean;
begin
  if not exists (select 1 from pg_publication where pubname = publication_name) then
    raise notice 'Publication "%" does not exist; skipping realtime publication changes.', publication_name;
    return;
  end if;

  foreach target_table in array realtime_tables loop
    select exists (
      select 1
      from pg_publication_rel pr
      join pg_publication p on p.oid = pr.prpubid
      join pg_class c on c.oid = pr.prrelid
      join pg_namespace n on n.oid = c.relnamespace
      where p.pubname = publication_name
        and n.nspname = split_part(target_table::text, '.', 1)
        and c.relname = split_part(target_table::text, '.', 2)
    ) into is_member;

    if not is_member then
      execute format('alter publication %I add table %s', publication_name, target_table::text);
    end if;
  end loop;
end;
$$;
