import "server-only";

import { cookies } from "next/headers";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";

/**
 * Guest order tracking and cancellation.
 *
 * The private tracking token is the only credential. It is hashed and resolved
 * by the existing service-role RPCs (`get_order_for_tracking`,
 * `request_order_cancellation`); no order id, phone or name is accepted from
 * the client. The token is only held in an httpOnly cookie during the checkout
 * hand-off, or read from the URL of the private tracking link.
 */

export const CHECKOUT_COOKIE = "da_checkout_token";

const trackingTokenSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{64}$/, "El enlace de seguimiento no es válido.");

export const trackedOrderSchema = z.object({
  order_id: z.number().int().positive(),
  status: z.string().min(1),
  fulfillment_type: z.string().min(1),
  subtotal_usd: z.coerce.number().nonnegative(),
  delivery_fee_usd: z.coerce.number().nullable(),
  total_usd: z.coerce.number().nonnegative(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  quote_accepted_at: z.string().nullable().optional(),
  quote_acceptance_expires_at: z.string().nullable().optional(),
  quote_acceptance_available: z.boolean().optional(),
  delivery_requires_quote: z.boolean().optional(),
  items: z.array(
    z.object({
      product_id: z.coerce.number().int().positive().optional(),
      product_name: z.string().min(1),
      unit_price_usd: z.coerce.number().nonnegative(),
      quantity: z.number().int().positive(),
    }),
  ),
  cancellation_requests: z.array(
    z.object({
      status: z.string().min(1),
      created_at: z.string().min(1),
      resolved_at: z.string().nullable(),
    }),
  ),
});

export type TrackedOrder = z.infer<typeof trackedOrderSchema>;

/* Tracking reads use the token-resolving RPC; invalid/absent orders return null. */

export async function getOrderByTracking(
  token: string,
): Promise<TrackedOrder | null> {
  const parsed = trackingTokenSchema.safeParse(token);
  if (!parsed.success) return null;

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("get_order_for_tracking", {
    p_token: parsed.data,
  });
  if (error || !data) return null;

  const result = trackedOrderSchema.safeParse(data);
  return result.success ? result.data : null;
}

export async function getCheckoutToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(CHECKOUT_COOKIE)?.value ?? null;
  if (!token) return null;
  const parsed = trackingTokenSchema.safeParse(token);
  return parsed.success ? parsed.data : null;
}

export async function getCheckoutOrder(): Promise<TrackedOrder | null> {
  const token = await getCheckoutToken();
  if (!token) return null;
  return getOrderByTracking(token);
}

export async function clearCheckoutToken(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(CHECKOUT_COOKIE);
}

export type RequestCancellationResult =
  | { ok: true; requestId: number }
  | { ok: false; error: string };

const cancellationGenericError =
  "No se pudo enviar la solicitud. Inténtalo de nuevo.";

export async function requestOrderCancellation(
  token: string,
  reason: string,
): Promise<RequestCancellationResult> {
  const parsedToken = trackingTokenSchema.safeParse(token);
  const parsedReason = z
    .string()
    .trim()
    .max(500, "El comentario es demasiado largo.")
    .safeParse(reason);
  if (!parsedToken.success) {
    return { ok: false, error: "El enlace de seguimiento no es válido." };
  }
  if (!parsedReason.success) {
    return { ok: false, error: parsedReason.error.issues[0]?.message ?? cancellationGenericError };
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
        error: "Ya hay una solicitud de cancelación pendiente para este pedido.",
      };
    }
    return { ok: false, error: cancellationGenericError };
  }

  const requestId = Number(data);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return { ok: false, error: cancellationGenericError };
  }
  return { ok: true, requestId };
}
