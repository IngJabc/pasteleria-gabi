"use server";

import { z } from "zod";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { requireActiveAdminId } from "./admin-session";
import {
  invalidPaymentInputError,
  paymentsPublicError,
  trackedOrderSchema,
  trackingTokenSchema,
} from "./schemas";

/** Read-only per-currency payment facts. No cross-currency total is produced. */

const byTokenSchema = z.object({ trackingToken: trackingTokenSchema });
const byOrderSchema = z.object({
  orderId: z.number().int().positive(),
});

export type PaymentSummaryResult =
  | { ok: true; summary: Record<string, unknown> }
  | { ok: false; error: string };

const genericError = "No se pudo consultar el resumen de pagos.";

export async function getPaymentSummaryForTracking(input: {
  trackingToken: string;
}): Promise<PaymentSummaryResult> {
  const parsed = byTokenSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "El enlace de seguimiento no es válido." };
  }

  const supabase = createSupabaseAdminClient();
  const tracked = await supabase.rpc("get_order_for_tracking", {
    p_token: parsed.data.trackingToken,
  });
  if (tracked.error) {
    return { ok: false, error: paymentsPublicError(tracked.error.message, genericError) };
  }
  const order = trackedOrderSchema.safeParse(tracked.data);
  if (!order.success || !order.data) {
    return { ok: false, error: "El enlace de seguimiento no es válido." };
  }

  return readSummary(supabase, order.data.order_id);
}

export async function getAdminPaymentSummary(input: {
  orderId: number;
}): Promise<PaymentSummaryResult> {
  const parsed = byOrderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: invalidPaymentInputError };
  }

  try {
    await requireActiveAdminId();
  } catch {
    return { ok: false, error: "La sesión del administrador no es válida." };
  }

  return readSummary(createSupabaseAdminClient(), parsed.data.orderId);
}

async function readSummary(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  orderId: number,
): Promise<PaymentSummaryResult> {
  const { data, error } = await supabase.rpc("get_order_payment_summary", {
    p_order_id: orderId,
  });
  if (error) {
    return { ok: false, error: paymentsPublicError(error.message, genericError) };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, error: genericError };
  }
  return { ok: true, summary: data as Record<string, unknown> };
}
