-- M1 — Catalog & administrative foundation (Phase 1B)
--
-- Implements, without deviation:
--   * docs/DATABASE_DESIGN.md  §3 (products, product_images), §4 (store_settings,
--     delivery_zones), §5 (administrators), §10.2 (audit_log)
--   * docs/SECURITY_DESIGN.md  §3 (authorization helper), §4 (RLS policies),
--     §7 (product-images storage bucket)
--   * docs/DECISIONS.md        #12–#14, #20, #21, #22
--
-- Seeds use only values confirmed in SPEC.md (§6 delivery zones; singleton
-- settings row with NULL business fields). No administrators, products,
-- prices, images or credentials are invented here (TASKS B2/B3).
--
-- Status: NOT applied to any remote Supabase project — this file is validated
-- locally only. RLS is the row-level boundary (SECURITY_DESIGN §2); Supabase
-- default table grants are left in place by design.

-- 1. Extensions ---------------------------------------------------------------

create extension if not exists pgcrypto with schema extensions;

-- 2. Schemas ------------------------------------------------------------------

-- Private helper schema: PostgREST exposes only `public` by default, so nothing
-- in `private` is callable as an RPC by API clients (SECURITY_DESIGN §3.2).
create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;

-- 3. Tables -------------------------------------------------------------------
-- Order matters: administrators first (store_settings and audit_log reference it).

