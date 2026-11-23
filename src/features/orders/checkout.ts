"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { CHECKOUT_COOKIE } from "./tracking";

/**
 * Guest checkout boundary.
 *
 * The client bag is never trusted: quantities, products and prices are
 * re-validated and re-priced by `create_online_order_with_bcv` (the canonical
 * service-role RPC). The plaintext tracking token is returned by the RPC and
 * stored only in an httpOnly cookie for the payment step; it is never placed in
 * the URL or in a client-readable field.
 */

const checkoutInputSchema = z.strictObject({
  customerName: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio.")
    .max(160, "El nombre es demasiado largo."),
  customerPhone: z
    .string()
    .trim()
    .min(1, "El teléfono es obligatorio.")
    .max(40, "El teléfono es demasiado largo."),
  fulfillmentType: z.enum(["delivery", "pickup"]),
  deliveryZoneId: z.number().int().positive().nullable(),
  addressLine: z.string().trim().max(300).nullable(),
  addressReferences: z.string().trim().max(300).nullable(),
  additionalInstructions: z.string().trim().max(500).nullable(),
  items: z
    .array(
      z.strictObject({
        productId: z.number().int().positive(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1, "Tu bolsa está vacía."),
});

export type CreateOnlineOrderResult =
  | { ok: true; orderId: number; trackingToken?: string }
  | { ok: false; error: string };

export type PrimeCheckoutPaymentResult = { ok: true } | { ok: false; error: string };

const genericError = "No se pudo crear el pedido. Inténtalo de nuevo.";

function checkoutPublicError(message: string): string {
  if (message.includes("customer name is required")) {
    return "El nombre es obligatorio.";
  }
  if (message.includes("customer phone is required")) {
    return "El teléfono es obligatorio.";
  }
  if (message.includes("fulfillment type must be")) {
    return "El método de entrega no es válido.";
  }
  if (message.includes("delivery zone is required")) {
    return "Selecciona una zona de entrega.";
  }
  if (message.includes("does not exist or is inactive")) {
    return "La zona de entrega no está disponible.";
  }
  if (message.includes("at least one cart line")) {
    return "Tu bolsa está vacía.";
  }
  if (message.includes("product") && message.includes("does not exist or is inactive")) {
    return "Uno de los productos ya no está disponible.";
  }
  if (message.includes("insufficient available stock")) {
    return "No hay suficiente stock para alguno de los productos.";
  }
  return genericError;
}

export async function createOnlineOrder(
  input: unknown,
): Promise<CreateOnlineOrderResult> {
  const parsed = checkoutInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Revisa los datos de la entrega.",
    };
  }

  const data = parsed.data;
  const isDelivery = data.fulfillmentType === "delivery";
  if (isDelivery && data.deliveryZoneId === null) {
    return { ok: false, error: "Selecciona una zona de entrega." };
  }

  const supabase = createSupabaseAdminClient();
  // Generated DB types model these params as non-null, but the SQL function and
  // runtime behavior accept nulls for pickup/no-instructions. Cast through
  // unknown at this boundary only; the RPC remains the server-side authority.
  const rpcArgs = {
    p_customer_name: data.customerName,
    p_customer_phone: data.customerPhone,
    p_fulfillment_type: data.fulfillmentType,
    p_delivery_zone_id: isDelivery ? data.deliveryZoneId : null,
    p_address_line: isDelivery ? data.addressLine : null,
    p_address_references: isDelivery ? data.addressReferences : null,
    p_additional_instructions: data.additionalInstructions,
    p_items: data.items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
    })),
  } as unknown as Parameters<typeof supabase.rpc<"create_online_order_with_bcv">>[1];

  const { data: result, error } = await supabase.rpc(
    "create_online_order_with_bcv",
    rpcArgs,
  );

  if (error) {
    return { ok: false, error: checkoutPublicError(error.message) };
  }

  const orderId = Number((result as { order_id?: number } | null)?.order_id);
  const token = String(
    (result as { tracking_token?: string } | null)?.tracking_token ?? "",
  );
  if (!Number.isInteger(orderId) || orderId <= 0 || !/^[0-9a-f]{64}$/.test(token)) {
    return { ok: false, error: genericError };
  }

  const cookieStore = await cookies();
  cookieStore.set(CHECKOUT_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });

  return { ok: true, orderId, trackingToken: token };
}

const trackingTokenSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{64}$/, "El enlace de seguimiento no es válido.");

export async function primeCheckoutPayment(input: {
  trackingToken: string;
}): Promise<PrimeCheckoutPaymentResult> {
  const parsed = trackingTokenSchema.safeParse(input?.trackingToken);
  if (!parsed.success) {
    return { ok: false, error: "El enlace de seguimiento no es válido." };
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("get_order_for_tracking", {
    p_token: parsed.data,
  });
  if (error || !data) {
    return { ok: false, error: "No se pudo validar el pedido para el pago." };
  }

  const order = data as {
    status?: string;
    delivery_requires_quote?: boolean;
    delivery_fee_usd?: number | null;
    quote_acceptance_available?: boolean;
  };
  const quotePending =
    order.delivery_requires_quote === true && order.delivery_fee_usd === null;
  const canPay =
    ["pending", "confirmed"].includes(String(order.status ?? "")) &&
    order.quote_acceptance_available !== true &&
    !quotePending;
  if (!canPay) {
    return {
      ok: false,
      error:
        "Este pedido aún no está listo para registrar un pago. Revisa el estado de la cotización.",
    };
  }

  const cookieStore = await cookies();
  cookieStore.set(CHECKOUT_COOKIE, parsed.data, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });
  return { ok: true };
}
