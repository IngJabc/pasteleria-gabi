"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/infrastructure/supabase/client";

export function ProductReviewsRealtime({ productId }: { productId: number }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`product-reviews-${productId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "product_reviews", filter: `product_id=eq.${productId}` },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "product_review_aggregates", filter: `product_id=eq.${productId}` },
        () => router.refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [productId, router]);
  return null;
}

export function AdminReviewsRealtime() {
  const router = useRouter();
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel("admin-product-reviews")
      .on("postgres_changes", { event: "*", schema: "public", table: "product_reviews" }, () => router.refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router]);
  return null;
}