-- Authorization source of truth (SPEC §16): Supabase Auth owns credentials;
-- this table alone decides who is an administrator. No client write policies.
create table public.administrators (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table public.products (
  id          bigint generated always as identity primary key,
  slug        text not null,
  name        text not null,
  description text not null,
  price_usd   numeric(10,2) not null check (price_usd >= 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint products_slug_key unique (slug)
);

-- Partial index: storefront listing always filters on is_active.
create index products_active_idx on public.products (id) where is_active;

create table public.product_images (
  id           bigint generated always as identity primary key,
  product_id   bigint not null references public.products (id) on delete cascade,
  storage_path text not null,
  position     integer not null check (position >= 0),
  created_at   timestamptz not null default now(),
  constraint product_images_storage_path_key unique (storage_path)
);

-- FK index; also used by the RLS policy that joins to products.is_active.
create index product_images_product_id_idx on public.product_images (product_id);

-- Singleton row (CHECK id = 1); jsonb shapes are defined later (DECISIONS #22).
-- Contains customer-facing configuration only — never secrets.
create table public.store_settings (
  id                  smallint primary key,
  pickup_address      text,
  whatsapp_phone      text,
  business_hours      jsonb,
  payment_instructions jsonb,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.administrators (id) on delete set null,
  constraint store_settings_id_check check (id = 1)
);

create table public.delivery_zones (
  id             bigint generated always as identity primary key,
  name           text not null,
  description    text,
  fee_usd        numeric(10,2) not null check (fee_usd >= 0),
  requires_quote boolean not null default false,
  is_active      boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint delivery_zones_name_key unique (name)
);

create index delivery_zones_active_idx
  on public.delivery_zones (sort_order, id) where is_active;

-- Append-only audit trail (SPEC §16): no UPDATE/DELETE policy for any client
-- role; INSERT is attributed to the acting admin (DECISIONS #21).
create table public.audit_log (
  id          bigint generated always as identity primary key,
  admin_id    uuid references public.administrators (id) on delete set null,
  action      text not null, -- naming convention: domain.verb (e.g. product.update)
  entity_type text not null,
  entity_id   text not null, -- text so any PK shape fits
  data        jsonb,
  created_at  timestamptz not null default now()
);

create index audit_log_created_at_idx on public.audit_log (created_at desc);
create index audit_log_entity_idx     on public.audit_log (entity_type, entity_id);
create index audit_log_admin_id_idx   on public.audit_log (admin_id);

-- 4. updated_at maintenance ---------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function private.set_updated_at() from public, anon;
grant  execute on function private.set_updated_at() to authenticated, service_role;

create trigger products_updated_at
  before update on public.products
  for each row execute function private.set_updated_at();

create trigger store_settings_updated_at
  before update on public.store_settings
  for each row execute function private.set_updated_at();

create trigger delivery_zones_updated_at
  before update on public.delivery_zones
  for each row execute function private.set_updated_at();

-- 5. Authorization helper (SECURITY_DESIGN §3.2) ------------------------------
-- SECURITY DEFINER avoids the recursive-policy error that would occur if a
-- policy on `administrators` selected the table directly. Never reads
-- user_metadata/app_metadata (SPEC §16): only auth.uid() -> table lookup.
-- Must be created after public.administrators exists.

create or replace function private.is_admin()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.administrators
    where id = (select auth.uid())
      and is_active
  );
$$;

-- Execute is needed for policy evaluation; revoke first so `public` never
-- retains it. The function only returns a boolean about the caller and lives
-- outside the exposed schema (not callable as an RPC).
revoke execute on function private.is_admin() from public, anon, authenticated;
grant  execute on function private.is_admin() to anon, authenticated;

-- 6. Row Level Security (enabled + forced on every exposed table) -------------

alter table public.administrators  enable row level security;
alter table public.administrators  force row level security;
alter table public.products        enable row level security;
alter table public.products        force row level security;
alter table public.product_images  enable row level security;
alter table public.product_images  force row level security;
alter table public.store_settings  enable row level security;
alter table public.store_settings  force row level security;
alter table public.delivery_zones  enable row level security;
alter table public.delivery_zones  force row level security;
alter table public.audit_log       enable row level security;
alter table public.audit_log       force row level security;

-- 7. Policies (SECURITY_DESIGN §4.2) ------------------------------------------
-- `TO` clauses are explicit (never the deprecated auth.role()); identity
-- lookups are wrapped in a scalar subquery so they run once per statement;
-- every UPDATE policy would carry USING + WITH CHECK (the ALL policies do).

-- Public catalog: read-only, active rows only. Zero writes for anon.
create policy products_public_select on public.products
  for select to anon using (is_active);

create policy product_images_public_select on public.product_images
  for select to anon
  using (exists (
    select 1 from public.products p
    where p.id = product_id and p.is_active
  ));

create policy delivery_zones_public_select on public.delivery_zones
  for select to anon using (is_active);

create policy store_settings_public_select on public.store_settings
  for select to anon using (true); -- single row, customer-facing content only

-- Administrator powers: one ALL policy per table, gated by the live
-- administrators row (deactivation takes effect on the next query).
create policy products_admin_all on public.products
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy product_images_admin_all on public.product_images
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy delivery_zones_admin_all on public.delivery_zones
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy store_settings_admin_all on public.store_settings
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- administrators: read-only for admins. No INSERT/UPDATE/DELETE policy for any
-- client role — provisioning is service-role only, so no session can grant
-- itself administrator (SECURITY_DESIGN §3.1).
create policy administrators_select on public.administrators
  for select to authenticated using ((select private.is_admin()));

-- audit_log: append-only, attributed to the acting admin (DECISIONS #21).
create policy audit_log_select on public.audit_log
  for select to authenticated using ((select private.is_admin()));

create policy audit_log_insert_as_self on public.audit_log
  for insert to authenticated
  with check ((select private.is_admin()) and admin_id = (select auth.uid()));

-- 8. Storage: public product-images bucket (SECURITY_DESIGN §7) ---------------
-- Public read comes from the bucket's public flag; only administrators may
-- write. Payment receipts (private bucket) belong to M4.

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = excluded.public;

create policy product_images_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and (select private.is_admin()));

create policy product_images_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and (select private.is_admin()))
  with check (bucket_id = 'product-images' and (select private.is_admin()));

create policy product_images_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and (select private.is_admin()));

-- 9. Seeds (SPEC-confirmed values only) ---------------------------------------

-- Singleton settings row: business fields stay NULL until real data exists
-- (pickup address configurable later; whatsapp/hours/instructions pending
-- OQ-6/OQ-8 and SPEC §19 — nothing invented).
insert into public.store_settings (id)
values (1)
on conflict (id) do nothing;

-- Delivery zones — SPEC §6 confirmed fees only. Descriptions remain NULL
-- because exact geographic boundaries are pending discovery (OQ-3).
insert into public.delivery_zones (name, fee_usd, requires_quote, sort_order)
values
  ('Zona norte de Barquisimeto', 0.00, false, 1),
  ('Resto de Barquisimeto',      5.00, false, 2),
  ('Fuera de Barquisimeto',      0.00, true,  3)
on conflict (name) do nothing;

-- No products, no administrators: their data is not confirmed (TASKS B2/B3).
