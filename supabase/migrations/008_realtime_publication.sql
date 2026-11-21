-- M6 — Supabase Realtime publication for live administrative notifications.
--
-- Additive only: this migration adds three EXISTING tables to the
-- Supabase-managed `supabase_realtime` publication. It creates no table,
-- column, function, trigger, policy, grant or seed, and it changes no existing
-- object. Migrations 001-007 are not touched.
--
-- Security boundary: `orders`, `payments` and `cancellation_requests` already
-- have RLS enabled and FORCED, with a single ALL policy for `authenticated`
-- administrators (`private.is_admin()`); there is no `anon` policy and
-- non-admins are filtered out. Realtime authorization uses those same grants
-- and RLS policies, so publishing the tables does not expose records or fields
-- to a role that cannot read them through SQL. No policy is weakened to make a
-- subscription work.
--
-- Replica identity: all three tables have a primary key, and the default
-- REPLICA IDENTITY is intentionally retained. The existing policies depend on
-- the CALLER's admin status, not on row values, so a PK-only old tuple is
-- sufficient for Realtime to authorize UPDATE/DELETE events. REPLICA IDENTITY
-- FULL would publish every old column to the WAL without any authorization
-- benefit here, so it is not used.
--
-- This file is local-only: not applied to a remote project, not deployed.

-- 1. Publication ---------------------------------------------------------------
-- Supabase projects always provide `supabase_realtime`. The guard keeps the
-- migration self-contained on a plain PostgreSQL cluster (the local behavioral
-- suite) and is a no-op when the managed publication already exists.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) then
    execute 'create publication supabase_realtime';
  end if;
end $$;

-- 2. Membership ----------------------------------------------------------------
-- Catalog-based check (rather than pg_publication_tables) so it is independent
-- of the caller's table privileges. Each ADD is executed only when that table
-- is not already a member, making the migration safely repeatable.
do $$
declare
  t text;
begin
  foreach t in array array['orders', 'payments', 'cancellation_requests'] loop
    if not exists (
      select 1
      from pg_catalog.pg_publication p
      join pg_catalog.pg_publication_rel pr on pr.prpubid = p.oid
      join pg_catalog.pg_class c on c.oid = pr.prrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where p.pubname = 'supabase_realtime'
        and n.nspname = 'public'
        and c.relname = t
    ) then
      execute pg_catalog.format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
