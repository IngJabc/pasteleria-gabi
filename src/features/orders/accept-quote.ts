"use server";

import { z } from "zod";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";

/**
 * OQ-17 — customer acceptance of a manually quoted delivery fee.
 *
 * The private tracking token is the ONLY customer credential accepted here.
 * It is hashed and resolved by `accept_quote_fee_for_tracking` in the same
 * database transaction that starts the fixed 20-minute reservation window.
 * An order id, phone number or name is never trusted as authorization.
 *
 * This server action is the application boundary: it validates the token
 * shape, invokes the service-role RPC (never a direct table write) and returns
 * a stable, localized result without exposing internal SQL error details.
 */

const trackingTokenSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{64}$/, "El enlace de seguimiento no es válido.");

const rpcResultSchema = z.object({
  order_id: z.number().int().positive(),
  quote_accepted_at: z.string().min(1),
  quote_acceptance_expires_at: z.string().min(1),
  reservations_updated: z.number().int().nonnegative(),
  idempotent: z.boolean(),
});

export type AcceptQuoteResult =
  | {
      ok: true;
      orderId: number;
      quoteAcceptedAt: string;
      quoteAcceptanceExpiresAt: string;
      reservationsUpdated: number;
      idempotent: boolean;
    }
  | { ok: false; error: string };

function publicError(message: string): string {
  if (message.includes("no order matches the tracking token")) {
    return "El enlace de seguimiento no es válido.";
  }
  if (message.includes("no confirmed delivery quote is available")) {
    return "La cotización aún no está disponible para este pedido.";
  }
  if (message.includes("quoted total does not match")) {
    return "La cotización del pedido cambió. Vuelve a consultarla antes de aceptar.";
  }
  if (message.includes("already has a submitted receipt")) {
    return "El pedido ya tiene un comprobante enviado; la cotización no se puede aceptar.";
  }
  if (message.includes("is not pending")) {
    return "El pedido ya no está pendiente.";
  }
  if (message.includes("no active reservations")) {
    return "La reserva de los productos ya no está disponible.";
  }
  if (message.includes("running deadline") || message.includes("no longer awaiting")) {
    return "La cotización ya fue aceptada o el pedido cambió de estado.";
  }
  return "No se pudo aceptar la cotización. Inténtalo de nuevo.";
}

export async function acceptQuoteFee(input: {
  trackingToken: string;
}): Promise<AcceptQuoteResult> {
  const parsed = trackingTokenSchema.safeParse(input?.trackingToken);
  if (!parsed.success) {
    return { ok: false, error: "El enlace de seguimiento no es válido." };
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("accept_quote_fee_for_tracking", {
    p_token: parsed.data,
  });

  if (error) {
    return { ok: false, error: publicError(error.message) };
  }

  const result = rpcResultSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, error: "No se pudo aceptar la cotización. Inténtalo de nuevo." };
  }

  return {
    ok: true,
    orderId: result.data.order_id,
    quoteAcceptedAt: result.data.quote_accepted_at,
    quoteAcceptanceExpiresAt: result.data.quote_acceptance_expires_at,
    reservationsUpdated: result.data.reservations_updated,
    idempotent: result.data.idempotent,
  };
}
