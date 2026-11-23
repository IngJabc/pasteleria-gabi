"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveAdminId } from "@/features/payments/admin-session";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";

const schema = z.object({
  orderId: z.number().int().positive(),
  deliveryFeeUsd: z
    .string()
    .trim()
    .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, "La tarifa no es válida."),
});

export type SetDeliveryQuoteResult =
  | { ok: true; deliveryFeeUsd: number; totalUsd: number; totalVes: number | null; idempotent: boolean }
  | { ok: false; error: string };

const invalidInput = "Revisa la tarifa de delivery e inténtalo de nuevo.";
const invalidSession = "La sesión del administrador no es válida.";
const genericError = "No se pudo guardar la cotización. Inténtalo de nuevo.";

function publicError(message: string): string {
  if (message.includes("only pending orders")) {
    return "Solo los pedidos pendientes pueden recibir una cotización de delivery.";
  }
  if (message.includes("not an online delivery order")) {
    return "Este pedido no es un delivery online.";
  }
  if (message.includes("does not require a manual quote")) {
    return "La zona de este pedido no requiere cotización manual.";
  }
  if (message.includes("after customer acceptance")) {
    return "No se puede cambiar la cotizaci?n despu?s de que el cliente la acept?.";
  }
  if (message.includes("after receipt submission")) {
    return "No se puede cambiar la cotización después de que el cliente envió un comprobante.";
  }
  if (message.includes("BCV snapshot is immutable")) {
    return "No se pudo actualizar el total en bolívares de forma segura.";
  }
  if (
    message.includes("admin_set_delivery_quote") &&
    (message.includes("does not exist") ||
      message.includes("Could not find the function") ||
      message.includes("schema cache"))
  ) {
    return "La función de cotización no está disponible en la base de datos. Aplica la migración 010_delivery_quote_admin.sql en tu entorno local.";
  }
  return genericError;
}

export async function setAdminDeliveryQuote(input: {
  orderId: number;
  deliveryFeeUsd: string;
}): Promise<SetDeliveryQuoteResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? invalidInput };
  }

  let adminId: string;
  try {
    adminId = await requireActiveAdminId();
  } catch {
    return { ok: false, error: invalidSession };
  }

  const supabase = createSupabaseAdminClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: "admin_set_delivery_quote",
    args: { p_order_id: number; p_delivery_fee_usd: string; p_admin_id: string },
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("admin_set_delivery_quote", {
    p_order_id: parsed.data.orderId,
    p_delivery_fee_usd: parsed.data.deliveryFeeUsd,
    p_admin_id: adminId,
  });

  if (error) {
    return { ok: false, error: publicError(error.message) };
  }

  const result = data as {
    delivery_fee_usd?: number | string;
    total_usd?: number | string;
    total_ves?: number | string | null;
    idempotent?: boolean;
  } | null;
  const deliveryFeeUsd = Number(result?.delivery_fee_usd);
  const totalUsd = Number(result?.total_usd);
  const totalVes =
    result?.total_ves === null || result?.total_ves === undefined
      ? null
      : Number(result.total_ves);

  if (!Number.isFinite(deliveryFeeUsd) || !Number.isFinite(totalUsd)) {
    return { ok: false, error: genericError };
  }

  revalidatePath(`/admin/pedidos/${parsed.data.orderId}`);
  revalidatePath("/admin/pedidos");
  revalidatePath("/admin");
  return {
    ok: true,
    deliveryFeeUsd,
    totalUsd,
    totalVes: Number.isFinite(totalVes as number) ? totalVes : null,
    idempotent: result?.idempotent === true,
  };
}
