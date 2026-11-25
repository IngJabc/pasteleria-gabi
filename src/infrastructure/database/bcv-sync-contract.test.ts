import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const migrationFile = path.join(migrationsDir, "015_bcv_sync_attempts.sql");

function stripComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("migration 015 contract (static)", () => {
  const raw = readFileSync(migrationFile, "utf8");
  const sql = stripComments(raw);

  it("is the 15th sequential migration and leaves prior migrations present", () => {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    expect(files[14]).toBe("015_bcv_sync_attempts.sql");
    expect(files).toContain("001_catalog_and_admin_foundation.sql");
    expect(files).toContain("014_product_reviews.sql");
    expect(files.filter((f) => f.startsWith("015_"))).toEqual(["015_bcv_sync_attempts.sql"]);
  });

  it("creates bcv_sync_attempts additively with RLS, constraints, and indexes", () => {
    expect(sql).toContain("create table public.bcv_sync_attempts");
    expect(sql).toContain("bcv_sync_attempts_idempotency_key_key unique (idempotency_key)");
    expect(sql).toContain("bcv_sync_attempts_status_check");
    expect(sql).toContain("check (status in ('success', 'failure', 'skipped', 'manual_overridden'))");
    expect(sql).toContain("bcv_sync_attempts_success_fields_check");
    expect(sql).toContain("bcv_sync_attempts_failure_fields_check");
    expect(sql).toContain("create index bcv_sync_attempts_attempted_at_idx");
    expect(sql).toContain("alter table public.bcv_sync_attempts enable row level security");
    expect(sql).toContain("alter table public.bcv_sync_attempts force row level security");
    expect(sql).not.toMatch(/create table (?!public\.bcv_sync_attempts)/);
  });

  it("keeps sync attempts service-role writable and admin-readable only", () => {
    expect(sql).toContain("create policy bcv_sync_attempts_admin_select");
    expect(sql).toContain("using ((select private.is_admin()))");
    expect(sql).toContain("revoke all on table public.bcv_sync_attempts from public, anon, authenticated");
    expect(sql).toContain("grant select on table public.bcv_sync_attempts to authenticated");
    expect(sql).toContain("grant select, insert on table public.bcv_sync_attempts to service_role");
    expect(sql).not.toContain("grant insert on table public.bcv_sync_attempts to authenticated");
    const attemptsBlock = sql.split("create table public.bcv_sync_attempts")[1]?.split("create or replace function")[0] ?? "";
    expect(attemptsBlock).not.toMatch(/create policy[\s\S]*for insert/);
    expect(attemptsBlock).not.toMatch(/create policy[\s\S]*for update/);
    expect(attemptsBlock).not.toMatch(/create policy[\s\S]*for delete/);
  });

  it("narrows automatic register_bcv_rate path without weakening manual admin auth", () => {
    expect(sql).toContain("create or replace function public.register_bcv_rate");
    expect(sql).toContain("if p_admin_id is null then");
    expect(sql).toContain("if current_user <> 'service_role' then");
    expect(sql).toContain("perform private.require_active_admin(p_admin_id);");
    expect(sql).toContain("v_source not like 'automatic:%'");
    expect(sql).toContain("automatic registration cannot supersede rates");
    expect(sql).toContain("if p_supersedes_id is not null then");
    expect(sql).toContain("revoke execute on function public.register_bcv_rate");
    expect(sql).toContain("grant execute on function public.register_bcv_rate");
    expect(sql).toContain("to service_role");
    // manual path still checks active admin when admin id provided
    expect(sql).toMatch(/else\s+perform private\.require_active_admin\(p_admin_id\);/);
  });

  it("does not touch migration 007 objects or create public write surfaces", () => {
    expect(raw).not.toContain("drop table public.exchange_rates");
    expect(raw).not.toContain("alter table public.exchange_rates");
    expect(raw).not.toContain("create policy exchange_rates");
    expect(sql).not.toContain("grant execute on function public.register_bcv_rate(numeric, text, uuid, timestamptz, bigint, text, text)\n  to anon");
    expect(sql).not.toContain("grant execute on function public.register_bcv_rate(numeric, text, uuid, timestamptz, bigint, text, text)\n  to authenticated");
  });
});
