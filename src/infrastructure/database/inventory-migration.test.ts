/**
 * M2 — behavioral validation of `supabase/migrations/002_inventory_foundation.sql`.
 *
 * The migration is applied to a throwaway local PostgreSQL cluster (with a
 * Supabase environment stub) and exercised end to end: entries, replenishment,
 * reductions, oversell/negative-stock rejection, invalid input, concurrency,
 * RLS/authorization boundaries, grants and schema objects. No remote project
 * and no credentials are involved.
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
  ('tarta-fresa', 'Tarta de fresa', 'descripcion', 10.00),
  ('bizcocho',    'Bizcocho',       'descripcion',  8.00),
  ('brownie',     'Brownie',        'descripcion',  4.00),
  ('galleta',     'Galleta',        'descripcion',  2.00),
  ('cheesecake',  'Cheesecake',     'descripcion', 12.00),
  ('sin-stock',   'Sin stock',      'descripcion',  3.00);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(!tools)("M2 inventory migration on a disposable local PostgreSQL", () => {
  let db: LocalPostgres;

  let tartaBatch = 0;
  let bizcochoNewer = 0;
  let bizcochoOlder = 0;
  let brownieBatch = 0;
  let galletaBatchOne = 0;
  let cheesecakeBatch = 0;
  let galletaBatchTwo = 0;

  // -q (set in the harness) suppresses the DO/SET command tags, so stdout
  // contains only real query results and assertions can compare it directly.
  const adminSession = (sub: string, sql: string): string =>
    `do $$ begin perform set_config('request.jwt.claim.sub', '${sub}', false); end $$;\n` +
    `set role authenticated;\n${sql}`;

  const asAdmin1 = (sql: string): Promise<PsqlResult> => db.psql(adminSession(ADMIN_1, sql));
  const asAdmin2 = (sql: string): Promise<PsqlResult> => db.psql(adminSession(ADMIN_2, sql));
  const asStranger = (sql: string): Promise<PsqlResult> => db.psql(adminSession(STRANGER, sql));
  const asAnon = (sql: string): Promise<PsqlResult> => db.psql(`set role anon;\n${sql}`);
  const asService = (sql: string): Promise<PsqlResult> => db.psql(`set role service_role;\n${sql}`);

  async function createBatch(slug: string, quantity: number, productionDate: string): Promise<number> {
    const result = await asAdmin1(
      `select public.create_inventory_batch(\n` +
        `  (select id from public.products where slug = '${slug}'),\n` +
        `  ${quantity}, '${productionDate}');`,
    );
    expect(result.code, allText(result)).toBe(0);
    const id = Number(lastLine(result.stdout));
    expect(Number.isInteger(id), `could not parse batch id from: ${result.stdout}`).toBe(true);
    return id;
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
  }, 240_000);

  afterAll(async () => {
    if (db) await db.stop();
  }, 60_000);

  it("creates the initial batch atomically: batch + entry movement + audit record", async () => {
    const result = await asAdmin1(
      `select public.create_inventory_batch(\n` +
        `  (select id from public.products where slug = 'tarta-fresa'),\n` +
        `  20, '2026-11-08');`,
    );
    expect(result.code, allText(result)).toBe(0);
    tartaBatch = Number(lastLine(result.stdout));
    expect(tartaBatch).toBeGreaterThan(0);

    const batch = await db.psql(
      `select initial_quantity, remaining_quantity, production_date, created_by\n` +
        `from public.inventory_batches where id = ${tartaBatch};`,
    );
    expect(batch.stdout.trim()).toBe(`20|20|2026-11-08|${ADMIN_1}`);

    const movements = await db.psql(
      `select type, quantity, reason, admin_id,\n` +
        `       (select sum(quantity) from public.inventory_movements where batch_id = ${tartaBatch})\n` +
        `from public.inventory_movements where batch_id = ${tartaBatch};`,
    );
    expect(movements.stdout.trim()).toBe(`entry|20||${ADMIN_1}|20`);

    const audit = await db.psql(
      `select action, entity_type, entity_id, admin_id from public.audit_log\n` +
        `where action = 'inventory.batch_create' order by id desc limit 1;`,
    );
    expect(audit.stdout.trim()).toBe(
      `inventory.batch_create|inventory_batch|${tartaBatch}|${ADMIN_1}`,
    );
  });

  it("replenishes stock with a second batch and orders batches FIFO by (production_date, id)", async () => {
    // Created in reverse chronological order on purpose: FIFO must follow
    // production_date, not insertion order.
    bizcochoNewer = await createBatch("bizcocho", 15, "2026-11-05");
    bizcochoOlder = await createBatch("bizcocho", 10, "2026-11-01");

    const order = await db.psql(
      `select id from public.inventory_batches\n` +
        `where product_id = (select id from public.products where slug = 'bizcocho')\n` +
        `order by production_date, id;`,
    );
    expect(lines(order.stdout)).toEqual([String(bizcochoOlder), String(bizcochoNewer)]);

    const perBatch = await db.psql(
      `select b.id, b.remaining_quantity,\n` +
        `       (select coalesce(sum(m.quantity), 0) from public.inventory_movements m\n` +
        `        where m.batch_id = b.id)\n` +
        `from public.inventory_batches b\n` +
        `where b.product_id = (select id from public.products where slug = 'bizcocho')\n` +
        `order by b.id;`,
    );
    expect(lines(perBatch.stdout)).toEqual([
      `${bizcochoNewer}|15|15`,
      `${bizcochoOlder}|10|10`,
    ]);

    const entries = await db.psql(
      `select batch_id, type, quantity, admin_id from public.inventory_movements\n` +
        `where batch_id in (${bizcochoNewer}, ${bizcochoOlder}) order by batch_id;`,
    );
    expect(lines(entries.stdout)).toEqual([
      `${bizcochoNewer}|entry|15|${ADMIN_1}`,
      `${bizcochoOlder}|entry|10|${ADMIN_1}`,
    ]);
  });

  it("reduces stock through a signed adjustment with a mandatory reason", async () => {
    brownieBatch = await createBatch("brownie", 30, "2026-11-10");

    const adjust = await asAdmin1(
      `select public.adjust_inventory(${brownieBatch}, -7, 'daños en el transporte');`,
    );
    expect(adjust.code, allText(adjust)).toBe(0);
    expect(lastLine(adjust.stdout)).toBe("23");

    const state = await db.psql(
      `select remaining_quantity from public.inventory_batches where id = ${brownieBatch};`,
    );
    expect(state.stdout.trim()).toBe("23");

    const movements = await db.psql(
      `select type, quantity, reason, admin_id from public.inventory_movements\n` +
        `where batch_id = ${brownieBatch} order by id;`,
    );
    expect(lines(movements.stdout)).toEqual([
      `entry|30||${ADMIN_1}`,
      `adjustment|-7|daños en el transporte|${ADMIN_1}`,
    ]);

    const audit = await db.psql(
      `select action, entity_id, admin_id, data::text from public.audit_log\n` +
        `where action = 'inventory.adjust' order by id desc limit 1;`,
    );
    const [action, entityId, adminId, dataText] = audit.stdout.trim().split("|");
    expect(action).toBe("inventory.adjust");
    expect(entityId).toBe(String(brownieBatch));
    expect(adminId).toBe(ADMIN_1);
    const data = JSON.parse(dataText) as Record<string, unknown>;
    expect(data).toMatchObject({
      quantity: -7,
      reason: "daños en el transporte",
      remaining_before: 30,
      remaining_after: 23,
    });
  });

  it("rejects an adjustment that would oversell, atomically and without trace", async () => {
    galletaBatchOne = await createBatch("galleta", 10, "2026-11-09");

    const ok = await asAdmin1(`select public.adjust_inventory(${galletaBatchOne}, -6, 'merma detectada');`);
    expect(ok.code, allText(ok)).toBe(0);
    expect(lastLine(ok.stdout)).toBe("4");

    const fail = await asAdmin1(`select public.adjust_inventory(${galletaBatchOne}, -9, 'merma adicional');`);
    expect(fail.code, allText(fail)).not.toBe(0);
    expect(allText(fail)).toContain("insufficient stock");

    const remaining = await db.psql(
      `select remaining_quantity from public.inventory_batches where id = ${galletaBatchOne};`,
    );
    expect(remaining.stdout.trim()).toBe("4");

    const movements = await db.psql(
      `select count(*) from public.inventory_movements where batch_id = ${galletaBatchOne};`,
    );
    expect(movements.stdout.trim()).toBe("2"); // entry + the successful adjustment only
  });

  it("prevents negative and over-initial stock at the constraint level", async () => {
    cheesecakeBatch = await createBatch("cheesecake", 5, "2026-11-07");

    const negative = await asAdmin1(
      `update public.inventory_batches set remaining_quantity = -1 where id = ${cheesecakeBatch};`,
    );
    expect(negative.code, allText(negative)).not.toBe(0);
    expect(allText(negative)).toContain("inventory_batches_remaining_quantity_check");

    const overInitial = await asAdmin1(
      `update public.inventory_batches set remaining_quantity = 99 where id = ${cheesecakeBatch};`,
    );
    expect(overInitial.code, allText(overInitial)).not.toBe(0);
    expect(allText(overInitial)).toContain("inventory_batches_remaining_quantity_check");

    const zero = await asAdmin1(
      `update public.inventory_batches set remaining_quantity = 0 where id = ${cheesecakeBatch};`,
    );
    expect(zero.code, allText(zero)).toBe(0);

    const restore = await asAdmin1(
      `update public.inventory_batches set remaining_quantity = 5 where id = ${cheesecakeBatch};`,
    );
    expect(restore.code, allText(restore)).toBe(0);
    const state = await db.psql(
      `select remaining_quantity from public.inventory_batches where id = ${cheesecakeBatch};`,
    );
    expect(state.stdout.trim()).toBe("5");
  });

  it("validates entry input before touching the database", async () => {
    const zero = await asAdmin1(
      `select public.create_inventory_batch((select id from public.products where slug = 'tarta-fresa'), 0, '2026-11-01');`,
    );
    expect(zero.code, allText(zero)).not.toBe(0);
    expect(allText(zero)).toContain("initial_quantity must be greater than zero");

    const negative = await asAdmin1(
      `select public.create_inventory_batch((select id from public.products where slug = 'tarta-fresa'), -5, '2026-11-01');`,
    );
    expect(negative.code, allText(negative)).not.toBe(0);
    expect(allText(negative)).toContain("initial_quantity must be greater than zero");

    const nullDate = await asAdmin1(
      `select public.create_inventory_batch((select id from public.products where slug = 'tarta-fresa'), 5, null);`,
    );
    expect(nullDate.code, allText(nullDate)).not.toBe(0);
    expect(allText(nullDate)).toContain("production_date is required");

    const nullProduct = await asAdmin1(
      `select public.create_inventory_batch(null, 5, '2026-11-01');`,
    );
    expect(nullProduct.code, allText(nullProduct)).not.toBe(0);
    expect(allText(nullProduct)).toContain("product id is required");

    const unknownProduct = await asAdmin1(
      `select public.create_inventory_batch(999999999, 5, '2026-11-01');`,
    );
    expect(unknownProduct.code, allText(unknownProduct)).not.toBe(0);
    expect(allText(unknownProduct)).toContain("inventory_batches_product_id_fkey");
  });

  it("validates adjustment input and leaves the batch untouched on every failure", async () => {
    const zeroQuantity = await asAdmin1(
      `select public.adjust_inventory(${tartaBatch}, 0, 'motivo');`,
    );
    expect(zeroQuantity.code, allText(zeroQuantity)).not.toBe(0);
    expect(allText(zeroQuantity)).toContain("non-zero signed integer");

    const nullQuantity = await asAdmin1(
      `select public.adjust_inventory(${tartaBatch}, null, 'motivo');`,
    );
    expect(nullQuantity.code, allText(nullQuantity)).not.toBe(0);
    expect(allText(nullQuantity)).toContain("non-zero signed integer");

    const nullReason = await asAdmin1(`select public.adjust_inventory(${tartaBatch}, -1, null);`);
    expect(nullReason.code, allText(nullReason)).not.toBe(0);
    expect(allText(nullReason)).toContain("reason is required");

    const blankReason = await asAdmin1(`select public.adjust_inventory(${tartaBatch}, -1, '   ');`);
    expect(blankReason.code, allText(blankReason)).not.toBe(0);
    expect(allText(blankReason)).toContain("reason is required");

    const nullBatch = await asAdmin1(`select public.adjust_inventory(null, -1, 'motivo');`);
    expect(nullBatch.code, allText(nullBatch)).not.toBe(0);
    expect(allText(nullBatch)).toContain("batch id is required");

    const unknownBatch = await asAdmin1(
      `select public.adjust_inventory(999999999, -1, 'motivo');`,
    );
    expect(unknownBatch.code, allText(unknownBatch)).not.toBe(0);
    expect(allText(unknownBatch)).toContain("does not exist");

    const overshoot = await asAdmin1(
      `select public.adjust_inventory(${tartaBatch}, 1, 'corrección');`,
    );
    expect(overshoot.code, allText(overshoot)).not.toBe(0);
    expect(allText(overshoot)).toContain("exceed the initial quantity");

    const state = await db.psql(
      `select remaining_quantity,\n` +
        `       (select count(*) from public.inventory_movements where batch_id = ${tartaBatch})\n` +
        `from public.inventory_batches where id = ${tartaBatch};`,
    );
    expect(state.stdout.trim()).toBe("20|1"); // nothing changed, no stray movements
  });

  it("backstops invalid movements with named CHECK constraints", async () => {
    const entryNegative = await asAdmin1(
      `insert into public.inventory_movements (batch_id, type, quantity, reason, admin_id)\n` +
        `values (${tartaBatch}, 'entry', -1, null, '${ADMIN_1}');`,
    );
    expect(entryNegative.code, allText(entryNegative)).not.toBe(0);
    expect(allText(entryNegative)).toContain("inventory_movements_entry_quantity_check");

    const adjustmentWithoutReason = await asAdmin1(
      `insert into public.inventory_movements (batch_id, type, quantity, reason, admin_id)\n` +
        `values (${tartaBatch}, 'adjustment', -1, null, '${ADMIN_1}');`,
    );
    expect(adjustmentWithoutReason.code, allText(adjustmentWithoutReason)).not.toBe(0);
    expect(allText(adjustmentWithoutReason)).toContain(
      "inventory_movements_adjustment_reason_check",
    );

    const unknownType = await asAdmin1(
      `insert into public.inventory_movements (batch_id, type, quantity, reason, admin_id)\n` +
        `values (${tartaBatch}, 'inventado', -1, 'motivo', '${ADMIN_1}');`,
    );
    expect(unknownType.code, allText(unknownType)).not.toBe(0);
    expect(allText(unknownType)).toContain("inventory_movements_type_check");

    const zeroQuantity = await asAdmin1(
      `insert into public.inventory_movements (batch_id, type, quantity, reason, admin_id)\n` +
        `values (${tartaBatch}, 'adjustment', 0, 'motivo', '${ADMIN_1}');`,
    );
    expect(zeroQuantity.code, allText(zeroQuantity)).not.toBe(0);
    expect(allText(zeroQuantity)).toContain("inventory_movements_quantity_check");
  });

  it("gives anon no inventory access: no rows, no writes, no RPCs", async () => {
    const counts = await asAnon(
      `select count(*) from public.inventory_batches;\nselect count(*) from public.inventory_movements;`,
    );
    expect(counts.code, allText(counts)).toBe(0);
    expect(lines(counts.stdout)).toEqual(["0", "0"]);

    const insertBatch = await asAnon(
      `insert into public.inventory_batches (product_id, initial_quantity, remaining_quantity, production_date, created_by)\n` +
        `values ((select id from public.products where slug = 'tarta-fresa'), 1, 1, '2026-11-01', '${ADMIN_1}');`,
    );
    expect(insertBatch.code, allText(insertBatch)).not.toBe(0);
    expect(allText(insertBatch)).toContain("row-level security policy");

    const insertMovement = await asAnon(
      `insert into public.inventory_movements (batch_id, type, quantity, admin_id)\n` +
        `values (${tartaBatch}, 'entry', 1, '${ADMIN_1}');`,
    );
    expect(insertMovement.code, allText(insertMovement)).not.toBe(0);
    expect(allText(insertMovement)).toContain("row-level security policy");

    const createRpc = await asAnon(
      `select public.create_inventory_batch((select id from public.products where slug = 'tarta-fresa'), 1, '2026-11-01');`,
    );
    expect(createRpc.code, allText(createRpc)).not.toBe(0);
    expect(allText(createRpc)).toContain("permission denied for function create_inventory_batch");

    const adjustRpc = await asAnon(`select public.adjust_inventory(${tartaBatch}, -1, 'motivo');`);
    expect(adjustRpc.code, allText(adjustRpc)).not.toBe(0);
    expect(allText(adjustRpc)).toContain("permission denied for function adjust_inventory");

    const stockRpc = await asAnon(
      `select * from public.get_product_stock((select id from public.products where slug = 'tarta-fresa'));`,
    );
    expect(stockRpc.code, allText(stockRpc)).not.toBe(0);
    expect(allText(stockRpc)).toContain("permission denied for function get_product_stock");
  });

  it("rejects an authenticated non-admin everywhere (RLS + internal admin gate)", async () => {
    const counts = await asStranger(
      `select count(*) from public.inventory_batches;\nselect count(*) from public.inventory_movements;`,
    );
    expect(counts.code, allText(counts)).toBe(0);
    expect(lines(counts.stdout)).toEqual(["0", "0"]);

    const insertMovement = await asStranger(
      `insert into public.inventory_movements (batch_id, type, quantity, admin_id)\n` +
        `values (${tartaBatch}, 'entry', 1, '${STRANGER}');`,
    );
    expect(insertMovement.code, allText(insertMovement)).not.toBe(0);
    expect(allText(insertMovement)).toContain("row-level security policy");

    const createRpc = await asStranger(
      `select public.create_inventory_batch((select id from public.products where slug = 'tarta-fresa'), 5, '2026-11-01');`,
    );
    expect(createRpc.code, allText(createRpc)).not.toBe(0);
    expect(allText(createRpc)).toContain("administrator required");

    const adjustRpc = await asStranger(
      `select public.adjust_inventory(${tartaBatch}, -1, 'motivo');`,
    );
    expect(adjustRpc.code, allText(adjustRpc)).not.toBe(0);
    expect(allText(adjustRpc)).toContain("administrator required");
  });

  it("lets any administrator read everything, but never rewrite history", async () => {
    const visible = await asAdmin2(`select count(*) from public.inventory_batches;`);
    expect(visible.code, allText(visible)).toBe(0);
    expect(Number(visible.stdout.trim())).toBeGreaterThan(0);

    // inventory_movements: append-only (DECISIONS #21) — UPDATE/DELETE hit 0 rows.
    const update = await asAdmin1(
      `update public.inventory_movements set reason = 'reescribir';\n` +
        `select coalesce(reason, '<null>') from public.inventory_movements\n` +
        `where type = 'adjustment' order by id limit 1;`,
    );
    expect(update.code, allText(update)).toBe(0);
    expect(lastLine(update.stdout)).toBe("daños en el transporte");

    const before = await db.psql(`select count(*) from public.inventory_movements;`);
    const remove = await asAdmin1(
      `delete from public.inventory_movements;\nselect count(*) from public.inventory_movements;`,
    );
    expect(remove.code, allText(remove)).toBe(0);
    expect(lastLine(remove.stdout)).toBe(before.stdout.trim());

    // Traceability: a batch cannot be deleted while its movement history exists.
    const deleteBatch = await asAdmin1(
      `delete from public.inventory_batches where id = ${tartaBatch};`,
    );
    expect(deleteBatch.code, allText(deleteBatch)).not.toBe(0);
    expect(allText(deleteBatch)).toContain("inventory_movements_batch_id_fkey");

    // A product with batches cannot be deleted (products FK is restrict).
    const deleteProduct = await asAdmin1(
      `delete from public.products where slug = 'tarta-fresa';`,
    );
    expect(deleteProduct.code, allText(deleteProduct)).not.toBe(0);
    expect(allText(deleteProduct)).toContain("inventory_batches_product_id_fkey");

    // A second administrator can adjust stock; attribution records the actor.
    const adjust = await asAdmin2(
      `select public.adjust_inventory(\n` +
        `  (select id from public.inventory_batches\n` +
        `   where product_id = (select id from public.products where slug = 'brownie')),\n` +
        `  -3, 'reconteo inicial');`,
    );
    expect(adjust.code, allText(adjust)).toBe(0);
    expect(lastLine(adjust.stdout)).toBe("20");

    const attribution = await asAdmin1(
      `select admin_id from public.inventory_movements\n` +
        `where batch_id = ${brownieBatch} order by id desc limit 1;`,
    );
    expect(attribution.stdout.trim()).toBe(ADMIN_2);

    // get_product_stock is service-role only: an admin session cannot call it.
    const stock = await asAdmin1(
      `select * from public.get_product_stock((select id from public.products where slug = 'tarta-fresa'));`,
    );
    expect(stock.code, allText(stock)).not.toBe(0);
    expect(allText(stock)).toContain("permission denied for function get_product_stock");
  });

  it("restricts the service role to its documented surface", async () => {
    const bypass = await asService(`select count(*) from public.inventory_batches;`);
    const asSuper = await db.psql(`select count(*) from public.inventory_batches;`);
    expect(bypass.code, allText(bypass)).toBe(0);
    expect(bypass.stdout.trim()).toBe(asSuper.stdout.trim());

    const adjustRpc = await asService(
      `select public.adjust_inventory(${tartaBatch}, -1, 'motivo');`,
    );
    expect(adjustRpc.code, allText(adjustRpc)).not.toBe(0);
    expect(allText(adjustRpc)).toContain("permission denied for function adjust_inventory");

    const createRpc = await asService(
      `select public.create_inventory_batch((select id from public.products where slug = 'tarta-fresa'), 5, '2026-11-01');`,
    );
    expect(createRpc.code, allText(createRpc)).not.toBe(0);
    expect(allText(createRpc)).toContain(
      "permission denied for function create_inventory_batch",
    );

    // The responsible admin of a batch cannot be deleted (created_by restrict).
    const deleteAdmin = await asService(
      `delete from public.administrators where id = '${ADMIN_1}';`,
    );
    expect(deleteAdmin.code, allText(deleteAdmin)).not.toBe(0);
    expect(allText(deleteAdmin)).toContain("inventory_batches_created_by_fkey");
  });

  it("grants EXECUTE exactly as SECURITY_DESIGN §5 requires", async () => {
    const grants = await db.psql(
      `select\n` +
        `  has_function_privilege('anon', 'public.create_inventory_batch(bigint, integer, date)', 'execute'),\n` +
        `  has_function_privilege('authenticated', 'public.create_inventory_batch(bigint, integer, date)', 'execute'),\n` +
        `  has_function_privilege('service_role', 'public.create_inventory_batch(bigint, integer, date)', 'execute'),\n` +
        `  has_function_privilege('anon', 'public.adjust_inventory(bigint, integer, text)', 'execute'),\n` +
        `  has_function_privilege('authenticated', 'public.adjust_inventory(bigint, integer, text)', 'execute'),\n` +
        `  has_function_privilege('service_role', 'public.adjust_inventory(bigint, integer, text)', 'execute'),\n` +
        `  has_function_privilege('anon', 'public.get_product_stock(bigint)', 'execute'),\n` +
        `  has_function_privilege('authenticated', 'public.get_product_stock(bigint)', 'execute'),\n` +
        `  has_function_privilege('service_role', 'public.get_product_stock(bigint)', 'execute');`,
    );
    expect(grants.code, allText(grants)).toBe(0);
    expect(grants.stdout.trim()).toBe("f|t|f|f|t|f|f|f|t");
  });

  it("exposes invoker-based functions with a pinned search_path", async () => {
    const attributes = await db.psql(
      `select p.proname, p.prosecdef, p.provolatile,\n` +
        `       coalesce(p.proconfig @> array['search_path=""'], false)\n` +
        `from pg_proc p\n` +
        `join pg_namespace n on n.oid = p.pronamespace\n` +
        `where n.nspname = 'public'\n` +
        `  and p.proname in ('create_inventory_batch', 'adjust_inventory', 'get_product_stock')\n` +
        `order by p.proname;`,
    );
    expect(lines(attributes.stdout)).toEqual([
      "adjust_inventory|f|v|t",
      "create_inventory_batch|f|v|t",
      "get_product_stock|f|s|t",
    ]);
  });

  it("creates exactly the designed schema objects (columns, RLS, policies, indexes)", async () => {
    const batchColumns = await db.psql(
      `select column_name, is_nullable, data_type from information_schema.columns\n` +
        `where table_schema = 'public' and table_name = 'inventory_batches'\n` +
        `order by ordinal_position;`,
    );
    expect(lines(batchColumns.stdout)).toEqual([
      "id|NO|bigint",
      "product_id|NO|bigint",
      "initial_quantity|NO|integer",
      "remaining_quantity|NO|integer",
      "production_date|NO|date",
      "created_by|NO|uuid",
      "created_at|NO|timestamp with time zone",
    ]);

    const movementColumns = await db.psql(
      `select column_name, is_nullable, data_type from information_schema.columns\n` +
        `where table_schema = 'public' and table_name = 'inventory_movements'\n` +
        `order by ordinal_position;`,
    );
    expect(lines(movementColumns.stdout)).toEqual([
      "id|NO|bigint",
      "batch_id|NO|bigint",
      "type|NO|text",
      "quantity|NO|integer",
      "reason|YES|text",
      "admin_id|YES|uuid",
      "created_at|NO|timestamp with time zone",
    ]);

    const rls = await db.psql(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity\n` +
        `from pg_class c\n` +
        `join pg_namespace n on n.oid = c.relnamespace\n` +
        `where n.nspname = 'public'\n` +
        `  and c.relname in ('inventory_batches', 'inventory_movements')\n` +
        `order by c.relname;`,
    );
    expect(lines(rls.stdout)).toEqual([
      "inventory_batches|t|t",
      "inventory_movements|t|t",
    ]);

    const policies = await db.psql(
      `select tablename, policyname, roles::text[], cmd from pg_policies\n` +
        `where schemaname = 'public'\n` +
        `  and tablename in ('inventory_batches', 'inventory_movements')\n` +
        `order by tablename, policyname;`,
    );
    expect(lines(policies.stdout)).toEqual([
      "inventory_batches|inventory_batches_admin_all|{authenticated}|ALL",
      "inventory_movements|inventory_movements_insert|{authenticated}|INSERT",
      "inventory_movements|inventory_movements_select|{authenticated}|SELECT",
    ]);

    const indexes = await db.psql(
      `select indexname from pg_indexes\n` +
        `where schemaname = 'public'\n` +
        `  and tablename in ('inventory_batches', 'inventory_movements')\n` +
        `order by tablename, indexname;`,
    );
    expect(lines(indexes.stdout)).toEqual(
      expect.arrayContaining([
        "inventory_batches_available_idx",
        "inventory_batches_pkey",
        "inventory_batches_product_fifo_idx",
        "inventory_movements_batch_id_idx",
        "inventory_movements_created_at_idx",
        "inventory_movements_pkey",
      ]),
    );

    const availableIndex = await db.psql(
      `select indexdef from pg_indexes where indexname = 'inventory_batches_available_idx';`,
    );
    expect(availableIndex.stdout).toContain("remaining_quantity > 0");

    const fifoIndex = await db.psql(
      `select indexdef from pg_indexes where indexname = 'inventory_batches_product_fifo_idx';`,
    );
    expect(fifoIndex.stdout).toContain("(product_id, production_date, id)");

    const constraints = await db.psql(
      `select conrelid::regclass::text, conname from pg_constraint\n` +
        `where conrelid::regclass::text in ('inventory_batches', 'inventory_movements')\n` +
        `order by conname;`,
    );
    expect(lines(constraints.stdout)).toEqual(
      expect.arrayContaining([
        "inventory_batches|inventory_batches_created_by_fkey",
        "inventory_batches|inventory_batches_initial_quantity_check",
        "inventory_batches|inventory_batches_product_id_fkey",
        "inventory_batches|inventory_batches_remaining_quantity_check",
        "inventory_movements|inventory_movements_adjustment_reason_check",
        "inventory_movements|inventory_movements_batch_id_fkey",
        "inventory_movements|inventory_movements_entry_quantity_check",
        "inventory_movements|inventory_movements_quantity_check",
        "inventory_movements|inventory_movements_type_check",
      ]),
    );
  });

  it("keeps M3 objects out of the M2 schema", async () => {
    const orderIdColumn = await db.psql(
      `select count(*) from information_schema.columns\n` +
        `where table_schema = 'public' and table_name = 'inventory_movements'\n` +
        `  and column_name = 'order_id';`,
    );
    expect(orderIdColumn.stdout.trim()).toBe("0");

    const reservations = await db.psql(
      `select to_regclass('public.inventory_reservations') is null;`,
    );
    expect(reservations.stdout.trim()).toBe("t");

    const orders = await db.psql(`select to_regclass('public.orders') is null;`);
    expect(orders.stdout.trim()).toBe("t");
  });

  it("serves stock only through get_product_stock (service role), with reserved = 0 until M3", async () => {
    const tarta = await asService(
      `select remaining_quantity, available_quantity, reserved_quantity\n` +
        `from public.get_product_stock((select id from public.products where slug = 'tarta-fresa'));`,
    );
    expect(tarta.code, allText(tarta)).toBe(0);
    expect(tarta.stdout.trim()).toBe("20|20|0");

    const empty = await asService(
      `select p.id, s.remaining_quantity, s.available_quantity, s.reserved_quantity\n` +
        `from public.products p,\n` +
        `     lateral public.get_product_stock(p.id) s\n` +
        `where p.slug = 'sin-stock';`,
    );
    expect(empty.code, allText(empty)).toBe(0);
    const [productId, ...aggregates] = empty.stdout.trim().split("|");
    const expectedId = await db.psql(
      `select id from public.products where slug = 'sin-stock';`,
    );
    expect(productId).toBe(expectedId.stdout.trim());
    expect(aggregates).toEqual(["0", "0", "0"]);
  });

  it(
    "serialises concurrent reductions on the same batch (no double-spend)",
    { timeout: 30_000 },
    async () => {
    galletaBatchTwo = await createBatch("galleta", 10, "2026-11-11");

    const lockedAdjustment = (quantity: number, tag: string): string =>
      `do $$ begin perform set_config('request.jwt.claim.sub', '${ADMIN_1}', false); end $$;\n` +
      `set role authenticated;\n` +
      `begin;\n` +
      `select public.adjust_inventory(${galletaBatchTwo}, ${quantity}, 'reducción concurrente ${tag}');\n` +
      `select pg_sleep(2);\n` +
      `commit;`;

    // Session A locks the batch row, applies its reduction and holds the
    // transaction open for 2 s; session B starts while A holds the lock.
    const sessionA = db.psql(lockedAdjustment(-6, "A"));
    await sleep(700);
    const startedB = Date.now();
    const sessionB = db.psql(
      `do $$ begin perform set_config('request.jwt.claim.sub', '${ADMIN_1}', false); end $$;\n` +
        `set role authenticated;\n` +
        `select public.adjust_inventory(${galletaBatchTwo}, -6, 'reducción concurrente B');`,
    );

    const [resultA, resultB] = await Promise.all([sessionA, sessionB]);
    const durationB = Date.now() - startedB;

    expect(resultA.code, allText(resultA)).toBe(0);
    expect(resultB.code, allText(resultB)).not.toBe(0);
    expect(allText(resultB)).toContain("insufficient stock");
    // B could only fail *after* waiting for A's row lock (4 remaining < 6 wanted).
    expect(durationB).toBeGreaterThan(500);

    const state = await db.psql(
      `select remaining_quantity,\n` +
        `       (select count(*) from public.inventory_movements where batch_id = ${galletaBatchTwo})\n` +
        `from public.inventory_batches where id = ${galletaBatchTwo};`,
    );
    expect(state.stdout.trim()).toBe("4|2"); // A applied once, B applied never

    const audit = await db.psql(
      `select count(*) from public.audit_log\n` +
        `where action = 'inventory.adjust' and entity_id = '${galletaBatchTwo}';`,
    );
    expect(audit.stdout.trim()).toBe("1");
  });

  it("defaults production_date to today when the administrator omits it", async () => {
    const create = await asAdmin1(
      `select public.create_inventory_batch(\n` +
        `  (select id from public.products where slug = 'tarta-fresa'), 5);`,
    );
    expect(create.code, allText(create)).toBe(0);
    const batchId = Number(lastLine(create.stdout));
    expect(batchId).toBeGreaterThan(0);

    const isToday = await db.psql(
      `select production_date = current_date from public.inventory_batches where id = ${batchId};`,
    );
    expect(isToday.stdout.trim()).toBe("t");
  });

  it("keeps the cross-table invariant for every batch", async () => {
    const violations = await db.psql(
      `select count(*) from public.inventory_batches b\n` +
        `where b.remaining_quantity <>\n` +
        `  (select coalesce(sum(m.quantity), 0) from public.inventory_movements m\n` +
        `   where m.batch_id = b.id);`,
    );
    expect(violations.stdout.trim()).toBe("0");

    const invariant = await db.psql(
      `select (select count(*) from public.inventory_batches),\n` +
        `       (select count(*) from public.inventory_batches b\n` +
        `        where (select count(*) from public.inventory_movements m\n` +
        `               where m.batch_id = b.id and m.type = 'entry') = 1);`,
    );
    expect(invariant.code, allText(invariant)).toBe(0);
    const [total, withOneEntry] = lines(invariant.stdout)[0].split("|");
    expect(Number(total)).toBeGreaterThan(0);
    expect(withOneEntry).toBe(total);

    const unattributed = await db.psql(
      `select count(*) from public.inventory_movements where admin_id is null;`,
    );
    expect(unattributed.stdout.trim()).toBe("0"); // OQ-9 is not relied upon in M2

    const reasonless = await db.psql(
      `select count(*) from public.inventory_movements\n` +
        `where type = 'adjustment' and reason is null;`,
    );
    expect(reasonless.stdout.trim()).toBe("0");

    const sales = await db.psql(
      `select count(*) from public.inventory_movements where type = 'sale';`,
    );
    expect(sales.stdout.trim()).toBe("0"); // no M3 sale movements in M2

    const stock = await asService(
      `select s.remaining_quantity, s.available_quantity, s.reserved_quantity\n` +
        `from public.products p, lateral public.get_product_stock(p.id) s\n` +
        `where p.slug = 'tarta-fresa';`,
    );
    expect(stock.stdout.trim()).toBe("25|25|0"); // 20 + the default-dated batch
  });
});
