"use server";

import { z } from "zod";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";

const trackingTokenSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{64}$/, "El enlace de seguimiento no es válido.");

export type RequestCancellationResult =
  | { ok: true; requestId: number }
  | { ok: false; error: string };

const genericError = "No se pudo enviar la solicitud. Inténtalo de nuevo.";

export async function requestOrderCancellation(input: {
  trackingToken: string;
  reason: string;
}): Promise<RequestCancellationResult> {
  const parsedToken = trackingTokenSchema.safeParse(input.trackingToken);
  const parsedReason = z
    .string()
    .trim()
    .max(500, "El comentario es demasiado largo.")
    .safeParse(input.reason);

  if (!parsedToken.success) {
    return { ok: false, error: "El enlace de seguimiento no es válido." };
  }
  if (!parsedReason.success) {
    return {
      ok: false,
      error: parsedReason.error.issues[0]?.message ?? genericError,
    };
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("request_order_cancellation", {
    p_token: parsedToken.data,
    p_reason: parsedReason.data,
  });

  if (error) {
    const message = error.message;
    if (message.includes("no order matches the tracking token")) {
      return { ok: false, error: "El enlace de seguimiento no es válido." };
    }
    if (message.includes("already pending")) {
      return {
        ok: false,
        error:
          "Ya hay una solicitud de cancelación pendiente para este pedido.",
      };
    }
    return { ok: false, error: genericError };
  }

  const requestId = Number(data);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return { ok: false, error: genericError };
  }
  return { ok: true, requestId };
}