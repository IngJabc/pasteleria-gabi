import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDir = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const migration014 = path.join(migrationsDir, "014_product_reviews.sql");

function stripComments(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("migration 014 contract (static)", () => {
  const raw = readFileSync(migration014, "utf8");
  const sql = stripComments(raw);

  it("defines review tables, constraints, and indexes", () => {
    expect(sql).toContain("create table public.product_reviews");
    expect(sql).toContain("create table public.product_review_aggregates");
    expect(sql).toContain("create table private.product_review_rate_limits");
    expect(sql).toContain("product_reviews_rating_check");
    expect(sql).toContain("product_reviews_verified_order_product_uidx");
    expect(sql).toContain("is_verified_purchase = true and order_id is not null");
  });

  it("enforces RLS and least-privilege grants", () => {
    expect(sql).toContain("alter table public.product_reviews enable row level security");
    expect(sql).toContain("alter table public.product_reviews force row level security");
    expect(sql).toContain("alter table public.product_review_aggregates enable row level security");
    expect(sql).toContain("create policy product_reviews_public_select_published");
    expect(sql).toContain("create policy product_reviews_admin_select");
    expect(sql).not.toContain("create policy product_reviews_admin_update");
    expect(sql).toContain("revoke all on table public.product_reviews from public, anon, authenticated");
    expect(sql).toContain("grant select (id, product_id, reviewer_name, rating, comment, is_verified_purchase, created_at)");
    expect(sql).toContain("on table public.product_reviews to anon;");
    expect(sql).toContain("grant select on table public.product_reviews to authenticated");
    expect(sql).not.toContain("grant select, update on table public.product_reviews to authenticated");
  });

  it("includes secure submission and moderation RPCs", () => {
    expect(sql).toContain("create or replace function public.submit_product_review");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("public.get_order_for_tracking(v_token)");
    expect(sql).toContain("Ya existe una reseña verificada para este producto en este pedido");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("create or replace function public.set_product_review_hidden");
    expect(sql).toContain("private.require_active_admin(v_admin_id)");
    expect(sql).toContain("insert into public.audit_log");
    expect(sql).toContain("product_review.hide");
    expect(sql).toContain("product_review.restore");
  });

  it("maintains aggregates and realtime publication safely", () => {
    expect(sql).toContain("create or replace function private.refresh_product_review_aggregate");
    expect(sql).toContain("create trigger product_reviews_aggregate_refresh");
    expect(sql).toContain("public.product_reviews'::regclass");
    expect(sql).toContain("public.product_review_aggregates'::regclass");
    expect(sql).toContain("alter publication %I add table %s");
  });
});
