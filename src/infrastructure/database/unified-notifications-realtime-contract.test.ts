/**
 * Static contract of local-only migration
 * `supabase/migrations/017_unified_notifications_realtime.sql`.
 *
 * The migration may only add `public.admin_notifications` to the Realtime
 * publication when safe; it must not alter replica identity, RLS, grants,
 * functions or triggers, or touch SLA behavior.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const migrationFile = path.join(migrationsDir, "017_unified_notifications_realtime.sql");

function stripComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("migration 017 contract (static)", () => {
  const raw = readFileSync(migrationFile, "utf8");
  const sql = stripComments(raw);

  it("is the 17th sequential migration and preserves 001-016", () => {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    expect(files[16]).toBe("017_unified_notifications_realtime.sql");
    expect(files).toContain("005_receipt_sla_notifications.sql");
    expect(files).toContain("016_general_admin_notifications.sql");
    expect(files.filter((f) => f.startsWith("017_"))).toEqual([
      "017_unified_notifications_realtime.sql",
    ]);
  });

  it("guards publication existence and catalog membership before adding the table", () => {
    expect(sql).toContain("publication_name constant text := 'supabase_realtime'");
    expect(sql).toContain("target_table constant regclass := 'public.admin_notifications'::regclass");
    expect(sql).toContain("from pg_publication where pubname = publication_name");
    expect(sql).toContain("join pg_publication_rel pr on pr.prpubid = p.oid");
    expect(sql).toContain("c.relname = 'admin_notifications'");
    expect(sql).toContain("if not is_member then");
    expect(sql).toContain("alter publication %I add table %s");
    expect(sql).not.toContain("if is_member then");
  });

  it("never changes replica identity or any authorization/business object", () => {
    expect(sql).not.toMatch(/replica\s+identity\s+full/i);
    expect(sql).not.toMatch(/replica\s+identity/i);
    expect(sql).not.toMatch(/\balter\s+table\b/i);
    expect(sql).not.toMatch(/\b(create|replace|drop)\s+(or\s+replace\s+)?(policy|function|trigger)\b/i);
    expect(sql).not.toMatch(/\b(grant|revoke)\b/i);
    expect(sql).not.toMatch(/process_sla_notifications/);
    expect(sql).not.toMatch(/\b(insert|update|delete)\s+into\s+public\./i);
    expect(sql).not.toMatch(/\binterval\b/i);
  });

  it("is explicitly local-only with no seed or remote operation", () => {
    expect(raw).toContain("local-only");
    expect(sql).not.toMatch(/insert\s+into/i);
    expect(sql).not.toMatch(/\bsupabase db push\b/i);
  });
});
