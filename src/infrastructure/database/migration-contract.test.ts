/**
 * M2 — static contract of `supabase/migrations/002_inventory_foundation.sql`.
 *
 * Fast, environment-independent assertions over the migration source: exact
 * scope (no M3 objects, no reservation timing), RLS/policy/grant shape, named
 * constraints and indexes, and migration ordering. The behavioral companion is
 * `inventory-migration.test.ts`.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const migrationFile = path.join(migrationsDir, "002_inventory_foundation.sql");

function stripComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("migration 002 contract (static)", () => {
  const raw = readFileSync(migrationFile, "utf8");
  const sql = stripComments(raw);

  it("follows the sequential migration naming convention", () => {
    expect(path.basename(migrationFile)).toBe("002_inventory_foundation.sql");
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
      "010_delivery_quote_admin.sql",
      "011_quote_pending_payment_guard.sql",
      "012_delivery_quote_post_acceptance_guard.sql",
      "013_quote_guard_helpers_grants.sql",
      "014_product_reviews.sql",
      "015_bcv_sync_attempts.sql",
      "016_general_admin_notifications.sql",
      "017_unified_notifications_realtime.sql",
    ]);
  });

  it("creates exactly the two M2 tables", () => {
    const tables = [...sql.matchAll(/create table (?:public\.)?(\w+)/g)].map((m) => m[1]);
    expect(tables.sort()).toEqual(["inventory_batches", "inventory_movements"]);
  });

  it("leaves every M3 concern out (reservations, orders, timing, checkout)", () => {
    expect(sql).not.toMatch(/inventory_reservations/);
    expect(sql).not.toMatch(/\border_id\b/);
    expect(sql).not.toMatch(/create_online_order/);
    expect(sql).not.toMatch(/tracking/);
    expect(sql).not.toMatch(/expires_at/);
    expect(sql).not.toMatch(/interval\s+'(15|20)/);
    expect(sql).not.toMatch(/payments?_receipts?/);
  });

  it("enables and forces RLS on both tables", () => {
    expect([...sql.matchAll(/enable row level security/g)]).toHaveLength(2);
    expect([...sql.matchAll(/force row level security/g)]).toHaveLength(2);
  });

  it("defines exactly the SECURITY_DESIGN §4.1 inventory policies and no anon access", () => {
    const policies = [...sql.matchAll(/create policy (\w+) on public\.(\w+)/g)].map(
      (m) => `${m[2]}.${m[1]}`,
    );
    expect(policies.sort()).toEqual([
      "inventory_batches.inventory_batches_admin_all",
      "inventory_movements.inventory_movements_insert",
      "inventory_movements.inventory_movements_select",
    ]);
    expect(sql).not.toMatch(/\bto anon\b/);
    expect(sql).not.toMatch(/using \(true\)/);
  });

  it("uses invoker-based RPCs with a pinned search_path (no definer rights)", () => {
    const functions = sql.match(/create or replace function public\.\w+/g) ?? [];
    expect(functions).toHaveLength(3);
    expect(sql).not.toMatch(/security\s+definer/i);
    expect([...sql.matchAll(/set search_path = ''/g)]).toHaveLength(3);
    expect(sql).toMatch(/for update;/); // row lock: concurrent adjustments serialise
  });

  it("grants least privilege on the RPC surface", () => {
    expect(sql).toMatch(
      /revoke execute on function public\.create_inventory_batch\(bigint, integer, date\)\s+from public, anon, service_role;/,
    );
    expect(sql).toMatch(
      /grant\s+execute on function public\.create_inventory_batch\(bigint, integer, date\)\s+to authenticated;/,
    );
    expect(sql).toMatch(
      /revoke execute on function public\.adjust_inventory\(bigint, integer, text\)\s+from public, anon, service_role;/,
    );
    expect(sql).toMatch(
      /grant\s+execute on function public\.adjust_inventory\(bigint, integer, text\)\s+to authenticated;/,
    );
    expect(sql).toMatch(
      /revoke execute on function public\.get_product_stock\(bigint\)\s+from public, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /grant\s+execute on function public\.get_product_stock\(bigint\)\s+to service_role;/,
    );
  });

  it("keeps the design's constraints, foreign keys and indexes", () => {
    for (const constraint of [
      "inventory_batches_initial_quantity_check",
      "inventory_batches_remaining_quantity_check",
      "inventory_movements_type_check",
      "inventory_movements_quantity_check",
      "inventory_movements_entry_quantity_check",
      "inventory_movements_adjustment_reason_check",
    ]) {
      expect(sql).toContain(constraint);
    }

    expect(sql).toMatch(/references public\.products \(id\) on delete restrict/);
    expect(sql).toMatch(/references public\.administrators \(id\) on delete restrict/);
    expect(sql).toMatch(/references public\.administrators \(id\) on delete set null/);

    for (const index of [
      "inventory_batches_product_fifo_idx",
      "inventory_batches_available_idx",
      "inventory_movements_batch_id_idx",
      "inventory_movements_created_at_idx",
    ]) {
      expect(sql).toContain(`create index ${index}`);
    }
    expect(sql).toMatch(/where remaining_quantity > 0/);
  });

  it("writes append-only audit records from the RPCs", () => {
    expect(sql).toContain("'inventory.batch_create'");
    expect(sql).toContain("'inventory.adjust'");
  });

  it("does not alter M1 objects or seed any data", () => {
    expect(sql).not.toMatch(
      /alter table public\.(products|product_images|store_settings|delivery_zones|administrators|audit_log)/,
    );
    expect(sql).not.toMatch(
      /insert into public\.(products|product_images|store_settings|delivery_zones|administrators)/,
    );
    expect(raw).toMatch(/No seeds/); // checked against the source incl. comments
  });
});
