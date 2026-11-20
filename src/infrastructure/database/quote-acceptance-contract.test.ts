/**
 * OQ-17 — static contract of `supabase/migrations/004_quote_acceptance.sql`.
 *
 * Fast, environment-independent assertions over the migration source: exact
 * scope (no OQ-16/payment leakage), the two new columns, the four-case
 * expires_at invariant, the immutable historical deadline, the atomic RPC with
 * its audit row, token-only customer authorization and least privilege.
 * The behavioral companion is `quote-acceptance-migration.test.ts`.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const migrationFile = path.join(migrationsDir, "004_quote_acceptance.sql");

function stripComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("migration 004 contract (static)", () => {
  const raw = readFileSync(migrationFile, "utf8");
  const sql = stripComments(raw);

  it("follows the sequential migration naming convention and leaves 001-003 present", () => {
    expect(path.basename(migrationFile)).toBe("004_quote_acceptance.sql");
    expect(/^\d{3}_[a-z0-9_]+\.sql$/.test(path.basename(migrationFile))).toBe(true);

    const migrations = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    expect(migrations).toEqual([
      "001_catalog_and_admin_foundation.sql",
      "002_inventory_foundation.sql",
      "003_orders_and_reservations.sql",
      "004_quote_acceptance.sql",
    ]);
  });

  it("adds exactly the two documented nullable columns and no new tables", () => {
    expect([...sql.matchAll(/create table (?:public\.)?\w+/g)]).toHaveLength(0);
    const added = [...sql.matchAll(/alter table public\.(\w+)\s+add column (\w+)/g)].map(
      (m) => `${m[1]}.${m[2]}`,
    );
    expect(added.sort()).toEqual([
      "inventory_reservations.quote_acceptance_expires_at",
      "orders.quote_accepted_at",
    ]);
    expect(sql).toMatch(/alter table public\.orders\s+add column quote_accepted_at timestamptz null;/);
    expect(sql).toMatch(
      /alter table public\.inventory_reservations\s+add column quote_acceptance_expires_at timestamptz null;/,
    );
    expect(sql).not.toMatch(/drop column|rename column|alter column .* type/);
  });

  it("never rewrites initial_expires_at and adapts expires_at to four cases", () => {
    expect(sql).toMatch(
      /drop constraint inventory_reservations_expires_at_check,\s+add constraint inventory_reservations_expires_at_check/,
    );
    expect(sql).toMatch(/expires_at is null/); // held
    expect(sql).toMatch(/when correction_window_ends_at is not null/);
    expect(sql).toMatch(/then expires_at = correction_window_ends_at/);
    expect(sql).toMatch(/when quote_acceptance_expires_at is not null/);
    expect(sql).toMatch(/then expires_at = quote_acceptance_expires_at/);
    expect(sql).toMatch(/else expires_at = initial_expires_at/);
    // The historical 20-minute creation-time rule is untouched, and no UPDATE
    // in the migration assigns to the immutable column.
    expect(sql).not.toMatch(/initial_expires_at\s*=\s*(now|quote_accepted_at)/i);
    expect(sql).not.toMatch(/drop constraint inventory_reservations_initial_expires_at_check/);
    expect(sql).toMatch(/interval '20 minutes'/);
    expect([...new Set([...sql.matchAll(/interval '([^']+)'/g)].map((m) => m[1]))]).toEqual([
      "20 minutes",
    ]);
  });

  it("keeps the acceptance clock independent of OQ-16 and the correction window", () => {
    expect(raw).toMatch(/OQ-16/); // documented as explicitly out of scope
    expect(sql).not.toMatch(/notification|scheduler|cron|24 hours|24 horas/);
    expect(sql).not.toMatch(/payments?_receipts?|payment_refunds/);
    expect(sql).not.toMatch(/correction_window_ends_at =/); // never written here
    const acceptBody = sql.match(/create or replace function public\.accept_quote_fee\([\s\S]*?\n\$\$;/)?.[0] ?? "";
    expect(acceptBody).not.toMatch(/receipt_attempts\s*=/); // only read for validation
    expect(sql).toMatch(/quote_acceptance_expires_at > created_at/); // value domain
  });

  it("defines the two service-role RPCs and keeps the tracking projection", () => {
    const created = [...sql.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]);
    expect(created.sort()).toEqual([
      "accept_quote_fee",
      "accept_quote_fee_for_tracking",
      "get_order_for_tracking",
    ]);
    expect([...sql.matchAll(/security invoker/g)]).toHaveLength(3);
    expect([...sql.matchAll(/set search_path = ''/g)]).toHaveLength(3);
    expect(sql).not.toMatch(/security\s+definer/i);
    expect(sql).toMatch(/create or replace function public\.accept_quote_fee\(p_order_id bigint\)/);
    expect(sql).toMatch(
      /create or replace function public\.accept_quote_fee_for_tracking\(p_token text\)/,
    );
  });

  it("authorizes customers only by the hashed private tracking token", () => {
    expect(sql).toMatch(
      /o\.tracking_token_hash = encode\(sha256\(convert_to\(p_token, 'UTF8'\)\), 'hex'\)/,
    );
    expect(sql).toMatch(/accept_quote_fee_for_tracking: no order matches the tracking token/);
    expect(sql).not.toMatch(/p_order_id\s+bigint[^\n]*p_token/); // no implicit id authorization
    expect(sql).not.toMatch(/grant\s+execute[^\n]*to (anon|authenticated|public);/i);
    expect(sql).not.toMatch(/create policy/);
    expect(sql).not.toMatch(/for\s+update[\s\S]{0,50}to anon/i);
  });

  it("uses the global reservations -> orders lock order and raises state errors", () => {
    const lockBlock = sql.match(/from \(\s*select r\.status[\s\S]*?\) locked;/)?.[0] ?? "";
    expect(lockBlock).toMatch(/order by r\.id/);
    expect(lockBlock).toMatch(/for update/);
    expect(sql.indexOf(") locked;")).toBeLessThan(sql.indexOf("where o.id = p_order_id\n  for update"));
    for (const message of [
      "order id is required",
      "does not exist",
      "is not pending",
      "already has a submitted receipt",
      "does not require a quote",
      "no confirmed delivery quote",
      "no active reservations",
      "running deadline",
      "no longer awaiting quote acceptance",
    ]) {
      expect(sql).toContain(message);
    }
  });

  it("writes the audit row in the same transaction, with no token or PII", () => {
    const functionBody = sql.match(/create or replace function public\.accept_quote_fee\([\s\S]*?\n\$\$;/)?.[0] ?? "";
    expect(functionBody).toMatch(
      /insert into public\.audit_log \(admin_id, action, entity_type, entity_id, data\)/,
    );
    expect(functionBody).toMatch(/'order\.quote_accept'/);
    expect(functionBody).toMatch(/'order',\s*p_order_id::text/);
    expect(functionBody).toMatch(/'source', 'tracking'/);
    expect(functionBody).toMatch(/quote_accepted_at', v_now/);
    expect(functionBody).toMatch(/quote_acceptance_expires_at', v_deadline/);
    expect(functionBody).toMatch(/'reservations_updated', v_updated/);
    expect(functionBody).not.toMatch(/p_token/);
    expect(functionBody).not.toMatch(/customer_name|customer_phone|address/);
    expect(sql).not.toMatch(/\bcommit\b|\brollback\b/i);
  });

  it("returns the original values on replay and never updates closed rows", () => {
    expect(sql).toMatch(/if v_accepted_at is not null then/);
    expect(sql).toMatch(/'idempotent', true/);
    expect(sql).toMatch(/'idempotent', false/);
    expect(sql).toMatch(/r\.status = 'active'/);
    expect(sql).not.toMatch(/status = 'released'[\s\S]*quote_acceptance_expires_at/);
    expect(sql).not.toMatch(/status = 'expired'[\s\S]*quote_acceptance_expires_at/);
  });

  it("grants execution to service_role only and keeps tracking PII-free", () => {
    const revokes = [...sql.matchAll(/revoke execute on function public\.(\w+)/g)].map((m) => m[1]);
    expect(revokes.sort()).toEqual([
      "accept_quote_fee",
      "accept_quote_fee_for_tracking",
      "get_order_for_tracking",
    ]);
    expect([...sql.matchAll(/from public, anon, authenticated;/g)]).toHaveLength(3);
    expect([...sql.matchAll(/to service_role;/g)]).toHaveLength(3);

    for (const field of [
      "quote_accepted_at",
      "quote_acceptance_expires_at",
      "quote_acceptance_available",
    ]) {
      expect(sql).toContain(`'${field}'`);
    }
    for (const pii of ["customer_name", "customer_phone", "address_line", "tracking_token_hash"]) {
      expect(sql).not.toContain(`'${pii}'`);
    }
  });

  it("does not seed data or add OQ-16 notification infrastructure", () => {
    expect(sql).not.toMatch(
      /insert into public\.(products|product_images|store_settings|delivery_zones|administrators|orders|exchange_rates)/,
    );
    // The only INSERT is the RPC's own append-only audit record, not a seed.
    expect([...sql.matchAll(/insert into public\.(\w+)/g)].map((m) => m[1])).toEqual(["audit_log"]);
    expect(sql).not.toMatch(/insert into auth\./);
    expect(raw).toMatch(/No seeds/);
  });
});
