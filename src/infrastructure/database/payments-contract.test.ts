/**
 * Phase 5 (payments module) — static contract of
 * `supabase/migrations/006_payments_and_verification.sql`.
 *
 * Fast, environment-independent guards for the additive schema, the exact
 * method/currency domains, evidence-link uniqueness, least-privilege grants and
 * reuse of the existing M3/M5 review primitives.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const migrationFile = path.join(migrationsDir, "006_payments_and_verification.sql");

function stripComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("migration 006 contract (static)", () => {
  const raw = readFileSync(migrationFile, "utf8");
  const sql = stripComments(raw);

  it("is the sixth sequential migration and leaves 001-005 present", () => {
    expect(path.basename(migrationFile)).toBe("006_payments_and_verification.sql");
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
      "008_realtime_publication.sql",
      "009_store_settings_schedule.sql",
      "010_delivery_quote_admin.sql",
      "011_quote_pending_payment_guard.sql",
      "012_delivery_quote_post_acceptance_guard.sql",
      "013_quote_guard_helpers_grants.sql",
      "014_product_reviews.sql",
    ]);
  });

  it("adds only the two documented tables and the single evidence-link column", () => {
    const tables = [...sql.matchAll(/create table (?:public\.)?(\w+)/g)].map((m) => m[1]);
    expect(tables.sort()).toEqual(["payment_refunds", "payments"]);

    const altered = [...sql.matchAll(/alter table public\.(\w+)\s+add column (\w+)/g)].map(
      (m) => `${m[1]}.${m[2]}`,
    );
    expect(altered).toEqual(["receipt_submissions.payment_id"]);
  });

  it("allows exactly the documented method/currency pairs", () => {
    expect(sql).toMatch(
      /check \(method in \('pago_movil', 'cash_usd', 'binance_pay', 'binance_transfer'\)\)/,
    );
    expect(sql).toMatch(/method = 'pago_movil'\s+and currency = 'VES'/);
    expect(sql).toMatch(/method = 'cash_usd'\s+and currency = 'USD'/);
    expect(sql).toMatch(/method = 'binance_pay'\s+and currency = 'USDT'/);
    expect(sql).toMatch(/method = 'binance_transfer' and currency = 'USDT'/);
    // No undeclared single-method alias or extra currency is introduced.
    expect(sql).not.toMatch(/'binance'\s*\)/);
    expect(sql).not.toMatch(/currency in \('USD', 'VES', 'USDT',/);
  });

  it("enforces database-level idempotency and a single open evidence history", () => {
    expect(sql).toMatch(/payments_idempotency_key_key unique \(idempotency_key\)/);
    expect(sql).toMatch(/payment_refunds_idempotency_key_key unique \(idempotency_key\)/);
    expect(sql).toMatch(
      /create unique index receipt_submissions_pending_payment_key\s+on public\.receipt_submissions \(payment_id\)\s+where review_status = 'pending' and payment_id is not null/,
    );
    expect(sql).toMatch(
      /create unique index receipt_submissions_pending_order_key\s+on public\.receipt_submissions \(order_id\)\s+where review_status = 'pending'/,
    );
  });

  it("keeps mutating RPCs service-role-only and the summary read-only", () => {
    for (const signature of [
      "register_payment(bigint, text, text, numeric, text, text, numeric, text, uuid, boolean)",
      "register_payment_for_tracking(text, text, numeric, text, text, text)",
      "submit_payment_evidence(bigint)",
      "approve_payment(bigint, uuid)",
      "reject_payment(bigint, uuid)",
      "register_pos_cash_sale(jsonb, numeric, text, uuid)",
      "record_refund(bigint, numeric, text, text, uuid, text)",
    ]) {
      expect(sql, signature).toContain(`grant  execute on function public.${signature}\n  to service_role;`);
      expect(sql, signature).toContain(
        `revoke execute on function public.${signature}\n  from public, anon, authenticated;`,
      );
    }
    expect(sql).toContain(
      "grant  execute on function public.get_order_payment_summary(bigint)\n  to authenticated, service_role;",
    );
    expect(sql).toContain(
      "revoke execute on function public.get_order_payment_summary(bigint)\n  from public, anon;",
    );
    expect(sql).toContain(
      "revoke execute on function private.require_active_admin(uuid)\n  from public, anon, authenticated;",
    );
  });

  it("grants no client table writes and keeps receipts private", () => {
    expect(sql).toContain(
      "revoke all on public.payments, public.payment_refunds from anon, authenticated;",
    );
    expect(sql).toContain("grant select on public.payments, public.payment_refunds to authenticated;");
    expect(sql).toContain("values ('payment-receipts', 'payment-receipts', false)");
    expect(sql).toMatch(
      /create policy payment_receipts_admin_select on storage\.objects\s+for select to authenticated\s+using \(bucket_id = 'payment-receipts' and \(select private\.is_admin\(\)\)\);/,
    );
    expect(sql).not.toMatch(/create policy \w+ on storage\.objects\s+for (insert|update|delete)/);
  });

  it("reuses the existing review and inventory primitives", () => {
    expect(sql).toContain("public.approve_receipt_submission(v_order.id)");
    expect(sql).toContain("public.open_order_correction_window(v_order.id)");
    expect(sql).toContain("public.hold_order_reservations(v_order.id)");
    expect(sql).toContain("public.consume_order_reservations(v_order_id)");
    expect(sql).not.toContain("set status = 'confirmed'");
    expect(sql).not.toContain("set status = 'ready'");
  });
});
