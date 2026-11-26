-- P6 — Unified notification Realtime membership.
--
-- Local-only, additive and repeatable. The OQ-16 SLA inbox already exists in
-- Staging and Production; this file only adds `public.admin_notifications` to
-- `supabase_realtime` when the publication exists and the table is not already
-- a member. It does not change RLS, grants, triggers, RPCs, replica identity or
-- any SLA timing/receipt rule. The two notification tables stay separate.
--
-- INSERT events carry the complete new row and are the only source of truth for
-- the browser refresh. `REPLICA IDENTITY FULL` is intentionally not used: RLS,
-- not the old-row image, authorizes Realtime payloads.
--
-- This file is local-only: no remote migration, no deployed change, no seed.

do $$
declare
  publication_name constant text := 'supabase_realtime';
  target_table constant regclass := 'public.admin_notifications'::regclass;
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
      and c.relname = 'admin_notifications'
  ) into is_member;

  if not is_member then
    execute format('alter publication %I add table %s', publication_name, target_table::text);
  end if;
end;
$$;
