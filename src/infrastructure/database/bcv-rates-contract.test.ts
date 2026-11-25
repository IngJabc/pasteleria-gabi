/**
 * OQ-4/OQ-5 — static contract of
 * `supabase/migrations/007_bcv_rates_and_rounding.sql`.
 *
 * Fast, environment-independent guards for the additive rate history, the
 * single rounding rule, service-role-only mutations, manual-only ingestion,
 * the absence of cross-currency arithmetic and the unchanged earlier phases.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const migrationFile = path.join(migrationsDir, "007_bcv_rates_and_rounding.sql");

function stripComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("migration 007 contract (static)", () => {
  const raw = readFileSync(migrationFile, "utf8");
  const sql = stripComments(raw);

  it("is the seventh sequential migration and leaves 001-006 present", () => {
    expect(path.basename(migrationFile)).toBe("007_bcv_rates_and_rounding.sql");
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
      "015_bcv_sync_attempts.sql",
    ]);
  });

  it("is additive: no new tables, no seed inserts and no earlier migration edits", () => {
    expect([...sql.matchAll(/create table (?:public\.)?\w+/g)]).toHaveLength(0);
    // The only rate INSERT is the runtime body of register_bcv_rate, not a seed.
    expect([...sql.matchAll(/insert\s+into\s+(?:public\.)?exchange_rates\b/gi)]).toHaveLength(1);
    expect([...sql.matchAll(/insert\s+into\s+(?:public\.)?orders\b/gi)]).toHaveLength(0);
    expect(sql).not.toMatch(/\bdrop\s+(?:table|column|constraint|policy)\b/i);
    expect(sql).not.toMatch(/^\s*commit\b/im);
    expect(sql).not.toMatch(/\\(?:i|ir|echo|connect)\b/);
    expect(raw).toContain("-- No seeds:");
  });

  it("adds exactly the documented rate columns, constraints and index", () => {
    const added = [...sql.matchAll(/add column\s+(\w+)/g)].map((m) => m[1]);
    expect(added.sort()).toEqual([
      "idempotency_key",
      "is_active",
      "note",
      "registered_by",
      "supersedes_id",
    ]);
    for (const name of [
      "exchange_rates_source_check",
      "exchange_rates_note_check",
      "exchange_rates_idempotency_key_key",
      "orders_rounding_rule_check",
      "exchange_rates_active_lookup_idx",
    ]) {
      expect(sql, name).toContain(name);
    }
    expect(sql).toContain("'round_half_up'");
    expect(sql).not.toMatch(/rounding_rule\s*=\s*'(?!round_half_up)/);
  });

  it("defines exactly the documented functions, all invoker with pinned search_path", () => {
    const functions = [...sql.matchAll(/create or replace function\s+(?:public|private)\.(\w+)\s*\(/g)].map((m) => m[1]);
    expect(functions.sort()).toEqual([
      "apply_bcv_rate_for_tracking",
      "apply_bcv_rate_to_order",
      "create_online_order_with_bcv",
      "deactivate_bcv_rate",
      "enforce_bcv_snapshot_immutability",
      "get_bcv_rate",
      "get_last_ves_per_usd",
      "register_bcv_rate",
      "require_ves_payment_snapshot",
      "snapshot_bcv_rate",
    ]);
    expect(sql.match(/security invoker/g)?.length).toBe(10);
    expect(sql.match(/set search_path = ''/g)?.length).toBe(10);
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).not.toMatch(/auth\.uid\s*\(/);
  });

  it("grants mutations only to service_role and keeps rate reads public", () => {
    for (const name of [
      "get_last_ves_per_usd",
      "register_bcv_rate",
      "deactivate_bcv_rate",
      "snapshot_bcv_rate",
      "apply_bcv_rate_for_tracking",
      "apply_bcv_rate_to_order",
      "create_online_order_with_bcv",
    ]) {
      const block = sql.match(new RegExp(`revoke execute on function (?:public|private)\\.${name}\\([^;]+;\\s*grant\\s+execute on function (?:public|private)\\.${name}\\([^;]+;`, "i"));
      expect(block, `${name} grant block`).not.toBeNull();
      expect(block?.[0]).toContain("from public, anon, authenticated");
      expect(block?.[0]).toContain("to service_role");
    }
    // Trigger backstops are never directly executable by clients.
    expect(sql).toMatch(/revoke execute on function private\.require_ves_payment_snapshot\(\) from public, anon, authenticated;/);
    expect(sql).toMatch(/revoke execute on function private\.enforce_bcv_snapshot_immutability\(\) from public, anon, authenticated;/);
    expect(sql).not.toMatch(/grant\s+execute on function private\.(require_ves_payment_snapshot|enforce_bcv_snapshot_immutability)/);
    expect(sql).toMatch(/grant\s+execute on function public\.get_bcv_rate\(timestamptz\)\s+to anon, authenticated, service_role;/);
  });

  it("audits administrative actions but never guest checkouts", () => {
    expect(sql).toContain("'exchange_rate.register'");
    expect(sql).toContain("'exchange_rate.deactivate'");
    expect(sql).toContain("'order.apply_bcv_rate'");
    expect(sql).toContain("if p_admin_id is not null then");
    expect(raw).toContain("a guest checkout is not one");
  });

  it("never invents a rate, sums currencies, or fulfills orders through 007", () => {
    expect(sql).toContain("no active BCV rate is available");
    expect(sql).toContain("v_rate is null");
    expect(sql).not.toMatch(/\bsum\s*\(\s*pay\./i);
    expect(sql).not.toMatch(/'confirmed'|'ready'/);
    expect(sql).not.toMatch(/https?:\/\/|http_get|net\.|pg_cron|cron\.schedule|schedule\s*\(/i);
    expect(raw).toContain("Automatic BCV ingestion is NOT implemented or assumed");
  });

  it("rounds once on the final VES total from the exact stored USD total", () => {
    expect(sql).toContain("pg_catalog.round(v_order.total_usd * v_rate, 2)");
    expect(sql).not.toMatch(/unit_price_usd\s*\*/);
    expect(sql).not.toMatch(/quantity\s*\*/);
    expect(sql).toContain("bcv_rate_at  = v_rate_at");
    expect(sql).toContain("if v_order.bcv_rate_ves is not null then");
  });

  it("creates orders atomically through the unchanged create_online_order logic", () => {
    expect(sql).toContain("create or replace function public.create_online_order_with_bcv(");
    expect(sql).toContain("v_result := public.create_online_order(");
    expect(sql).toContain("for update");
    expect(sql).toContain("v_rate is null then");
    expect(sql).toContain("'bcv_applied', false");
    expect(sql).toContain("'bcv_applied', true");
    // No client-supplied rate or timestamp in the canonical signature.
    const signature = sql.match(/create or replace function public\.create_online_order_with_bcv\(([^)]*)\)/)?.[1] ?? "";
    expect(signature).not.toMatch(/rate|observed|timestamp/i);
    expect(signature).toContain("p_items");
  });

  it("enforces pago_movil snapshots and snapshot immutability at the database level", () => {
    expect(sql).toContain("create trigger payments_require_ves_snapshot");
    expect(sql).toContain("before insert on public.payments");
    expect(sql).toContain("pago_movil requires a BCV snapshot and VES total");
    expect(sql).toContain("new.currency = 'VES'");
    expect(sql).toContain("create trigger orders_bcv_snapshot_immutable");
    expect(sql).toContain("before update on public.orders");
    expect(sql).toContain("BCV snapshot is immutable and cannot be overwritten");
    expect(raw).toContain("Stale-rate threshold remains an UNRESOLVED business decision");
  });
});
