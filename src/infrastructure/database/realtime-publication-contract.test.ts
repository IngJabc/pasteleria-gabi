/**
 * M6 — static contract of `supabase/migrations/008_realtime_publication.sql`.
 *
 * Fast, environment-independent guards: the migration is the eighth sequential
 * file, only adds the three approved tables to the managed realtime publication,
 * is repeatable, and does not touch RLS, grants, replica identity, existing
 * objects or earlier migrations.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const migrationFile = path.join(migrationsDir, "008_realtime_publication.sql");

function stripComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("migration 008 contract (static)", () => {
  const raw = readFileSync(migrationFile, "utf8");
  const sql = stripComments(raw);

  it("is the eighth sequential migration and leaves 001-007 present", () => {
    expect(path.basename(migrationFile)).toBe("008_realtime_publication.sql");
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
      "016_general_admin_notifications.sql",
      "017_unified_notifications_realtime.sql",
      "018_formalized_order_notifications.sql",
    ]);
  });

  it("is additive: no schema object, policy, grant, function, trigger or seed", () => {
    expect(sql).not.toMatch(/create\s+table\b/i);
    expect(sql).not.toMatch(/add\s+column\b/i);
    expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?(function|trigger|policy|view)\b/i);
    expect(sql).not.toMatch(/\b(grant|revoke)\b/i);
    expect(sql).not.toMatch(/alter\s+table\b/i);
    expect(sql).not.toMatch(/insert\s+into\b/i);
    expect(sql).not.toMatch(/\bdrop\b/i);
    expect(sql).not.toMatch(/^\s*commit\b/im);
    expect(sql).not.toMatch(/\\(?:i|ir|echo|connect)\b/);
    expect(raw).toContain("This file is local-only");
  });

  it("publishes exactly the three approved tables through the managed publication", () => {
    expect(sql).toContain("supabase_realtime");
    expect(sql).toContain("array['orders', 'payments', 'cancellation_requests']");
    expect(sql).toContain("alter publication supabase_realtime add table public.%I");
    expect((sql.match(/alter\s+publication\b/gi) ?? []).length).toBe(1);
    for (const table of [
      "order_items",
      "products",
      "exchange_rates",
      "inventory_reservations",
      "payment_refunds",
      "admin_notifications",
      "audit_log",
    ]) {
      expect(sql, table).not.toContain(`'${table}'`);
    }
  });

  it("is repeatable: guarded publication creation and catalog-based membership check", () => {
    expect((sql.match(/if\s+not\s+exists\s*\(/gi) ?? []).length).toBe(2);
    expect(sql).toContain("create publication supabase_realtime");
    for (const catalog of [
      "pg_catalog.pg_publication",
      "pg_catalog.pg_publication_rel",
      "pg_catalog.pg_class",
      "pg_catalog.pg_namespace",
      "pg_catalog.format",
    ]) {
      expect(sql, catalog).toContain(catalog);
    }
    expect(sql).toContain("foreach t in array");
    expect(sql).toContain("pr.prpubid = p.oid");
    expect(sql).toContain("n.nspname = 'public'");
  });

  it("does not change publication options or replica identity", () => {
    expect(sql).not.toMatch(/replica\s+identity/i);
    expect(sql).not.toMatch(/alter\s+publication[\s\S]*?\bset\s*\(/i);
    expect(sql).not.toMatch(/\bpublish\s*=/i);
    expect(raw).toContain("REPLICA IDENTITY");
    expect(raw).toContain("FULL would publish every old column");
  });

  it("does not weaken or replace the existing access boundary", () => {
    expect(sql).not.toMatch(/row\s+level\s+security/i);
    expect(sql).not.toMatch(/security\s+(definer|invoker)/i);
    expect(sql).not.toMatch(/auth\.uid\s*\(/);
    expect(sql).not.toMatch(/\b(anon|authenticated|service_role)\b/i);
    expect(raw).toContain("No policy is weakened to make a");
  });
});
