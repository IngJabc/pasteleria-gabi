import "server-only";

import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import {
  publicReviewSchema,
  reviewAggregateSchema,
  type PublicReview,
  type ReviewAggregateView,
} from "./schemas";

export const reviewsUnavailableError = "No se pudieron cargar las reseñas. Inténtalo de nuevo.";

export async function listPublishedReviewsByProduct(productId: number): Promise<PublicReview[]> {
  if (!Number.isSafeInteger(productId) || productId <= 0) return [];
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("product_reviews")
      .select("id, product_id, reviewer_name, rating, comment, is_verified_purchase, created_at")
      .eq("product_id", productId)
      .eq("is_hidden", false)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error || !data) return [];
    const reviews: PublicReview[] = [];
    for (const row of data) {
      const parsed = publicReviewSchema.safeParse(row);
      if (parsed.success) reviews.push(parsed.data);
    }
    return reviews;
  } catch {
    return [];
  }
}

type ReviewClient = Pick<import("@supabase/supabase-js").SupabaseClient, "from">;

export async function getReviewAggregatesByProductIds(
  productIds: number[],
  client?: ReviewClient,
): Promise<Record<number, ReviewAggregateView>> {
  const unique = [...new Set(productIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (unique.length === 0) return {};
  try {
    const supabase = client ?? await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("product_review_aggregates")
      .select("product_id, review_count, rating_sum, average_rating")
      .in("product_id", unique);
    if (error || !data) return {};
    const map: Record<number, ReviewAggregateView> = {};
    for (const row of data) {
      const parsed = reviewAggregateSchema.safeParse(row);
      if (!parsed.success) continue;
      map[parsed.data.product_id] = {
        productId: parsed.data.product_id,
        reviewCount: parsed.data.review_count,
        averageRating: Number(parsed.data.average_rating),
      };
    }
    return map;
  } catch {
    return {};
  }
}

export async function listActiveReviewProducts(): Promise<Array<{ id: number; name: string }>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("products")
      .select("id, name")
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (error || !data) return [];
    return data
      .filter((row): row is { id: number; name: string } =>
        typeof row?.id === "number" && typeof row?.name === "string",
      )
      .map((row) => ({ id: row.id, name: row.name }));
  } catch {
    return [];
  }
}

export async function getTrackingReviewContext(token: string): Promise<{
  orderId: number;
  items: Array<{ productId: number; productName: string; quantity: number }>;
} | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.rpc("get_order_for_tracking", { p_token: token });
    if (error || !data || typeof data !== "object") return null;
    const row = data as Record<string, unknown>;
    const orderId = Number(row.order_id);
    if (!Number.isSafeInteger(orderId) || orderId <= 0) return null;
    const rawItems = Array.isArray(row.items) ? row.items : [];
    const items = rawItems
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const value = item as Record<string, unknown>;
        const productId = Number(value.product_id);
        const productName = typeof value.product_name === "string" ? value.product_name : null;
        const quantity = Number(value.quantity);
        if (!Number.isSafeInteger(productId) || productId <= 0 || !productName) return null;
        return { productId, productName, quantity: Number.isFinite(quantity) ? quantity : 1 };
      })
      .filter((v): v is { productId: number; productName: string; quantity: number } => v !== null);
    return { orderId, items };
  } catch {
    return null;
  }
}
