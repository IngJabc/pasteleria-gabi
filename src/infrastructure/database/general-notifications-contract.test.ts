/**
 * P6 — static contract of `supabase/migrations/016_general_admin_notifications.sql`.
 *
 * Guards the dedicated notification table, its active-admin fan-out, the four
 * deterministic event keys, the evidence-link receipt trigger and the Realtime
 * publication boundary without requiring a database. It also asserts that the
 * legacy SLA inbox and external delivery surfaces are untouched.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const migrationFile = path.join(migrationsDir, "016_general_admin_notifications.sql");

function stripComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("migration 016 contract (static)", () => {
  const raw = readFileSync(migrationFile, "utf8");
  const sql = stripComments(raw);

  it("is the 16th sequential migration and preserves 001-015", () => {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    expect(files[15]).toBe("016_general_admin_notifications.sql");
    expect(files[16]).toBe("017_unified_notifications_realtime.sql");
    expect(files).toContain("001_catalog_and_admin_foundation.sql");
    expect(files).toContain("005_receipt_sla_notifications.sql");
    expect(files).toContain("015_bcv_sync_attempts.sql");
    expect(files.filter((f) => f.startsWith("016_"))).toEqual([
      "016_general_admin_notifications.sql",
    ]);
  });

  it("creates only the dedicated table with the required columns and FKs", () => {
    expect([...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1])).toEqual([
      "admin_general_notifications",
    ]);
    expect(sql).toMatch(
      /id\s+bigint generated always as identity primary key[\s\S]*?event_type\s+text not null[\s\S]*?event_key\s+text not null/,
    );
    expect(sql).toContain("admin_id              uuid not null");
    expect(sql).toMatch(/references public\.administrators \(id\) on delete cascade/);
    expect(sql).toMatch(/order_id\s+bigint null\s+references public\.orders \(id\) on delete cascade/);
    expect(sql).toMatch(
      /receipt_submission_id bigint null\s+references public\.receipt_submissions \(id\) on delete cascade/,
    );
    expect(sql).toMatch(
      /payment_id\s+bigint null\s+references public\.payments \(id\) on delete restrict/,
    );
    expect(sql).toMatch(/review_id\s+bigint null\s+references public\.product_reviews \(id\) on delete cascade/);
    expect(sql).toMatch(/product_id\s+bigint null\s+references public\.products \(id\) on delete restrict/);
    expect(sql).toContain("created_at            timestamptz not null default now()");
    expect(sql).toContain("read_at               timestamptz null");
  });

  it("declares every constraint, key shape and supporting index", () => {
    expect(sql).toContain(
      "check (event_type in ('new_order', 'payment_receipt', 'receipt_correction', 'product_review'))",
    );
    expect(sql).toContain("'new_order:' || order_id::text");
    expect(sql).toContain("'payment_receipt:' || receipt_submission_id::text");
    expect(sql).toContain("'receipt_correction:' || receipt_submission_id::text");
    expect(sql).toContain("'product_review:' || review_id::text");
    expect(sql).not.toContain("'order:' ||");
    expect(sql).not.toContain("'receipt:' ||");
    expect(sql).not.toContain("'review:' ||");
    expect(sql).toContain("check (read_at is null or read_at >= created_at)");
    expect(sql).toContain("unique (event_key, admin_id)");
    expect(sql).toMatch(
      /event_type in \('payment_receipt', 'receipt_correction'\)[\s\S]*?payment_id is not null[\s\S]*?review_id is null/,
    );
    expect(sql).toMatch(/event_type = 'new_order'[\s\S]*?payment_id is null/);
    expect(sql).toMatch(/event_type = 'product_review'[\s\S]*?payment_id is null/);
    expect(sql).toContain(
      "on public.admin_general_notifications (admin_id, created_at desc, id desc)",
    );
    expect(sql).toContain("where read_at is null");
  });

  it("enables forced RLS with own-row admin policies and narrow grants", () => {
    expect(sql).toContain("alter table public.admin_general_notifications enable row level security");
    expect(sql).toContain("alter table public.admin_general_notifications force row level security");
    expect(sql).toContain("create policy admin_general_notifications_admin_select");
    expect(sql).toContain("create policy admin_general_notifications_admin_update_own");
    expect(sql).toContain(
      "using (admin_id = (select auth.uid()) and (select private.is_admin()))",
    );
    expect(sql).toContain("with check (admin_id = (select auth.uid()) and (select private.is_admin()))");
    expect(sql).toContain(
      "revoke all on table public.admin_general_notifications from public, anon, authenticated",
    );
    expect(sql).toContain("grant select on table public.admin_general_notifications to authenticated");
    expect(sql).toContain("grant update (read_at) on table public.admin_general_notifications to authenticated");
    expect(sql).toContain("grant all on table public.admin_general_notifications to service_role");
    expect(sql).not.toContain("grant insert on table public.admin_general_notifications to authenticated");
    expect(sql).not.toContain("grant delete on table public.admin_general_notifications to authenticated");
  });

  it("keeps history immutable and grants only read_at changes to admins", () => {
    expect(sql).toContain(
      "create or replace function private.enforce_admin_general_notification_immutability()",
    );
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("new.payment_id is distinct from old.payment_id");
    expect(sql).toContain("new.read_at < old.created_at");
    expect(sql).toContain("create trigger admin_general_notifications_immutable");
    expect(sql).toContain("before update on public.admin_general_notifications");
    expect(sql).toContain(
      "revoke all on function private.enforce_admin_general_notification_immutability()",
    );
  });

  it("fans out active admins through a service-role-only idempotent helper", () => {
    expect(sql).toContain("create or replace function private.create_admin_general_notification(");
    expect(sql).toMatch(
      /p_receipt_submission_id bigint default null,\s+p_payment_id bigint default null,\s+p_review_id bigint default null,\s+p_product_id bigint default null/,
    );
    expect(sql).toContain("where a.is_active");
    expect(sql).toContain("on conflict (event_key, admin_id) do nothing");
    expect(sql).toContain(
      "revoke all on function private.create_admin_general_notification(text, text, text, bigint, bigint, bigint, bigint, bigint)",
    );
    expect(sql).toContain(
      "grant execute on function private.create_admin_general_notification(text, text, text, bigint, bigint, bigint, bigint, bigint)",
    );
  });

  it("uses transactional triggers with the corrected event keys", () => {
    expect(sql).toContain("create trigger admin_general_notifications_new_order");
    expect(sql).toContain("after insert on public.orders");
    expect(sql).toContain("if new.channel = 'online' then");
    expect(sql).toContain("'new_order:' || new.id::text");

    expect(sql).toContain("create trigger admin_general_notifications_receipt_submission");
    expect(sql).toContain("after update of payment_id on public.receipt_submissions");
    expect(sql).toContain("when (old.payment_id is null and new.payment_id is not null)");
    expect(sql).not.toMatch(/after insert on public\.receipt_submissions/);
    expect(sql).toContain("v_event_type := 'payment_receipt'");
    expect(sql).toContain("v_event_type := 'receipt_correction'");
    expect(sql).toContain("'Nuevo comprobante de pago recibido.'");
    expect(sql).toContain("'Comprobante corregido recibido.'");
    expect(sql).toContain("v_event_type || ':' || new.id::text");
    expect(sql).toContain("new.payment_id");

    expect(sql).toContain("create trigger admin_general_notifications_product_review");
    expect(sql).toContain("after insert on public.product_reviews");
    expect(sql).toContain("'product_review:' || new.id::text");
    expect(sql).toContain("'Nueva reseña de producto recibida.'");
  });

  it("joins the realtime publication without relying on FULL replica identity", () => {
    expect(sql).toContain("alter publication %I add table %s");
    expect(sql).toContain("'public.admin_general_notifications'::regclass");
    expect(sql).not.toMatch(/replica\s+identity\s+full/i);
  });

  it("does not regress the SLA inbox, its RPCs or business writes", () => {
    expect(sql).not.toMatch(/\badmin_notifications\b/);
    expect(sql).not.toContain("process_sla_notifications");
    expect(sql).not.toMatch(/create or replace function public\./);
    expect(sql).not.toMatch(/\binsert\s+into\s+public\.(orders|receipt_submissions)\b/i);
    expect(sql).not.toMatch(/\bupdate\s+public\.(orders|receipt_submissions)\b/i);
    expect(sql).not.toMatch(/\bdelete\s+from\s+public\.(orders|receipt_submissions)\b/i);
    expect(sql).not.toMatch(/\b(email|whatsapp|outbox|send)\b/i);
  });
});
