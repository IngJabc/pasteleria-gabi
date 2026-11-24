"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { submitReviewInputSchema } from "./schemas";

export type SubmitReviewResult =
  | { ok: true; message: string; reviewId: number; verified: boolean }
  | { ok: false; error: string };

const genericError = "No se pudo enviar la reseña. Inténtalo de nuevo.";

function sanitizeError(message: unknown): string {
  if (typeof message !== "string" || !message.trim()) return genericError;
  const known = [
    "Selecciona un producto válido.",
    "La calificación debe estar entre 1 y 5 estrellas.",
    "El comentario es obligatorio y debe tener hasta 1000 caracteres.",
    "El nombre debe tener hasta 80 caracteres.",
    "El producto seleccionado no está disponible.",
    "Has enviado varias reseñas recientemente. Intenta nuevamente más tarde.",
    "El enlace de seguimiento no es válido.",
    "No pudimos validar el pedido para esta reseña verificada.",
    "Solo puedes dejar una reseña verificada para pedidos completados o entregados.",
    "Este pedido no incluye el producto seleccionado.",
    "Ya existe una reseña verificada para este producto en este pedido.",
  ];
  const trimmed = message.trim();
  if (known.includes(trimmed)) return trimmed;
  if (trimmed.includes("product_reviews_verified_order_product_uidx")) {
    return "Ya existe una reseña verificada para este producto en este pedido.";
  }
  return genericError;
}

async function getSubmitterKey(): Promise<string> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    const realIp = h.get("x-real-ip")?.trim();
    const ip = forwarded || realIp || "unknown";
    const ua = (h.get("user-agent") ?? "").slice(0, 120);
    return `${ip}|${ua}`;
  } catch {
    return "unknown";
  }
}

export async function submitProductReview(input: unknown): Promise<SubmitReviewResult> {
  const parsed = submitReviewInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? genericError };
  }

  try {
    const supabase = createSupabaseAdminClient();
    const submitterKey = await getSubmitterKey();
    const { data, error } = await supabase.rpc("submit_product_review", {
      p_product_id: parsed.data.productId,
      p_rating: parsed.data.rating,
      p_comment: parsed.data.comment,
      p_reviewer_name: parsed.data.reviewerName,
      p_tracking_token: parsed.data.trackingToken,
      p_submitter_key: submitterKey,
    });

    if (error) {
      console.error("[submitProductReview] rpc error", {
        code: error.code,
        message: error.message,
        details: error.details,
      });
      return { ok: false, error: sanitizeError(error.message) };
    }

    const payload = (data ?? {}) as Record<string, unknown>;
    const reviewId = Number(payload.review_id);
    const verified = payload.is_verified_purchase === true;
    if (!Number.isSafeInteger(reviewId) || reviewId <= 0) {
      return { ok: false, error: genericError };
    }

    revalidatePath("/");
    revalidatePath("/productos");
    revalidatePath("/productos/[slug]", "page");

    return {
      ok: true,
      reviewId,
      verified,
      message: verified
        ? "Gracias por tu reseña verificada. Ya está visible en el producto."
        : "Gracias por tu reseña. Ya está visible en el producto.",
    };
  } catch {
    return { ok: false, error: genericError };
  }
}
