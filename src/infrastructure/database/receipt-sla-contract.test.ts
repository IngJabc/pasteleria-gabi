/**
 * OQ-16 — static contract of `supabase/migrations/005_receipt_sla_notifications.sql`.
 *
 * Guards the documented invariants without a database: durable history, an
 * individually addressed inbox with a database-enforced idempotency key,
 * service-role-only volatile RPCs, no business writes from the SLA cycle and no
 * external-delivery/outbox leakage.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const migrationsDir = path.join(repoRoot, "supabase", "migrations");
const migrationFile = path.join(migrationsDir, "005_receipt_sla_notifications.sql");

function stripComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("migration 005 contract (static)", () => {
  const raw = readFileSync(migrationFile, "utf8");
  const sql = stripComments(raw);

  it("follows the sequential migration naming convention and preserves 001-004", () => {
    expect(path.basename(migrationFile)).toBe("005_receipt_sla_notifications.sql");
    expect(/^\d{3}_[a-z0-9_]+\.sql$/.test(path.basename(migrationFile))).toBe(true);

    expect(
      readdirSync(migrationsDir)
        .filter((name) => name.endsWith(".sql"))
        .sort(),
    ).toEqual([
      "001_catalog_and_admin_foundation.sql",
      "002_inventory_foundation.sql",
      "003_orders_and_reservations.sql",
      "004_quote_acceptance.sql",
      "005_receipt_sla_notifications.sql",
      "006_payments_and_verification.sql",
      "007_bcv_rates_and_rounding.sql",
    ]);
  });

  it("creates exactly the two documented tables with the required columns", () => {
    const tables = [...sql.matchAll(/create table (?:public\.)?(\w+)/g)].map((m) => m[1]);
    expect(tables.sort()).toEqual(["admin_notifications", "receipt_submissions"]);

    expect(sql).toMatch(
      /attempt_number smallint not null[\s\S]*?submitted_at\s+timestamptz not null default now\(\)[\s\S]*?reviewed_at\s+timestamptz,[\s\S]*?review_status\s+text not null default 'pending'/,
    );
    expect(sql).toMatch(
      /constraint receipt_submissions_order_attempt_key unique \(order_id, attempt_number\)/,
    );
    expect(sql).toMatch(/admin_id\s+uuid not null[\s\S]*?references public\.administrators \(id\)/);
    expect(sql).toMatch(/read_at\s+timestamptz/);
    expect(sql).toMatch(
      /constraint admin_notifications_unique\s+unique \(receipt_submission_id, admin_id, interval_bucket\)/,
    );
  });

  it("enables and forces RLS with own-row-only notification policies", () => {
    expect([...sql.matchAll(/enable row level security/g)]).toHaveLength(2);
    expect([...sql.matchAll(/force row level security/g)]).toHaveLength(2);

    expect(sql).toMatch(
      /create policy admin_notifications_admin_select on public\.admin_notifications[\s\S]*?admin_id = \(select auth\.uid\(\)\)[\s\S]*?private\.is_admin\(\)/,
    );
    expect(sql).toMatch(
      /create policy admin_notifications_admin_update_own[\s\S]*?with check \(admin_id = \(select auth\.uid\(\)\)[\s\S]*?private\.is_admin\(\)\)/,
    );
    expect(sql).not.toMatch(/create policy admin_notifications_admin_insert/);
    expect(sql).not.toMatch(/create policy admin_notifications_admin_delete/);
  });

  it("uses volatile, invoker-based RPCs with pinned search paths", () => {
    const functions = [...sql.matchAll(/create or replace function (?:public|private)\.\w+/g)].map(
      (m) => m[0],
    );
    expect(functions).toHaveLength(6);
    expect(sql).not.toMatch(/security\s+definer/i);
    expect([...sql.matchAll(/security invoker/g)]).toHaveLength(6);
    expect([...sql.matchAll(/set search_path = ''/g)]).toHaveLength(6);
    expect([...sql.matchAll(/^\s*volatile\s*$/gm)]).toHaveLength(6);
    // Mutating/locking functions must never be marked STABLE or IMMUTABLE.
    // Match the volatility declaration line only, so the word "immutable" in
    // comments/the trigger-function name does not create a false positive.
    expect(sql).not.toMatch(/^\s*(stable|immutable)\s*$/gm);
  });

  it("enforces receipt-history immutability at database level", () => {
    expect(sql).toMatch(
      /create trigger receipt_submissions_immutable\s+before update on public\.receipt_submissions/,
    );
    const triggerBody = sql.slice(
      sql.indexOf("create or replace function private.enforce_receipt_submission_immutability"),
      sql.indexOf("create or replace function private.close_pending_receipt_submission"),
    );
    expect(triggerBody).toMatch(/new\.order_id is distinct from old\.order_id/);
    expect(triggerBody).toMatch(/new\.attempt_number is distinct from old\.attempt_number/);
    expect(triggerBody).toMatch(/new\.submitted_at is distinct from old\.submitted_at/);
    expect(triggerBody).not.toMatch(/review_status|reviewed_at/);
  });

  it("keeps the M3 submission/rejection behavior and lock order intact", () => {
    expect(sql).toMatch(/set receipt_attempts = o\.receipt_attempts \+ 1/);
    expect(sql).toMatch(/o\.receipt_attempts < 2/);
    expect(sql).toMatch(/has already used its two receipt attempts/);
    expect(sql).toMatch(/has no submitted receipt to reject/);
    expect(sql).toMatch(/set status = 'canceled'/);
    // The original reservation locks are preserved in both replaced functions.
    expect([...sql.matchAll(/where r\.order_id = p_order_id and r\.status = 'active'\s+for update/g)]).toHaveLength(2);
  });

  it("records one history row only after a real attempt increment", () => {
    const holdBody = sql.slice(
      sql.indexOf("create or replace function public.hold_order_reservations"),
      sql.indexOf("create or replace function public.open_order_correction_window"),
    );
    const insertIndex = holdBody.indexOf(
      "insert into public.receipt_submissions (order_id, attempt_number, submitted_at)",
    );
    const incrementIndex = holdBody.indexOf("get diagnostics v_counted = row_count;");
    const guardIndex = holdBody.indexOf("if v_counted = 0 then");
    expect(insertIndex).toBeGreaterThan(incrementIndex);
    expect(insertIndex).toBeGreaterThan(guardIndex);
    expect(holdBody).toMatch(/values \(p_order_id, v_attempts \+ 1, now\(\)\)/);
  });

  it("closes the exact pending submission on both review outcomes", () => {
    expect(sql).toMatch(
      /perform private\.close_pending_receipt_submission\(p_order_id, 'rejected'\)/,
    );
    expect(sql).toMatch(
      /v_closed := private\.close_pending_receipt_submission\(p_order_id, 'approved'\)/,
    );
    expect(sql).toMatch(
      /where s\.order_id = p_order_id\s+and s\.review_status = 'pending'/,
    );
    expect(sql).not.toMatch(/truncate|delete from public\.receipt_submissions/);
  });

  it("processes one deterministic 15-minute bucket without business writes", () => {
    expect(sql).toMatch(/floor\(extract\(epoch from v_now\) \/ 900\)::bigint/);
    expect(sql).toMatch(/s\.submitted_at <= v_now - interval '24 hours'/);
    expect(sql).toMatch(/cross join public\.administrators a/);
    expect(sql).toMatch(/on conflict \(receipt_submission_id, admin_id, interval_bucket\) do nothing/);

    const cycleBody = sql.slice(sql.indexOf("create or replace function public.process_sla_notifications"));
    // The active filter must be on the INSERT fan-out, not only on the metric.
    expect(cycleBody).toMatch(/and a\.is_active\s+on conflict/i);
    // No "already has one" subquery may suppress another administrator's row.
    expect(cycleBody).not.toMatch(/not exists/i);
    expect(cycleBody).not.toMatch(/update public\.(orders|inventory_reservations|inventory_batches|inventory_movements)/);
    expect(cycleBody).not.toMatch(/delete from|truncate/);
    expect(cycleBody).not.toMatch(/expires_at\s*=/);
    // The only write in the cycle is the notification insert.
    expect([...cycleBody.matchAll(/insert into public\.(\w+)/g)].map((m) => m[1])).toEqual([
      "admin_notifications",
    ]);
  });

  it("grants every RPC to service_role only and never to client roles", () => {
    for (const signature of [
      "public.hold_order_reservations(bigint)",
      "public.open_order_correction_window(bigint)",
      "public.approve_receipt_submission(bigint)",
      "public.process_sla_notifications(timestamptz)",
      "private.close_pending_receipt_submission(bigint, text)",
      "private.enforce_receipt_submission_immutability()",
    ]) {
      const escaped = signature.replace(/[()]/g, "\\$&");
      expect(sql).toMatch(
        new RegExp(`revoke execute on function ${escaped}\\s+from public, anon, authenticated;`),
      );
      expect(sql).toMatch(new RegExp(`grant  execute on function ${escaped}\\s+to service_role;`));
    }
  });

  it("is an in-app inbox, not an external-delivery outbox", () => {
    expect(sql).not.toMatch(/pg_notify|notify\s+['"]/i);
    expect(sql).not.toMatch(/outbox|sendgrid|mailgun|smtp|slack|whatsapp/i);
    expect(sql).not.toMatch(/delivered|delivery_status/i);
  });
});
