/**
 * M3 — static contract of `supabase/migrations/003_orders_and_reservations.sql`.
 *
 * Fast, environment-independent assertions over the migration source: exact
 * scope (no M4+ leakage), RLS/policy/grant shape, lifecycle timing literals,
 * named constraints and indexes, and migration ordering. The behavioral
 * companion is `orders-migration.test.ts`.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const migrationFile = path.join(migrationsDir, "003_orders_and_reservations.sql");

const M3_FUNCTIONS = [
  "create_online_order",
  "hold_order_reservations",
  "open_order_correction_window",
  "release_expired_reservations",
  "consume_order_reservations",
  "release_order_reservations",
  "get_order_for_tracking",
  "request_order_cancellation",
];

function stripComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("migration 003 contract (static)", () => {
  const raw = readFileSync(migrationFile, "utf8");
  const sql = stripComments(raw);

  it("follows the sequential migration naming convention", () => {
    expect(path.basename(migrationFile)).toBe("003_orders_and_reservations.sql");
    expect(/^\d{3}_[a-z0-9_]+\.sql$/.test(path.basename(migrationFile))).toBe(true);

    const migrations = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    expect(migrations).toEqual([
      "001_catalog_and_admin_foundation.sql",
      "002_inventory_foundation.sql",
      "003_orders_and_reservations.sql",
      "004_quote_acceptance.sql",
      "005_receipt_sla_notifications.sql",
      "006_payments_and_verification.sql",
      "007_bcv_rates_and_rounding.sql",
      "008_realtime_publication.sql",
      "009_store_settings_schedule.sql",
    ]);
  });

  it("creates exactly the five M3 tables", () => {
    const tables = [...sql.matchAll(/create table (?:public\.)?(\w+)/g)].map((m) => m[1]);
    expect(tables.sort()).toEqual([
      "cancellation_requests",
      "exchange_rates",
      "inventory_reservations",
      "order_items",
      "orders",
    ]);
  });

  it("leaves every M4+ concern out (payments, receipts, notifications, rates write path)", () => {
    expect(sql).not.toMatch(/payments?_receipts?/);
    // The only receipt-related identifier in M3 is the attempt counter; actual
    // receipt storage/upload/verification remains an M4 concern.
    const receiptIdentifiers = [...new Set([...sql.matchAll(/\breceipt_\w+/g)].map((m) => m[0]))];
    expect(receiptIdentifiers.sort()).toEqual(["receipt_attempts"]);
    expect(sql).not.toMatch(/notification/);
    expect(sql).not.toMatch(/payment_refunds/);
    expect(sql).not.toMatch(/insert into public\.exchange_rates/); // OQ-4: no write path yet
    expect(sql).not.toMatch(/audit_log/); // no admin action exists in M3 to audit
    // Exactly one duration exists: the 20-minute deadline/window. No invented
    // longer (or shorter) reservation windows.
    const intervals = [...sql.matchAll(/interval '([^']+)'/g)].map((m) => m[1]);
    expect([...new Set(intervals)].sort()).toEqual(["20 minutes"]);
  });

  it("adds only the documented column to inventory_movements (001/002 otherwise untouched)", () => {
    expect([...sql.matchAll(/alter table public\.\w+\s+add column/g)]).toHaveLength(1);
    expect(sql).toMatch(
      /alter table public\.inventory_movements\s+add column order_id bigint references public\.orders \(id\) on delete set null;/,
    );
    expect(sql).not.toMatch(/alter table public\.(products|product_images|store_settings|delivery_zones|administrators|audit_log|inventory_batches)\b/);
    expect(sql).not.toMatch(/create or replace function public\.(adjust_inventory|create_inventory_batch)\b/);
  });

  it("enables and forces RLS on all five tables", () => {
    expect([...sql.matchAll(/enable row level security/g)]).toHaveLength(5);
    expect([...sql.matchAll(/force row level security/g)]).toHaveLength(5);
  });

  it("defines exactly the SECURITY_DESIGN §4.1/§4.2 policies", () => {
    const policies = [...sql.matchAll(/create policy (\w+) on public\.(\w+)/g)].map(
      (m) => `${m[2]}.${m[1]}`,
    );
    expect(policies.sort()).toEqual([
      "cancellation_requests.cancellation_requests_admin_all",
      "exchange_rates.exchange_rates_admin_all",
      "exchange_rates.exchange_rates_public_select",
      "inventory_reservations.inventory_reservations_admin_all",
      "order_items.order_items_admin_all",
      "orders.orders_admin_all",
    ]);
    // The single anon policy is the documented read-only exchange-rate view.
    expect([...sql.matchAll(/\bto anon\b/g)]).toHaveLength(1);
    expect(sql).toMatch(
      /create policy exchange_rates_public_select on public\.exchange_rates\s+for select to anon using \(true\);/,
    );
    // Admin policies are the representative §4.2 shape, called through is_admin().
    // 5 admin ALL policies × (using + with check); the anon SELECT has none.
    expect([...sql.matchAll(/\(select private\.is_admin\(\)\)/g)]).toHaveLength(10);
    expect(sql).not.toMatch(/user_metadata/);
  });

  it("uses invoker-based RPCs with a pinned search_path (no definer rights)", () => {
    const created = [...sql.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]);
    expect(created.sort()).toEqual([...M3_FUNCTIONS, "get_product_stock"].sort());
    expect(sql).not.toMatch(/security\s+definer/i);
    expect([...sql.matchAll(/security invoker/g)]).toHaveLength(9); // 8 new + replaced stock view
    expect([...sql.matchAll(/set search_path = ''/g)]).toHaveLength(9);
    expect(sql).not.toMatch(/\\[ir]\b/); // no psql meta-commands
    expect(sql).not.toMatch(/\bcommit;/);
  });

  it("grants least privilege: every M3 RPC is service-role-only", () => {
    const revokes = [...sql.matchAll(/revoke execute on function public\.(\w+)/g)].map((m) => m[1]);
    expect(revokes.sort()).toEqual([...M3_FUNCTIONS].sort());
    expect([...sql.matchAll(/from public, anon, authenticated;/g)]).toHaveLength(8);

    const grants = [
      ...sql.matchAll(/grant\s+execute on function public\.(\w+)\([^)]*\)\s+to service_role;/g),
    ].map((m) => m[1]);
    expect(grants.sort()).toEqual([...M3_FUNCTIONS].sort());
    expect(sql).not.toMatch(/grant\s+execute on function public\.\w+\([^)]*\)\s+to (anon|authenticated|public);/);
  });

  it("keeps the design's constraints, foreign keys and indexes", () => {
    for (const constraint of [
      "orders_channel_check",
      "orders_status_check",
      "orders_fulfillment_type_check",
      "orders_online_check",
      "orders_pos_check",
      "orders_receipt_attempts_check",
      "orders_pickup_check",
      "orders_delivery_check",
      "orders_tracking_token_hash_key",
      "order_items_quantity_check",
      "order_items_unit_price_usd_check",
      "inventory_reservations_quantity_check",
      "inventory_reservations_status_check",
      "inventory_reservations_initial_expires_at_check",
      "inventory_reservations_expires_at_check",
      "cancellation_requests_status_check",
      "cancellation_requests_source_check",
      "cancellation_requests_pending_check",
      "cancellation_requests_resolved_check",
      "exchange_rates_rate_ves_per_usd_check",
      "exchange_rates_observed_at_key",
    ]) {
      expect(sql).toContain(constraint);
    }

    // Foreign keys per design §7.1/§7.2/§6.2/§9.1.
    expect(sql).toMatch(/references public\.delivery_zones \(id\) on delete restrict/);
    expect(sql).toMatch(/references public\.orders \(id\) on delete cascade/);
    expect(sql).toMatch(/references public\.products \(id\) on delete restrict/);
    expect(sql).toMatch(/references public\.inventory_batches \(id\) on delete restrict/);
    expect(sql).toMatch(/references public\.administrators \(id\) on delete restrict/);
    expect(sql).toMatch(/references public\.orders \(id\) on delete set null/); // movements.order_id

    for (const index of [
      "orders_status_created_at_idx",
      "orders_pending_idx",
      "orders_customer_phone_idx",
      "orders_delivery_zone_id_idx",
      "orders_created_at_idx",
      "order_items_order_id_idx",
      "order_items_product_id_idx",
      "inventory_reservations_order_id_idx",
      "inventory_reservations_active_batch_idx",
      "inventory_reservations_expiry_idx",
      "cancellation_requests_order_pending_key",
      "cancellation_requests_pending_idx",
      "cancellation_requests_order_id_idx",
      "cancellation_requests_resolved_by_idx",
      "inventory_movements_order_id_idx",
    ]) {
      expect(sql).toMatch(new RegExp(`create (?:unique )?index ${index}\\b`));
    }
    expect(sql).toContain(`where status = 'pending'`); // partial indexes (§7.1/§6.2/§9.1)
    expect(sql).toContain(`where status = 'active'`);
  });

  it("encodes the documented lifecycle: 20-minute deadlines, two receipts, hashed tokens", () => {
    expect([...sql.matchAll(/interval '20 minutes'/g)].length).toBeGreaterThanOrEqual(3);
    expect(sql).toContain(`interval '20 minutes'`); // materialised on every reservation row
    expect(sql).toMatch(/initial_expires_at = created_at \+ interval '20 minutes'/);
    // Correction window is 20 minutes, written once and never extended (OQ-14).
    expect(sql).toMatch(/coalesce\(r\.correction_window_ends_at, now\(\) \+ interval '20 minutes'\)/);
    // Quote-pending deliveries start held: no operative deadline while the
    // manual quote is being confirmed (OQ-13, confirmed for the quote case).
    expect(sql).toMatch(/case when v_requires_quote then null else v_now \+ interval '20 minutes' end/);
    // Two receipts total: the counter is domain-checked 0..2, incremented
    // atomically under that cap, and a repeated hold does not increment it.
    expect(sql).toMatch(/check \(receipt_attempts between 0 and 2\)/);
    expect(sql).toMatch(/set receipt_attempts = o\.receipt_attempts \+ 1/);
    expect(sql).toMatch(/o\.receipt_attempts < 2/);
    // Second rejection: cancel the order and release everything, no movement.
    expect(sql).toMatch(/set status = 'canceled'/);
    expect(sql).toMatch(/set status = 'released', closed_at = now\(\)/);
    // Rejection without a submitted receipt is an invalid transition.
    expect(sql).toMatch(/has no submitted receipt to reject/);
    // Tokens: 32 random bytes, only the SHA-256 digest is persisted.
    expect(sql).toContain(`extensions.gen_random_bytes(32)`);
    expect(sql).toContain(`encode(sha256(convert_to(`);
    expect(sql).not.toMatch(/tracking_token\s+text/); // no plaintext token column
    // Availability subtracts active, unexpired reservations (§6.2 rule).
    expect(sql).toMatch(/r\.expires_at is null or r\.expires_at > now\(\)/);
    // Global lock order everywhere multi-row locks are taken.
    expect(sql).toMatch(/order by b\.id\s+for update of b/);
  });

  it("does not seed any data", () => {
    expect(sql).not.toMatch(
      /insert into public\.(products|product_images|store_settings|delivery_zones|administrators|exchange_rates)/,
    );
    expect(raw).toMatch(/No seeds/); // checked against the source incl. comments
  });
});
