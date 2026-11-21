-- OQ-8 (Phase 6) — canonical schedule structure for the existing singleton
-- `public.store_settings` row. Additive only: no new table, no column, no seed,
-- no grant/policy/RLS change, no edit to migrations 001-008.
--
-- `store_settings` already exists from M1 with:
--   * pickup_address text       -- business/pickup address (unchanged, free text)
--   * business_hours jsonb      -- NULL placeholder explicitly deferred to OQ-8
-- This migration only DEFINES AND VALIDATES the shape of `business_hours`.
-- It never writes data: the singleton keeps NULL until an administrator fills
-- it in from the panel. No address or opening hour is invented here.
--
-- BUSINESS RULES (SPEC §14):
--   * Orders are accepted 24/7. This structure is INFORMATIONAL ONLY: nothing
--     in checkout, order creation, payment, inventory or reservation expiry
--     reads it or can be blocked by it.
--   * Weekly recurring schedules with explicit closed days (empty array).
--   * Multiple non-overlapping intervals per day (e.g. a lunch break).
--   * Times are local wall-clock strings in America/Caracas; the timezone is
--     stored inside the document so clients never guess.
--
-- CANONICAL JSONB CONTRACT (exactly these keys, lowercase weekday names):
-- {
--   "timezone": "America/Caracas",
--   "attention": {
--     "monday": [{"start": "09:00", "end": "13:00"},
--                {"start": "15:00", "end": "18:00"}],
--     "tuesday": [...], "wednesday": [...], "thursday": [...],
--     "friday": [...], "saturday": [...],
--     "sunday": []            -- [] = closed day
--   },
--   "pickup": {               -- preparation / collection hours, same shape
--     "monday": [...], ... , "sunday": []
--   }
-- }
-- Times use HH24:MI with 00:00 <= start < end <= 23:59. Overnight intervals
-- are not supported; a business open past midnight must use two same-day
-- intervals. NULL remains valid for backward compatibility.

-- 1. Pure validators -----------------------------------------------------------

create or replace function private.valid_store_time(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$';
$$;

create or replace function private.validate_business_hours(p_hours jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_section   text;
  v_day       text;
  v_interval  jsonb;
  v_intervals jsonb;
  v_prev_end  text;
  v_days      text[] := array['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
begin
  -- NULL is the pre-OQ-8 placeholder and stays valid (backward compatible).
  if p_hours is null then
    return true;
  end if;

  if jsonb_typeof(p_hours) is distinct from 'object' then
    return false;
  end if;

  -- Exactly timezone + the two schedules; no extra keys.
  if (select array_agg(k order by k) from jsonb_object_keys(p_hours) as k)
       is distinct from array['attention', 'pickup', 'timezone'] then
    return false;
  end if;

  if p_hours ->> 'timezone' is distinct from 'America/Caracas' then
    return false;
  end if;

  foreach v_section in array array['attention', 'pickup'] loop
    if jsonb_typeof(p_hours -> v_section) is distinct from 'object' then
      return false;
    end if;

    -- Every weekday must be present, and no other key is allowed.
    if (select array_agg(k order by k) from jsonb_object_keys(p_hours -> v_section) as k)
         is distinct from (select array_agg(d order by d) from unnest(v_days) as d) then
      return false;
    end if;

    foreach v_day in array v_days loop
      v_intervals := p_hours -> v_section -> v_day;
      if jsonb_typeof(v_intervals) is distinct from 'array' then
        return false;
      end if;

      -- Empty array is a closed day. Each interval has exactly start/end,
      -- HH24:MI format, start < end, and intervals are ordered/non-overlapping.
      v_prev_end := null;
      for v_interval in select value from jsonb_array_elements(v_intervals) loop
        if jsonb_typeof(v_interval) is distinct from 'object' then
          return false;
        end if;
        if (select array_agg(k order by k) from jsonb_object_keys(v_interval) as k)
             is distinct from array['end', 'start'] then
          return false;
        end if;
        if not private.valid_store_time(v_interval ->> 'start')
           or not private.valid_store_time(v_interval ->> 'end') then
          return false;
        end if;
        if (v_interval ->> 'start') >= (v_interval ->> 'end') then
          return false;
        end if;
        if v_prev_end is not null and (v_interval ->> 'start') < v_prev_end then
          return false;
        end if;
        v_prev_end := v_interval ->> 'end';
      end loop;
    end loop;
  end loop;

  return true;
end $$;

-- Constraint evaluation and RLS policy evaluation must work for the same roles
-- that may write the singleton. Both functions are pure (no data access, no
-- side effects) and live in `private` with a pinned search_path.
revoke all on function private.valid_store_time(text) from public, anon, authenticated;
grant  execute on function private.valid_store_time(text) to authenticated, service_role;
revoke all on function private.validate_business_hours(jsonb) from public, anon, authenticated;
grant  execute on function private.validate_business_hours(jsonb) to authenticated, service_role;

-- 2. Database boundary ---------------------------------------------------------

alter table public.store_settings
  add constraint store_settings_business_hours_check
  check (private.validate_business_hours(business_hours));

comment on column public.store_settings.business_hours is
  'OQ-8: weekly attention/pickup schedules in America/Caracas. NULL until configured; informational only, never blocks an order. Shape: {"timezone":"America/Caracas","attention":{"monday":[{"start":"09:00","end":"13:00"}],...},"pickup":{...}}; [] is a closed day.';

-- The pickup address already exists as free text from M1 and is unchanged:
-- no new address column and no invented value. RLS/policies/grants are untouched.
