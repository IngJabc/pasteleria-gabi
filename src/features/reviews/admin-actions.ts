"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import { AdminSessionError, requireActiveAdminId } from "@/features/payments/admin-session";

export async function setReviewHiddenAction(input: {
  reviewId: number;
  hidden: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireActiveAdminId();
  const reviewId = Number(input.reviewId);
  if (!Number.isSafeInteger(reviewId) || reviewId <= 0) {
    return { ok: false, error: "Rese?a inv?lida." };
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_product_review_hidden", {
      p_review_id: reviewId,
      p_hidden: Boolean(input.hidden),
    });
    if (error) {
      const message = error.message || "";
      if (message.includes("La rese?a no existe")) {
        return { ok: false, error: "La rese?a no existe." };
      }
      return { ok: false, error: "No se pudo actualizar la rese?a." };
    }
    revalidatePath("/");
    revalidatePath("/productos");
    revalidatePath("/productos/[slug]", "page");
    revalidatePath("/admin/resenas");
    return { ok: true };
  } catch (error) {
    if (error instanceof AdminSessionError) throw error;
    return { ok: false, error: "No se pudo actualizar la rese?a." };
  }
}
