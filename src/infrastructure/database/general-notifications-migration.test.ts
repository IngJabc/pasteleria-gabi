/**
 * P6 — behavioral validation of `supabase/migrations/016_general_admin_notifications.sql`.
 *
 * Applies 001-016 to a throwaway local PostgreSQL cluster and exercises the
 * four general event families end to end: online-only order fan-out, the
 * evidence-link receipt transition (including retries and corrections), product
 * reviews, deterministic/idempotent keys, active-admin RLS and the immutable
 * history boundary.
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
  "008_realtime_publication.sql",
  "009_store_settings_schedule.sql",
  "010_delivery_quote_admin.sql",
  "011_quote_pending_payment_guard.sql",
  "012_delivery_quote_post_acceptance_guard.sql",
  "013_quote_guard_helpers_grants.sql",
  "014_product_reviews.sql",
  "015_bcv_sync_attempts.sql",
  "016_general_admin_notifications.sql",
  "017_unified_notifications_realtime.sql",
].map((name) => path.join(repoRoot, "supabase", "migrations", name));

const ADMIN_1 = "11111111-1111-4111-8111-111111111111";
const ADMIN_2 = "22222222-2222-4222-8222-222222222222";
const ADMIN_INACTIVE = "33333333-3333-4333-8333-333333333333";
const STRANGER = "99999999-9999-4999-8999-999999999999";

const FIXTURES = `
insert into auth.users (id, email) values
  ('${ADMIN_1}', 'admin1@example.test'),
  ('${ADMIN_2}', 'admin2@example.test'),
  ('${ADMIN_INACTIVE}', 'inactive@example.test'),
  ('${STRANGER}', 'stranger@example.test');

insert into public.administrators (id, display_name, is_active) values
  ('${ADMIN_1}', 'Admin One', true),
  ('${ADMIN_2}', 'Admin Two', true),
  ('${ADMIN_INACTIVE}', 'Admin Inactive', false);

insert into public.products (slug, name, description, price_usd) values
  ('general-notify-cake', 'Tarta de notificaciones', 'prueba P6', 10.00);
`;

interface NotificationRow {
  id: number;
  eventType: string;
  eventKey: string;
  adminId: string;
  orderId: number | null;
  receiptSubmissionId: number | null;
  paymentId: number | null;
  reviewId: number | null;
  productId: number | null;
  summary: string;
  unread: boolean;
}

function nullableNumber(value: string): number | null {
  return value === "-" || value === "" ? null : Number(value);
}

describe.skipIf(!tools)("P6 general notifications migration on a disposable local PostgreSQL", () => {
  let db: LocalPostgres;
  let productId = 0;
  let onlineOrder = 0;
  let firstSubmission = 0;

  const asService = (sql: string): Promise<PsqlResult> => db.psql(`set role service_role;\n${sql}`);
  const asAnon = (sql: string): Promise<PsqlResult> => db.psql(`set role anon;\n${sql}`);
  const asAdmin = (sub: string, sql: string): Promise<PsqlResult> =>
    db.psql(
      `do $$ begin perform set_config('request.jwt.claim.sub', '${sub}', false); end $$;\n` +
        `set role authenticated;\n${sql}`,
    );
  const asAdmin1 = (sql: string): Promise<PsqlResult> => asAdmin(ADMIN_1, sql);
  const asInactive = (sql: string): Promise<PsqlResult> => asAdmin(ADMIN_INACTIVE, sql);
  const asStranger = (sql: string): Promise<PsqlResult> => asAdmin(STRANGER, sql);

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

  async function scalar(sql: string): Promise<string> {
    const result = await asService(sql);
    expect(result.code, allText(result)).toBe(0);
    return lastLine(result.stdout);
  }

  async function notificationRows(): Promise<NotificationRow[]> {
    const result = await asService(
      `select id, event_type, event_key, admin_id,\n` +
        `  coalesce(order_id::text, '-'), coalesce(receipt_submission_id::text, '-'),\n` +
        `  coalesce(payment_id::text, '-'), coalesce(review_id::text, '-'),\n` +
        `  coalesce(product_id::text, '-'), summary, (read_at is null)\n` +
        `from public.admin_general_notifications order by id;`,
    );
    expect(result.code, allText(result)).toBe(0);
    return lines(result.stdout).map((line) => {
      const [
        id,
        eventType,
        eventKey,
        adminId,
        orderId,
        receiptSubmissionId,
        paymentId,
        reviewId,
        productIdValue,
        summary,
        unread,
      ] = line.split("|");
      return {
        id: Number(id),
        eventType,
        eventKey,
        adminId,
        orderId: nullableNumber(orderId),
        receiptSubmissionId: nullableNumber(receiptSubmissionId),
        paymentId: nullableNumber(paymentId),
        reviewId: nullableNumber(reviewId),
        productId: nullableNumber(productIdValue),
        summary,
        unread: unread === "t",
      };
    });
  }

  async function rowsByKey(eventKey: string): Promise<NotificationRow[]> {
    return (await notificationRows()).filter((row) => row.eventKey === eventKey);
  }

  async function createOrder(channel: "online" | "pos"): Promise<number> {
    const sql =
      channel === "online"
        ? `insert into public.orders\n` +
          `  (channel, customer_name, customer_phone, fulfillment_type, tracking_token_hash, subtotal_usd, total_usd)\n` +
          `values ('online', 'Ana Perez', '04120001122', 'pickup',\n` +
          `  repeat(md5(clock_timestamp()::text || random()::text), 2), 10, 10)\n` +
          `returning id;`
        : `insert into public.orders (channel, subtotal_usd, total_usd)\n` +
          `values ('pos', 10, 10) returning id;`;
    return Number(await scalar(sql));
  }

  async function createPayment(orderId: number, suffix: string): Promise<number> {
    return Number(
      await scalar(
        `insert into public.payments\n` +
          `  (order_id, method, currency, amount, reference, receipt_path, status, idempotency_key)\n` +
          `values (${orderId}, 'pago_movil', 'VES', 100, 'ref-${suffix}', ` +
          `'receipts/${suffix}.jpg', 'pending', 'idem-${suffix}')\n` +
          `returning id;`,
      ),
    );
  }

  async function createSubmission(orderId: number, attempt: number): Promise<number> {
    return Number(
      await scalar(
        `insert into public.receipt_submissions (order_id, attempt_number, payment_id)\n` +
          `values (${orderId}, ${attempt}, null) returning id;`,
      ),
    );
  }

  async function linkEvidence(submissionId: number, paymentId: number): Promise<number> {
    return Number(
      await scalar(
        `with linked as (\n` +
          `  update public.receipt_submissions set payment_id = ${paymentId}\n` +
          `  where id = ${submissionId} and payment_id is null returning 1\n` +
          `) select count(*) from linked;`,
      ),
    );
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
    productId = Number(await scalar(`select id from public.products where slug = 'general-notify-cake';`));
    expect(productId).toBeGreaterThan(0);
  }, 240_000);

  afterAll(async () => {
    if (db) await db.stop();
  }, 60_000);

  it("creates the dedicated table with forced RLS, default replica identity and publication membership", async () => {
    const columns = await db.psql(
      `select column_name || '|' || data_type || '|' || is_nullable\n` +
        `from information_schema.columns\n` +
        `where table_schema = 'public' and table_name = 'admin_general_notifications'\n` +
        `order by ordinal_position;`,
    );
    expect(columns.code, allText(columns)).toBe(0);
    expect(lines(columns.stdout)).toEqual([
      "id|bigint|NO",
      "event_type|text|NO",
      "event_key|text|NO",
      "admin_id|uuid|NO",
      "order_id|bigint|YES",
      "receipt_submission_id|bigint|YES",
      "payment_id|bigint|YES",
      "review_id|bigint|YES",
      "product_id|bigint|YES",
      "summary|text|NO",
      "created_at|timestamp with time zone|NO",
      "read_at|timestamp with time zone|YES",
    ]);

    expect(
      await scalar(
        `select pg_get_constraintdef(oid) from pg_constraint\n` +
          `where conname = 'admin_general_notifications_event_key_admin_key';`,
      ),
    ).toContain("UNIQUE (event_key, admin_id)");

    expect(
      await scalar(
        `select pg_get_constraintdef(oid) from pg_constraint\n` +
          `where conname = 'admin_general_notifications_payment_id_fkey';`,
      ),
    ).toContain("ON DELETE RESTRICT");

    expect(
      await scalar(
        `select relrowsecurity || '|' || relforcerowsecurity || '|' || relreplident\n` +
          `from pg_class where oid = 'public.admin_general_notifications'::regclass;`,
      ),
    ).toBe("true|true|d");

    expect(
      await scalar(
        `select count(*) from pg_publication_rel pr\n` +
          `join pg_publication p on p.oid = pr.prpubid\n` +
          `where p.pubname = 'supabase_realtime'\n` +
          `  and pr.prrelid = 'public.admin_general_notifications'::regclass;`,
      ),
    ).toBe("1");
  });

  it("fans online orders out to active admins only with event-prefixed keys and retry dedupe", async () => {
    onlineOrder = await createOrder("online");
    const posOrder = await createOrder("pos");

    const onlineKey = `new_order:${onlineOrder}`;
    const rows = await rowsByKey(onlineKey);
    expect(rows.map((row) => row.adminId).sort()).toEqual([ADMIN_1, ADMIN_2].sort());
    expect(rows.every((row) => row.eventType === "new_order")).toBe(true);
    expect(rows.every((row) => row.orderId === onlineOrder)).toBe(true);
    expect(rows.every((row) => row.summary === "Nuevo pedido online recibido.")).toBe(true);
    expect(
      rows.every(
        (row) =>
          row.receiptSubmissionId === null &&
          row.paymentId === null &&
          row.reviewId === null &&
          row.productId === null,
      ),
    ).toBe(true);

    expect(await rowsByKey(`new_order:${posOrder}`)).toEqual([]);

    const before = (await notificationRows()).length;
    const retried = await scalar(
      `select private.create_admin_general_notification(\n` +
        `  'new_order', '${onlineKey}', 'Nuevo pedido online recibido.', ${onlineOrder});`,
    );
    expect(retried).toBe("0");
    expect(await notificationRows()).toHaveLength(before);
  });

  it("emits receipt notifications only when evidence is linked, including corrections", async () => {
    const order = await createOrder("online");
    const payment1 = await createPayment(order, "first");
    firstSubmission = await createSubmission(order, 1);
    const key1 = `payment_receipt:${firstSubmission}`;

    // The submission INSERT is only a placeholder: no notification yet.
    expect(await rowsByKey(key1)).toEqual([]);
    expect(await linkEvidence(firstSubmission, payment1)).toBe(1);

    const rows1 = await rowsByKey(key1);
    expect(rows1.map((row) => row.adminId).sort()).toEqual([ADMIN_1, ADMIN_2].sort());
    expect(rows1.every((row) => row.eventType === "payment_receipt")).toBe(true);
    expect(rows1.every((row) => row.orderId === order)).toBe(true);
    expect(rows1.every((row) => row.receiptSubmissionId === firstSubmission)).toBe(true);
    expect(rows1.every((row) => row.paymentId === payment1)).toBe(true);
    expect(rows1.every((row) => row.summary === "Nuevo comprobante de pago recibido.")).toBe(true);

    // An idempotent repeat changes no row and therefore emits no second event.
    expect(await linkEvidence(firstSubmission, payment1)).toBe(0);
    expect(await rowsByKey(key1)).toHaveLength(2);

    const payment2 = await createPayment(order, "correction");
    const submission2 = await createSubmission(order, 2);
    const key2 = `receipt_correction:${submission2}`;
    expect(await rowsByKey(key2)).toEqual([]);
    expect(await linkEvidence(submission2, payment2)).toBe(1);

    const rows2 = await rowsByKey(key2);
    expect(rows2.map((row) => row.adminId).sort()).toEqual([ADMIN_1, ADMIN_2].sort());
    expect(rows2.every((row) => row.eventType === "receipt_correction")).toBe(true);
    expect(rows2.every((row) => row.receiptSubmissionId === submission2)).toBe(true);
    expect(rows2.every((row) => row.paymentId === payment2)).toBe(true);
    expect(rows2.every((row) => row.summary === "Comprobante corregido recibido.")).toBe(true);
  });

  it("notifies both active admins when a product review is published", async () => {
    const reviewId = Number(
      await scalar(
        `insert into public.product_reviews (product_id, rating, comment)\n` +
          `values (${productId}, 5, 'Excelente tarta') returning id;`,
      ),
    );
    const rows = await rowsByKey(`product_review:${reviewId}`);
    expect(rows.map((row) => row.adminId).sort()).toEqual([ADMIN_1, ADMIN_2].sort());
    expect(rows.every((row) => row.eventType === "product_review")).toBe(true);
    expect(rows.every((row) => row.reviewId === reviewId)).toBe(true);
    expect(rows.every((row) => row.productId === productId)).toBe(true);
    expect(rows.every((row) => row.summary === "Nueva reseña de producto recibida.")).toBe(true);
    expect(rows.every((row) => row.orderId === null && row.receiptSubmissionId === null && row.paymentId === null)).toBe(true);
  });

  it("enforces RLS, grants and read-state transitions for the owning admin only", async () => {
    const ownRows = await rowsByKey(`new_order:${onlineOrder}`);
    const ownId = ownRows.find((row) => row.adminId === ADMIN_1)?.id;
    const otherId = ownRows.find((row) => row.adminId === ADMIN_2)?.id;
    expect(ownId).toBeGreaterThan(0);
    expect(otherId).toBeGreaterThan(0);

    const visibleToAdmin1 = await asAdmin1(
      `select count(*) from public.admin_general_notifications;`,
    );
    expect(visibleToAdmin1.code, allText(visibleToAdmin1)).toBe(0);
    expect(Number(lastLine(visibleToAdmin1.stdout))).toBeGreaterThan(0);

    const visibleToStranger = await asStranger(
      `select count(*) from public.admin_general_notifications;`,
    );
    expect(visibleToStranger.code, allText(visibleToStranger)).toBe(0);
    expect(lastLine(visibleToStranger.stdout)).toBe("0");

    const anonSelect = await asAnon(`select count(*) from public.admin_general_notifications;`);
    expect(anonSelect.code).not.toBe(0);
    const clientInsert = await asAdmin1(
      `insert into public.admin_general_notifications\n` +
        `  (event_type, event_key, admin_id, summary) values\n` +
        `  ('new_order', 'new_order:999999', '${ADMIN_1}', 'Falso');`,
    );
    expect(clientInsert.code).not.toBe(0);

    const inactiveSelect = await asInactive(
      `select count(*) from public.admin_general_notifications;`,
    );
    expect(inactiveSelect.code, allText(inactiveSelect)).toBe(0);
    expect(lastLine(inactiveSelect.stdout)).toBe("0");

    const clientDelete = await asAdmin1(
      `delete from public.admin_general_notifications where id = ${ownId};`,
    );
    expect(clientDelete.code).not.toBe(0);

    const crossAdminUpdate = await asAdmin1(
      `with changed as (\n` +
        `  update public.admin_general_notifications set read_at = now() where id = ${otherId}\n` +
        `  returning 1\n` +
        `) select count(*) from changed;`,
    );
    expect(crossAdminUpdate.code, allText(crossAdminUpdate)).toBe(0);
    expect(lastLine(crossAdminUpdate.stdout)).toBe("0");

    const markOne = await asAdmin1(
      `with changed as (\n` +
        `  update public.admin_general_notifications set read_at = now() where id = ${ownId}\n` +
        `  returning 1\n` +
        `) select count(*) from changed;`,
    );
    expect(markOne.code, allText(markOne)).toBe(0);
    expect(lastLine(markOne.stdout)).toBe("1");

    const ownUnreadBefore = await asAdmin1(
      `select count(*) from public.admin_general_notifications\n` +
        `where admin_id = '${ADMIN_1}' and read_at is null;`,
    );
    expect(ownUnreadBefore.code, allText(ownUnreadBefore)).toBe(0);
    expect(Number(lastLine(ownUnreadBefore.stdout))).toBeGreaterThan(0);

    const markAll = await asAdmin1(
      `with changed as (\n` +
        `  update public.admin_general_notifications set read_at = now()\n` +
        `  where admin_id = '${ADMIN_1}' and read_at is null returning 1\n` +
        `) select count(*) from changed;`,
    );
    expect(markAll.code, allText(markAll)).toBe(0);
    expect(Number(lastLine(markAll.stdout))).toBeGreaterThan(0);

    const ownUnreadAfter = await asAdmin1(
      `select count(*) from public.admin_general_notifications\n` +
        `where admin_id = '${ADMIN_1}' and read_at is null;`,
    );
    expect(lastLine(ownUnreadAfter.stdout)).toBe("0");

    const unmark = await asAdmin1(
      `with changed as (\n` +
        `  update public.admin_general_notifications set read_at = null where id = ${ownId}\n` +
        `  returning 1\n` +
        `) select count(*) from changed;`,
    );
    expect(unmark.code, allText(unmark)).toBe(0);
    expect(lastLine(unmark.stdout)).toBe("1");
  });

  it("keeps event identity immutable and validates event shapes", async () => {
    const row = (await rowsByKey(`new_order:${onlineOrder}`))[0];
    expect(row).toBeDefined();

    const rewriteSummary = await asService(
      `update public.admin_general_notifications set summary = 'Manipulada' where id = ${row.id};`,
    );
    expect(rewriteSummary.code).not.toBe(0);
    expect(allText(rewriteSummary)).toContain("Los campos de la notificación general son inmutables.");

    const rewritePayment = await asService(
      `update public.admin_general_notifications set payment_id = 999 where id = ${row.id};`,
    );
    expect(rewritePayment.code).not.toBe(0);
    expect(allText(rewritePayment)).toContain("Los campos de la notificación general son inmutables.");

    const earlyRead = await asService(
      `update public.admin_general_notifications\n` +
        `set read_at = created_at - interval '1 second' where id = ${row.id};`,
    );
    expect(earlyRead.code).not.toBe(0);

    const wrongKey = await asService(
      `insert into public.admin_general_notifications\n` +
        `  (event_type, event_key, admin_id, order_id, summary)\n` +
        `values ('new_order', 'order:${onlineOrder}', '${ADMIN_1}', ${onlineOrder}, 'Clave inválida');`,
    );
    expect(wrongKey.code).not.toBe(0);

    const missingPayment = await asService(
      `insert into public.admin_general_notifications\n` +
        `  (event_type, event_key, admin_id, order_id, receipt_submission_id, payment_id, summary)\n` +
        `values ('payment_receipt', 'payment_receipt:${firstSubmission}', '${ADMIN_1}',\n` +
        `  ${onlineOrder}, ${firstSubmission}, null, 'Sin pago');`,
    );
    expect(missingPayment.code).not.toBe(0);
  });

  it("never addresses inactive administrators or unknown event families", async () => {
    const rows = await notificationRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.adminId !== ADMIN_INACTIVE)).toBe(true);
    expect(
      rows.every((row) =>
        ["new_order", "payment_receipt", "receipt_correction", "product_review"].includes(
          row.eventType,
        ),
      ),
    ).toBe(true);
  });
});
