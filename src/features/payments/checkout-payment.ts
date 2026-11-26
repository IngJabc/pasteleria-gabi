"use server";

import { z } from "zod";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import {
  clearCheckoutToken,
  getCheckoutToken,
} from "@/features/orders/tracking";
import { registerDigitalPaymentWithReceipt } from "./guest-payments";
import {
  digitalPaymentMethodSchema,
  idempotencyKeySchema,
  positiveMoneySchema,
  receiptFileSchema,
  referenceSchema,
} from "./schemas";

/**
 * Checkout payment boundary.
 *
 * The guest never sends the tracking token here: it is read from the httpOnly
 * checkout cookie set when the order was created. A missing or expired cookie
 * fails closed. Payment amount is validated against the server-authoritative
 * order total before registration. On success the cookie is cleared and the
 * private tracking token is returned once so the confirmation screen can show
 * the owner their link.
 */

const checkoutPaymentSchema = z.strictObject({
  method: digitalPaymentMethodSchema,
  amount: positiveMoneySchema,
  reference: referenceSchema,
  idempotencyKey: idempotencyKeySchema,
  file: receiptFileSchema,
});

export type CheckoutPaymentResult =
  | { ok: true; orderId: number; trackingToken: string }
  | { ok: false; error: string };

export type ConfirmPayInStoreResult =
  | { ok: true; trackingToken: string }
  | { ok: false; error: string };

const expiredSessionError =
  "La sesión de compra expiró. Vuelve a crear tu pedido.";

export async function confirmPayInStoreOrder(): Promise<ConfirmPayInStoreResult> {
  const token = await getCheckoutToken();
  if (!token) {
    return { ok: false, error: expiredSessionError };
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("get_order_for_tracking", {
    p_token: token,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "No se pudo validar el pedido." };
  }

  const order = data as {
    order_id?: number | null;
    status?: string;
    fulfillment_type?: string;
    delivery_requires_quote?: boolean;
    delivery_fee_usd?: number | null;
    quote_acceptance_available?: boolean;
  };
  const quotePending =
    order.delivery_requires_quote === true && order.delivery_fee_usd === null;
  const deliveryFee = Number(order.delivery_fee_usd);
  const isFreeDelivery = order.fulfillment_type === "delivery" && Number.isFinite(deliveryFee) && deliveryFee === 0;
  const canConfirm =
    ["pending", "confirmed"].includes(String(order.status ?? "")) &&
    (order.fulfillment_type === "pickup" || isFreeDelivery) &&
    order.quote_acceptance_available !== true &&
    !quotePending;
  if (!canConfirm) {
    return {
      ok: false,
      error:
        "El pago en tienda solo está disponible para retiro en atelier o delivery gratis en este paso.",
    };
  }

  const orderId = Number(order.order_id);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    return { ok: false, error: "No se pudo validar el pedido." };
  }

  const { error: notifyError } = await supabase.rpc(
    "notify_online_order_formalized",
    { p_order_id: orderId },
  );
  if (notifyError) {
    // Keep the checkout cookie so the customer can retry formalization.
    return {
      ok: false,
      error: "No se pudo confirmar el pedido. Inténtalo de nuevo.",
    };
  }

  await clearCheckoutToken();
  return { ok: true, trackingToken: token };
}

export async function registerCheckoutPayment(
  input: unknown,
): Promise<CheckoutPaymentResult> {
  const parsed = checkoutPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ??
        "Revisa los datos del pago e inténtalo de nuevo.",
    };
  }

  const token = await getCheckoutToken();
  if (!token) {
    return { ok: false, error: expiredSessionError };
  }

  const { method, amount, reference, idempotencyKey, file } = parsed.data;
  const result = await registerDigitalPaymentWithReceipt({
    trackingToken: token,
    method,
    amount,
    reference,
    idempotencyKey,
    file,
  });

  if (!result.ok) {
    return result;
  }

  await clearCheckoutToken();
  return {
    ok: true,
    orderId: result.orderId,
    trackingToken: token,
  };
}
