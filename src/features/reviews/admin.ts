import "server-only";

import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import { AdminSessionError, requireActiveAdminId } from "@/features/payments/admin-session";
import { adminReviewFilterSchema, type AdminReviewFilter, type AdminReviewRow, adminReviewSchema } from "./schemas";

export type AdminReviewsResult = {
  items: Array<AdminReviewRow & { productName: string | null }>;
  total: number;
  page: number;
  pageSize: number;
  unavailable: boolean;
  message?: string;
};

const unavailableMessage = "No se pudieron cargar las reseñas. Inténtalo de nuevo.";

export async function listAdminReviews(input: Partial<AdminReviewFilter> = {}): Promise<AdminReviewsResult> {
  await requireActiveAdminId();
  const parsed = adminReviewFilterSchema.safeParse(input);
  const filter = parsed.success ? parsed.data : adminReviewFilterSchema.parse({});
  try {
    const supabase = await createSupabaseServerClient();
    let query = supabase
      .from("product_reviews")
      .select("id, product_id, order_id, reviewer_name, rating, comment, is_verified_purchase, is_hidden, hidden_at, created_at, products(name)", { count: "exact" });

    if (filter.status === "published") query = query.eq("is_hidden", false);
    if (filter.status === "hidden") query = query.eq("is_hidden", true);
    if (filter.productId) query = query.eq("product_id", filter.productId);
    if (filter.rating) query = query.eq("rating", filter.rating);
    if (filter.search) {
      const safe = filter.search.replace(/[,%()]/g, " ").trim();
      if (safe) {
        query = query.or(`reviewer_name.ilike.%${safe}%,comment.ilike.%${safe}%`);
      }
    }

    const from = (filter.page - 1) * filter.pageSize;
    const to = from + filter.pageSize - 1;
    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) return { items: [], total: 0, page: filter.page, pageSize: filter.pageSize, unavailable: true, message: unavailableMessage };

    const items = (data ?? [])
      .map((row) => {
        const raw = row as Record<string, unknown>;
        const parsedRow = adminReviewSchema.safeParse(raw);
        if (!parsedRow.success) return null;
        const productRel = raw.products as { name?: string } | { name?: string }[] | null;
        const productName = Array.isArray(productRel) ? productRel[0]?.name ?? null : productRel?.name ?? null;
        return { ...parsedRow.data, productName };
      })
      .filter((v): v is AdminReviewRow & { productName: string | null } => v !== null);

    return { items, total: count ?? 0, page: filter.page, pageSize: filter.pageSize, unavailable: false };
  } catch (error) {
    if (error instanceof AdminSessionError) throw error;
    return { items: [], total: 0, page: filter.page, pageSize: filter.pageSize, unavailable: true, message: unavailableMessage };
  }
}
