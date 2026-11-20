/**
 * M3 — behavioral validation of `supabase/migrations/003_orders_and_reservations.sql`.
 *
 * The migration is applied on top of 001 + 002 to a throwaway local
 * PostgreSQL cluster (Supabase stub) and exercised end to end: checkout
 * creation with server-side recompute, FIFO allocation, reservation timing
 * (20 min / one 20-minute correction window / two receipts max), hold
 * semantics, lazy expiry
 * cleanup, consumption into sale movements, release, idempotency, invalid
 * transitions, concurrency (no oversell), PII-free tracking, guest
 * cancellation requests, RLS/grant boundaries and exact schema objects.
 *
 * The whole suite is skipped when no local PostgreSQL binaries are installed
 * (`npm test` still passes; see `local-postgres.ts`).
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
  path.join(repoRoot, "supabase", "migrations", "001_catalog_and_admin_foundation.sql"),
  path.join(repoRoot, "supabase", "migrations", "002_inventory_foundation.sql"),
  path.join(repoRoot, "supabase", "migrations", "003_orders_and_reservations.sql"),
  path.join(repoRoot, "supabase", "migrations", "004_quote_acceptance.sql"),
  path.join(repoRoot, "supabase", "migrations", "005_receipt_sla_notifications.sql"),
];

const ADMIN_1 = "11111111-1111-4111-8111-111111111111";
const ADMIN_2 = "22222222-2222-4222-8222-222222222222";
const STRANGER = "99999999-9999-4999-8999-999999999999";

const FIXTURES = `
insert into auth.users (id, email) values
  ('${ADMIN_1}', 'admin1@example.test'),
  ('${ADMIN_2}', 'admin2@example.test'),
  ('${STRANGER}', 'stranger@example.test');

insert into public.administrators (id, display_name) values
  ('${ADMIN_1}', 'Admin One'),
  ('${ADMIN_2}', 'Admin Two');

insert into public.products (slug, name, description, price_usd) values
  ('tarta-fresa',  'Tarta de fresa', 'descripcion', 10.00),
  ('bizcocho',     'Bizcocho',       'descripcion',  8.00),
  ('brownie',      'Brownie',        'descripcion',  4.00),
  ('galleta',      'Galleta',        'descripcion',  2.00),
  ('cheesecake',   'Cheesecake',     'descripcion', 12.00),
  ('sin-stock',    'Sin stock',      'descripcion',  3.00),
  ('concurrencia', 'Concurrencia',   'descripcion',  5.00),
  ('retirado',     'Retirado',       'descripcion',  9.00);

update public.products set is_active = false where slug in ('retirado', 'cheesecake');
`;

function lines(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function lastLine(output: string): string {
  const all = lines(output);
  return all.length > 0 ? all[all.length - 1] : "";
}

function allText(result: PsqlResult): string {
  return `${result.stdout}\n${result.stderr}`;
}

describe.skipIf(!tools)("M3 orders & reservations migration on a disposable local PostgreSQL", () => {
  let db: LocalPostgres;

  // Resolved ids (fixtures are deterministic, but never hard-code them).
  let tarta = 0;
  let bizcocho = 0;
  let brownie = 0;
  let galleta = 0;
  let cheesecake = 0;
  let sinStock = 0;
  let concurrencia = 0;
  let retirado = 0;
  let zoneResto = 0;
  let zoneFuera = 0;

  // Orders created along the way and reused by later tests.
  let orderA1 = 0; // tarta x3 pickup
  let orderA2 = 0; // tarta x12 (FIFO)
  let orderB = 0; // brownie x2 (last units)
  let orderInitial = 0; // bizcocho x1: initial lapse
  let orderHeld = 0; // bizcocho x1: held, never lapses
  let orderReleased = 0; // galleta x6 -> released
  let orderFlow = 0; // bizcocho x1: hold -> reject window -> lapse
  let orderSecondReject = 0; // bizcocho x1: two receipts -> auto-cancel + release
  let orderConsume = 0; // bizcocho x1 -> consumed into a sale movement
  let tokenA1 = "";

  const adminSession = (sub: string, sql: string): string =>
    `do $$ begin perform set_config('request.jwt.claim.sub', '${sub}', false); end $$;\n` +
    `set role authenticated;\n${sql}`;

  const asAdmin1 = (sql: string): Promise<PsqlResult> => db.psql(adminSession(ADMIN_1, sql));
  const asStranger = (sql: string): Promise<PsqlResult> => db.psql(adminSession(STRANGER, sql));
  const asAnon = (sql: string): Promise<PsqlResult> => db.psql(`set role anon;\n${sql}`);
  const asService = (sql: string): Promise<PsqlResult> => db.psql(`set role service_role;\n${sql}`);

  async function productId(slug: string): Promise<number> {
    const result = await asService(`select id from public.products where slug = '${slug}';`);
    expect(result.code, allText(result)).toBe(0);
    return Number(lastLine(result.stdout));
  }

  async function createBatch(slug: string, quantity: number, productionDate: string): Promise<number> {
    const result = await asAdmin1(
      `select public.create_inventory_batch(\n` +
        `  (select id from public.products where slug = '${slug}'),\n` +
        `  ${quantity}, '${productionDate}');`,
    );
    expect(result.code, allText(result)).toBe(0);
    return Number(lastLine(result.stdout));
  }

  /** Calls create_online_order as the service role and returns the parsed result. */
  async function createOrder(args: string): Promise<PsqlResult> {
    return asService(`select public.create_online_order(${args});`);
  }

  function parsedOrder(result: PsqlResult): { order_id: number; tracking_token: string } {
    return JSON.parse(lastLine(result.stdout));
  }

  /** Standard pickup checkout line for one product. */
  const pickupArgs = (items: string): string =>
    `'Maria Perez', '04121234567', 'pickup', null, null, null, null, '${items}'`;

  async function scalar(sql: string, role: "service" | "postgres" = "service"): Promise<number> {
    const result = role === "service" ? await asService(sql) : await db.psql(sql);
    expect(result.code, allText(result)).toBe(0);
    return Number(lastLine(result.stdout));
  }

  /**
   * Runs one `perform <expr>` inside a DO block and asserts the SQLSTATE it
   * raised with (psql never prints SQLSTATE, so it must be captured here).
   */
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

  beforeAll(async () => {
    if (!tools) throw new Error("local PostgreSQL binaries not found");
    db = await startLocalPostgres(tools);
    await db.applyScript(SUPABASE_STUB_SQL);
    for (const file of MIGRATIONS) {
      await db.applyFile(file);
    }
    const fixtures = await db.psql(FIXTURES);
    expect(fixtures.code, allText(fixtures)).toBe(0);

    tarta = await productId("tarta-fresa");
    bizcocho = await productId("bizcocho");
    brownie = await productId("brownie");
    galleta = await productId("galleta");
    cheesecake = await productId("cheesecake");
    sinStock = await productId("sin-stock");
    concurrencia = await productId("concurrencia");
    retirado = await productId("retirado");

    zoneResto = Number(
      lastLine((await asService(`select id from public.delivery_zones where name = 'Resto de Barquisimeto';`)).stdout),
    );
    zoneFuera = Number(
      lastLine((await asService(`select id from public.delivery_zones where name = 'Fuera de Barquisimeto';`)).stdout),
    );
    expect(zoneResto).toBeGreaterThan(0);
    expect(zoneFuera).toBeGreaterThan(0);

    // Stock fixtures: only what the tests below rely on.
    await createBatch("tarta-fresa", 10, "2026-11-01");
    await createBatch("tarta-fresa", 5, "2026-11-10");
    await createBatch("brownie", 4, "2026-11-05");
    await createBatch("galleta", 10, "2026-11-05");
    await createBatch("bizcocho", 6, "2026-11-05");
    await createBatch("cheesecake", 5, "2026-11-05"); // inactive product with stock
    await createBatch("concurrencia", 5, "2026-11-05");
    // sin-stock: deliberately no batches. retirado: inactive, no batches.
  }, 240_000);

  afterAll(async () => {
    if (db) await db.stop();
  }, 60_000);

  // --- A. Creation ------------------------------------------------------------

  it("creates an order atomically with a hashed token and 20-minute reservations", async () => {
    const before = await scalar(`select count(*) from public.orders;`);
    const result = await createOrder(pickupArgs(`[{"product_id": ${tarta}, "quantity": 3}]`));
    expect(result.code, allText(result)).toBe(0);

    const created = parsedOrder(result);
    orderA1 = created.order_id;
    tokenA1 = created.tracking_token;
    expect(tokenA1).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes, hex (URL-safe)

    const order = await asService(
      `select channel, status, customer_name, customer_phone, fulfillment_type,\n` +
        `       delivery_zone_id, delivery_fee_usd, subtotal_usd, total_usd,\n` +
        `       bcv_rate_ves, total_ves, rounding_rule, tracking_token_hash\n` +
        `from public.orders where id = ${orderA1};`,
    );
    // Only the SHA-256 digest is stored; the plaintext token never hits disk.
    const storedHash = await hashToken(tokenA1);
    expect(storedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(order.stdout.trim()).toBe(
      `online|pending|Maria Perez|04121234567|pickup|||30.00|30.00||||${storedHash}`,
    );
    expect(storedHash).not.toBe(tokenA1);

    // The two-receipt counter starts at 0 on every new order.
    const attempts = await asService(
      `select receipt_attempts from public.orders where id = ${orderA1};`,
    );
    expect(attempts.stdout.trim()).toBe(`0`);

    // Items: snapshot of name and server-side price.
    const items = await asService(
      `select product_id, product_name, unit_price_usd, quantity from public.order_items\n` +
        `where order_id = ${orderA1};`,
    );
    expect(items.stdout.trim()).toBe(`${tarta}|Tarta de fresa|10.00|3`);

    // Reservations: active, deadline exactly created_at + 20 minutes.
    const reservations = await asService(
      `select status, quantity, initial_expires_at = created_at + interval '20 minutes',\n` +
        `       expires_at = initial_expires_at, correction_window_ends_at is null, closed_at is null\n` +
        `from public.inventory_reservations where order_id = ${orderA1};`,
    );
    expect(reservations.stdout.trim()).toBe(`active|3|t|t|t|t`);

    // Atomicity: exactly one new order, one item row, one reservation row.
    expect(await scalar(`select count(*) from public.orders;`)).toBe(before + 1);
    expect(
      await scalar(`select count(*) from public.order_items where order_id = ${orderA1};`),
    ).toBe(1);
    expect(
      await scalar(`select count(*) from public.inventory_reservations where order_id = ${orderA1};`),
    ).toBe(1);
  });

  it("serves stock through get_product_stock with reservations subtracted (M2 placeholder replaced)", async () => {
    // tarta: 15 physical, 3 reserved by orderA1 -> available 12.
    const tartaStock = await asService(`select * from public.get_product_stock(${tarta});`);
    expect(tartaStock.stdout.trim()).toBe(`${tarta}|15|12|3`);

    // Held/lapsed semantics are covered below; baseline: nothing reserved yet.
    const bizcochoStock = await asService(`select * from public.get_product_stock(${bizcocho});`);
    expect(bizcochoStock.stdout.trim()).toBe(`${bizcocho}|6|6|0`);

    // Product with no batches still returns a zero row (M2 contract kept).
    const none = await asService(`select * from public.get_product_stock(${sinStock});`);
    expect(none.stdout.trim()).toBe(`${sinStock}|0|0|0`);
  });

  it("allocates FIFO from the oldest batch first", async () => {
    const result = await createOrder(pickupArgs(`[{"product_id": ${tarta}, "quantity": 12}]`));
    expect(result.code, allText(result)).toBe(0);
    orderA2 = parsedOrder(result).order_id;

    // Old batch (2026-11-01, 10 units, 3 already reserved by A1) has 7 free;
    // the newer batch covers the remaining 5.
    const rows = await asService(
      `select b.production_date, r.quantity\n` +
        `from public.inventory_reservations r\n` +
        `join public.inventory_batches b on b.id = r.batch_id\n` +
        `where r.order_id = ${orderA2}\n` +
        `order by b.production_date, b.id;`,
    );
    expect(lines(rows.stdout)).toEqual(["2026-11-01|7", "2026-11-10|5"]);

    const stock = await asService(`select * from public.get_product_stock(${tarta});`);
    expect(stock.stdout.trim()).toBe(`${tarta}|15|0|15`);
  });

  it("recomputes totals server-side: zone fee for delivery, none for pickup", async () => {
    // Delivery to 'Resto de Barquisimeto' ($5 fee).
    const delivery = await createOrder(
      `'Juan Lopez', '04127654321', 'delivery', ${zoneResto}, 'Calle 12', null, null, ` +
        `'[{"product_id": ${brownie}, "quantity": 1}]'`,
    );
    expect(delivery.code, allText(delivery)).toBe(0);
    const d = parsedOrder(delivery);
    const dRow = await asService(
      `select subtotal_usd, delivery_fee_usd, total_usd, delivery_zone_id\n` +
        `from public.orders where id = ${d.order_id};`,
    );
    expect(dRow.stdout.trim()).toBe(`4.00|5.00|9.00|${zoneResto}`);

    // Manual-quote zone: fee snapshot stays NULL until the quote is confirmed
    // (SPEC §6 / design §7.1); the total simply excludes the pending fee.
    const quote = await createOrder(
      `'Ana Diaz', '04120001122', 'delivery', ${zoneFuera}, 'Sector norte', null, null, ` +
        `'[{"product_id": ${brownie}, "quantity": 1}]'`,
    );
    expect(quote.code, allText(quote)).toBe(0);
    const q = parsedOrder(quote);
    const qRow = await asService(
      `select subtotal_usd, delivery_fee_usd, total_usd from public.orders where id = ${q.order_id};`,
    );
    expect(qRow.stdout.trim()).toBe(`4.00||4.00`);

    // Pickup: no zone, no fee.
    const pickup = await createOrder(pickupArgs(`[{"product_id": ${galleta}, "quantity": 1}]`));
    expect(pickup.code, allText(pickup)).toBe(0);
    const p = parsedOrder(pickup);
    const pRow = await asService(
      `select delivery_zone_id, delivery_fee_usd, total_usd from public.orders where id = ${p.order_id};`,
    );
    expect(pRow.stdout.trim()).toBe(`||2.00`);
  });

  async function hashToken(token: string): Promise<string> {
    const result = await db.psql(
      `select encode(sha256(convert_to('${token}', 'UTF8')), 'hex');`,
    );
    expect(result.code, allText(result)).toBe(0);
    return lastLine(result.stdout);
  }

  // --- B. Validation ----------------------------------------------------------

  it("validates checkout input before touching the database", async () => {
    const before = await scalar(`select count(*) from public.orders;`);

    const cases: Array<{ args: string; error: string }> = [
      { args: `'', '04121234567', 'pickup', null, null, null, null, '[{"product_id": ${tarta}, "quantity": 1}]'`, error: "customer name is required" },
      { args: `'Maria Perez', null, 'pickup', null, null, null, null, '[{"product_id": ${tarta}, "quantity": 1}]'`, error: "customer phone is required" },
      { args: `'Maria Perez', '04121234567', 'drive', null, null, null, null, '[{"product_id": ${tarta}, "quantity": 1}]'`, error: "fulfillment type must be delivery or pickup" },
      { args: `'Maria Perez', '04121234567', 'delivery', null, null, null, null, '[{"product_id": ${tarta}, "quantity": 1}]'`, error: "delivery zone is required" },
      { args: `'Maria Perez', '04121234567', 'pickup', ${zoneResto}, null, null, null, '[{"product_id": ${tarta}, "quantity": 1}]'`, error: "must not carry a delivery zone" },
      { args: `'Maria Perez', '04121234567', 'pickup', null, null, null, null, '[]'`, error: "at least one cart line" },
      { args: `'Maria Perez', '04121234567', 'pickup', null, null, null, null, null`, error: "at least one cart line" },
      { args: `'Maria Perez', '04121234567', 'pickup', null, null, null, null, '{"product_id": ${tarta}}'`, error: "at least one cart line" },
      { args: `'Maria Perez', '04121234567', 'pickup', null, null, null, null, '[{"product_id": ${tarta}}]'`, error: "numeric product_id and quantity" },
      { args: `'Maria Perez', '04121234567', 'pickup', null, null, null, null, '[{"product_id": "${'not-a-number'}", "quantity": 1}]'`, error: "numeric product_id and quantity" },
      { args: `'Maria Perez', '04121234567', 'pickup', null, null, null, null, '[{"product_id": ${tarta}, "quantity": 0}]'`, error: "quantity at least 1" },
      { args: `'Maria Perez', '04121234567', 'pickup', null, null, null, null, '[{"product_id": ${tarta}, "quantity": 1.5}]'`, error: "integer and quantity at least 1" },
      { args: `'Maria Perez', '04121234567', 'pickup', null, null, null, null, '[{"product_id": 999999999, "quantity": 1}]'`, error: "does not exist or is inactive" },
      { args: `'Maria Perez', '04121234567', 'pickup', null, null, null, null, '[{"product_id": ${retirado}, "quantity": 1}]'`, error: "does not exist or is inactive" },
      { args: `'Maria Perez', '04121234567', 'pickup', null, null, null, null, '[{"product_id": ${cheesecake}, "quantity": 1}]'`, error: "does not exist or is inactive" },
      { args: `'Maria Perez', '04121234567', 'delivery', 999999999, null, null, null, '[{"product_id": ${tarta}, "quantity": 1}]'`, error: "delivery zone" },
    ];

    for (const testCase of cases) {
      const result = await createOrder(testCase.args);
      expect(result.code, `${testCase.args}\n${allText(result)}`).not.toBe(0);
      expect(allText(result)).toContain(testCase.error);
    }

    expect(await scalar(`select count(*) from public.orders;`)).toBe(before);
  });

  it("rejects insufficient stock atomically, naming the product", async () => {
    const before = await scalar(`select count(*) from public.orders;`);
    const reservationsBefore = await scalar(`select count(*) from public.inventory_reservations;`);

    const result = await createOrder(pickupArgs(`[{"product_id": ${sinStock}, "quantity": 1}]`));
    expect(result.code, allText(result)).not.toBe(0);
    expect(allText(result)).toContain(`insufficient available stock for product "Sin stock"`);
    await expectSqlState(
      `public.create_online_order('Maria Perez', '04121234567', 'pickup', null, null, null, null, '[{"product_id": ${sinStock}, "quantity": 1}]')`,
      "P0001",
    );

    // The whole transaction rolled back: no order, no reservation.
    expect(await scalar(`select count(*) from public.orders;`)).toBe(before);
    expect(await scalar(`select count(*) from public.inventory_reservations;`)).toBe(reservationsBefore);
  });

  // --- C. Reservation availability and lifecycle ------------------------------

  it("blocks other checkouts through reservations without touching physical stock", async () => {
    // brownie: 4 physical, 2 already reserved by the delivery/quote orders.
    const orderBResult = await createOrder(pickupArgs(`[{"product_id": ${brownie}, "quantity": 2}]`));
    expect(orderBResult.code, allText(orderBResult)).toBe(0);
    orderB = parsedOrder(orderBResult).order_id;

    // Physical stock untouched; availability is what the reservation removed.
    const stock = await asService(`select * from public.get_product_stock(${brownie});`);
    expect(stock.stdout.trim()).toBe(`${brownie}|4|0|4`);

    // A third checkout cannot take units that are merely reserved.
    const denied = await createOrder(pickupArgs(`[{"product_id": ${brownie}, "quantity": 1}]`));
    expect(denied.code, allText(denied)).not.toBe(0);
    expect(allText(denied)).toContain("insufficient available stock");
    expect(
      await scalar(`select count(*) from public.inventory_reservations where order_id = ${orderB};`),
    ).toBe(1);
  });

  /**
   * Backdates an order's reservations so their deadline has passed. The
   * `created_at / initial_expires_at / expires_at` trio is moved together to
   * keep the migration's CHECKs satisfied (initial = created + 20 min, and
   * expires = correction window when granted, else initial).
   */
  async function lapse(orderId: number, withWindow: boolean): Promise<void> {
    const windowClause = withWindow
      ? `correction_window_ends_at = now() - interval '10 minutes',\n    `
      : ``;
    const result = await asService(
      `update public.inventory_reservations\n` +
        `set created_at = now() - interval '30 minutes',\n` +
        `    initial_expires_at = now() - interval '10 minutes',\n` +
        `    ${windowClause}` +
        `    expires_at = case when expires_at is null then null else now() - interval '10 minutes' end\n` +
        `where order_id = ${orderId} and status = 'active';`,
    );
    expect(result.code, allText(result)).toBe(0);
  }

  it("expires lapsed reservations lazily and moves the pending order to expired", async () => {
    const created = await createOrder(pickupArgs(`[{"product_id": ${bizcocho}, "quantity": 1}]`));
    expect(created.code, allText(created)).toBe(0);
    orderInitial = parsedOrder(created).order_id;

    // Nothing happens while the deadline is in the future.
    const untouched = await asService(`select public.release_expired_reservations();`);
    expect(untouched.code, allText(untouched)).toBe(0);

    await lapse(orderInitial, false);

    const cleanup = await asService(`select public.release_expired_reservations();`);
    expect(cleanup.code, allText(cleanup)).toBe(0);
    expect(Number(lastLine(cleanup.stdout))).toBeGreaterThanOrEqual(1);

    // Reservation closed as expired; the pending order followed.
    const reservation = await asService(
      `select status, closed_at is not null from public.inventory_reservations\n` +
        `where order_id = ${orderInitial};`,
    );
    expect(reservation.stdout.trim()).toBe(`expired|t`);
    const order = await asService(`select status from public.orders where id = ${orderInitial};`);
    expect(order.stdout.trim()).toBe(`expired`);

    // Lazy expiry changes availability only: physical stock is untouched and
    // no movement row is written (design §6.2/§6.3).
    const stock = await asService(`select * from public.get_product_stock(${bizcocho});`);
    expect(stock.stdout.trim()).toBe(`${bizcocho}|6|6|0`); // expired row no longer counts
    const movements = await asService(
      `select count(*) from public.inventory_movements where order_id = ${orderInitial};`,
    );
    expect(movements.stdout.trim()).toBe(`0`);

    // Idempotent: a second cleanup has nothing to do.
    const again = await asService(`select public.release_expired_reservations();`);
    expect(again.stdout.trim()).toBe(`0`);
  });

  it("holds reservations while the receipt is reviewed (OQ-15 semantics)", async () => {
    const created = await createOrder(pickupArgs(`[{"product_id": ${bizcocho}, "quantity": 1}]`));
    expect(created.code, allText(created)).toBe(0);
    orderHeld = parsedOrder(created).order_id;

    const held = await asService(`select public.hold_order_reservations(${orderHeld});`);
    expect(held.stdout.trim()).toBe(`1`);

    // The first receipt submission is counted (0 -> 1) and stays counted.
    const firstAttempt = await asService(
      `select receipt_attempts from public.orders where id = ${orderHeld};`,
    );
    expect(firstAttempt.stdout.trim()).toBe(`1`);

    // expires_at = NULL is the documented "held" state; the immutable initial
    // deadline is preserved for the record.
    const state = await asService(
      `select status, expires_at is null, initial_expires_at = created_at + interval '20 minutes',\n` +
        `       correction_window_ends_at is null\n` +
        `from public.inventory_reservations where order_id = ${orderHeld};`,
    );
    expect(state.stdout.trim()).toBe(`active|t|t|t`);

    // Repeating the hold is a safe no-op (SPEC §8 idempotency): no second
    // attempt is consumed by a retry of the same submission.
    const repeat = await asService(`select public.hold_order_reservations(${orderHeld});`);
    expect(repeat.stdout.trim()).toBe(`1`);
    const attemptsAfterRepeat = await asService(
      `select receipt_attempts from public.orders where id = ${orderHeld};`,
    );
    expect(attemptsAfterRepeat.stdout.trim()).toBe(`1`);

    // A held reservation never lapses, no matter how old the initial deadline
    // is: release_expired_reservations skips NULL deadlines entirely.
    const before = await asService(
      `select status from public.inventory_reservations where order_id = ${orderHeld};`,
    );
    await lapse(orderHeld, false); // only rewrites created_at/initial (expires stays NULL)
    const cleanup = await asService(`select public.release_expired_reservations();`);
    expect(cleanup.code, allText(cleanup)).toBe(0);
    const after = await asService(
      `select status, expires_at is null from public.inventory_reservations where order_id = ${orderHeld};`,
    );
    expect(before.stdout.trim()).toBe(`active`);
    expect(after.stdout.trim()).toBe(`active|t`);

    const order = await asService(`select status from public.orders where id = ${orderHeld};`);
    expect(order.stdout.trim()).toBe(`pending`);

    // Still reserved: availability keeps counting it (orderInitial's expired
    // row does not).
    const stock = await asService(`select * from public.get_product_stock(${bizcocho});`);
    expect(stock.stdout.trim()).toBe(`${bizcocho}|6|5|1`);
  });

  it("opens one bounded 20-minute correction window after the first rejection and never releases", async () => {
    const created = await createOrder(pickupArgs(`[{"product_id": ${bizcocho}, "quantity": 1}]`));
    expect(created.code, allText(created)).toBe(0);
    orderFlow = parsedOrder(created).order_id;

    // Receipt #1 is submitted first: counted and held during review.
    const submitted = await asService(`select public.hold_order_reservations(${orderFlow});`);
    expect(submitted.stdout.trim()).toBe(`1`);

    // Rejection #1 opens the window; inventory is NOT released (design §6.2).
    const opened = await asService(`select public.open_order_correction_window(${orderFlow});`);
    expect(opened.stdout.trim()).toBe(`1`);

    const window = await asService(
      `select status, correction_window_ends_at is not null,\n` +
        `       expires_at = correction_window_ends_at,\n` +
        `       correction_window_ends_at >= now() + interval '19 minutes',\n` +
        `       expires_at > now()\n` +
        `from public.inventory_reservations where order_id = ${orderFlow};`,
    );
    expect(window.stdout.trim()).toBe(`active|t|t|t|t`);

    // Rejections never add attempts: exactly one correction is still allowed.
    const attempts = await asService(
      `select receipt_attempts from public.orders where id = ${orderFlow};`,
    );
    expect(attempts.stdout.trim()).toBe(`1`);

    const first = await asService(
      `select correction_window_ends_at from public.inventory_reservations where order_id = ${orderFlow};`,
    );

    // A repeated rejection re-uses the recorded deadline: the window is bounded
    // and never extended (OQ-14 confirmed).
    const reopened = await asService(`select public.open_order_correction_window(${orderFlow});`);
    expect(reopened.stdout.trim()).toBe(`1`);
    const second = await asService(
      `select correction_window_ends_at from public.inventory_reservations where order_id = ${orderFlow};`,
    );
    expect(second.stdout.trim()).toBe(first.stdout.trim());
    const attemptsAgain = await asService(
      `select receipt_attempts from public.orders where id = ${orderFlow};`,
    );
    expect(attemptsAgain.stdout.trim()).toBe(`1`);

    // Nothing was released by either rejection.
    const stock = await asService(`select * from public.get_product_stock(${bizcocho});`);
    expect(stock.stdout.trim()).toBe(`${bizcocho}|6|4|2`);
    const movements = await asService(
      `select count(*) from public.inventory_movements where order_id = ${orderFlow};`,
    );
    expect(movements.stdout.trim()).toBe(`0`);

    // When the window lapses, the lazy cleanup expires it like any other
    // reservation — and the order with it.
    await lapse(orderFlow, true);
    await asService(`select public.release_expired_reservations();`);
    const reservation = await asService(
      `select status from public.inventory_reservations where order_id = ${orderFlow};`,
    );
    expect(reservation.stdout.trim()).toBe(`expired`);
    const order = await asService(`select status from public.orders where id = ${orderFlow};`);
    expect(order.stdout.trim()).toBe(`expired`);
  });

  it("consumes reservations into sale movements and decrements physical stock", async () => {
    const created = await createOrder(pickupArgs(`[{"product_id": ${bizcocho}, "quantity": 1}]`));
    expect(created.code, allText(created)).toBe(0);
    orderConsume = parsedOrder(created).order_id;

    const consumed = await asService(`select public.consume_order_reservations(${orderConsume});`);
    expect(consumed.code, allText(consumed)).toBe(0);
    expect(consumed.stdout.trim()).toBe(`1`);

    const reservation = await asService(
      `select status, closed_at is not null from public.inventory_reservations\n` +
        `where order_id = ${orderConsume};`,
    );
    expect(reservation.stdout.trim()).toBe(`consumed|t`);

    // Exactly one negative `sale` movement, tied to the order, written by the
    // system (admin_id NULL — design §6.3, OQ-9 still open).
    const movement = await asService(
      `select type, quantity, reason is null, admin_id is null, order_id\n` +
        `from public.inventory_movements where order_id = ${orderConsume};`,
    );
    expect(movement.stdout.trim()).toBe(`sale|-1|t|t|${orderConsume}`);

    // Physical stock fell by the consumed quantity; the held reservation of
    // orderHeld still counts as reserved.
    const stock = await asService(`select * from public.get_product_stock(${bizcocho});`);
    expect(stock.stdout.trim()).toBe(`${bizcocho}|5|4|1`);

    // Idempotent repeat: no second deduction, no second movement.
    const repeat = await asService(`select public.consume_order_reservations(${orderConsume});`);
    expect(repeat.stdout.trim()).toBe(`0`);
    const stockAgain = await asService(`select * from public.get_product_stock(${bizcocho});`);
    expect(stockAgain.stdout.trim()).toBe(`${bizcocho}|5|4|1`);
    const movements = await asService(
      `select count(*) from public.inventory_movements where order_id = ${orderConsume};`,
    );
    expect(movements.stdout.trim()).toBe(`1`);
  });

  it("releases reservations on authorized cancellation without moving physical stock", async () => {
    const stockBefore = await asService(`select * from public.get_product_stock(${galleta});`);
    expect(stockBefore.stdout.trim()).toBe(`${galleta}|10|9|1`); // 1 pickup unit reserved

    const created = await createOrder(pickupArgs(`[{"product_id": ${galleta}, "quantity": 6}]`));
    expect(created.code, allText(created)).toBe(0);
    orderReleased = parsedOrder(created).order_id;

    // Availability dropped while held...
    const heldStock = await asService(`select * from public.get_product_stock(${galleta});`);
    expect(heldStock.stdout.trim()).toBe(`${galleta}|10|3|7`);

    const released = await asService(`select public.release_order_reservations(${orderReleased});`);
    expect(released.stdout.trim()).toBe(`1`);

    const reservation = await asService(
      `select status, closed_at is not null from public.inventory_reservations\n` +
        `where order_id = ${orderReleased};`,
    );
    expect(reservation.stdout.trim()).toBe(`released|t`);

    // ...and the units are available again: release never touches
    // remaining_quantity and writes no movement (design §6.2).
    const stockAfter = await asService(`select * from public.get_product_stock(${galleta});`);
    expect(stockAfter.stdout.trim()).toBe(`${galleta}|10|9|1`);
    const movements = await asService(
      `select count(*) from public.inventory_movements where order_id = ${orderReleased};`,
    );
    expect(movements.stdout.trim()).toBe(`0`);

    // Idempotent repeat.
    const repeat = await asService(`select public.release_order_reservations(${orderReleased});`);
    expect(repeat.stdout.trim()).toBe(`0`);
  });

  it("counts two receipts and auto-cancels + releases on the second rejection", async () => {
    const created = await createOrder(pickupArgs(`[{"product_id": ${bizcocho}, "quantity": 1}]`));
    expect(created.code, allText(created)).toBe(0);
    orderSecondReject = parsedOrder(created).order_id;

    // Receipt #1: submitted (counted, 0 -> 1) and held during review.
    const firstSubmit = await asService(
      `select public.hold_order_reservations(${orderSecondReject});`,
    );
    expect(firstSubmit.stdout.trim()).toBe(`1`);
    // Rejection #1: the ONE 20-minute window opens; inventory is NOT released.
    const firstReject = await asService(
      `select public.open_order_correction_window(${orderSecondReject});`,
    );
    expect(firstReject.stdout.trim()).toBe(`1`);
    // Receipt #2 (the only correction): counted (1 -> 2) and held again.
    const secondSubmit = await asService(
      `select public.hold_order_reservations(${orderSecondReject});`,
    );
    expect(secondSubmit.stdout.trim()).toBe(`1`);

    const counted = await asService(
      `select receipt_attempts from public.orders where id = ${orderSecondReject};`,
    );
    expect(counted.stdout.trim()).toBe(`2`);

    // Still reserved while the second receipt is under review (physical stock
    // is 5 after the consume test, orderHeld still holds one unit).
    const during = await asService(`select * from public.get_product_stock(${bizcocho});`);
    expect(during.stdout.trim()).toBe(`${bizcocho}|5|3|2`);

    // Rejection #2: no third receipt exists -> automatic cancel + release in
    // the same transaction; the return value is the released reservation count.
    const finalReject = await asService(
      `select public.open_order_correction_window(${orderSecondReject});`,
    );
    expect(finalReject.code, allText(finalReject)).toBe(0);
    expect(finalReject.stdout.trim()).toBe(`1`);

    const state = await asService(
      `select o.status, r.status, r.closed_at is not null\n` +
        `from public.orders o join public.inventory_reservations r on r.order_id = o.id\n` +
        `where o.id = ${orderSecondReject};`,
    );
    expect(state.stdout.trim()).toBe(`canceled|released|t`);

    // Availability restored exactly once; no physical stock change, no
    // movement (a rejection is not a sale — design §6.2/§6.3).
    const stock = await asService(`select * from public.get_product_stock(${bizcocho});`);
    expect(stock.stdout.trim()).toBe(`${bizcocho}|5|4|1`);
    const movements = await asService(
      `select count(*) from public.inventory_movements where order_id = ${orderSecondReject};`,
    );
    expect(movements.stdout.trim()).toBe(`0`);

    // Idempotent repeats: a third rejection returns 0, a hold on the canceled
    // order is a state violation, and neither changes stock or order status.
    const repeat = await asService(
      `select public.open_order_correction_window(${orderSecondReject});`,
    );
    expect(repeat.stdout.trim()).toBe(`0`);
    await expectSqlState(`public.hold_order_reservations(${orderSecondReject})`, "P0001");
    const stockAgain = await asService(`select * from public.get_product_stock(${bizcocho});`);
    expect(stockAgain.stdout.trim()).toBe(`${bizcocho}|5|4|1`);
    const status = await asService(
      `select status from public.orders where id = ${orderSecondReject};`,
    );
    expect(status.stdout.trim()).toBe(`canceled`);
  });

  it("keeps a manual-quote delivery reserved from creation while the quote is pending", async () => {
    const created = await createOrder(
      `'Luisa Mara', '04129998877', 'delivery', ${zoneFuera}, 'Sector sur', null, null, ` +
        `'[{"product_id": ${galleta}, "quantity": 1}]'`,
    );
    expect(created.code, allText(created)).toBe(0);
    const orderQuote = parsedOrder(created).order_id;

    // Created HELD: no operative deadline can lapse while the quote is being
    // confirmed, but the immutable 20-minute initial deadline is recorded.
    const state = await asService(
      `select status, expires_at is null,\n` +
        `       initial_expires_at = created_at + interval '20 minutes',\n` +
        `       correction_window_ends_at is null\n` +
        `from public.inventory_reservations where order_id = ${orderQuote};`,
    );
    expect(state.stdout.trim()).toBe(`active|t|t|t`);

    // The unit is reserved from creation (galleta: pickup 1 + this order 1).
    const reserved = await asService(`select * from public.get_product_stock(${galleta});`);
    expect(reserved.stdout.trim()).toBe(`${galleta}|10|8|2`);

    // Lazy expiry never touches it, no matter how old the record gets.
    await lapse(orderQuote, false);
    const cleanup = await asService(`select public.release_expired_reservations();`);
    expect(cleanup.stdout.trim()).toBe(`0`);
    const after = await asService(
      `select status, expires_at is null from public.inventory_reservations where order_id = ${orderQuote};`,
    );
    expect(after.stdout.trim()).toBe(`active|t`);
    const order = await asService(`select status from public.orders where id = ${orderQuote};`);
    expect(order.stdout.trim()).toBe(`pending`);

    // The first receipt still counts even though the rows arrived held:
    // receipt_attempts 0 -> 1, with the deadline still suspended.
    const held = await asService(`select public.hold_order_reservations(${orderQuote});`);
    expect(held.stdout.trim()).toBe(`1`);
    const attempts = await asService(
      `select receipt_attempts from public.orders where id = ${orderQuote};`,
    );
    expect(attempts.stdout.trim()).toBe(`1`);

    // Release in-line so later stock assertions see the original baseline.
    const released = await asService(`select public.release_order_reservations(${orderQuote});`);
    expect(released.stdout.trim()).toBe(`1`);
    const stock = await asService(`select * from public.get_product_stock(${galleta});`);
    expect(stock.stdout.trim()).toBe(`${galleta}|10|9|1`);
  });

  it("hard-stops at two receipts: a third submission is rejected before changing anything", async () => {
    const created = await createOrder(pickupArgs(`[{"product_id": ${galleta}, "quantity": 1}]`));
    expect(created.code, allText(created)).toBe(0);
    const orderThird = parsedOrder(created).order_id;

    // Simulate an order whose two receipts were already submitted (a Phase 4
    // double-submit bug or a manual data edit): hold must refuse attempt #3.
    const forced = await db.psql(
      `update public.orders set receipt_attempts = 2 where id = ${orderThird};`,
    );
    expect(forced.code, allText(forced)).toBe(0);

    // The CHECK independently enforces the 0..2 value domain.
    const overDomain = await db.psql(
      `update public.orders set receipt_attempts = 3 where id = ${orderThird};`,
    );
    expect(overDomain.code).not.toBe(0);
    expect(allText(overDomain)).toContain(`orders_receipt_attempts_check`);

    await expectSqlState(`public.hold_order_reservations(${orderThird})`, "P0001");
    const state = await asService(
      `select receipt_attempts,\n` +
        `       (select expires_at is null from public.inventory_reservations\n` +
        `        where order_id = ${orderThird})\n` +
        `from public.orders where id = ${orderThird};`,
    );
    expect(state.stdout.trim()).toBe(`2|f`); // nothing was held, counter unchanged

    // Release in-line to restore the shared galleta baseline.
    const released = await asService(`select public.release_order_reservations(${orderThird});`);
    expect(released.stdout.trim()).toBe(`1`);
  });

  it("rejects invalid lifecycle transitions with the documented SQLSTATEs", async () => {
    // Terminal-state violations: P0001.
    await expectSqlState(`public.consume_order_reservations(${orderReleased})`, "P0001");
    await expectSqlState(`public.release_order_reservations(${orderConsume})`, "P0001");
    await expectSqlState(`public.hold_order_reservations(${orderInitial})`, "P0001");
    await expectSqlState(`public.open_order_correction_window(${orderInitial})`, "P0001");
    // Rejecting a receipt that was never submitted is also invalid: orderA1
    // still has active reservations but receipt_attempts = 0.
    await expectSqlState(`public.open_order_correction_window(${orderA1})`, "P0001");
    const noReceipt = await asService(`select public.open_order_correction_window(${orderA1});`);
    expect(allText(noReceipt)).toContain("no submitted receipt to reject");

    const consumeReleased = await asService(
      `select public.consume_order_reservations(${orderReleased});`,
    );
    expect(allText(consumeReleased)).toContain("no active reservations to consume");
    expect(consumeReleased.code).not.toBe(0);

    // Unknown order: P0002. Missing/bad arguments: 22023.
    await expectSqlState(`public.consume_order_reservations(999999999)`, "P0002");
    await expectSqlState(`public.release_order_reservations(999999999)`, "P0002");
    await expectSqlState(`public.hold_order_reservations(999999999)`, "P0002");
    await expectSqlState(`public.hold_order_reservations(null)`, "22023");
    await expectSqlState(`public.open_order_correction_window(null)`, "22023");

    // The rejected calls changed nothing.
    const stock = await asService(`select * from public.get_product_stock(${galleta});`);
    expect(stock.stdout.trim()).toBe(`${galleta}|10|9|1`);
  });

  // --- D. Concurrency ---------------------------------------------------------

  it("never oversells under concurrent checkouts (row locks serialise creators)", async () => {
    // concurrencia: 5 physical units; four parallel checkouts each want 3, so
    // exactly one can win no matter how the sessions interleave.
    const attempts = await Promise.all(
      Array.from({ length: 4 }, () =>
        createOrder(pickupArgs(`[{"product_id": ${concurrencia}, "quantity": 3}]`)),
      ),
    );

    const successes = attempts.filter((result) => result.code === 0);
    const failures = attempts.filter((result) => result.code !== 0);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(3);
    for (const failure of failures) {
      expect(allText(failure)).toContain("insufficient available stock");
    }

    // The winner reserved 3 of 5; nothing was double-allocated.
    const stock = await asService(`select * from public.get_product_stock(${concurrencia});`);
    expect(stock.stdout.trim()).toBe(`${concurrencia}|5|2|3`);
    const reservations = await asService(
      `select coalesce(sum(quantity), 0) from public.inventory_reservations r\n` +
        `join public.inventory_batches b on b.id = r.batch_id\n` +
        `where b.product_id = ${concurrencia} and r.status = 'active';`,
    );
    expect(reservations.stdout.trim()).toBe(`3`);
  });

  it("consumes exactly once under concurrent calls (idempotent under contention)", async () => {
    const created = await createOrder(pickupArgs(`[{"product_id": ${galleta}, "quantity": 2}]`));
    expect(created.code, allText(created)).toBe(0);
    const orderId = parsedOrder(created).order_id;

    const before = await asService(`select * from public.get_product_stock(${galleta});`);
    expect(before.stdout.trim()).toBe(`${galleta}|10|7|3`); // pickup 1 + this order 2

    const [first, second] = await Promise.all([
      asService(`select public.consume_order_reservations(${orderId});`),
      asService(`select public.consume_order_reservations(${orderId});`),
    ]);
    expect(first.code, allText(first)).toBe(0);
    expect(second.code, allText(second)).toBe(0);

    // One caller consumed the row; the other observed the terminal state and
    // returned the idempotent no-op.
    const counts = [Number(lastLine(first.stdout)), Number(lastLine(second.stdout))].sort();
    expect(counts, `${allText(first)}\n---\n${allText(second)}`).toEqual([0, 1]);

    const after = await asService(`select * from public.get_product_stock(${galleta});`);
    expect(after.stdout.trim()).toBe(`${galleta}|8|7|1`); // one deduction only
    const movements = await asService(
      `select count(*) from public.inventory_movements where order_id = ${orderId};`,
    );
    expect(movements.stdout.trim()).toBe(`1`);
  });

  it("auto-cancels exactly once under parallel second rejections", async () => {
    const created = await createOrder(pickupArgs(`[{"product_id": ${galleta}, "quantity": 1}]`));
    expect(created.code, allText(created)).toBe(0);
    const orderId = parsedOrder(created).order_id;

    // Drive the order to the second receipt under review (attempts = 2, held).
    expect((await asService(`select public.hold_order_reservations(${orderId});`)).stdout.trim()).toBe(`1`);
    expect((await asService(`select public.open_order_correction_window(${orderId});`)).stdout.trim()).toBe(`1`);
    expect((await asService(`select public.hold_order_reservations(${orderId});`)).stdout.trim()).toBe(`1`);

    const before = await asService(`select * from public.get_product_stock(${galleta});`);
    expect(before.stdout.trim()).toBe(`${galleta}|8|6|2`);

    // Two concurrent final rejections: one does the cancel+release, the other
    // observes the terminal state and returns the idempotent no-op.
    const [first, second] = await Promise.all([
      asService(`select public.open_order_correction_window(${orderId});`),
      asService(`select public.open_order_correction_window(${orderId});`),
    ]);
    expect(first.code, allText(first)).toBe(0);
    expect(second.code, allText(second)).toBe(0);
    const counts = [Number(lastLine(first.stdout)), Number(lastLine(second.stdout))].sort();
    expect(counts, `${allText(first)}\n---\n${allText(second)}`).toEqual([0, 1]);

    const state = await asService(
      `select o.status, r.status from public.orders o\n` +
        `join public.inventory_reservations r on r.order_id = o.id where o.id = ${orderId};`,
    );
    expect(state.stdout.trim()).toBe(`canceled|released`);

    // Availability restored exactly once; no movement, no double release.
    const after = await asService(`select * from public.get_product_stock(${galleta});`);
    expect(after.stdout.trim()).toBe(`${galleta}|8|7|1`);
    const movements = await asService(
      `select count(*) from public.inventory_movements where order_id = ${orderId};`,
    );
    expect(movements.stdout.trim()).toBe(`0`);
  });

  // --- E. Tracking and guest cancellation -------------------------------------

  it("serves tracking data without any PII and only accepts the real token", async () => {
    const result = await asService(`select public.get_order_for_tracking('${tokenA1}');`);
    expect(result.code, allText(result)).toBe(0);

    const payload = JSON.parse(lastLine(result.stdout)) as Record<string, unknown>;
    expect(payload.order_id).toBe(orderA1);
    expect(payload.status).toBe(`pending`);
    expect(payload.items).toEqual([
      { product_name: `Tarta de fresa`, unit_price_usd: 10, quantity: 3 },
    ]);
    expect(payload.cancellation_requests).toEqual([]);

    // PII-free projection: no customer identity, address or raw token.
    const raw = JSON.stringify(payload);
    expect(raw).not.toContain(`Maria`);
    expect(raw).not.toContain(`04121234567`);
    expect(raw).not.toContain(`customer`);
    expect(raw).not.toContain(`address`);
    expect(raw).not.toContain(tokenA1);

    // Wrong tokens simply match nothing (NULL), without leaking existence.
    const wrong = await asService(
      `select public.get_order_for_tracking('${"ab".repeat(32)}');`,
    );
    expect(wrong.code, allText(wrong)).toBe(0);
    expect(wrong.stdout.trim()).toBe(``);

    // The stored value is the digest, never the token itself.
    const stored = await asService(
      `select tracking_token_hash = encode(sha256(convert_to('${tokenA1}', 'UTF8')), 'hex'),\n` +
        `       tracking_token_hash <> '${tokenA1}'\n` +
        `from public.orders where id = ${orderA1};`,
    );
    expect(stored.stdout.trim()).toBe(`t|t`);
  });

  it("records one pending cancellation request per order and reports duplicates", async () => {
    const requested = await asService(
      `select public.request_order_cancellation('${tokenA1}', '  ya no lo quiero  ');`,
    );
    expect(requested.code, allText(requested)).toBe(0);
    const requestId = Number(lastLine(requested.stdout));
    expect(requestId).toBeGreaterThan(0);

    // Stored trimmed, pending, sourced from tracking — and it changed nothing
    // about the order or the inventory (SPEC §11).
    const row = await asService(
      `select status, source, customer_reason, resolved_at is null, order_id\n` +
        `from public.cancellation_requests where id = ${requestId};`,
    );
    expect(row.stdout.trim()).toBe(`pending|tracking|ya no lo quiero|t|${orderA1}`);
    const order = await asService(`select status from public.orders where id = ${orderA1};`);
    expect(order.stdout.trim()).toBe(`pending`);
    const stock = await asService(`select * from public.get_product_stock(${tarta});`);
    expect(stock.stdout.trim()).toBe(`${tarta}|15|0|15`);

    // Visible to the guest through tracking...
    const tracked = await asService(`select public.get_order_for_tracking('${tokenA1}');`);
    const payload = JSON.parse(lastLine(tracked.stdout)) as { cancellation_requests: unknown[] };
    expect(payload.cancellation_requests).toEqual([
      { status: `pending`, created_at: expect.any(String), resolved_at: null },
    ]);

    // ...but a second pending request for the same order is a duplicate (23505).
    await expectSqlState(
      `public.request_order_cancellation('${tokenA1}', 'otra vez')`,
      "23505",
    );
    const duplicate = await asService(
      `select public.request_order_cancellation('${tokenA1}', 'otra vez');`,
    );
    expect(duplicate.code).not.toBe(0);
    expect(allText(duplicate)).toContain("already pending");

    // Unknown tokens are rejected without revealing whether orders exist.
    await expectSqlState(
      `public.request_order_cancellation('${"cd".repeat(32)}', 'x')`,
      "P0002",
    );
    const count = await scalar(`select count(*) from public.cancellation_requests;`);
    expect(count).toBe(1);
  });

  // --- F. RLS, grants and administrative access -------------------------------

  it("enables and forces RLS on all five tables with only the documented policies", async () => {
    const rls = await db.psql(
      `select c.relname || '|' || c.relrowsecurity || '|' || c.relforcerowsecurity\n` +
        `from pg_class c join pg_namespace n on n.oid = c.relnamespace\n` +
        `where n.nspname = 'public'\n` +
        `  and c.relname in ('orders', 'order_items', 'inventory_reservations',\n` +
        `                    'cancellation_requests', 'exchange_rates')\n` +
        `order by c.relname;`,
    );
    expect(rls.code, allText(rls)).toBe(0);
    expect(lines(rls.stdout), allText(rls)).toEqual([
      `cancellation_requests|true|true`,
      `exchange_rates|true|true`,
      `inventory_reservations|true|true`,
      `order_items|true|true`,
      `orders|true|true`,
    ]);

    const policies = await db.psql(
      `select tablename || '.' || policyname from pg_policies\n` +
        `where schemaname = 'public'\n` +
        `  and tablename in ('orders', 'order_items', 'inventory_reservations',\n` +
        `                    'cancellation_requests', 'exchange_rates')\n` +
        `order by tablename, policyname;`,
    );
    expect(policies.code, allText(policies)).toBe(0);
    expect(lines(policies.stdout), allText(policies)).toEqual([
      `cancellation_requests.cancellation_requests_admin_all`,
      `exchange_rates.exchange_rates_admin_all`,
      `exchange_rates.exchange_rates_public_select`,
      `inventory_reservations.inventory_reservations_admin_all`,
      `order_items.order_items_admin_all`,
      `orders.orders_admin_all`,
    ]);

    // Guests have no row-level path to orders or their reservations at all.
    const anonPolicies = await db.psql(
      `select count(*) from pg_policies\n` +
        `where schemaname = 'public'\n` +
        `  and tablename in ('orders', 'order_items', 'inventory_reservations',\n` +
        `                    'cancellation_requests')\n` +
        `  and 'anon' = any(roles);`,
    );
    expect(anonPolicies.stdout.trim()).toBe(`0`);
  });

  it("keeps the RLS boundary: guests and strangers see nothing, admins see all", async () => {
    const total = await scalar(`select count(*) from public.orders;`, "postgres");

    // anon: no policy -> zero rows on read, hard failure on write.
    const anonRead = await asAnon(`select count(*) from public.orders;`);
    expect(anonRead.stdout.trim()).toBe(`0`);
    const anonWrite = await asAnon(
      `insert into public.orders (channel, status, subtotal_usd, total_usd)\n` +
        `values ('online', 'pending', 1, 1);`,
    );
    expect(anonWrite.code, allText(anonWrite)).not.toBe(0);
    expect(allText(anonWrite)).toContain(`row-level security policy`);

    // Authenticated non-admin: same invisible boundary.
    const strangerRead = await asStranger(`select count(*) from public.orders;`);
    expect(strangerRead.stdout.trim()).toBe(`0`);
    const strangerWrite = await asStranger(
      `insert into public.order_items (order_id, product_id, product_name, unit_price_usd, quantity)\n` +
        `values (${orderA1}, ${tarta}, 'Tarta de fresa', 10, 1);`,
    );
    expect(strangerWrite.code, allText(strangerWrite)).not.toBe(0);
    expect(allText(strangerWrite)).toContain(`row-level security policy`);

    // Admins: the ALL policy applies (read + write).
    const adminRead = await asAdmin1(`select count(*) from public.orders;`);
    expect(Number(lastLine(adminRead.stdout))).toBe(total);
    const adminWrite = await asAdmin1(
      `update public.orders set additional_instructions = 'nota del admin' where id = ${orderA1};`,
    );
    expect(adminWrite.code, allText(adminWrite)).toBe(0);
    const saved = await asService(
      `select additional_instructions, updated_at > created_at from public.orders where id = ${orderA1};`,
    );
    expect(saved.stdout.trim()).toBe(`nota del admin|t`); // updated_at trigger fired

    // service_role bypasses RLS entirely (server-side only).
    const serviceRead = await asService(`select count(*) from public.orders;`);
    expect(Number(lastLine(serviceRead.stdout))).toBe(total);
  });

  it("exposes exchange_rates read-only to the public and keeps writes admin-only", async () => {
    const seeded = await asService(
      `insert into public.exchange_rates (rate_ves_per_usd, observed_at, source)\n` +
        `values (36.5000, now(), 'bcv-test') returning id;`,
    );
    expect(seeded.code, allText(seeded)).toBe(0);

    // The one documented anon policy: SELECT works for everyone.
    const anonRead = await asAnon(`select count(*) from public.exchange_rates;`);
    expect(anonRead.code, allText(anonRead)).toBe(0);
    expect(Number(lastLine(anonRead.stdout))).toBeGreaterThanOrEqual(1);

    // Writes are rejected for guests and non-admins alike.
    const anonWrite = await asAnon(
      `insert into public.exchange_rates (rate_ves_per_usd, observed_at)\n` +
        `values (99, now());`,
    );
    expect(anonWrite.code, allText(anonWrite)).not.toBe(0);
    expect(allText(anonWrite)).toContain(`row-level security policy`);
    const strangerWrite = await asStranger(
      `insert into public.exchange_rates (rate_ves_per_usd, observed_at)\n` +
        `values (99, now());`,
    );
    expect(strangerWrite.code, allText(strangerWrite)).not.toBe(0);
    expect(allText(strangerWrite)).toContain(`row-level security policy`);
  });

  it("grants every M3 RPC to the service role and to no API role", async () => {
    const m3Functions = [
      `create_online_order`,
      `hold_order_reservations`,
      `open_order_correction_window`,
      `release_expired_reservations`,
      `consume_order_reservations`,
      `release_order_reservations`,
      `get_order_for_tracking`,
      `request_order_cancellation`,
    ].join(`', '`);

    for (const role of [`anon`, `authenticated`]) {
      const result = await db.psql(
        `select count(*) from pg_proc p\n` +
          `join pg_namespace n on n.oid = p.pronamespace\n` +
          `where n.nspname = 'public'\n` +
          `  and p.proname in ('${m3Functions}')\n` +
          `  and has_function_privilege('${role}', p.oid, 'execute');`,
      );
      expect(result.code, allText(result)).toBe(0);
      expect(lastLine(result.stdout), role).toBe(`0`);
    }

    const service = await db.psql(
      `select count(*) from pg_proc p\n` +
        `join pg_namespace n on n.oid = p.pronamespace\n` +
        `where n.nspname = 'public'\n` +
        `  and p.proname in ('${m3Functions}')\n` +
        `  and has_function_privilege('service_role', p.oid, 'execute');`,
    );
    expect(service.code, allText(service)).toBe(0);
    expect(lastLine(service.stdout)).toBe(`8`);

    // And the boundary holds when actually invoked (full arity so the call
    // resolves to the real function and fails on the EXECUTE grant).
    const anonCreate = await asAnon(
      `select public.create_online_order(null, null, null, null, null, null, null, null);`,
    );
    expect(anonCreate.code).not.toBe(0);
    expect(allText(anonCreate)).toContain(`permission denied for function create_online_order`);
    const anonTrack = await asAnon(`select public.get_order_for_tracking('x');`);
    expect(anonTrack.code).not.toBe(0);
    expect(allText(anonTrack)).toContain(`permission denied for function get_order_for_tracking`);
    const anonCancel = await asAnon(`select public.request_order_cancellation('x', 'y');`);
    expect(anonCancel.code).not.toBe(0);
    expect(allText(anonCancel)).toContain(`permission denied for function request_order_cancellation`);
    const anonExpiry = await asAnon(`select public.release_expired_reservations();`);
    expect(anonExpiry.code).not.toBe(0);
    expect(allText(anonExpiry)).toContain(`permission denied for function release_expired_reservations`);

    // Even an administrator has no execute rights: these run server-side only.
    const adminCreate = await asAdmin1(
      `select public.create_online_order(null, null, null, null, null, null, null, null);`,
    );
    expect(adminCreate.code).not.toBe(0);
    expect(allText(adminCreate)).toContain(`permission denied for function create_online_order`);
    const adminConsume = await asAdmin1(`select public.consume_order_reservations(${orderA1});`);
    expect(adminConsume.code).not.toBe(0);
    expect(allText(adminConsume)).toContain(`permission denied for function consume_order_reservations`);
  });

  // --- G. Schema objects ------------------------------------------------------

  it("creates every design-specified constraint, index and column of M3", async () => {
    // Named CHECK / UNIQUE constraints (design §7.1/§7.2/§6.2/§9.1/§10.1).
    const expectedConstraints = [
      `cancellation_requests_pending_check`,
      `cancellation_requests_resolved_check`,
      `cancellation_requests_source_check`,
      `cancellation_requests_status_check`,
      `exchange_rates_observed_at_key`,
      `exchange_rates_rate_ves_per_usd_check`,
      `inventory_reservations_expires_at_check`,
      `inventory_reservations_initial_expires_at_check`,
      `inventory_reservations_quantity_check`,
      `inventory_reservations_status_check`,
      `orders_channel_check`,
      `orders_delivery_check`,
      `orders_fulfillment_type_check`,
      `orders_online_check`,
      `orders_pickup_check`,
      `orders_pos_check`,
      `orders_receipt_attempts_check`,
      `orders_status_check`,
      `orders_tracking_token_hash_key`,
      `order_items_quantity_check`,
      `order_items_unit_price_usd_check`,
    ];
    const constraints = await db.psql(
      `select conname from pg_constraint\n` +
        `where conname in ('${expectedConstraints.join(`', '`)}') order by conname;`,
    );
    expect(constraints.code, allText(constraints)).toBe(0);
    expect(lines(constraints.stdout)).toEqual([...expectedConstraints].sort());

    // Indexes (design §6.2/§7.1/§7.2/§9.1 — including the two partial ones).
    const expectedIndexes = [
      `cancellation_requests_order_id_idx`,
      `cancellation_requests_order_pending_key`,
      `cancellation_requests_pending_idx`,
      `cancellation_requests_resolved_by_idx`,
      `inventory_movements_order_id_idx`,
      `inventory_reservations_active_batch_idx`,
      `inventory_reservations_expiry_idx`,
      `inventory_reservations_order_id_idx`,
      `order_items_order_id_idx`,
      `order_items_product_id_idx`,
      `orders_created_at_idx`,
      `orders_customer_phone_idx`,
      `orders_delivery_zone_id_idx`,
      `orders_pending_idx`,
      `orders_status_created_at_idx`,
    ];
    const indexes = await db.psql(
      `select indexname from pg_indexes\n` +
        `where schemaname = 'public' and indexname in ('${expectedIndexes.join(`', '`)}')\n` +
        `order by indexname;`,
    );
    expect(indexes.code, allText(indexes)).toBe(0);
    expect(lines(indexes.stdout)).toEqual(expectedIndexes);

    // inventory_movements.order_id: column, SET NULL FK to orders, index.
    const column = await db.psql(
      `select column_name from information_schema.columns\n` +
        `where table_schema = 'public' and table_name = 'inventory_movements'\n` +
        `  and column_name = 'order_id';`,
    );
    expect(column.stdout.trim()).toBe(`order_id`);
    const fk = await db.psql(
      `select confdeltype from pg_constraint\n` +
        `where conrelid = 'public.inventory_movements'::regclass\n` +
        `  and confrelid = 'public.orders'::regclass and contype = 'f';`,
    );
    expect(fk.stdout.trim()).toBe(`n`); // ON DELETE SET NULL

    // updated_at trigger on orders (design §7.1).
    const trigger = await db.psql(
      `select count(*) from pg_trigger\n` +
        `where tgrelid = 'public.orders'::regclass and tgname = 'orders_updated_at'\n` +
        `  and not tgisinternal;`,
    );
    expect(trigger.stdout.trim()).toBe(`1`);

    // The 20-minute deadlines are CHECK-enforced, not trigger magic.
    const timing = await db.psql(
      `select pg_get_constraintdef(oid) from pg_constraint\n` +
        `where conname = 'inventory_reservations_initial_expires_at_check';`,
    );
    expect(timing.stdout).toContain(`00:20:00`); // interval '20 minutes', verbatim

    // M3 correction: the two-receipt counter is a NOT NULL column defaulting0.
    const attemptsColumn = await db.psql(
      `select is_nullable || '|' || coalesce(column_default, 'null')\n` +
        `from information_schema.columns\n` +
        `where table_schema = 'public' and table_name = 'orders'\n` +
        `  and column_name = 'receipt_attempts';`,
    );
    expect(attemptsColumn.stdout.trim()).toBe(`NO|0`);
  });
});
