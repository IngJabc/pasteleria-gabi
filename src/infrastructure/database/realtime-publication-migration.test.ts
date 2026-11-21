/**
 * M6 — behavioral validation of
 * `supabase/migrations/008_realtime_publication.sql`.
 *
 * Applies 001–008 to a throwaway local PostgreSQL cluster with the Supabase
 * stub. Verifies publication membership and change-event flags, repeatability,
 * unchanged force-RLS/grants, that anon and non-admin clients see no protected
 * rows (the same boundary Realtime uses), and that order/payment/cancellation
 * flows still work. No remote database or running Realtime server is involved.
 *
 * Skipped automatically when local PostgreSQL binaries are unavailable.
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
const migration008 = path.join(repoRoot, "supabase", "migrations", "008_realtime_publication.sql");
const MIGRATIONS = [
  "001_catalog_and_admin_foundation.sql",
  "002_inventory_foundation.sql",
  "003_orders_and_reservations.sql",
  "004_quote_acceptance.sql",
  "005_receipt_sla_notifications.sql",
  "006_payments_and_verification.sql",
  "007_bcv_rates_and_rounding.sql",
  "008_realtime_publication.sql",
].map((name) => path.join(repoRoot, "supabase", "migrations", name));

const ADMIN = "11111111-1111-4111-8111-111111111111";
const STRANGER = "99999999-9999-4999-8999-999999999999";
const PUBLISHED = ["cancellation_requests", "orders", "payments"];

describe.skipIf(!tools)("realtime publication migration on a disposable local PostgreSQL", () => {
  let db: LocalPostgres;
  let orderId: number;
  let token: string;

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
  const last = (text: string): string => {
    const all = lines(text);
    return all.length ? all[all.length - 1] : "";
  };

  async function ok(sql: string): Promise<string[]> {
    const result = await asService(sql);
    expect(result.code, allText(result)).toBe(0);
    return lines(result.stdout);
  }
  async function scalar(sql: string): Promise<string> {
    return (await ok(sql))[0] ?? "";
  }
  async function expectFailure(sql: string, role: "anon" | "authenticated" = "anon"): Promise<string> {
    const result = role === "anon" ? await asAnon(sql) : await asUser(STRANGER, sql);
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
        ('m6-cake', 'Tarta Realtime', 'prueba', 10.25);
      insert into public.inventory_batches
        (product_id, initial_quantity, remaining_quantity, production_date, created_by)
      select id, 20, 20, '2026-11-01', '${ADMIN}' from public.products where slug = 'm6-cake';
    `);
    expect(fixtures.code, allText(fixtures)).toBe(0);

    const pid = Number(await scalar(`select id from public.products where slug = 'm6-cake'`));
    const created = await asService(
      `select public.create_online_order('Ana Perez', '04120001122', 'pickup', ` +
        `null, null, null, null, '[{"product_id": ${pid}, "quantity": 1}]');`,
    );
    expect(created.code, allText(created)).toBe(0);
    const payload = JSON.parse(last(created.stdout)) as { order_id: number; tracking_token: string };
    orderId = payload.order_id;
    token = payload.tracking_token;

    const payment = await asService(
      `select public.register_payment(${orderId}, 'cash_usd', 'USD', 10.25, ` +
        `null, null, 20.00, 'm6-cash-1');`,
    );
    expect(payment.code, allText(payment)).toBe(0);
    const cancel = await asService(`select public.request_order_cancellation('${token}', 'Prueba M6');`);
    expect(cancel.code, allText(cancel)).toBe(0);
  }, 240_000);

  afterAll(async () => {
    if (db) await db.stop();
  }, 60_000);

  it("publishes exactly the three approved tables with insert/update/delete/truncate enabled", async () => {
    expect(await ok(`select tablename from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' order by tablename;`)).toEqual(PUBLISHED);
    expect(await scalar(`select count(*) from pg_catalog.pg_publication where pubname = 'supabase_realtime'`)).toBe("1");
    expect(await ok(`select puballtables || '|' || pubinsert || '|' || pubupdate || '|' || pubdelete || '|' || pubtruncate
      from pg_catalog.pg_publication where pubname = 'supabase_realtime';`)).toEqual(["false|true|true|true|true"]);
    // No REPLICA IDENTITY FULL: PK-only old tuples are enough for these policies.
    expect(await ok(`select c.relname || '|' || c.relreplident::text
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any(array['orders','payments','cancellation_requests'])
      order by c.relname;`)).toEqual(PUBLISHED.map((name) => `${name}|d`));
  });

  it("is safely repeatable and does not create duplicate membership", async () => {
    await db.applyFile(migration008);
    await db.applyFile(migration008);
    expect(await ok(`select tablename from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' order by tablename;`)).toEqual(PUBLISHED);
    expect(await scalar(`select count(*) from pg_catalog.pg_publication_rel pr
      join pg_catalog.pg_publication p on p.oid = pr.prpubid
      where p.pubname = 'supabase_realtime';`)).toBe("3");
  });

  it("leaves force RLS, admin-only policies and grants untouched", async () => {
    for (const table of PUBLISHED) {
      expect(await scalar(`select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.${table}'::regclass`), table).toBe("t");
      expect(await scalar(`select count(*) from pg_policies where schemaname = 'public' and tablename = '${table}'`), table).toBe("1");
      expect(await scalar(`select policyname from pg_policies where schemaname = 'public' and tablename = '${table}'`), table).toBe(`${table}_admin_all`);
    }
    expect(await scalar(`select has_table_privilege('anon', 'public.payments', 'SELECT')`)).toBe("f");
    expect(await scalar(`select has_table_privilege('authenticated', 'public.payments', 'SELECT')`)).toBe("t");
    expect(await scalar(`select has_table_privilege('service_role', 'public.orders', 'SELECT')`)).toBe("t");
  });

  it("does not expose protected rows to anon or non-admin authenticated clients", async () => {
    for (const table of ["orders", "cancellation_requests"]) {
      expect((await asAnon(`select count(*) from public.${table};`)).stdout.trim(), table).toBe("0");
      expect((await asUser(STRANGER, `select count(*) from public.${table};`)).stdout.trim(), table).toBe("0");
    }
    // 006 revoked anon table access to financial data entirely.
    expect(await expectFailure(`select count(*) from public.payments;`)).toMatch(/permission denied/i);
    expect((await asUser(STRANGER, `select count(*) from public.payments;`)).stdout.trim()).toBe("0");

    // Administrators keep full read access, which is what Realtime relies on.
    for (const table of PUBLISHED) {
      const result = await asUser(ADMIN, `select count(*) from public.${table};`);
      expect(result.code, allText(result)).toBe(0);
      expect(Number(result.stdout.trim()), table).toBeGreaterThan(0);
    }
  });

  it("keeps order, payment and cancellation workflows working after publication", async () => {
    const replay = await asService(
      `select public.register_payment(${orderId}, 'cash_usd', 'USD', 10.25, ` +
        `null, null, 20.00, 'm6-cash-1');`,
    );
    expect(replay.code, allText(replay)).toBe(0);
    expect(await scalar(`select count(*) from public.payments where order_id = ${orderId} and idempotency_key = 'm6-cash-1'`)).toBe("1");
    expect(await scalar(`select status from public.payments where order_id = ${orderId} limit 1`)).toBe("pending");
    expect(await scalar(`select count(*) from public.cancellation_requests where order_id = ${orderId}`)).toBe("1");
    expect(await scalar(`select status from public.orders where id = ${orderId}`)).toBe("pending");
  });
});
