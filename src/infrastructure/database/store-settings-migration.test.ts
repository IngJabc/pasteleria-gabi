/**
 * OQ-8 — behavioral validation of
 * `supabase/migrations/009_store_settings_schedule.sql`.
 *
 * Applies 001–009 to a throwaway local PostgreSQL cluster with the Supabase
 * stub. Verifies the singleton stays NULL/backward compatible, the exact JSONB
 * contract is enforced at the database boundary, RLS write boundaries are
 * unchanged, and schedules cannot affect 24/7 checkout. No remote database is
 * contacted. Skipped when local PostgreSQL binaries are unavailable.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  findPostgresTools,
  startLocalPostgres,
  SUPABASE_STUB_SQL,
  type LocalPostgres,
  type PsqlResult,
  type PostgresTools,
} from "./local-postgres";

const tools: PostgresTools | null = findPostgresTools();
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const MIGRATIONS = [
  "001_catalog_and_admin_foundation.sql",
  "002_inventory_foundation.sql",
  "003_orders_and_reservations.sql",
  "004_quote_acceptance.sql",
  "005_receipt_sla_notifications.sql",
  "006_payments_and_verification.sql",
  "007_bcv_rates_and_rounding.sql",
  "008_realtime_publication.sql",
  "009_store_settings_schedule.sql",
].map((name) => path.join(repoRoot, "supabase", "migrations", name));

const ADMIN = "11111111-1111-4111-8111-111111111111";
const STRANGER = "99999999-9999-4999-8999-999999999999";

const fullDay = (start: string, end: string): string => `{"start":"${start}","end":"${end}"}`;

function week(dayValue: string): string {
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  return `{${days.map((day) => `"${day}":${dayValue}`).join(",")}}`;
}

function document(attention: string, pickup: string, timezone = "America/Caracas"): string {
  return `{"timezone":"${timezone}","attention":${attention},"pickup":${pickup}}`;
}

describe.skipIf(!tools)("store settings schedule migration on a disposable local PostgreSQL", () => {
  let db: LocalPostgres;

  const asService = (sql: string): Promise<PsqlResult> => db.psql(`set role service_role;\n${sql}`);
  const asAnon = (sql: string): Promise<PsqlResult> => db.psql(`set role anon;\n${sql}`);
  const asUser = (sub: string, sql: string): Promise<PsqlResult> =>
    db.psql(
      `do $$ begin perform set_config('request.jwt.claim.sub', '${sub}', false); end $$;\n` +
        `set role authenticated;\n${sql}`,
    );

  const allText = (r: PsqlResult): string => `${r.stdout}\n${r.stderr}`;
  const lines = (text: string): string[] =>
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "");

  async function ok(sql: string): Promise<string[]> {
    const result = await asService(sql);
    expect(result.code, allText(result)).toBe(0);
    return lines(result.stdout);
  }
  async function scalar(sql: string): Promise<string> {
    return (await ok(sql))[0] ?? "";
  }
  async function fail(sql: string, role: "service" | "anon" | "authenticated" = "service"): Promise<string> {
    const result =
      role === "anon" ? await asAnon(sql)
      : role === "authenticated" ? await asUser(STRANGER, sql)
      : await asService(sql);
    expect(result.code, allText(result)).not.toBe(0);
    return allText(result);
  }

  beforeAll(async () => {
    if (!tools) throw new Error("local PostgreSQL binaries not found");
    db = await startLocalPostgres(tools);
    await db.applyScript(SUPABASE_STUB_SQL);
    for (const file of MIGRATIONS) {
      await db.applyFile(file);
    }
    const fixtures = await db.psql(`
      insert into auth.users (id, email) values
        ('${ADMIN}', 'admin@example.test'),
        ('${STRANGER}', 'stranger@example.test');
      insert into public.administrators (id, display_name, is_active) values
        ('${ADMIN}', 'Admin', true);
      insert into public.products (slug, name, description, price_usd) values
        ('oq8-cake', 'Tarta OQ-8', 'prueba', 10.25);
      insert into public.inventory_batches
        (product_id, initial_quantity, remaining_quantity, production_date, created_by)
      select id, 20, 20, '2026-11-01', '${ADMIN}' from public.products where slug = 'oq8-cake';
    `);
    expect(fixtures.code, allText(fixtures)).toBe(0);
  }, 240_000);

  afterAll(async () => {
    if (db) await db.stop();
  }, 60_000);

  it("preserves the singleton with NULL schedule and no invented data", async () => {
    expect(await scalar(`select count(*) from public.store_settings`)).toBe("1");
    expect(await scalar(`select business_hours is null from public.store_settings where id = 1`)).toBe("t");
    expect(await scalar(`select pickup_address is null from public.store_settings where id = 1`)).toBe("t");
    expect(await scalar(`select count(*) from pg_constraint where conname = 'store_settings_business_hours_check'`)).toBe("1");
    expect(await scalar(`select count(*) from pg_policies where schemaname = 'public' and tablename = 'store_settings'`)).toBe("2");
    expect(await scalar(`select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.store_settings'::regclass`)).toBe("t");
  });

  it("accepts a complete weekly document with closed days and multiple intervals", async () => {
    const attention = week(`[${fullDay("09:00", "13:00")},${fullDay("15:00", "18:00")}]`).replace(
      '"sunday":[' + fullDay("09:00", "13:00") + ',' + fullDay("15:00", "18:00") + ']',
      '"sunday":[]',
    );
    const pickup = week(`[${fullDay("10:00", "17:00")}]`).replace(
      '"sunday":[' + fullDay("10:00", "17:00") + ']',
      '"sunday":[]',
    );
    const doc = document(attention, pickup);
    await ok(`update public.store_settings set business_hours = '${doc}'::jsonb where id = 1`);
    expect(await scalar(`select business_hours ->> 'timezone' from public.store_settings where id = 1`)).toBe("America/Caracas");
    expect(await scalar(`select jsonb_array_length(business_hours -> 'attention' -> 'monday') from public.store_settings where id = 1`)).toBe("2");
    expect(await scalar(`select jsonb_array_length(business_hours -> 'pickup' -> 'sunday') from public.store_settings where id = 1`)).toBe("0");
    // NULL remains valid for backward compatibility.
    await ok(`update public.store_settings set business_hours = null where id = 1`);
    expect(await scalar(`select business_hours is null from public.store_settings where id = 1`)).toBe("t");
  });

  it("rejects invalid documents at the database boundary", async () => {
    const validAttention = week(`[${fullDay("09:00", "18:00")}]`);
    const validPickup = week(`[${fullDay("10:00", "17:00")}]`);
    const cases: Record<string, string> = {
      "non-object": `'[]'::jsonb`,
      "missing section": `('${document(validAttention, validPickup)}'::jsonb - 'pickup')`,
      "extra key": `('${document(validAttention, validPickup)}'::jsonb || '{"extra":1}'::jsonb)`,
      "wrong timezone": `'${document(validAttention, validPickup, "America/New_York")}'::jsonb`,
      "missing weekday": `(('${document(validAttention, validPickup)}'::jsonb) #- '{attention,sunday}')`,
      "day not array": `jsonb_set('${document(validAttention, validPickup)}'::jsonb, '{attention,monday}', '"09:00"')`,
      "bad time format": `'${document(week(`[${fullDay("9:00", "18:00")}]`), validPickup)}'::jsonb`,
      "start after end": `'${document(week(`[${fullDay("18:00", "09:00")}]`), validPickup)}'::jsonb`,
      "overlapping intervals": `'${document(week(`[${fullDay("09:00", "14:00")},${fullDay("13:00", "18:00")}]`), validPickup)}'::jsonb`,
      "interval extra key": `'${document(week(`[{"start":"09:00","end":"18:00","note":"x"}]`), validPickup)}'::jsonb`,
    };
    for (const [name, value] of Object.entries(cases)) {
      const message = await fail(`update public.store_settings set business_hours = ${value} where id = 1`);
      expect(message, name).toMatch(/store_settings_business_hours_check/);
    }
    expect(await scalar(`select business_hours is null from public.store_settings where id = 1`)).toBe("t");
  });

  it("does not change RLS write boundaries", async () => {
    const doc = `'${document(week(`[${fullDay("09:00", "18:00")}]`), week(`[${fullDay("10:00", "17:00")}]`))}'::jsonb`;
    const updateSql = `update public.store_settings set business_hours = ${doc} where id = 1`;

    // With no matching RLS policy these writes touch zero rows (a successful
    // statement), so verify the stored value instead of expecting an error.
    await asAnon(updateSql);
    expect(await scalar(`select business_hours is null from public.store_settings where id = 1`)).toBe("t");
    await asUser(STRANGER, updateSql);
    expect(await scalar(`select business_hours is null from public.store_settings where id = 1`)).toBe("t");

    const admin = await asUser(
      ADMIN,
      `update public.store_settings set business_hours = ${doc}, updated_by = '${ADMIN}' where id = 1 returning id`,
    );
    expect(admin.code, allText(admin)).toBe(0);
    expect(admin.stdout.trim()).toBe("1");
    expect(await scalar(`select updated_by = '${ADMIN}'::uuid from public.store_settings where id = 1`)).toBe("t");
  });

  it("cannot affect 24/7 checkout or order state", async () => {
    const pid = Number(await scalar(`select id from public.products where slug = 'oq8-cake'`));
    const created = await asService(
      `select public.create_online_order('Ana Perez', '04120001122', 'pickup', ` +
        `null, null, null, null, '[{"product_id": ${pid}, "quantity": 1}]');`,
    );
    expect(created.code, allText(created)).toBe(0);
    expect(await scalar(`select status from public.orders order by id desc limit 1`)).toBe("pending");
    expect(await scalar(`select count(*) from public.inventory_reservations`)).toBe("1");
    // Clearing the schedule does not touch any order.
    await ok(`update public.store_settings set business_hours = null where id = 1`);
    expect(await scalar(`select count(*) from public.orders`)).toBe("1");
  });
});
