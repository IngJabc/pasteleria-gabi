/**
 * OQ-16 — behavioral validation of `supabase/migrations/005_receipt_sla_notifications.sql`.
 *
 * Applies 001 + 002 + 003 + 004 + 005 to a throwaway local PostgreSQL cluster
 * and exercises the whole receipt-review SLA: one immutable submission row per
 * actual receipt (including the correction), two independent 24-hour clocks,
 * durable per-administrator notifications every 15 minutes with database-level
 * idempotency, no historical burst on a delayed run, same-transaction review
 * closing on approval/rejection, strict business-state immutability, and
 * RLS/grant boundaries.
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
  ('sla-cake', 'Tarta SLA', 'prueba OQ-16', 10.00);
`;

interface CycleMetrics {
  bucket: number;
  pending_submissions: number;
  due_submissions: number;
  active_administrators: number;
  notifications_created: number;
  processed_at: string;
}

interface Submission {
  id: number;
  attempt: number;
  submittedAt: string;
  reviewedAt: string | null;
  status: string;
}

describe.skipIf(!tools)("OQ-16 receipt-review SLA migration on a disposable local PostgreSQL", () => {
  let db: LocalPostgres;
  let productId = 0;

  const asService = (sql: string): Promise<PsqlResult> => db.psql(`set role service_role;\n${sql}`);
  const asAnon = (sql: string): Promise<PsqlResult> => db.psql(`set role anon;\n${sql}`);
  const asAdmin = (sub: string, sql: string): Promise<PsqlResult> =>
    db.psql(
      `do $$ begin perform set_config('request.jwt.claim.sub', '${sub}', false); end $$;\n` +
        `set role authenticated;\n${sql}`,
    );
  const asAdmin1 = (sql: string): Promise<PsqlResult> => asAdmin(ADMIN_1, sql);
  const asAdmin2 = (sql: string): Promise<PsqlResult> => asAdmin(ADMIN_2, sql);
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

  async function createOrder(): Promise<number> {
    const result = await asService(
      `select public.create_online_order('Ana Perez', '04120001122', 'pickup', ` +
        `null, null, null, null, '[{"product_id": ${productId}, "quantity": 1}]');`,
    );
    expect(result.code, allText(result)).toBe(0);
    const parsed = JSON.parse(lastLine(result.stdout)) as { order_id: number };
    return parsed.order_id;
  }

  async function submit(orderId: number): Promise<Submission> {
    const result = await asService(`select public.hold_order_reservations(${orderId});`);
    expect(result.code, allText(result)).toBe(0);
    const rows = await submissions(orderId);
    return rows[rows.length - 1];
  }

  async function submissions(orderId: number): Promise<Submission[]> {
    const result = await asService(
      `select id, attempt_number, submitted_at, reviewed_at, review_status\n` +
        `from public.receipt_submissions where order_id = ${orderId} order by attempt_number;`,
    );
    expect(result.code, allText(result)).toBe(0);
    return lines(result.stdout).map((line) => {
      const [id, attempt, submittedAt, reviewedAt, status] = line.split("|");
      return {
        id: Number(id),
        attempt: Number(attempt),
        submittedAt,
        reviewedAt: reviewedAt === "" ? null : reviewedAt,
        status,
      };
    });
  }

  async function cycle(nowExpr = "now()"): Promise<CycleMetrics> {
    const result = await asService(`select public.process_sla_notifications(${nowExpr});`);
    expect(result.code, allText(result)).toBe(0);
    return JSON.parse(lastLine(result.stdout)) as CycleMetrics;
  }

  async function notificationRows(submissionId: number): Promise<Array<{
    id: number;
    adminId: string;
    bucket: number;
    readAt: string | null;
  }>> {
    const result = await asService(
      `select id, admin_id, interval_bucket, read_at\n` +
        `from public.admin_notifications where receipt_submission_id = ${submissionId}\n` +
        `order by interval_bucket, admin_id;`,
    );
    expect(result.code, allText(result)).toBe(0);
    return lines(result.stdout).map((line) => {
      const [id, adminId, bucket, readAt] = line.split("|");
      return {
        id: Number(id),
        adminId,
        bucket: Number(bucket),
        readAt: readAt === "" ? null : readAt,
      };
    });
  }

  /** Business state that the SLA/approval primitives must never touch. */
  async function businessSnapshot(orderId: number): Promise<string> {
    return [
      await scalar(
        `select status || '|' || receipt_attempts from public.orders where id = ${orderId};`,
      ),
      await scalar(
        `select coalesce(string_agg(status || '|' || coalesce(expires_at::text, '-') || '|' ||\n` +
          `  coalesce(initial_expires_at::text, '-') || '|' ||\n` +
          `  coalesce(correction_window_ends_at::text, '-'), ';'), '')\n` +
          `from (select * from public.inventory_reservations where order_id = ${orderId} order by id) r;`,
      ),
      await scalar(`select count(*) from public.inventory_movements;`),
      await scalar(`select coalesce(sum(remaining_quantity), 0)::text from public.inventory_batches;`),
    ].join("//");
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

    productId = Number(await scalar(`select id from public.products where slug = 'sla-cake';`));
    expect(productId).toBeGreaterThan(0);

    const batch = await asAdmin1(
      `select public.create_inventory_batch(${productId}, 50, '2026-11-01');`,
    );
    expect(batch.code, allText(batch)).toBe(0);
  }, 240_000);

  afterAll(async () => {
    if (db) await db.stop();
  }, 60_000);

  // --- A. Schema contract -----------------------------------------------------

  it("creates durable submission history and a uniquely keyed admin inbox", async () => {
    const columns = await db.psql(
      `select table_name || '.' || column_name || '|' || data_type || '|' || is_nullable\n` +
        `from information_schema.columns\n` +
        `where table_schema = 'public'\n` +
        `  and table_name in ('receipt_submissions', 'admin_notifications')\n` +
        `order by table_name, ordinal_position;`,
    );
    expect(columns.code, allText(columns)).toBe(0);
    expect(lines(columns.stdout)).toEqual([
      "admin_notifications.id|bigint|NO",
      "admin_notifications.receipt_submission_id|bigint|NO",
      "admin_notifications.admin_id|uuid|NO",
      "admin_notifications.interval_bucket|bigint|NO",
      "admin_notifications.created_at|timestamp with time zone|NO",
      "admin_notifications.read_at|timestamp with time zone|YES",
      "receipt_submissions.id|bigint|NO",
      "receipt_submissions.order_id|bigint|NO",
      "receipt_submissions.attempt_number|smallint|NO",
      "receipt_submissions.submitted_at|timestamp with time zone|NO",
      "receipt_submissions.reviewed_at|timestamp with time zone|YES",
      "receipt_submissions.review_status|text|NO",
    ]);

    expect(
      await scalar(
        `select pg_get_constraintdef(oid) from pg_constraint\n` +
          `where conname = 'receipt_submissions_order_attempt_key';`,
      ),
    ).toContain("UNIQUE (order_id, attempt_number)");
    expect(
      await scalar(
        `select pg_get_constraintdef(oid) from pg_constraint\n` +
          `where conname = 'admin_notifications_unique';`,
      ),
    ).toContain("UNIQUE (receipt_submission_id, admin_id, interval_bucket)");

    // RLS is enabled AND forced on both tables, as everywhere else.
    const rls = await db.psql(
      `select relname || '|' || relrowsecurity || '|' || relforcerowsecurity\n` +
        `from pg_class where relname in ('receipt_submissions', 'admin_notifications')\n` +
        `order by relname;`,
    );
    expect(rls.code, allText(rls)).toBe(0);
    expect(lines(rls.stdout)).toEqual([
      "admin_notifications|true|true",
      "receipt_submissions|true|true",
    ]);
  });

  // --- B. Submission history --------------------------------------------------

  let historyOrder = 0;
  let firstSubmission: Submission;

  it("records one immutable row per actual submission, never for idempotent repeats", async () => {
    historyOrder = await createOrder();
    expect(await submissions(historyOrder)).toEqual([]);

    firstSubmission = await submit(historyOrder);
    expect(firstSubmission.attempt).toBe(1);
    expect(firstSubmission.status).toBe("pending");
    expect(firstSubmission.reviewedAt).toBeNull();

    await submit(historyOrder); // already held: idempotent no-op
    expect(await submissions(historyOrder)).toHaveLength(1);
    expect(await scalar(`select receipt_attempts from public.orders where id = ${historyOrder};`)).toBe("1");

    const firstAt = firstSubmission.submittedAt;
    const rejected = await asService(`select public.open_order_correction_window(${historyOrder});`);
    expect(rejected.code, allText(rejected)).toBe(0);

    const afterReject = await submissions(historyOrder);
    expect(afterReject).toHaveLength(1);
    expect(afterReject[0].status).toBe("rejected");
    expect(afterReject[0].submittedAt).toBe(firstAt); // submission clock is immutable

    const secondSubmission = await submit(historyOrder); // correction: a NEW submission
    expect(secondSubmission.attempt).toBe(2);
    expect(secondSubmission.status).toBe("pending");
    expect(secondSubmission.submittedAt).not.toBe(firstSubmission.submittedAt);

    const all = await submissions(historyOrder);
    expect(all.map((s) => [s.attempt, s.status])).toEqual([
      [1, "rejected"],
      [2, "pending"],
    ]);
  });

  it("rejects rewrites of submission identity or its 24-hour clock", async () => {
    const order = await createOrder();
    const submission = await submit(order);

    for (const assignment of [
      `submitted_at = now() - interval '10 hours'`,
      `attempt_number = 2`,
      `order_id = ${order + 1000}`,
    ]) {
      const rewrite = await asService(
        `update public.receipt_submissions set ${assignment} where id = ${submission.id};`,
      );
      expect(rewrite.code, allText(rewrite)).not.toBe(0);
      expect(allText(rewrite)).toContain("receipt submission history is immutable");
    }

    // Review fields remain appendable by the service-role primitive.
    const approved = await asService(`select public.approve_receipt_submission(${order});`);
    expect(approved.code, allText(approved)).toBe(0);
    const rows = await submissions(order);
    expect(rows[0].status).toBe("approved");
    expect(rows[0].submittedAt).toBe(submission.submittedAt);
  });

  // --- C. SLA cycle -----------------------------------------------------------

  it("waits 24 hours, then notifies every active admin only", async () => {
    const order = await createOrder();
    const submission = await submit(order);

    await cycle("now() + interval '23 hours'"); // not due yet
    expect(await notificationRows(submission.id)).toEqual([]);

    const metrics = await cycle("now() + interval '24 hours 1 second'");
    expect(metrics.active_administrators).toBe(2);
    expect(metrics.due_submissions).toBeGreaterThanOrEqual(1);

    const rows = await notificationRows(submission.id);
    expect(rows.map((r) => r.adminId).sort()).toEqual([ADMIN_1, ADMIN_2].sort());
    expect(rows.every((r) => r.readAt === null)).toBe(true);
    expect(rows.every((r) => r.bucket === metrics.bucket)).toBe(true);

    await cycle("now() + interval '24 hours 1 second'"); // same bucket: no duplicates
    expect(await notificationRows(submission.id)).toHaveLength(2);
  });

  it("repeats every 15 minutes but a delayed run creates only the current bucket", async () => {
    const order = await createOrder();
    const submission = await submit(order);

    const first = await cycle("now() + interval '25 hours'");
    const second = await cycle("now() + interval '25 hours 15 minutes'");
    const delayed = await cycle("now() + interval '25 hours 46 minutes'");

    const buckets = (await notificationRows(submission.id)).map((r) => r.bucket).sort((a, b) => a - b);
    expect(new Set(buckets)).toEqual(
      new Set([first.bucket, second.bucket, delayed.bucket].sort((a, b) => a - b)),
    );
    expect(second.bucket).toBe(first.bucket + 1);
    // A 46-minute jump spans 3 or 4 quarter-hour buckets depending on the
    // current minute. Intermediate buckets are skipped, never replayed.
    expect(delayed.bucket - first.bucket).toBeGreaterThanOrEqual(3);
    expect(delayed.bucket - first.bucket).toBeLessThanOrEqual(4);
    expect(buckets).toHaveLength(6); // 3 buckets x 2 active admins
  });

  it("uses each receipt submission's own clock (the correction does not inherit the first SLA)", async () => {
    const order = await createOrder();
    const original = await submit(order);
    const rejected = await asService(`select public.open_order_correction_window(${order});`);
    expect(rejected.code, allText(rejected)).toBe(0);
    const correction = await submit(order);

    // At real time neither row is due: the original is reviewed, the
    // correction was submitted moments ago.
    expect(await notificationRows(original.id)).toEqual([]);
    expect(await notificationRows(correction.id)).toEqual([]);

    const metrics = await cycle("now() + interval '25 hours'");
    expect(metrics.bucket).toBeGreaterThan(0);
    expect(await notificationRows(original.id)).toEqual([]);
    expect(await notificationRows(correction.id)).toHaveLength(2);

    // The reviewed original never receives new notifications in later buckets.
    await cycle("now() + interval '25 hours 15 minutes'");
    expect(await notificationRows(original.id)).toEqual([]);
  });

  it("never writes order, payment, inventory or reservation state", async () => {
    const order = await createOrder();
    await submit(order);
    const before = await businessSnapshot(order);

    await cycle("now() + interval '30 hours'");
    await cycle("now() + interval '30 hours 15 minutes'");
    await asService(`select public.approve_receipt_submission(${order});`);

    const after = await businessSnapshot(order);
    expect(after).toBe(before); // approval/SLA close only the SLA submission
    expect((await submissions(order))[0].status).toBe("approved");
  });

  // --- D. Review closing ------------------------------------------------------

  it("closes exactly the pending submission on approval and is safe to repeat", async () => {
    const order = await createOrder();
    const submission = await submit(order);

    const first = await asService(`select public.approve_receipt_submission(${order});`);
    expect(first.code, allText(first)).toBe(0);
    expect(JSON.parse(lastLine(first.stdout)).submissions_closed).toBe(1);

    const second = await asService(`select public.approve_receipt_submission(${order});`);
    expect(second.code, allText(second)).toBe(0);
    expect(JSON.parse(lastLine(second.stdout)).submissions_closed).toBe(0);

    const rows = await submissions(order);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("approved");
    expect(rows[0].reviewedAt).not.toBeNull();

    // Approval stops the clock: no new notification even when overdue.
    const before = (await notificationRows(submission.id)).length;
    await cycle("now() + interval '30 hours'");
    expect((await notificationRows(submission.id)).length).toBe(before);
  });

  it("rejection closes in the same transaction and preserves full history after two rejections", async () => {
    const order = await createOrder();
    await submit(order);

    const rejected = await asService(`select public.open_order_correction_window(${order});`);
    expect(rejected.code, allText(rejected)).toBe(0);

    await submit(order);
    const finalReject = await asService(`select public.open_order_correction_window(${order});`);
    expect(finalReject.code, allText(finalReject)).toBe(0);

    const rows = await submissions(order);
    expect(rows.map((s) => [s.attempt, s.status])).toEqual([
      [1, "rejected"],
      [2, "rejected"],
    ]);
    expect(rows.every((s) => s.reviewedAt !== null)).toBe(true);
    expect(await scalar(`select status from public.orders where id = ${order};`)).toBe("canceled");
  });

  // --- E. Security ------------------------------------------------------------

  it("lets admins read history and read/update only their own notifications", async () => {
    const order = await createOrder();
    const submission = await submit(order);
    // Insert directly so created_at = now() and an admin can mark it read.
    // The SLA fan-out itself is covered by the cycle tests above.
    const seeded = await asService(
      `insert into public.admin_notifications\n` +
        `  (receipt_submission_id, admin_id, interval_bucket, created_at)\n` +
        `values (${submission.id}, '${ADMIN_1}', 999999, now()),\n` +
        `       (${submission.id}, '${ADMIN_2}', 999999, now());`,
    );
    expect(seeded.code, allText(seeded)).toBe(0);
    const rows = await notificationRows(submission.id);
    const mine = rows.find((r) => r.adminId === ADMIN_1);
    const theirs = rows.find((r) => r.adminId === ADMIN_2);
    expect(mine).toBeDefined();
    expect(theirs).toBeDefined();

    const readable = await asAdmin1(
      `select id from public.admin_notifications where receipt_submission_id = ${submission.id};`,
    );
    expect(readable.code, allText(readable)).toBe(0);
    expect(lines(readable.stdout)).toEqual([String(mine?.id)]);

    const updateOwn = await asAdmin1(
      `update public.admin_notifications set read_at = now() where id = ${mine?.id};`,
    );
    expect(updateOwn.code, allText(updateOwn)).toBe(0);
    expect((await notificationRows(submission.id)).find((r) => r.id === mine?.id)?.readAt).not.toBeNull();

    const updateOther = await asAdmin1(
      `update public.admin_notifications set read_at = now() where id = ${theirs?.id};`,
    );
    expect(updateOther.code, allText(updateOther)).toBe(0);
    expect((await notificationRows(submission.id)).find((r) => r.id === theirs?.id)?.readAt).toBeNull();

    const changeOwner = await asAdmin1(
      `update public.admin_notifications set admin_id = '${ADMIN_2}' where id = ${mine?.id};`,
    );
    expect(changeOwner.code, allText(changeOwner)).not.toBe(0);

    const insert = await asAdmin1(
      `insert into public.admin_notifications\n` +
        ` (receipt_submission_id, admin_id, interval_bucket)\n` +
        `values (${submission.id}, '${ADMIN_1}', 999999);`,
    );
    expect(insert.code, allText(insert)).not.toBe(0);

    const remove = await asAdmin1(`delete from public.admin_notifications where id = ${mine?.id};`);
    expect(remove.code, allText(remove)).toBe(0);
    // No DELETE policy exists: RLS silently filters the row, so it survives.
    expect((await notificationRows(submission.id)).some((r) => r.id === mine?.id)).toBe(true);

    const anonymousRead = await asAnon(
      `select id from public.admin_notifications where receipt_submission_id = ${submission.id};`,
    );
    expect(anonymousRead.code, allText(anonymousRead)).toBe(0);
    expect(lines(anonymousRead.stdout)).toEqual([]);

    const adminHistory = await asAdmin1(
      `select id from public.receipt_submissions where id = ${submission.id};`,
    );
    expect(adminHistory.code, allText(adminHistory)).toBe(0);
    expect(lines(adminHistory.stdout)).toEqual([String(submission.id)]);
    const strangerHistory = await asStranger(
      `select id from public.receipt_submissions where id = ${submission.id};`,
    );
    expect(strangerHistory.code, allText(strangerHistory)).toBe(0);
    expect(lines(strangerHistory.stdout)).toEqual([]);
  });

  it("restricts every SLA RPC to service_role", async () => {
    for (const role of ["anon", "authenticated"]) {
      const denied = await db.psql(
        role === "anon"
          ? `set role anon;\nselect public.process_sla_notifications(null);`
          : `set role authenticated;\nselect public.process_sla_notifications(null);`,
      );
      expect(denied.code, allText(denied)).not.toBe(0);

      const approveDenied = await db.psql(
        role === "anon"
          ? `set role anon;\nselect public.approve_receipt_submission(1);`
          : `set role authenticated;\nselect public.approve_receipt_submission(1);`,
      );
      expect(approveDenied.code, allText(approveDenied)).not.toBe(0);
    }
    expect(await asAdmin2(`select 1;`).then((r) => r.code)).toBe(0);
  });

  it("enforces the unique key at database level even under concurrent cycles", async () => {
    const order = await createOrder();
    const submission = await submit(order);

    const results = await Promise.all([
      cycle("now() + interval '25 hours'"),
      cycle("now() + interval '25 hours'"),
      cycle("now() + interval '25 hours'"),
      cycle("now() + interval '25 hours'"),
    ]);
    expect(results.every((m) => m.active_administrators === 2)).toBe(true);
    expect(await notificationRows(submission.id)).toHaveLength(2);
  });
});
