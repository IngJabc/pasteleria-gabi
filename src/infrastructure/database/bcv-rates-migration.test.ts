/**
 * OQ-4/OQ-5 — behavioral validation of
 * `supabase/migrations/007_bcv_rates_and_rounding.sql`.
 *
 * Applies 001–007 to a throwaway local PostgreSQL cluster with the Supabase
 * stub. Exercises manual rate registration, correction/deactivation,
 * last-active-rate lookup with age, per-order rate snapshots, the single
 * round-half-up rule, idempotent re-snapshots, no-active-rate failure, grants
 * and audit rows. No remote database is contacted.
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
const MIGRATIONS = [
  "001_catalog_and_admin_foundation.sql",
  "002_inventory_foundation.sql",
  "003_orders_and_reservations.sql",
  "004_quote_acceptance.sql",
  "005_receipt_sla_notifications.sql",
  "006_payments_and_verification.sql",
  "007_bcv_rates_and_rounding.sql",
].map((name) => path.join(repoRoot, "supabase", "migrations", name));

const ADMIN_1 = "11111111-1111-4111-8111-111111111111";
const ADMIN_2 = "22222222-2222-4222-8222-222222222222";
const INACTIVE = "33333333-3333-4333-8333-333333333333";
const STRANGER = "99999999-9999-4999-8999-999999999999";

interface JsonResult {
  [key: string]: string | number | boolean | null;
}

describe.skipIf(!tools)("BCV rates + rounding migration on a disposable local PostgreSQL", () => {
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
  const last = (text: string): string => {
    const all = lines(text);
    return all.length ? all[all.length - 1] : "";
  };

  async function ok(sql: string, role: "service" | "anon" | "authenticated" = "service", sub = ADMIN_1): Promise<string[]> {
    const result =
      role === "service" ? await asService(sql)
      : role === "anon" ? await asAnon(sql)
      : await asUser(sub, sql);
    expect(result.code, allText(result)).toBe(0);
    return lines(result.stdout);
  }

  async function json(sql: string): Promise<JsonResult> {
    const rows = await ok(sql);
    const jsonLine = rows.find((line) => line.startsWith("{") || line.startsWith("["));
    expect(jsonLine, `expected a JSON row in psql output: ${rows.join(" | ")}`).toBeDefined();
    return JSON.parse(jsonLine as string) as JsonResult;
  }

  async function scalar(sql: string): Promise<string> {
    return (await ok(sql))[0] ?? "";
  }

  async function expectSqlState(expr: string, expected: string): Promise<string> {
    const result = await asService(
      `do $$ begin\n` +
        `  perform ${expr};\n` +
        `  raise notice 'SQLSTATE=OK';\n` +
        `exception when others then\n` +
        `  raise notice 'SQLSTATE=%', sqlstate;\n` +
        `end $$;`,
    );
    expect(result.code, allText(result)).toBe(0);
    const match = allText(result).match(/SQLSTATE=(\S+)/);
    expect(match, `${expr}\n${allText(result)}`).not.toBeNull();
    expect(match?.[1], expr).toBe(expected);
    return match?.[1] ?? "";
  }

  interface CreatedOrder {
    orderId: number;
    token: string;
  }

  async function expectFailure(sql: string): Promise<string> {
    const result = await asService(sql);
    expect(result.code, allText(result)).not.toBe(0);
    return allText(result);
  }

  async function createOrder(productSlug: string, quantity = 1): Promise<CreatedOrder> {
    const pid = Number(await scalar(`select id from public.products where slug = '${productSlug}'`));
    const result = await asService(
      `select public.create_online_order('Ana Perez', '04120001122', 'pickup', ` +
        `null, null, null, null, '[{"product_id": ${pid}, "quantity": ${quantity}}]');`,
    );
    expect(result.code, allText(result)).toBe(0);
    const parsed = JSON.parse(last(result.stdout)) as {
      order_id: number;
      tracking_token: string;
    };
    return { orderId: parsed.order_id, token: parsed.tracking_token };
  }

  /** Canonical atomic path: order creation + BCV snapshot in one transaction. */
  async function createOrderWithBcv(
    productSlug: string,
    quantity = 1,
    customer = "Ana Perez",
  ): Promise<CreatedOrder & { result: JsonResult }> {
    const pid = Number(await scalar(`select id from public.products where slug = '${productSlug}'`));
    const result = await asService(
      `select public.create_online_order_with_bcv('${customer}', '04120001122', 'pickup', ` +
        `null, null, null, null, '[{"product_id": ${pid}, "quantity": ${quantity}}]');`,
    );
    expect(result.code, allText(result)).toBe(0);
    const parsed = JSON.parse(last(result.stdout)) as JsonResult;
    return {
      orderId: Number(parsed.order_id),
      token: String(parsed.tracking_token),
      result: parsed,
    };
  }

  async function registerRate(
    rate: string,
    source: string,
    admin = ADMIN_1,
    observedAt: string | null = null,
    supersedesId: number | null = null,
    key: string | null = null,
  ): Promise<number> {
    const args = [
      rate,
      `'${source}'`,
      `'${admin}'`,
      observedAt ? `'${observedAt}'` : "null",
      supersedesId === null ? "null" : String(supersedesId),
      "null",
      key ? `'${key}'` : "null",
    ].join(", ");
    const result = await json(`select public.register_bcv_rate(${args})`);
    return Number(result.rate_id);
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
        ('${ADMIN_1}', 'a1@example.test'),
        ('${ADMIN_2}', 'a2@example.test'),
        ('${INACTIVE}', 'inactive@example.test'),
        ('${STRANGER}', 'stranger@example.test');
      insert into public.administrators (id, display_name, is_active) values
        ('${ADMIN_1}', 'Admin One', true),
        ('${ADMIN_2}', 'Admin Two', true),
        ('${INACTIVE}', 'Inactive', false);
      insert into public.products (slug, name, description, price_usd) values
        ('bcv-cake', 'Tarta BCV', 'prueba', 10.25),
        ('bcv-small', 'Tarta Chica', 'prueba', 0.05);
      insert into public.inventory_batches
        (product_id, initial_quantity, remaining_quantity, production_date, created_by)
      select id, 50, 50, '2026-11-01', '${ADMIN_1}' from public.products
       where slug in ('bcv-cake', 'bcv-small');
    `);
    expect(fixtures.code, allText(fixtures)).toBe(0);
  }, 240_000);

  afterAll(async () => {
    if (db) await db.stop();
  }, 60_000);

  it("adds only the documented additive schema objects and preserves staging rows", async () => {
    const columns = await ok(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'exchange_rates' order by column_name;`,
    );
    for (const name of ["is_active", "registered_by", "supersedes_id", "note", "idempotency_key"]) {
      expect(columns).toContain(name);
    }
    expect(await scalar(`select count(*) from pg_constraint where conname = 'orders_rounding_rule_check'`)).toBe("1");
    expect(await scalar(`select count(*) from pg_indexes where indexname = 'exchange_rates_active_lookup_idx'`)).toBe("1");
    // No seeds: a fresh cluster has no rate rows.
    expect(await scalar(`select count(*) from public.exchange_rates`)).toBe("0");
    expect(await scalar(`select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.exchange_rates'::regclass`)).toBe("t");
  });

  it("registers a rate manually, is idempotent, and audits the administrative action", async () => {
    const first = await json(
      `select public.register_bcv_rate(36.5000, 'manual:bcv', '${ADMIN_1}', ` +
        `'2020-01-01 10:00:00+00', null, 'prueba', 'rate-key-0001')`,
    );
    expect(first.idempotent).toBe(false);
    const replay = await json(
      `select public.register_bcv_rate(99.0000, 'manual:other', '${ADMIN_2}', ` +
        `'2020-01-01 11:00:00+00', null, null, 'rate-key-0001')`,
    );
    expect(replay.idempotent).toBe(true);
    expect(replay.rate_id).toBe(first.rate_id);
    expect(await scalar(`select count(*) from public.exchange_rates`)).toBe("1");
    expect(await scalar(`select rate_ves_per_usd::text from public.exchange_rates`)).toBe("36.5000");
    expect(await scalar(`select registered_by = '${ADMIN_1}'::uuid from public.exchange_rates`)).toBe("t");

    const audit = await ok(
      `select action from public.audit_log where entity_type = 'exchange_rate' order by id;`,
    );
    expect(audit).toEqual(["exchange_rate.register"]);
  });

  it("validates rate, source and administrator at the database boundary", async () => {
    await expectSqlState(`public.register_bcv_rate(0, 'manual', '${ADMIN_1}')`, "22023");
    await expectSqlState(`public.register_bcv_rate(-1, 'manual', '${ADMIN_1}')`, "22023");
    await expectSqlState(`public.register_bcv_rate(1.12345, 'manual', '${ADMIN_1}')`, "22023");
    await expectSqlState(`public.register_bcv_rate(1, '   ', '${ADMIN_1}')`, "22023");
    await expectSqlState(`public.register_bcv_rate(1, 'manual', '${INACTIVE}')`, "42501");
    await expectSqlState(`public.register_bcv_rate(1, 'manual', null)`, "22023");
  });

  it("serves the latest active rate with its age and historical as-of lookups", async () => {
    await registerRate("37.0000", "manual:bcv", ADMIN_1, "2020-01-01 12:00:00+00");
    expect(await scalar(`select public.get_last_ves_per_usd()::text`)).toBe("37.0000");

    const current = await json(`select public.get_bcv_rate()`);
    expect(Number(current.rate_ves_per_usd)).toBe(37);
    expect(current.source).toBe("manual:bcv");
    expect(typeof current.age_seconds).toBe("number");
    expect(current.is_stale).toBe(true); // fixture is far in the past relative to `now()`

    const asOf = await json(`select public.get_bcv_rate('2020-01-01 10:30:00+00'::timestamptz)`);
    expect(Number(asOf.rate_ves_per_usd)).toBe(36.5);
    const none = await ok(`select public.get_bcv_rate('2019-01-01'::timestamptz) is null`);
    expect(none).toEqual(["t"]);
  });

  it("corrects a rate by deactivating the old row and keeping both for history", async () => {
    const bad = await ok(`select id from public.exchange_rates where rate_ves_per_usd = 37.0000`);
    const badId = Number(bad[0]);
    const corrected = await registerRate("37.2000", "manual:correction", ADMIN_2, "2020-01-01 13:00:00+00", badId);

    expect(await scalar(`select is_active from public.exchange_rates where id = ${badId}`)).toBe("f");
    expect(await scalar(`select is_active from public.exchange_rates where id = ${corrected}`)).toBe("t");
    expect(await scalar(`select supersedes_id = ${badId} from public.exchange_rates where id = ${corrected}`)).toBe("t");
    expect(await scalar(`select count(*) from public.exchange_rates`)).toBe("3");
    expect(await scalar(`select public.get_last_ves_per_usd()::text`)).toBe("37.2000");

    // A second correction of an already inactive row must fail atomically.
    await expectSqlState(
      `public.register_bcv_rate(38, 'manual', '${ADMIN_1}', null, ${badId}, null, 'correction-race')`,
      "P0002",
    );
    expect(await scalar(`select count(*) from public.exchange_rates`)).toBe("3");
  });

  it("snapshots the exact rate on the order and applies round_half_up once at the total", async () => {
    const { orderId, token } = await createOrder("bcv-cake", 2); // 20.50 USD
    // 20.50 * 37.2000 = 762.600 -> 762.60
    const result = await json(`select public.apply_bcv_rate_for_tracking('${token}')`);
    expect(result.order_id).toBe(orderId);
    expect(result.applied).toBe(true);
    expect(Number(result.bcv_rate_ves)).toBe(37.2);
    expect(result.rounding_rule).toBe("round_half_up");
    expect(Number(result.total_ves)).toBe(762.6);

    const stored = await json(
      `select jsonb_build_object('bcv_rate_ves', o.bcv_rate_ves, 'bcv_rate_at', o.bcv_rate_at, ` +
        `'total_ves', o.total_ves, 'rounding_rule', o.rounding_rule) ` +
        `from public.orders o where o.id = ${orderId}`,
    );
    expect(Number(stored.total_ves)).toBe(762.6);
    expect(stored.rounding_rule).toBe("round_half_up");
    expect(stored.bcv_rate_at).not.toBeNull();

    // Guest snapshots are not administrative actions.
    expect(await scalar(`select count(*) from public.audit_log where entity_type = 'order' and entity_id = '${orderId}'`)).toBe("0");
  });

  it("demonstrates the half-up boundary and rejects per-item rounding", async () => {
    // 10.25 * 36.5 = 374.125 -> 374.13 (half up), NOT 374.12 (half even).
    await registerRate("36.5000", "manual:boundary", ADMIN_1, "2020-01-01 14:00:00+00");
    const { orderId } = await createOrder("bcv-cake", 1);
    const result = await json(`select public.apply_bcv_rate_to_order(${orderId}, '${ADMIN_1}')`);
    expect(Number(result.total_ves)).toBe(374.13);
    expect(await scalar(`select rounding_rule from public.orders where id = ${orderId}`)).toBe("round_half_up");

    // A second item would be 374.13 * 2 = 748.26 if rounded per line; rounding
    // only the final total gives 20.50 * 36.5 = 748.25.
    const two = await createOrder("bcv-cake", 2);
    const total = await json(`select public.apply_bcv_rate_for_tracking('${two.token}')`);
    expect(Number(total.total_ves)).toBe(748.25);
  });

  it("never overwrites an existing snapshot, even after a manual correction", async () => {
    const { orderId } = await createOrder("bcv-small", 1);
    const first = await json(`select public.apply_bcv_rate_to_order(${orderId}, '${ADMIN_2}')`);
    const firstRate = first.bcv_rate_ves;
    const firstAt = first.bcv_rate_at;

    await registerRate("99.0000", "manual:later", ADMIN_1, "2020-01-01 15:00:00+00");
    const second = await json(`select public.apply_bcv_rate_to_order(${orderId}, '${ADMIN_1}')`);
    expect(second.applied).toBe(false);
    expect(second.bcv_rate_ves).toBe(firstRate);
    expect(second.bcv_rate_at).toBe(firstAt);
    expect(await scalar(`select count(*) from public.audit_log where action = 'order.apply_bcv_rate'`)).toBe("2");
  });

  it("serialises concurrent snapshots so only one caller applies the rate", async () => {
    await registerRate("40.0000", "manual:concurrent", ADMIN_1, "2020-01-01 16:00:00+00");
    const { orderId, token } = await createOrder("bcv-small", 1);

    const [byToken, byAdmin] = await Promise.all([
      json(`select public.apply_bcv_rate_for_tracking('${token}')`),
      json(`select public.apply_bcv_rate_to_order(${orderId}, '${ADMIN_2}')`),
    ]);

    expect([byToken.applied, byAdmin.applied].filter((value) => value === true)).toHaveLength(1);
    expect(byToken.bcv_rate_ves).toBe(byAdmin.bcv_rate_ves);
    expect(byToken.total_ves).toBe(byAdmin.total_ves);
    // Whichever caller wins, at most one administrative audit row exists: a
    // guest apply writes none and an admin replay is a no-op.
    expect(Number(await scalar(`select count(*) from public.audit_log where action = 'order.apply_bcv_rate' and entity_id = '${orderId}'`))).toBeLessThanOrEqual(1);
  });

  it("creates the order and snapshots the active BCV rate in one transaction", async () => {
    const { orderId, result } = await createOrderWithBcv("bcv-cake", 2);
    expect(result.bcv_applied).toBe(true);
    expect(result.rounding_rule).toBe("round_half_up");
    expect(Number(result.bcv_rate_ves)).toBe(40);
    expect(Number(result.total_ves)).toBe(820); // 20.50 * 40.0000
    expect(result.tracking_token).toMatch(/^[0-9a-f]{64}$/);

    const stored = await json(
      `select jsonb_build_object('rate', o.bcv_rate_ves, 'at', o.bcv_rate_at, ` +
        `'total', o.total_ves, 'usd', o.total_usd, 'rule', o.rounding_rule) ` +
        `from public.orders o where o.id = ${orderId}`,
    );
    expect(String(stored.rate)).toBe(String(result.bcv_rate_ves));
    expect(stored.at).toBe(result.bcv_rate_at);
    expect(stored.rule).toBe("round_half_up");
    expect(await scalar(
      `select o.total_ves = round(o.total_usd * o.bcv_rate_ves, 2) from public.orders o where o.id = ${orderId}`,
    )).toBe("t");

    // No parallel implementation: the same inventory reservation is made.
    expect(Number(await scalar(
      `select count(*) from public.inventory_reservations where order_id = ${orderId}`,
    ))).toBeGreaterThan(0);
  });

  it("rolls back the order and its reservations when the snapshot write fails", async () => {
    await registerRate("41.0000", "manual:rollback", ADMIN_1, "2020-01-01 17:00:00+00");
    const pid = Number(await scalar(`select id from public.products where slug = 'bcv-cake'`));
    const ordersBefore = Number(await scalar(`select count(*) from public.orders`));
    const reservationsBefore = Number(await scalar(`select count(*) from public.inventory_reservations`));

    const setup = await db.psql(`
      create function public.fail_snapshot() returns trigger language plpgsql as $$
      begin
        raise exception 'forced snapshot failure';
      end $$;
      create trigger orders_fail_snapshot before update on public.orders
        for each row when (new.bcv_rate_ves is not null and old.bcv_rate_ves is null)
        execute function public.fail_snapshot();
    `);
    expect(setup.code, allText(setup)).toBe(0);

    const text = await expectFailure(
      `select public.create_online_order_with_bcv('Ana Perez', '04120001122', 'pickup', ` +
        `null, null, null, null, '[{"product_id": ${pid}, "quantity": 1}]');`,
    );
    expect(text).toContain("forced snapshot failure");

    const cleanup = await db.psql(`drop trigger orders_fail_snapshot on public.orders; drop function public.fail_snapshot();`);
    expect(cleanup.code, allText(cleanup)).toBe(0);
    expect(Number(await scalar(`select count(*) from public.orders`))).toBe(ordersBefore);
    expect(Number(await scalar(`select count(*) from public.inventory_reservations`))).toBe(reservationsBefore);
  });

  it("rejects pago_movil without a complete BCV snapshot on every entry point", async () => {
    const { orderId } = await createOrder("bcv-cake", 1); // 003 path: no snapshot
    const direct = await expectFailure(
      `select public.register_payment(${orderId}, 'pago_movil', 'VES', 100, ` +
        `'PM-NOSNAP', 'receipts/nosnap.png', null, 'ves-no-snapshot-1');`,
    );
    expect(direct).toContain("pago_movil requires a BCV snapshot and VES total");

    const { token } = await createOrder("bcv-cake", 1);
    const guest = await expectFailure(
      `select public.register_payment_for_tracking('${token}', 'pago_movil', 100, ` +
        `'PM-GUEST', 'receipts/guest.png', 'ves-no-snapshot-2');`,
    );
    expect(guest).toContain("pago_movil requires a BCV snapshot and VES total");

    // Admin direct RPC path uses the same guarded insert.
    const admin = await expectFailure(
      `select public.register_payment(${orderId}, 'pago_movil', 'VES', 100, ` +
        `'PM-ADMIN', 'receipts/admin.png', null, 'ves-no-snapshot-3', '${ADMIN_1}', false);`,
    );
    expect(admin).toContain("pago_movil requires a BCV snapshot and VES total");
    expect(Number(await scalar(`select count(*) from public.payments where order_id = ${orderId}`))).toBe(0);
  });

  it("accepts pago_movil with a valid snapshot while USD and USDT stay unaffected", async () => {
    const { orderId, result: created } = await createOrderWithBcv("bcv-cake", 1);
    expect(created.bcv_applied).toBe(true);

    const ves = await json(
      `select public.register_payment(${orderId}, 'pago_movil', 'VES', 100, ` +
        `'PM-OK', 'receipts/ok.png', null, 'ves-ok-1') as r;`,
    );
    expect(ves.idempotent).toBe(false);
    const usd = await json(
      `select public.register_payment(${orderId}, 'cash_usd', 'USD', 10, ` +
        `null, null, 20, 'usd-ok-1') as r;`,
    );
    expect(usd.idempotent).toBe(false);
    const usdt = await json(
      `select public.register_payment(${orderId}, 'binance_pay', 'USDT', 10, ` +
        `'TX-OK', 'receipts/usdt.png', null, 'usdt-ok-1') as r;`,
    );
    expect(usdt.idempotent).toBe(false);
    expect(Number(await scalar(`select count(*) from public.payments where order_id = ${orderId}`))).toBe(3);

    // USD/USDT also register on orders that never had a BCV snapshot.
    const plain = await createOrder("bcv-small", 1);
    expect((await json(
      `select public.register_payment(${plain.orderId}, 'cash_usd', 'USD', 1, ` +
        `null, null, 2, 'usd-nosnap-1') as r;`,
    )).idempotent).toBe(false);
    expect((await json(
      `select public.register_payment(${plain.orderId}, 'binance_transfer', 'USDT', 1, ` +
        `'TX', 'receipts/t.png', null, 'usdt-nosnap-1') as r;`,
    )).idempotent).toBe(false);
  });

  it("keeps an existing snapshot immutable through every exposed write path", async () => {
    const { orderId, token, result: created } = await createOrderWithBcv("bcv-small", 1);
    const rate = String(created.bcv_rate_ves);
    const at = String(created.bcv_rate_at);
    const total = String(created.total_ves);

    const guest = await json(`select public.apply_bcv_rate_for_tracking('${token}')`);
    expect(guest.applied).toBe(false);
    expect(String(guest.bcv_rate_ves)).toBe(rate);
    expect(String(guest.bcv_rate_at)).toBe(at);

    const admin = await json(`select public.apply_bcv_rate_to_order(${orderId}, '${ADMIN_1}')`);
    expect(admin.applied).toBe(false);
    expect(String(admin.bcv_rate_ves)).toBe(rate);

    // Even a privileged direct UPDATE is blocked at the table level.
    const direct = await expectFailure(
      `update public.orders set bcv_rate_ves = 999, total_ves = 999 where id = ${orderId};`,
    );
    expect(direct).toContain("BCV snapshot is immutable");

    expect(Number(await scalar(`select bcv_rate_ves from public.orders where id = ${orderId}`))).toBe(Number(rate));
    expect(Number(await scalar(`select total_ves from public.orders where id = ${orderId}`))).toBe(Number(total));
    expect(await scalar(`select rounding_rule from public.orders where id = ${orderId}`)).toBe("round_half_up");
  });

  it("serialises concurrent atomic creation with a rate correction without fabricating snapshots", async () => {
    const baseId = await registerRate("42.0000", "manual:concurrent-base", ADMIN_1, "2020-01-01 18:00:00+00");
    const pid = Number(await scalar(`select id from public.products where slug = 'bcv-small'`));
    const orderSql = (n: number) =>
      `select public.create_online_order_with_bcv('Client ${n}', '04120001122', 'pickup', ` +
        `null, null, null, null, '[{"product_id": ${pid}, "quantity": 1}]');`;

    const [a, b, c, corrected] = await Promise.all([
      json(orderSql(1)),
      json(orderSql(2)),
      json(orderSql(3)),
      json(
        `select public.register_bcv_rate(43.0000, 'manual:concurrent-new', '${ADMIN_1}', ` +
          `'2020-01-01 18:01:00+00', ${baseId}, null, 'concurrent-key')`,
      ),
    ]);
    expect(Number(corrected.rate_ves_per_usd)).toBe(43);

    for (const result of [a, b, c]) {
      expect(result.bcv_applied).toBe(true);
      const rate = Number(result.bcv_rate_ves);
      expect([42, 43]).toContain(rate);
      const id = Number(result.order_id);
      const stored = await json(
        `select jsonb_build_object('rate', o.bcv_rate_ves, 'at', o.bcv_rate_at, ` +
          `'rule', o.rounding_rule, 'total', o.total_ves, 'usd', o.total_usd, ` +
          `'consistent', o.total_ves = round(o.total_usd * o.bcv_rate_ves, 2)) ` +
          `from public.orders o where o.id = ${id}`,
      );
      expect(Number(stored.rate)).toBe(rate);
      expect(String(stored.at)).toBe(String(result.bcv_rate_at));
      expect(stored.rule).toBe("round_half_up");
      expect(stored.consistent).toBe(true);
    }
  });

  it("refuses to use an unknown rate and accepts a wrong tracking token only once resolved", async () => {
    await ok(`update public.exchange_rates set is_active = false where is_active`);
    const { token } = await createOrder("bcv-small", 1);
    await expectSqlState(`public.apply_bcv_rate_for_tracking('${token}')`, "P0001");
    await expectSqlState(`public.apply_bcv_rate_for_tracking('${"a".repeat(64)}')`, "P0002");
    await expectSqlState(`public.apply_bcv_rate_for_tracking('short')`, "22023");
    // The order created while no rate exists stayed USD-only: no fabricated VES.
    expect(await scalar(`select count(*) from public.orders where bcv_rate_ves is not null and total_ves is null`)).toBe("0");
  });

  it("creates an atomic USD-only order with all BCV fields NULL when no rate is active", async () => {
    const { orderId, token, result } = await createOrderWithBcv("bcv-small", 1);
    expect(result.bcv_applied).toBe(false);
    expect(result.bcv_rate_ves).toBeNull();
    expect(result.bcv_rate_at).toBeNull();
    expect(result.total_ves).toBeNull();
    expect(result.rounding_rule).toBeNull();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await scalar(
      `select o.bcv_rate_ves is null and o.bcv_rate_at is null and o.total_ves is null ` +
        `and o.rounding_rule is null and o.status = 'pending' from public.orders o where o.id = ${orderId}`,
    )).toBe("t");
  });

  it("keeps mutating RPCs service-role-only while rate reads stay public", async () => {
    const created = await asAnon(
      `select public.register_bcv_rate(1, 'manual', '${ADMIN_1}');`,
    );
    expect(created.code).not.toBe(0);
    expect(allText(created)).toContain("permission denied");

    const snapshot = await asAnon(`select public.apply_bcv_rate_for_tracking('${"a".repeat(64)}');`);
    expect(snapshot.code).not.toBe(0);

    const read = await asAnon(`select rate_ves_per_usd::text from public.exchange_rates limit 1;`);
    expect(read.code).toBe(0);

    const rateRead = await asAnon(`select public.get_bcv_rate() is not null`);
    expect(rateRead.code).toBe(0);
    // All rows were deactivated by the previous case.
    expect(rateRead.stdout.trim()).toBe("f");

    const inactiveAdmin = await asUser(INACTIVE, `select public.deactivate_bcv_rate(1, '${INACTIVE}');`);
    expect(inactiveAdmin.code).not.toBe(0);
  });
});
