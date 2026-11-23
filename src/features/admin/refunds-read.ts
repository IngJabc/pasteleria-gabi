import "server-only";

import { z } from "zod";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import { requireActiveAdminId } from "@/features/payments/admin-session";

/**
 * Read-only recent refunds. Column names mirror migration 006
 * (`payment_refunds`: payment_id, amount, currency, method, reason, admin_id,
 * created_at). The payment/order reference is resolved in a separate query and
 * is always derived from real rows. Refund creation stays in the existing
 * `recordPaymentRefund` action — there is no write path here.
 */

const unavailableError =
  "El historial de reembolsos no está disponible en este momento.";
const invalidSessionError = "La sesión del administrador no es válida.";
const MAX_REFUNDS = 100;

const refundRowSchema = z.object({
  id: z.number().int().positive(),
  payment_id: z.number().int().positive(),
  amount: z.coerce.number().positive(),
  currency: z.string().min(1),
  method: z.string().min(1),
  reason: z.string().min(1),
  admin_id: z.string().min(1),
  created_at: z.string().min(1),
});

const paymentRowSchema = z.object({
  id: z.number().int().positive(),
  order_id: z.number().int().positive(),
  reference: z.string().nullable(),
});

export type AdminRefundItem = {
  id: number;
  paymentId: number;
  amount: number;
  currency: string;
  method: string;
  reason: string;
  adminId: string;
  createdAt: string;
  /** `null` only when the referenced payment row is no longer queryable. */
  orderId: number | null;
  /** Derived from the real order id. */
  orderReference: string | null;
  /** The real payment reference, when one was recorded. */
  paymentReference: string | null;
};

export type AdminRefundsResult = {
  unavailable: boolean;
  message: string;
  items: AdminRefundItem[];
};

function unavailableRefunds(message: string): AdminRefundsResult {
  return { unavailable: true, message, items: [] };
}

export async function listRecentRefunds(): Promise<AdminRefundsResult> {
  try {
    await requireActiveAdminId();
  } catch {
    return unavailableRefunds(invalidSessionError);
  }

  try {
    const supabase = await createSupabaseServerClient();

    const refundsResult = await supabase
      .from("payment_refunds")
      .select("id, payment_id, amount, currency, method, reason, admin_id, created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAX_REFUNDS);
    if (refundsResult.error) return unavailableRefunds(unavailableError);

    const refunds: z.infer<typeof refundRowSchema>[] = [];
    for (const row of refundsResult.data ?? []) {
      const parsed = refundRowSchema.safeParse(row);
      if (parsed.success) refunds.push(parsed.data);
    }
    if (refunds.length === 0) {
      return { unavailable: false, message: "", items: [] };
    }

    const paymentIds = [...new Set(refunds.map((refund) => refund.payment_id))];
    const paymentsResult = await supabase
      .from("payments")
      .select("id, order_id, reference")
      .in("id", paymentIds);
    if (paymentsResult.error) return unavailableRefunds(unavailableError);

    const paymentsById = new Map<number, z.infer<typeof paymentRowSchema>>();
    for (const row of paymentsResult.data ?? []) {
      const parsed = paymentRowSchema.safeParse(row);
      if (parsed.success) paymentsById.set(parsed.data.id, parsed.data);
    }

    const items: AdminRefundItem[] = refunds.map((refund) => {
      const payment = paymentsById.get(refund.payment_id);
      return {
        id: refund.id,
        paymentId: refund.payment_id,
        amount: refund.amount,
        currency: refund.currency,
        method: refund.method,
        reason: refund.reason,
        adminId: refund.admin_id,
        createdAt: refund.created_at,
        orderId: payment?.order_id ?? null,
        orderReference: payment ? `#${payment.order_id}` : null,
        paymentReference: payment?.reference ?? null,
      };
    });

    return { unavailable: false, message: "", items };
  } catch {
    return unavailableRefunds(unavailableError);
  }
}
