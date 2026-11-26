/**
 * OQ-8 — static contract of
 * `supabase/migrations/009_store_settings_schedule.sql`.
 *
 * Fast, environment-independent guards: additive shape of the existing
 * singleton, exact JSONB contract, pure validators with least-privilege
 * grants, and no order/payment/inventory coupling (schedules are informational).
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const migrationFile = path.join(migrationsDir, "009_store_settings_schedule.sql");

function stripComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("migration 009 contract (static)", () => {
  const raw = readFileSync(migrationFile, "utf8");
  const sql = stripComments(raw);

  it("is the ninth sequential migration and leaves 001-008 present", () => {
    expect(path.basename(migrationFile)).toBe("009_store_settings_schedule.sql");
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
    ]);
  });

  it("is additive: no table, column, seed, trigger, policy, RLS or grant change", () => {
    expect(sql).not.toMatch(/create\s+table\b/i);
    expect(sql).not.toMatch(/add\s+column\b/i);
    expect(sql).not.toMatch(/create\s+trigger\b/i);
    expect(sql).not.toMatch(/create\s+policy\b/i);
    expect(sql).not.toMatch(/alter\s+table[^\n]*(?:enable|force)\s+row\s+level\s+security/i);
    expect(sql).not.toMatch(/grant\s+(?:select|insert|update|delete|all)\s+on\s+(?:table|public\.)/i);
    expect(sql).not.toMatch(/\binsert\s+into\b/i);
    expect(sql).not.toMatch(/\bdrop\b/i);
    expect(sql).not.toMatch(/^\s*commit\b/im);
    expect(sql).not.toMatch(/\\(?:i|ir|echo|connect)\b/);
    expect(sql).toContain("add constraint store_settings_business_hours_check");
    expect(sql).not.toMatch(/alter\s+table public\.(?!store_settings\b)/i);
  });

  it("defines exactly two pure validators with pinned search_path", () => {
    const functions = [...sql.matchAll(/create or replace function\s+(?:public|private)\.(\w+)\s*\(/g)].map((m) => m[1]);
    expect(functions.sort()).toEqual(["valid_store_time", "validate_business_hours"]);
    expect(sql.match(/immutable/g)?.length).toBe(2);
    expect(sql.match(/set search_path = ''/g)?.length).toBe(2);
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).not.toMatch(/volatile/i);
    expect(sql).not.toMatch(/auth\.uid\s*\(/);
  });

  it("grants validator execution only to authenticated and service_role", () => {
    for (const signature of ["private.valid_store_time(text)", "private.validate_business_hours(jsonb)"]) {
      const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const block = sql.match(new RegExp(`revoke all on function ${escaped} from public, anon, authenticated;\\s*grant\\s+execute on function ${escaped} to authenticated, service_role;`, "i"));
      expect(block, signature).not.toBeNull();
    }
    expect(sql).not.toMatch(/grant\s+execute on function private\.(valid_store_time|validate_business_hours)[^;]*to\s+anon/i);
  });

  it("enforces the exact America/Caracas weekly contract", () => {
    expect(sql).toContain("'America/Caracas'");
    expect(sql).toContain("array['attention', 'pickup', 'timezone']");
    expect(sql).toContain("array['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']");
    expect(sql).toContain("array['end', 'start']");
    expect(sql).toContain("p_value ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'");
    expect(sql).toContain("is distinct from 'array'");
    expect(sql).toContain("is distinct from 'object'");
    expect(sql).toContain("(v_interval ->> 'start') >= (v_interval ->> 'end')");
    expect(sql).toContain("(v_interval ->> 'start') < v_prev_end");
    expect(sql).toContain("if p_hours is null then");
    expect(sql).toContain("return true;");
  });

  it("never seeds or invents an address, hour or business rule", () => {
    expect(sql).not.toMatch(/'0[0-9]:[0-9]{2}'|'1[0-9]:[0-9]{2}'/);
    expect(sql).not.toMatch(/'Calle|'Av\.|'Caracas'|'Maracaibo'/i);
    expect(raw).toContain("No address or opening hour is invented here");
    expect(raw).toContain("Orders are accepted 24/7");
    expect(raw).toContain("INFORMATIONAL ONLY");
    expect(raw).toMatch(/Overnight intervals\r?\n-- are not supported/);
  });

  it("does not couple schedules to orders, payments, inventory or reservations", () => {
    for (const table of ["orders", "payments", "inventory", "reservation"]) {
      expect(sql.toLowerCase(), table).not.toContain(`public.${table}`);
    }
    expect(sql).not.toMatch(/pg_cron|cron\.schedule|http_get|net\./i);
    expect(sql).not.toMatch(/subscription|publication/i);
  });
});
