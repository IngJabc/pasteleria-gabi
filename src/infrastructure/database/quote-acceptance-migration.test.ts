/**
 * OQ-17 — behavioral validation of `supabase/migrations/004_quote_acceptance.sql`.
 *
 * Applies 001 + 002 + 003 + 004 to a throwaway local PostgreSQL cluster and
 * exercises every confirmed rule: quote availability and state validation,
 * the immutable initial deadline, one fixed 20-minute acceptance window,
 * idempotency, audit in the same transaction, token-only authorization,
 * concurrency with receipt submission, correction-window precedence, lazy
 * expiry and no revival of closed reservations.
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
  path.join(repoRoot, "supabase", "migrations", "001_catalog_and_admin_foundation.sql"),
  path.join(repoRoot, "supabase", "migrations", "002_inventory_foundation.sql"),
  path.join(repoRoot, "supabase", "migrations", "003_orders_and_reservations.sql"),
  path.join(repoRoot, "supabase", "migrations", "004_quote_acceptance.sql"),
  path.join(repoRoot, "supabase", "migrations", "005_receipt_sla_notifications.sql"),
];

const ADMIN = "11111111-1111-4111-8111-111111111111";

const FIXTURES = `
insert into auth.users (id, email) values
  ('${ADMIN}', 'admin@example.test');

insert into public.administrators (id, display_name) values
  ('${ADMIN}', 'Admin Quote');

insert into public.products (slug, name, description, price_usd) values
  ('quote-cake', 'Tarta cotizada', 'producto de prueba', 10.00),
  ('fixed-cake', 'Tarta con tarifa fija', 'producto de prueba', 8.00);
`;

interface QuoteResult {
  order_id: number;
  quote_accepted_at: string;
  quote_acceptance_expires_at: string;
  reservations_updated: number;
  idempotent: boolean;
}

describe.skipIf(!tools)("OQ-17 quote acceptance migration on a disposable local PostgreSQL", () => {
  let db: LocalPostgres;
  let quoteProduct = 0;
  let fixedProduct = 0;
  let quoteZone = 0;
  let fixedZone = 0;

  const asService = (sql: string): Promise<PsqlResult> =>
    db.psql(`set role service_role;\n${sql}`);
  const asAnon = (sql: string): Promise<PsqlResult> => db.psql(`set role anon;\n${sql}`);
  const asAdmin = (sql: string): Promise<PsqlResult> =>
    db.psql(
      `do $$ begin perform set_config('request.jwt.claim.sub', ` +
        `'${ADMIN}', false); end $$;\n` +
        `set role authenticated;\n${sql}`,
    );

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

  function parsed(result: PsqlResult): QuoteResult {
    expect(result.code, allText(result)).toBe(0);
    return JSON.parse(lastLine(result.stdout)) as QuoteResult;
  }

  async function scalar(sql: string): Promise<string> {
    const result = await asService(sql);
    expect(result.code, allText(result)).toBe(0);
    return lastLine(result.stdout);
  }

  async function expectSqlState(expr: string, expected: string): Promise<void> {
    const result = await asService(
      `do $$ begin\n` +
        `  perform ${expr};\n` +
        `  raise notice 'SQLSTATE=OK';\n` +
        `exception when others then\n` +
        `  raise notice 'SQLSTATE=%', sqlstate;\n` +
        `end $$;`,
    );
    expect(result.code, allText(result)).toBe(0);
    expect(allText(result)).toContain(`SQLSTATE=${expected}`);
  }

  async function createOrder(args: string): Promise<{ id: number; token: string }> {
    const result = await asService(`select public.create_online_order(${args});`);
    expect(result.code, allText(result)).toBe(0);
    const row = JSON.parse(lastLine(result.stdout)) as {
      order_id: number;
      tracking_token: string;
    };
    return { id: row.order_id, token: row.tracking_token };
  }

  /** Manual-quote delivery with the quoted fee already snapshotted by the server. */
  async function quotedOrder(quantity = 1, fee = "7.50"): Promise<{ id: number; token: string }> {
    const created = await createOrder(
      `'Ana Diaz', '04120001122', 'delivery', ${quoteZone}, 'Sector norte', null, null, ` +
        `'[{"product_id": ${quoteProduct}, "quantity": ${quantity}}]'`,
    );
    const updated = await asService(
      `update public.orders\n` +
        `set delivery_fee_usd = ${fee}, total_usd = subtotal_usd + ${fee}\n` +
        `where id = ${created.id};`,
    );
    expect(updated.code, allText(updated)).toBe(0);
    return created;
  }

  /** Manual-quote delivery still waiting for the administrator's quote. */
  async function unquotedOrder(): Promise<{ id: number; token: string }> {
    return createOrder(
      `'Luisa Mara', '04129998877', 'delivery', ${quoteZone}, 'Sector sur', null, null, ` +
        `'[{"product_id": ${quoteProduct}, "quantity": 1}]'`,
    );
  }

  const acceptByToken = (token: string): Promise<PsqlResult> =>
    asService(`select public.accept_quote_fee_for_tracking('${token}');`);
  const acceptById = (id: number): Promise<PsqlResult> =>
    asService(`select public.accept_quote_fee(${id});`);

  async function auditCount(id: number): Promise<number> {
    return Number(
      await scalar(
        `select count(*) from public.audit_log\n` +
          `where action = 'order.quote_accept' and entity_type = 'order' and entity_id = '${id}';`,
      ),
    );
  }

  async function reservationState(id: number): Promise<string[]> {
    const result = await asService(
      `select status,\n` +
        `       expires_at = quote_acceptance_expires_at,\n` +
        `       quote_acceptance_expires_at = (select quote_accepted_at + interval '20 minutes'\n` +
        `                                       from public.orders where id = ${id}),\n` +
        `       initial_expires_at = created_at + interval '20 minutes',\n` +
        `       correction_window_ends_at is null\n` +
        `from public.inventory_reservations where order_id = ${id} order by id;`,
    );
    expect(result.code, allText(result)).toBe(0);
    return lines(result.stdout);
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

    quoteProduct = Number(
      await scalar(`select id from public.products where slug = 'quote-cake';`),
    );
    fixedProduct = Number(
      await scalar(`select id from public.products where slug = 'fixed-cake';`),
    );
    quoteZone = Number(
      await scalar(`select id from public.delivery_zones where name = 'Fuera de Barquisimeto';`),
    );
    fixedZone = Number(
      await scalar(`select id from public.delivery_zones where name = 'Resto de Barquisimeto';`),
    );
    expect(quoteProduct).toBeGreaterThan(0);
    expect(fixedProduct).toBeGreaterThan(0);
    expect(quoteZone).toBeGreaterThan(0);
    expect(fixedZone).toBeGreaterThan(0);

    const quoteBatch = await asAdmin(
      `select public.create_inventory_batch(${quoteProduct}, 40, '2026-11-01');`,
    );
    expect(quoteBatch.code, allText(quoteBatch)).toBe(0);
    const fixedBatch = await asAdmin(
      `select public.create_inventory_batch(${fixedProduct}, 10, '2026-11-01');`,
    );
    expect(fixedBatch.code, allText(fixedBatch)).toBe(0);
  }, 240_000);

  afterAll(async () => {
    if (db) await db.stop();
  }, 60_000);

  // --- A. Contract shape ------------------------------------------------------

  it("keeps the historical initial deadline and adds the two nullable columns", async () => {
    const columns = await db.psql(
      `select table_name || '.' || column_name || '|' || is_nullable\n` +
        `from information_schema.columns\n` +
        `where table_schema = 'public'\n` +
        `  and ((table_name = 'orders' and column_name = 'quote_accepted_at')\n` +
        `    or (table_name = 'inventory_reservations' and column_name = 'quote_acceptance_expires_at'))\n` +
        `order by table_name;`,
    );
    expect(columns.code, allText(columns)).toBe(0);
    expect(lines(columns.stdout)).toEqual([
      "inventory_reservations.quote_acceptance_expires_at|YES",
      "orders.quote_accepted_at|YES",
    ]);

    const initialCheck = await scalar(
      `select pg_get_constraintdef(oid) from pg_constraint\n` +
        `where conname = 'inventory_reservations_initial_expires_at_check';`,
    );
    expect(initialCheck).toContain("00:20:00");
    expect(initialCheck).not.toContain("quote");

    const expiresCheckResult = await asService(
      `select pg_get_constraintdef(oid) from pg_constraint\n` +
        `where conname = 'inventory_reservations_expires_at_check';`,
    );
    expect(expiresCheckResult.code, allText(expiresCheckResult)).toBe(0);
    const expiresCheck = expiresCheckResult.stdout;
    for (const part of [
      "expires_at IS NULL",
      "correction_window_ends_at",
      "quote_acceptance_expires_at",
      "initial_expires_at",
    ]) {
      expect(expiresCheck).toContain(part);
    }
  });

  // --- B. Validation ----------------------------------------------------------

  it("rejects orders that are not manual-quote deliveries", async () => {
    const pickup = await createOrder(
      `'Pickup User', '04121111111', 'pickup', null, null, null, null, ` +
        `'[{"product_id": ${quoteProduct}, "quantity": 1}]'`,
    );
    const pickupResult = await acceptById(pickup.id);
    expect(pickupResult.code).not.toBe(0);
    expect(allText(pickupResult)).toContain("is not a delivery quote order");

    const fixed = await createOrder(
      `'Fixed User', '04122222222', 'delivery', ${fixedZone}, 'Calle 1', null, null, ` +
        `'[{"product_id": ${fixedProduct}, "quantity": 1}]'`,
    );
    const fixedResult = await acceptById(fixed.id);
    expect(fixedResult.code).not.toBe(0);
    expect(allText(fixedResult)).toContain("does not require a quote");

    expect(await scalar(`select quote_accepted_at is null from public.orders where id = ${pickup.id};`)).toBe("t");
    expect(await scalar(`select quote_accepted_at is null from public.orders where id = ${fixed.id};`)).toBe("t");
    expect(await auditCount(pickup.id)).toBe(0);
    expect(await auditCount(fixed.id)).toBe(0);
  });

  it("rejects a quote order before a confirmed fee is available", async () => {
    const order = await unquotedOrder();
    const result = await acceptByToken(order.token);
    expect(result.code).not.toBe(0);
    expect(allText(result)).toContain("no confirmed delivery quote is available");
    expect(await scalar(`select quote_accepted_at is null from public.orders where id = ${order.id};`)).toBe("t");
    expect(await auditCount(order.id)).toBe(0);
  });

  it("rejects terminal order states", async () => {
    for (const status of ["canceled", "expired", "confirmed"]) {
      const order = await quotedOrder();
      const updated = await asService(
        `update public.orders set status = '${status}' where id = ${order.id};`,
      );
      expect(updated.code, allText(updated)).toBe(0);

      const result = await acceptByToken(order.token);
      expect(result.code, `${status}\n${allText(result)}`).not.toBe(0);
      expect(allText(result)).toContain("is not pending");
      expect(await scalar(`select quote_accepted_at is null from public.orders where id = ${order.id};`)).toBe("t");
    }
  });

  it("rejects acceptance after a receipt has been submitted", async () => {
    const order = await quotedOrder();
    const held = await asService(`select public.hold_order_reservations(${order.id});`);
    expect(held.stdout.trim()).toBe("1");

    const result = await acceptByToken(order.token);
    expect(result.code).not.toBe(0);
    expect(allText(result)).toContain("already has a submitted receipt");
    expect(await scalar(`select quote_accepted_at is null from public.orders where id = ${order.id};`)).toBe("t");
    expect(await auditCount(order.id)).toBe(0);
  });

  it("rejects active reservations whose deadline is already running", async () => {
    const order = await quotedOrder();
    const unheld = await asService(
      `update public.inventory_reservations\n` +
        `set expires_at = initial_expires_at\n` +
        `where order_id = ${order.id};`,
    );
    expect(unheld.code, allText(unheld)).toBe(0);

    const result = await acceptByToken(order.token);
    expect(result.code).not.toBe(0);
    expect(allText(result)).toContain("running deadline");
    expect(await scalar(`select quote_accepted_at is null from public.orders where id = ${order.id};`)).toBe("t");
    expect(await auditCount(order.id)).toBe(0);
  });

  it("never revives released or expired reservations", async () => {
    const released = await quotedOrder();
    expect((await asService(`select public.release_order_reservations(${released.id});`)).stdout.trim()).toBe("1");
    const releasedResult = await acceptByToken(released.token);
    expect(releasedResult.code).not.toBe(0);
    expect(allText(releasedResult)).toContain("no active reservations");
    expect((await reservationState(released.id)).join("\n")).not.toContain(",t,t");

    const expired = await quotedOrder();
    const expiredUpdate = await asService(
      `update public.inventory_reservations\n` +
        `set status = 'expired', closed_at = now()\n` +
        `where order_id = ${expired.id};`,
    );
    expect(expiredUpdate.code, allText(expiredUpdate)).toBe(0);
    const expiredResult = await acceptByToken(expired.token);
    expect(expiredResult.code).not.toBe(0);
    expect(allText(expiredResult)).toContain("no active reservations");
    expect(await scalar(
      `select status from public.inventory_reservations where order_id = ${expired.id};`,
    )).toBe("expired");
    expect(await auditCount(expired.id)).toBe(0);
  });

  // --- C. Successful transition ------------------------------------------------

  it("accepts a valid quote once: fixed deadline, immutable history, one audit row", async () => {
    const order = await quotedOrder();
    const originalInitial = await scalar(
      `select initial_expires_at from public.inventory_reservations where order_id = ${order.id};`,
    );

    const first = parsed(await acceptByToken(order.token));
    expect(first.order_id).toBe(order.id);
    expect(first.idempotent).toBe(false);
    expect(first.reservations_updated).toBe(1);
    expect(first.quote_accepted_at).toBeTruthy();
    expect(first.quote_acceptance_expires_at).toBeTruthy();

    const marker = await scalar(
      `select quote_accepted_at is not null from public.orders where id = ${order.id};`,
    );
    expect(marker).toBe("t");
    expect(await reservationState(order.id)).toEqual([
      `active|t|t|t|t`,
    ]);
    expect(await scalar(
      `select initial_expires_at from public.inventory_reservations where order_id = ${order.id};`,
    )).toBe(originalInitial);

    const audit = await db.psql(
      `select action || '|' || entity_type || '|' || entity_id || '|' ||\n` +
        `       (admin_id is null) || '|' || (data ->> 'source')\n` +
        `from public.audit_log where entity_id = '${order.id}';`,
    );
    expect(audit.code, allText(audit)).toBe(0);
    expect(lastLine(audit.stdout)).toBe(`order.quote_accept|order|${order.id}|true|tracking`);
    expect(await auditCount(order.id)).toBe(1);

    // Still reserved: acceptance starts a clock, it does not consume/release.
    expect(await scalar(
      `select status from public.inventory_reservations where order_id = ${order.id};`,
    )).toBe("active");
  });

  it("cannot rewrite the historical initial deadline after acceptance", async () => {
    const order = await quotedOrder();
    parsed(await acceptByToken(order.token));
    const before = await scalar(
      `select initial_expires_at from public.inventory_reservations where order_id = ${order.id};`,
    );

    const attempt = await asService(
      `update public.inventory_reservations\n` +
        `set initial_expires_at = now() + interval '20 minutes'\n` +
        `where order_id = ${order.id};`,
    );
    expect(attempt.code).not.toBe(0);
    expect(allText(attempt)).toContain("inventory_reservations_initial_expires_at_check");
    expect(await scalar(
      `select initial_expires_at from public.inventory_reservations where order_id = ${order.id};`,
    )).toBe(before);
  });

  it("returns the original acceptance and deadline on every replay, without extending them", async () => {
    const order = await quotedOrder();
    const first = parsed(await acceptByToken(order.token));
    await asService(`select pg_sleep(0.05);`);

    const second = parsed(await acceptByToken(order.token));
    const third = parsed(await acceptById(order.id));

    for (const replay of [second, third]) {
      expect(replay.idempotent).toBe(true);
      expect(replay.reservations_updated).toBe(0);
      expect(replay.quote_accepted_at).toBe(first.quote_accepted_at);
      expect(replay.quote_acceptance_expires_at).toBe(first.quote_acceptance_expires_at);
    }
    expect(await auditCount(order.id)).toBe(1);
    expect(await scalar(`select receipt_attempts from public.orders where id = ${order.id};`)).toBe("0");
  });

  // --- D. Concurrency ---------------------------------------------------------

  it("serialises parallel acceptance: one deadline and one audit row", async () => {
    const order = await quotedOrder();
    const [first, second] = await Promise.all([
      acceptByToken(order.token),
      acceptByToken(order.token),
    ]);
    expect(first.code, allText(first)).toBe(0);
    expect(second.code, allText(second)).toBe(0);

    const results = [parsed(first), parsed(second)];
    expect(results.filter((r) => !r.idempotent)).toHaveLength(1);
    expect(results.filter((r) => r.idempotent)).toHaveLength(1);
    expect(results[0].quote_accepted_at).toBe(results[1].quote_accepted_at);
    expect(results[0].quote_acceptance_expires_at).toBe(results[1].quote_acceptance_expires_at);
    expect(await auditCount(order.id)).toBe(1);
    expect(await reservationState(order.id)).toEqual([`active|t|t|t|t`]);
  });

  it("serialises acceptance against receipt submission", async () => {
    // Receipt first: acceptance must refuse an order already under review.
    const receiptFirst = await quotedOrder();
    expect((await asService(`select public.hold_order_reservations(${receiptFirst.id});`)).stdout.trim()).toBe("1");
    const refused = await acceptByToken(receiptFirst.token);
    expect(refused.code).not.toBe(0);
    expect(allText(refused)).toContain("already has a submitted receipt");

    // Acceptance first: the later receipt still counts and holds the new clock.
    const acceptanceFirst = await quotedOrder();
    const accepted = parsed(await acceptByToken(acceptanceFirst.token));
    const held = await asService(`select public.hold_order_reservations(${acceptanceFirst.id});`);
    expect(held.stdout.trim()).toBe("1");
    expect(await scalar(`select receipt_attempts from public.orders where id = ${acceptanceFirst.id};`)).toBe("1");
    expect(await scalar(
      `select expires_at is null from public.inventory_reservations where order_id = ${acceptanceFirst.id};`,
    )).toBe("t");
    expect(await scalar(
      `select quote_acceptance_expires_at is not null\n` +
        `from public.inventory_reservations where order_id = ${acceptanceFirst.id};`,
    )).toBe("t");

    // True race: either ordering is safe, but no invalid mixed state exists.
    const raced = await quotedOrder();
    const [acceptResult, holdResult] = await Promise.all([
      acceptByToken(raced.token),
      asService(`select public.hold_order_reservations(${raced.id});`),
    ]);
    expect(holdResult.code, allText(holdResult)).toBe(0);
    const acceptedNow = await scalar(
      `select quote_accepted_at is not null from public.orders where id = ${raced.id};`,
    );
    const attempts = await scalar(`select receipt_attempts from public.orders where id = ${raced.id};`);
    expect(attempts).toBe("1");
    if (acceptedNow === "t") {
      expect(acceptResult.code, allText(acceptResult)).toBe(0);
      expect(await auditCount(raced.id)).toBe(1);
    } else {
      expect(acceptResult.code).not.toBe(0);
      expect(await auditCount(raced.id)).toBe(0);
    }
    expect(await scalar(
      `select expires_at is null from public.inventory_reservations where order_id = ${raced.id};`,
    )).toBe("t");
  });

  // --- E. Interaction with the other clocks -----------------------------------

  it("lets a later receipt correction take precedence without extending the acceptance deadline", async () => {
    const order = await quotedOrder();
    const accepted = parsed(await acceptByToken(order.token));
    expect((await asService(`select public.hold_order_reservations(${order.id});`)).stdout.trim()).toBe("1");
    expect((await asService(`select public.open_order_correction_window(${order.id});`)).stdout.trim()).toBe("1");

    const state = await db.psql(
      `select expires_at = correction_window_ends_at,\n` +
        `       quote_acceptance_expires_at = '${accepted.quote_acceptance_expires_at}',\n` +
        `       correction_window_ends_at >= now() + interval '19 minutes'\n` +
        `from public.inventory_reservations where order_id = ${order.id};`,
    );
    expect(lastLine(state.stdout)).toBe("t|t|t");

    const firstWindow = await scalar(
      `select correction_window_ends_at from public.inventory_reservations where order_id = ${order.id};`,
    );
    expect((await asService(`select public.open_order_correction_window(${order.id});`)).stdout.trim()).toBe("1");
    expect(await scalar(
      `select correction_window_ends_at from public.inventory_reservations where order_id = ${order.id};`,
    )).toBe(firstWindow);
    expect(await auditCount(order.id)).toBe(1);
  });

  it("expires from the acceptance deadline, not the original creation clock", async () => {
    const order = await quotedOrder();
    const accepted = parsed(await acceptByToken(order.token));
    const backdated = await asService(
      `update public.inventory_reservations\n` +
        `set created_at = now() - interval '40 minutes',\n` +
        `    initial_expires_at = now() - interval '20 minutes',\n` +
        `    quote_acceptance_expires_at = now() - interval '10 minutes',\n` +
        `    expires_at = now() - interval '10 minutes'\n` +
        `where order_id = ${order.id};`,
    );
    expect(backdated.code, allText(backdated)).toBe(0);

    const cleanup = await asService(`select public.release_expired_reservations();`);
    expect(cleanup.code, allText(cleanup)).toBe(0);
    expect(await scalar(
      `select status from public.inventory_reservations where order_id = ${order.id};`,
    )).toBe("expired");
    expect(await scalar(`select status from public.orders where id = ${order.id};`)).toBe("expired");

    // Replay returns the original values but cannot revive the closed row.
    const replay = parsed(await acceptById(order.id));
    expect(replay.idempotent).toBe(true);
    expect(replay.quote_acceptance_expires_at).toBe(accepted.quote_acceptance_expires_at);
    expect(await scalar(
      `select status from public.inventory_reservations where order_id = ${order.id};`,
    )).toBe("expired");
    expect(await auditCount(order.id)).toBe(1);
  });

  // --- F. Authorization and observability -------------------------------------

  it("only accepts the high-entropy tracking token, never an order id or a guess", async () => {
    const order = await quotedOrder();
    const wrong = await acceptByToken("ab".repeat(32));
    expect(wrong.code).not.toBe(0);
    expect(allText(wrong)).toContain("no order matches the tracking token");

    const bareId = await asService(`select public.accept_quote_fee_for_tracking('${order.id}');`);
    expect(bareId.code).not.toBe(0);
    expect(allText(bareId)).toContain("no order matches the tracking token");

    const empty = await asService(`select public.accept_quote_fee_for_tracking(null);`);
    expect(empty.code).not.toBe(0);
    expect(allText(empty)).toContain("tracking token is required");

    expect(await scalar(`select quote_accepted_at is null from public.orders where id = ${order.id};`)).toBe("t");
    expect(await auditCount(order.id)).toBe(0);
    expect(await scalar(
      `select expires_at is null from public.inventory_reservations where order_id = ${order.id};`,
    )).toBe("t");
  });

  it("exposes acceptance state through PII-free tracking and no API role can call the RPCs", async () => {
    const order = await quotedOrder();
    const before = await asService(`select public.get_order_for_tracking('${order.token}');`);
    const beforePayload = JSON.parse(lastLine(before.stdout)) as Record<string, unknown>;
    expect(beforePayload.quote_acceptance_available).toBe(true);
    expect(beforePayload.quote_accepted_at).toBeNull();

    parsed(await acceptByToken(order.token));
    const after = await asService(`select public.get_order_for_tracking('${order.token}');`);
    const payload = JSON.parse(lastLine(after.stdout)) as Record<string, unknown>;
    expect(payload.quote_accepted_at).toBeTruthy();
    expect(payload.quote_acceptance_expires_at).toBeTruthy();
    expect(payload.quote_acceptance_available).toBe(false);
    const raw = JSON.stringify(payload);
    for (const pii of ["Ana Diaz", "04120001122", "Sector norte", order.token]) {
      expect(raw).not.toContain(pii);
    }

    const functions = "'accept_quote_fee', 'accept_quote_fee_for_tracking'";
    for (const role of ["anon", "authenticated"]) {
      const privileges = await db.psql(
        `select count(*) from pg_proc p\n` +
          `join pg_namespace n on n.oid = p.pronamespace\n` +
          `where n.nspname = 'public' and p.proname in (${functions})\n` +
          `  and has_function_privilege('${role}', p.oid, 'execute');`,
      );
      expect(lastLine(privileges.stdout), role).toBe("0");
    }
    const anonCall = await asAnon(
      `select public.accept_quote_fee_for_tracking('${order.token}');`,
    );
    expect(anonCall.code).not.toBe(0);
    expect(allText(anonCall)).toContain("permission denied");
    const adminCall = await asAdmin(`select public.accept_quote_fee(${order.id});`);
    expect(adminCall.code).not.toBe(0);
    expect(allText(adminCall)).toContain("permission denied");

    const serviceGrant = await db.psql(
      `select count(*) from pg_proc p\n` +
        `join pg_namespace n on n.oid = p.pronamespace\n` +
        `where n.nspname = 'public' and p.proname in (${functions})\n` +
        `  and has_function_privilege('service_role', p.oid, 'execute');`,
    );
    expect(lastLine(serviceGrant.stdout)).toBe("2");
  });
});
