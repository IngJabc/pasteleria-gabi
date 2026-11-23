"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveAdminId } from "@/features/payments/admin-session";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";

type QuoteOrder = {
  status: string;
  fulfillment_type: string | null;
  delivery_zone_id: number | string | null;
  delivery_fee_usd: number | string | null;
};

const ORDER_STATUSES = ["pending", "confirmed", "ready", "completed", "canceled", "expired"] as const;
type OrderStatus = (typeof ORDER_STATUSES)[number];

const ALLOWED_TARGETS = ["confirmed", "ready", "completed"] as const;
type AllowedTarget = (typeof ALLOWED_TARGETS)[number];

const schema = z.object({
  orderId: z.number().int().positive(),
  status: z.enum(ALLOWED_TARGETS),
});

export type UpdateOrderStatusResult =
  | { ok: true; status: OrderStatus; idempotent: boolean }
  | { ok: false; error: string };

const invalidSession = "La sesión del administrador no es válida.";
const invalidInput = "Los datos del pedido no son válidos.";
const genericError = "No se pudo actualizar el estado del pedido. Inténtalo de nuevo.";

function canTransition(from: string, to: AllowedTarget): boolean {
  if (from === to) return true; // idempotent
  if (from === "pending") return to === "confirmed" || to === "ready" || to === "completed";
  if (from === "confirmed") return to === "ready" || to === "completed";
  if (from === "ready") return to === "completed";
  return false;
}

/**
 * Admin-only order status update.
 *
 * - Verifies active admin session (fail-closed).
 * - Allows conservative forward transitions for active orders.
 * - When completing, consumes active reservations via the existing
 *   service-role RPC `consume_order_reservations` before marking completed.
 * - Does not invent payment/fulfillment rules; it only updates order status.
 */
export async function updateAdminOrderStatus(input: {
  orderId: number;
  status: "confirmed" | "ready" | "completed";
}): Promise<UpdateOrderStatusResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: invalidInput };

  try {
    await requireActiveAdminId();
  } catch {
    return { ok: false, error: invalidSession };
  }

  const { orderId, status: target } = parsed.data;

  try {
    const supabase = await createSupabaseServerClient();
    const { data: order, error: readError } = await supabase
      .from("orders")
      .select("id, status, fulfillment_type, delivery_zone_id, delivery_fee_usd")
      .eq("id", orderId)
      .maybeSingle();

    if (readError) return { ok: false, error: genericError };
    if (!order) return { ok: false, error: "El pedido no existe o no está disponible." };

    const current = typeof order.status === "string" ? order.status : "";
    if (!canTransition(current, target)) {
      return {
        ok: false,
        error: `No se puede cambiar el pedido de "${current}" a "${target}".`,
      };
    }
    if (current === target) {
      return { ok: true, status: target, idempotent: true };
    }

    if (target === "confirmed") {
      const quoteOrder = order as QuoteOrder;
      const zoneIdRaw = quoteOrder.delivery_zone_id;
      const zoneId =
        typeof zoneIdRaw === "number"
          ? zoneIdRaw
          : typeof zoneIdRaw === "string" && /^\d+$/.test(zoneIdRaw)
            ? Number(zoneIdRaw)
            : null;
      if (
        quoteOrder.fulfillment_type === "delivery" &&
        zoneId !== null &&
        (quoteOrder.delivery_fee_usd === null || quoteOrder.delivery_fee_usd === undefined)
      ) {
        const { data: zone, error: zoneError } = await supabase
          .from("delivery_zones")
          .select("requires_quote")
          .eq("id", zoneId)
          .maybeSingle();
        if (zoneError) return { ok: false, error: genericError };
        if (zone?.requires_quote === true) {
          return {
            ok: false,
            error:
              "Debes guardar la cotización de delivery antes de confirmar este pedido.",
          };
        }
      }
    }

    if (target === "completed") {
      const adminClient = createSupabaseAdminClient();
      const { error: consumeError } = await adminClient.rpc("consume_order_reservations", {
        p_order_id: orderId,
      });
      // RPC is idempotent when already consumed and errors when no active
      // reservations exist for a never-consumed order; surface a safe message.
      if (consumeError) {
        return {
          ok: false,
          error:
            "No se pudo completar el pedido porque sus reservas no pudieron consumirse. Verifica el estado del inventario.",
        };
      }
    }

    const allowedCurrent = ORDER_STATUSES.filter(
      (s): s is OrderStatus => canTransition(s, target) && s !== target,
    );

    const { error: updateError } = await supabase
      .from("orders")
      .update({ status: target })
      .eq("id", orderId)
      .in("status", allowedCurrent);

    if (updateError) return { ok: false, error: genericError };

    // Read-after-write to confirm actual state.
    const { data: after, error: afterError } = await supabase
      .from("orders")
      .select("status")
      .eq("id", orderId)
      .maybeSingle();
    if (afterError || !after) return { ok: false, error: genericError };

    const finalStatus = typeof after.status === "string" ? after.status : "";
    if (finalStatus !== target) {
      return { ok: false, error: "El estado del pedido cambió durante la actualización. Recarga la página." };
    }

    revalidatePath(`/admin/pedidos/${orderId}`);
    revalidatePath("/admin/pedidos");
    revalidatePath("/admin");
    return { ok: true, status: target, idempotent: false };
  } catch {
    return { ok: false, error: genericError };
  }
}