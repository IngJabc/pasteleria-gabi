/**
 * Phase 5 (payments module) — behavioral validation of
 * `supabase/migrations/006_payments_and_verification.sql`.
 *
 * Applies 001–006 to a throwaway local PostgreSQL cluster with the Supabase
 * stub and exercises registration/idempotency, per-currency reporting, the
 * single receipt/SLA history, review separation from fulfillment, cash/POS
 * flows, refunds, concurrency and RLS/grant boundaries.
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
].map((name) => path.join(repoRoot, "supabase", "migrations", name));

const ADMIN_1 = "11111111-1111-4111-8111-111111111111";
const ADMIN_2 = "22222222-2222-4222-8222-222222222222";
const INACTIVE = "33333333-3333-4333-8333-333333333333";
const STRANGER = "99999999-9999-4999-8999-999999999999";

interface JsonResult {
  [key: string]: string | number | boolean | null;
}

describe.skipIf(!tools)("payments migration on a disposable local PostgreSQL", () => {
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

  interface CreatedOrder {
    orderId: number;
    token: string;
  }

  async function createOrder(productId: number, quantity = 1): Promise<CreatedOrder> {
    const result = await asService(
      `select public.create_online_order('Ana Perez', '04120001122', 'pickup', ` +
        `null, null, null, null, '[{"product_id": ${productId}, "quantity": ${quantity}}]');`,
    );
    expect(result.code, allText(result)).toBe(0);
    const parsed = JSON.parse(last(result.stdout)) as {
      order_id: number;
      tracking_token: string;
    };
    return { orderId: parsed.order_id, token: parsed.tracking_token };
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
        ('pay-cake', 'Tarta Pago', 'prueba', 10.00),
        ('pay-other', 'Tarta Otra', 'prueba', 5.00);
      insert into public.inventory_batches
        (product_id, initial_quantity, remaining_quantity, production_date, created_by)
      select id, 20, 20, '2026-11-01', '${ADMIN_1}' from public.products
       where slug in ('pay-cake', 'pay-other');
    `);
    expect(fixtures.code, allText(fixtures)).toBe(0);
  }, 240_000);

  afterAll(async () => {
    if (db) await db.stop();
  }, 60_000);

  it("applies on top of 001–005 and creates exactly the payment schema objects", async () => {
    expect(await scalar(`select count(*) from public.payments;`)).toBe("0");
    expect(await scalar(`select count(*) from public.payment_refunds;`)).toBe("0");
    expect(await scalar(`select count(*) from public.receipt_submissions;`)).toBe("0");

    const constraints = await ok(
      `select conname from pg_constraint where conrelid in
         ('public.payments'::regclass, 'public.payment_refunds'::regclass)
       order by conname;`,
    );
    for (const name of [
      "payments_amount_check",
      "payments_method_check",
      "payments_currency_check",
      "payments_method_currency_check",
      "payments_reference_check",
      "payments_receipt_path_check",
      "payments_idempotency_key_key",
      "payments_verification_check",
      "payment_refunds_amount_check",
      "payment_refunds_idempotency_key_key",
    ]) {
      expect(constraints).toContain(name);
    }

    const indexes = await ok(`select indexname from pg_indexes where schemaname = 'public'
      and indexname in ('receipt_submissions_payment_id_idx',
                        'receipt_submissions_pending_payment_key',
                        'receipt_submissions_pending_order_key',
                        'payments_review_queue_idx') order by indexname;`);
    expect(indexes).toEqual([
      "payments_review_queue_idx",
      "receipt_submissions_payment_id_idx",
      "receipt_submissions_pending_order_key",
      "receipt_submissions_pending_payment_key",
    ]);

    expect(await scalar(`select bool_and(relrowsecurity and relforcerowsecurity)::text
      from pg_class where relname in ('payments','payment_refunds');`)).toBe("true");
    expect(await scalar(`select public from storage.buckets where id = 'payment-receipts';`)).toBe("f");
  });

  it("registers several currencies/components and reports them separately", async () => {
    const { orderId } = await createOrder(1);
    const digital = await json(
      `select public.register_payment(${orderId}, 'pago_movil', 'VES', 1500.50,
         'PM-001', 'receipts/one.png', null, 'idem-digital-1') as r;`,
    );
    const cash = await json(
      `select public.register_payment(${orderId}, 'cash_usd', 'USD', 10.00,
         null, null, 20.00, 'idem-cash-1') as r;`,
    );

    expect(digital.idempotent).toBe(false);
    expect(cash.idempotent).toBe(false);
    expect(Number(cash.change_usd)).toBe(10);

    const summary = await json(
      `select public.get_order_payment_summary(${orderId}) as s;`,
    );
    expect(Object.keys(summary).sort()).toEqual(["USD", "VES"]);
    expect(Number((summary.VES as unknown as JsonResult).approved_amount)).toBe(0);
    expect(Number((summary.VES as unknown as JsonResult).pending_amount)).toBe(1500.5);
    expect(Number((summary.USD as unknown as JsonResult).pending_amount)).toBe(10);
    // No raw cross-currency total is ever produced.
    expect(JSON.stringify(summary)).not.toContain("total_amount");
    expect(await scalar(`select count(*) from public.payments where order_id = ${orderId};`)).toBe("2");
  });

  it("is idempotent by idempotency key, including concurrent replays", async () => {
    const { orderId } = await createOrder(1);
    const calls = await Promise.all(
      [0, 1, 2].map((n) =>
        asService(
          `select public.register_payment(${orderId}, 'binance_pay', 'USDT', 10.00,
             'TX-${n}', 'receipts/binance-${n}.png', null, 'idem-concurrent') as r;`,
        ),
      ),
    );
    for (const result of calls) expect(result.code, allText(result)).toBe(0);
    const ids = calls.map((result) => {
      const row = lines(result.stdout).find((line) => line.startsWith("{"));
      expect(row, allText(result)).toBeDefined();
      return (JSON.parse(row as string) as { payment_id: number }).payment_id;
    });
    expect(new Set(ids).size).toBe(1);
    expect(await scalar(`select count(*) from public.payments where order_id = ${orderId};`)).toBe("1");
    expect(await scalar(`select count(*) from public.audit_log where action = 'payment.register'
      and entity_id = '${ids[0]}';`)).toBe("1");
  });

  it("rejects invalid method/currency pairs, missing evidence and inactive administrators", async () => {
    const { orderId } = await createOrder(1);
    const bad = [
      `select public.register_payment(${orderId}, 'pago_movil', 'USD', 10, 'R', 'path', null, 'k1');`,
      `select public.register_payment(${orderId}, 'binance_pay', 'USDT', 10, null, 'path', null, 'k2');`,
      `select public.register_payment(${orderId}, 'cash_usd', 'USD', 10, null, null, -1, 'k3');`,
      `select public.register_payment(${orderId}, 'pago_movil', 'VES', -5, 'R', 'path', null, 'k4');`,
      `select public.register_payment(${orderId}, 'cash_usd', 'USD', 10, null, null, 20, 'k5', '${INACTIVE}');`,
      `select public.register_payment(${orderId}, 'cash_usd', 'USD', 10, null, null, 20, 'k6', '${INACTIVE}', true);`,
      `select public.register_payment(${orderId}, 'binance', 'USDT', 10, 'R', 'path', null, 'k7');`,
      `select public.register_payment(${orderId}, 'binance_transfer', 'USD', 10, 'R', 'path', null, 'k8');`,
      `select public.register_payment(${orderId}, 'pago_movil', 'VES', 10.123, 'R', 'path', null, 'k9');`,
    ];
    for (const sql of bad) {
      const result = await asService(sql);
      expect(result.code, allText(result)).not.toBe(0);
    }
    expect(await scalar(`select count(*) from public.payments where order_id = ${orderId};`)).toBe("0");
  });

  it("never accepts arbitrary order ids or admin ids from a guest token wrapper", async () => {
    const { orderId, token } = await createOrder(1);
    const wrong = await asService(
      `select public.register_payment_for_tracking('${"22".repeat(32)}', 'pago_movil', 10,
         'R', 'path', 'k-wrong');`,
    );
    expect(wrong.code, allText(wrong)).not.toBe(0);
    expect(allText(wrong)).toContain("no order matches the tracking token");

    const cash = await asService(
      `select public.register_payment_for_tracking('${token}', 'cash_usd', 10,
         null, null, 'k-guest-cash');`,
    );
    expect(cash.code, allText(cash)).not.toBe(0);

    const good = await json(
      `select public.register_payment_for_tracking('${token}', 'binance_transfer', 10,
         'TX-1', 'receipts/tx1.png', 'k-guest-ok') as r;`,
    );
    expect(Number(good.order_id)).toBe(orderId);
    expect(await scalar(`select currency from public.payments where id = ${good.payment_id};`)).toBe("USDT");
    expect(await scalar(`select method from public.payments where id = ${good.payment_id};`))
      .toBe("binance_transfer");
  });

  it("links one evidence submission to one payment without consuming extra attempts", async () => {
    const { orderId } = await createOrder(1);
    const paymentId = Number(
      (await json(
        `select public.register_payment(${orderId}, 'pago_movil', 'VES', 1500,
           'PM-2', 'receipts/two.png', null, 'idem-evidence') as r;`,
      )).payment_id,
    );

    const first = await json(`select public.submit_payment_evidence(${paymentId}) as r;`);
    expect(first.idempotent).toBe(false);
    expect(await scalar(`select receipt_attempts from public.orders where id = ${orderId};`)).toBe("1");
    expect(await scalar(`select status from public.payments where id = ${paymentId};`)).toBe("in_review");
    expect(await scalar(`select expires_at from public.inventory_reservations where order_id = ${orderId};`)).toBe("");
    expect(await scalar(`select count(*) from public.receipt_submissions where order_id = ${orderId};`)).toBe("1");
    expect(await scalar(`select count(*) from public.receipt_submissions
      where order_id = ${orderId} and payment_id = ${paymentId};`)).toBe("1");

    const repeat = await json(`select public.submit_payment_evidence(${paymentId}) as r;`);
    expect(repeat.idempotent).toBe(true);
    expect(await scalar(`select receipt_attempts from public.orders where id = ${orderId};`)).toBe("1");

    // Another digital payment cannot hijack the single pending evidence submission.
    const other = Number(
      (await json(
        `select public.register_payment(${orderId}, 'binance_transfer', 'USDT', 10,
           'TX-OTHER', 'receipts/other.png', null, 'idem-evidence-other') as r;`,
      )).payment_id,
    );
    const hijack = await asService(`select public.submit_payment_evidence(${other});`);
    expect(hijack.code, allText(hijack)).not.toBe(0);
    expect(allText(hijack)).toContain("already has pending evidence for another payment");
    expect(await scalar(`select count(*) from public.receipt_submissions
      where order_id = ${orderId} and payment_id is not null;`)).toBe("1");
    expect(await scalar(`select payment_id from public.receipt_submissions where order_id = ${orderId};`))
      .toBe(String(paymentId));
  });

  it("allows only one pending evidence submission per order and keeps review attribution", async () => {
    const { orderId } = await createOrder(1);
    const first = Number(
      (await json(
        `select public.register_payment(${orderId}, 'pago_movil', 'VES', 1000,
           'PM-A', 'receipts/a.png', null, 'idem-multi-a') as r;`,
      )).payment_id,
    );
    const second = Number(
      (await json(
        `select public.register_payment(${orderId}, 'binance_transfer', 'USDT', 10,
           'TX-B', 'receipts/b.png', null, 'idem-multi-b') as r;`,
      )).payment_id,
    );

    await ok(`select public.submit_payment_evidence(${first});`);
    const hijack = await asService(`select public.submit_payment_evidence(${second});`);
    expect(hijack.code, allText(hijack)).not.toBe(0);
    expect(allText(hijack)).toContain("already has pending evidence for another payment");
    expect(await scalar(`select count(*) from public.receipt_submissions
      where order_id = ${orderId} and review_status = 'pending';`)).toBe("1");
    expect(await scalar(`select receipt_attempts from public.orders where id = ${orderId};`)).toBe("1");

    const wrongApproval = await asService(
      `select public.approve_payment(${second}, '${ADMIN_1}');`,
    );
    expect(wrongApproval.code, allText(wrongApproval)).not.toBe(0);
    expect(await scalar(`select review_status from public.receipt_submissions
      where order_id = ${orderId};`)).toBe("pending");

    const rightApproval = await json(
      `select public.approve_payment(${first}, '${ADMIN_1}') as r;`,
    );
    expect(rightApproval.idempotent).toBe(false);
    expect(await scalar(`select review_status from public.receipt_submissions
      where order_id = ${orderId};`)).toBe("approved");
    // An approval holds the order for review; it does not reopen the deadline,
    // so a second evidence submission cannot consume another attempt here.
    expect(await scalar(`select receipt_attempts from public.orders where id = ${orderId};`)).toBe("1");
    expect(await scalar(`select count(*) from public.receipt_submissions
      where order_id = ${orderId};`)).toBe("1");
    expect(await scalar(`select status from public.payments where id = ${second};`)).toBe("pending");
  });

  it("keeps verification separate from fulfillment and idempotent", async () => {
    const { orderId } = await createOrder(1);
    const paymentId = Number(
      (await json(
        `select public.register_payment(${orderId}, 'binance_pay', 'USDT', 10,
           'TX-A', 'receipts/a.png', null, 'idem-approve') as r;`,
      )).payment_id,
    );
    await ok(`select public.submit_payment_evidence(${paymentId});`);

    const before = await scalar(
      `select o.status || '|' || count(r.id) || '|' ||
              coalesce(sum(case when r.status = 'active' then 1 else 0 end), 0)
       from public.orders o
       left join public.inventory_reservations r on r.order_id = o.id
       where o.id = ${orderId} group by o.status;`,
    );

    const approved = await json(
      `select public.approve_payment(${paymentId}, '${ADMIN_1}') as r;`,
    );
    expect(approved.idempotent).toBe(false);
    expect(approved.order_status).toBe("pending");
    expect(await scalar(`select status from public.orders where id = ${orderId};`)).toBe("pending");
    expect(await scalar(`select review_status from public.receipt_submissions
      where order_id = ${orderId};`)).toBe("approved");
    expect(await scalar(`select count(*) from public.inventory_movements where order_id = ${orderId};`)).toBe("0");
    expect(await scalar(`select verified_by from public.payments where id = ${paymentId};`)).toBe(ADMIN_1);

    const after = await scalar(
      `select o.status || '|' || count(r.id) || '|' ||
              coalesce(sum(case when r.status = 'active' then 1 else 0 end), 0)
       from public.orders o
       left join public.inventory_reservations r on r.order_id = o.id
       where o.id = ${orderId} group by o.status;`,
    );
    expect(after).toBe(before);

    const repeat = await json(
      `select public.approve_payment(${paymentId}, '${ADMIN_2}') as r;`,
    );
    expect(repeat.idempotent).toBe(true);
    expect(await scalar(`select count(*) from public.audit_log where action = 'payment.verify'
      and entity_id = '${paymentId}';`)).toBe("1");
  });

  it("reuses the existing correction/cancel rules and never increments attempts on rejection", async () => {
    const { orderId } = await createOrder(1);
    const first = Number(
      (await json(
        `select public.register_payment(${orderId}, 'pago_movil', 'VES', 1000,
           'PM-3', 'receipts/three.png', null, 'idem-reject-1') as r;`,
      )).payment_id,
    );
    await ok(`select public.submit_payment_evidence(${first});`);
    const reject1 = await json(`select public.reject_payment(${first}, '${ADMIN_1}') as r;`);
    expect(reject1.order_status).toBe("pending");
    expect(await scalar(`select receipt_attempts from public.orders where id = ${orderId};`)).toBe("1");
    expect(await scalar(`select status from public.orders where id = ${orderId};`)).toBe("pending");
    expect(await scalar(`select count(*) from public.inventory_reservations
      where order_id = ${orderId} and status = 'released';`)).toBe("0");
    const window1 = await scalar(`select correction_window_ends_at from public.inventory_reservations
      where order_id = ${orderId} limit 1;`);
    expect(window1).not.toBe("");

    const second = Number(
      (await json(
        `select public.register_payment(${orderId}, 'pago_movil', 'VES', 1000,
           'PM-4', 'receipts/four.png', null, 'idem-reject-2') as r;`,
      )).payment_id,
    );
    await ok(`select public.submit_payment_evidence(${second});`);
    expect(await scalar(`select receipt_attempts from public.orders where id = ${orderId};`)).toBe("2");
    const reject2 = await json(`select public.reject_payment(${second}, '${ADMIN_2}') as r;`);
    expect(reject2.order_status).toBe("canceled");
    expect(await scalar(`select count(*) from public.inventory_reservations
      where order_id = ${orderId} and status = 'released';`)).toBe("1");
    expect(await scalar(`select count(*) from public.inventory_movements where order_id = ${orderId};`)).toBe("0");
    expect(await scalar(`select count(*) from public.receipt_submissions
      where order_id = ${orderId} and review_status = 'rejected';`)).toBe("2");

    const repeat = await json(`select public.reject_payment(${second}, '${ADMIN_1}') as r;`);
    expect(repeat.idempotent).toBe(true);
    expect(await scalar(`select count(*) from public.audit_log where action = 'payment.reject'
      and entity_id = '${second}';`)).toBe("1");
  });

  it("refuses a late correction after the single window has closed", async () => {
    const { orderId } = await createOrder(1);
    const paymentId = Number(
      (await json(
        `select public.register_payment(${orderId}, 'binance_pay', 'USDT', 10,
           'TX-LATE', 'receipts/late.png', null, 'idem-late') as r;`,
      )).payment_id,
    );
    await ok(`select public.submit_payment_evidence(${paymentId});`);
    await ok(`select public.reject_payment(${paymentId}, '${ADMIN_1}');`);
    await ok(
      `update public.inventory_reservations
          set correction_window_ends_at = now() - interval '1 minute',
              expires_at = now() - interval '1 minute'
        where order_id = ${orderId};`,
    );
    const late = Number(
      (await json(
        `select public.register_payment(${orderId}, 'binance_pay', 'USDT', 10,
           'TX-LATE-2', 'receipts/late2.png', null, 'idem-late-2') as r;`,
      )).payment_id,
    );
    const result = await asService(`select public.submit_payment_evidence(${late});`);
    expect(result.code, allText(result)).not.toBe(0);
    expect(allText(result)).toContain("correction window for order");
    expect(await scalar(`select receipt_attempts from public.orders where id = ${orderId};`)).toBe("1");
  });

  it("registers cash without submissions, holds or attempt increments", async () => {
    const { orderId } = await createOrder(1);
    const paymentId = Number(
      (await json(
        `select public.register_payment(${orderId}, 'cash_usd', 'USD', 10,
           null, null, 50, 'idem-cash-only', '${ADMIN_1}', false) as r;`,
      )).payment_id,
    );
    expect(await scalar(`select receipt_attempts from public.orders where id = ${orderId};`)).toBe("0");
    expect(await scalar(`select count(*) from public.receipt_submissions where order_id = ${orderId};`)).toBe("0");
    expect(await scalar(`select count(*) from public.inventory_reservations
      where order_id = ${orderId} and expires_at is null;`)).toBe("0");

    const rejected = await json(`select public.reject_payment(${paymentId}, '${ADMIN_1}') as r;`);
    expect(rejected.reservations_affected).toBe(0);
    expect(await scalar(`select status from public.orders where id = ${orderId};`)).toBe("pending");
    expect(await scalar(`select receipt_attempts from public.orders where id = ${orderId};`)).toBe("0");
  });

  it("registers an offline POS cash sale atomically and idempotently", async () => {
    const items = '[{"product_id": 1, "quantity": 2}]';
    const stockBefore = await scalar(`select remaining_quantity from public.inventory_batches
      where product_id = 1 order by id limit 1;`);

    const first = await json(
      `select public.register_pos_cash_sale('${items}', 30.00, 'pos-idem-1', '${ADMIN_1}') as r;`,
    );
    expect(first.idempotent).toBe(false);
    expect(Number(first.change_usd)).toBe(10);
    const orderId = Number(first.order_id);
    const paymentId = Number(first.payment_id);
    expect(await scalar(`select channel || '|' || status from public.orders where id = ${orderId};`))
      .toBe("pos|completed");
    expect(await scalar(`select status from public.payments where id = ${paymentId};`)).toBe("approved");
    expect(await scalar(`select amount_tendered_usd from public.payments where id = ${paymentId};`)).toBe("30.00");
    expect(await scalar(`select count(*) from public.inventory_movements where order_id = ${orderId};`)).toBe("1");
    expect(Number(await scalar(`select remaining_quantity from public.inventory_batches
      where product_id = 1 order by id limit 1;`))).toBe(Number(stockBefore) - 2);

    const repeat = await json(
      `select public.register_pos_cash_sale('${items}', 30.00, 'pos-idem-1', '${ADMIN_2}') as r;`,
    );
    expect(repeat.idempotent).toBe(true);
    expect(repeat.order_id).toBe(first.order_id);
    expect(await scalar(`select count(*) from public.orders where channel = 'pos' and total_usd = 20;`)).toBe("1");
    expect(await scalar(`select count(*) from public.inventory_movements where order_id = ${orderId};`)).toBe("1");
  });

  it("rejects invalid POS baskets without writing an order, payment or movement", async () => {
    const before = await scalar(`select count(*) from public.orders where channel = 'pos';`);
    const result = await asService(
      `select public.register_pos_cash_sale('[{"product_id": 1, "quantity": 9999}]',
         200000, 'pos-invalid', '${ADMIN_1}');`,
    );
    expect(result.code, allText(result)).not.toBe(0);
    expect(allText(result)).toContain("insufficient stock");
    expect(await scalar(`select count(*) from public.orders where channel = 'pos';`)).toBe(before);
    expect(await scalar(`select count(*) from public.payments where idempotency_key = 'pos-invalid';`)).toBe("0");
  });

  it("records refunds append-only, blocks over-refunds and is idempotent", async () => {
    const { orderId } = await createOrder(1);
    const paymentId = Number(
      (await json(
        `select public.register_payment(${orderId}, 'cash_usd', 'USD', 10,
           null, null, 20, 'idem-refund', '${ADMIN_1}', true) as r;`,
      )).payment_id,
    );
    const partial = await json(
      `select public.record_refund(${paymentId}, 4, 'cash', 'change', '${ADMIN_2}', 'refund-1') as r;`,
    );
    expect(partial.status).toBe("refunded_partial");
    const full = await json(
      `select public.record_refund(${paymentId}, 6, 'cash', 'return', '${ADMIN_2}', 'refund-2') as r;`,
    );
    expect(full.status).toBe("refunded_full");
    expect(await scalar(`select amount from public.payments where id = ${paymentId};`)).toBe("10.00");

    const over = await asService(
      `select public.record_refund(${paymentId}, 1, 'cash', 'too much', '${ADMIN_2}', 'refund-3');`,
    );
    expect(over.code, allText(over)).not.toBe(0);
    expect(await scalar(`select count(*) from public.payment_refunds where payment_id = ${paymentId};`)).toBe("2");

    const repeat = await json(
      `select public.record_refund(${paymentId}, 4, 'cash', 'change', '${ADMIN_2}', 'refund-1') as r;`,
    );
    expect(repeat.idempotent).toBe(true);
    expect(await scalar(`select count(*) from public.payment_refunds where payment_id = ${paymentId};`)).toBe("2");
  });

  it("serialises concurrent approvals and refunds", async () => {
    const { orderId } = await createOrder(1);
    const paymentId = Number(
      (await json(
        `select public.register_payment(${orderId}, 'pago_movil', 'VES', 100,
           'PM-CONC', 'receipts/conc.png', null, 'idem-conc-approve') as r;`,
      )).payment_id,
    );
    const approvals = await Promise.all(
      [0, 1, 2].map(() => asService(`select public.approve_payment(${paymentId}, '${ADMIN_1}');`)),
    );
    for (const result of approvals) expect(result.code, allText(result)).toBe(0);
    expect(await scalar(`select count(*) from public.audit_log where action = 'payment.verify'
      and entity_id = '${paymentId}';`)).toBe("1");

    const refunds = await Promise.all(
      ["conc-1", "conc-2", "conc-3"].map((key) =>
        asService(
          `select public.record_refund(${paymentId}, 40, 'cash', 'test', '${ADMIN_2}', '${key}');`,
        ),
      ),
    );
    expect(refunds.filter((result) => result.code === 0)).toHaveLength(2);
    expect(await scalar(`select coalesce(sum(amount), 0) from public.payment_refunds
      where payment_id = ${paymentId};`)).toBe("80.00");
  });

  it("enforces RLS and EXECUTE grants for anon, non-admins and admins", async () => {
    expect((await asAnon(`select * from public.payments;`)).code).not.toBe(0);
    expect((await asUser(STRANGER, `select * from public.payments;`)).code).toBe(0);
    expect(await ok(`select count(*) from public.payments;`, "authenticated", STRANGER)).toEqual(["0"]);

    const adminRead = await asUser(ADMIN_1, `select count(*) from public.payments;`);
    expect(adminRead.code, allText(adminRead)).toBe(0);
    expect((await asAnon(`select public.get_order_payment_summary(1);`)).code).not.toBe(0);
    expect((await asAnon(`select public.approve_payment(1, '${ADMIN_1}');`)).code).not.toBe(0);
    expect((await asUser(ADMIN_1, `select public.approve_payment(1, '${ADMIN_1}');`)).code).not.toBe(0);
    expect((await asUser(STRANGER, `select public.get_order_payment_summary(1);`)).code, "non-admin summary must be empty via RLS")
      .toBe(0);

    // Storage: admins read receipts, but no client role may insert directly.
    expect((await asUser(ADMIN_1, `select count(*) from storage.objects where bucket_id = 'payment-receipts';`)).code)
      .toBe(0);
    const upload = await asUser(
      ADMIN_1,
      `insert into storage.objects (bucket_id, name) values ('payment-receipts', 'x.png');`,
    );
    expect(upload.code, allText(upload)).not.toBe(0);
  });
});
