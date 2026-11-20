"use server";

import { z } from "zod";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { requireActiveAdminId } from "./admin-session";
import {
  idempotencyKeySchema,
  invalidPaymentInputError,
  nonNegativeMoneySchema,
  paymentsPublicError,
  positiveMoneySchema,
  posItemSchema,
  posSaleResultSchema,
  refundResultSchema,
  registeredPaymentSchema,
  reviewResultSchema,
} from "./schemas";

/** Administrator-only payment mutations. No client supplies an admin id. */

const cashSchema = z.object({
  orderId: z.number().int().positive(),
  amount: positiveMoneySchema,
  amountTenderedUsd: nonNegativeMoneySchema.optional(),
  idempotencyKey: idempotencyKeySchema,
});

const reviewSchema = z.object({
  paymentId: z.number().int().positive(),
  decision: z.enum(["approve", "reject"]),
});

const posSchema = z.object({
  items: z.array(posItemSchema).min(1),
  amountTenderedUsd: nonNegativeMoneySchema,
  idempotencyKey: idempotencyKeySchema,
});

const refundSchema = z.object({
  paymentId: z.number().int().positive(),
  amount: positiveMoneySchema,
  method: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(1).max(240),
  idempotencyKey: idempotencyKeySchema,
});

export type CashPaymentResult =
  | {
      ok: true;
      paymentId: number;
      orderId: number;
      status: string;
      changeUsd: string | number | null;
      idempotent: boolean;
    }
  | { ok: false; error: string };

export type ReviewPaymentResult =
  | {
      ok: true;
      paymentId: number;
      orderId: number;
      status: string;
      orderStatus?: string;
      idempotent: boolean;
    }
  | { ok: false; error: string };

export type PosSaleResult =
  | {
      ok: true;
      orderId: number;
      paymentId: number;
      status: string;
      changeUsd: string | number;
      idempotent: boolean;
    }
  | { ok: false; error: string };

export type RefundResult =
  | {
      ok: true;
      refundId: number;
      paymentId: number;
      status: string;
      totalRefunded?: string | number;
      idempotent: boolean;
    }
  | { ok: false; error: string };

const invalidSessionError = "La sesión del administrador no es válida.";
const genericError = "No se pudo completar la operación. Inténtalo de nuevo.";

async function withAdmin<T>(
  action: (adminId: string, supabase: ReturnType<typeof createSupabaseAdminClient>) => Promise<T>,
): Promise<T | { ok: false; error: string }> {
  let adminId: string;
  try {
    adminId = await requireActiveAdminId();
  } catch {
    return { ok: false, error: invalidSessionError };
  }
  return action(adminId, createSupabaseAdminClient());
}

export async function registerCashPayment(input: {
  orderId: number;
  amount: string;
  amountTenderedUsd?: string;
  idempotencyKey: string;
}): Promise<CashPaymentResult> {
  const parsed = cashSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: String(parsed.error.issues[0]?.message ?? invalidPaymentInputError),
    };
  }

  return withAdmin(async (adminId, supabase) => {
    const { orderId, amount, amountTenderedUsd, idempotencyKey } = parsed.data;
    const { data, error } = await supabase.rpc("register_payment", {
      p_order_id: orderId,
      p_method: "cash_usd",
      p_currency: "USD",
      p_amount: amount,
      p_reference: null,
      p_receipt_path: null,
      p_amount_tendered_usd: amountTenderedUsd ?? amount,
      p_idempotency_key: idempotencyKey,
      p_registered_by: adminId,
      p_collected: true,
    });
    if (error) {
      return { ok: false, error: paymentsPublicError(error.message, genericError) };
    }
    const result = registeredPaymentSchema.safeParse(data);
    if (!result.success) {
      return { ok: false, error: genericError };
    }
    return {
      ok: true,
      paymentId: result.data.payment_id,
      orderId: result.data.order_id,
      status: result.data.status,
      changeUsd: result.data.change_usd ?? null,
      idempotent: result.data.idempotent,
    };
  });
}

export async function reviewPayment(input: {
  paymentId: number;
  decision: "approve" | "reject";
}): Promise<ReviewPaymentResult> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: String(parsed.error.issues[0]?.message ?? invalidPaymentInputError),
    };
  }

  return withAdmin(async (adminId, supabase) => {
    const rpcName = parsed.data.decision === "approve" ? "approve_payment" : "reject_payment";
    const { data, error } = await supabase.rpc(rpcName, {
      p_payment_id: parsed.data.paymentId,
      p_admin_id: adminId,
    });
    if (error) {
      return { ok: false, error: paymentsPublicError(error.message, genericError) };
    }
    const result = reviewResultSchema.safeParse(data);
    if (!result.success) {
      return { ok: false, error: genericError };
    }
    return {
      ok: true,
      paymentId: result.data.payment_id,
      orderId: result.data.order_id,
      status: result.data.status,
      orderStatus: result.data.order_status,
      idempotent: result.data.idempotent,
    };
  });
}

export async function registerPosCashSale(input: {
  items: Array<{ productId: number; quantity: number }>;
  amountTenderedUsd: string;
  idempotencyKey: string;
}): Promise<PosSaleResult> {
  const parsed = posSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: String(parsed.error.issues[0]?.message ?? invalidPaymentInputError),
    };
  }

  return withAdmin(async (adminId, supabase) => {
    const { data, error } = await supabase.rpc("register_pos_cash_sale", {
      p_items: parsed.data.items.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
      })),
      p_amount_tendered_usd: parsed.data.amountTenderedUsd,
      p_idempotency_key: parsed.data.idempotencyKey,
      p_admin_id: adminId,
    });
    if (error) {
      return { ok: false, error: paymentsPublicError(error.message, genericError) };
    }
    const result = posSaleResultSchema.safeParse(data);
    if (!result.success) {
      return { ok: false, error: genericError };
    }
    return {
      ok: true,
      orderId: result.data.order_id,
      paymentId: result.data.payment_id,
      status: result.data.status,
      changeUsd: result.data.change_usd,
      idempotent: result.data.idempotent,
    };
  });
}

export async function recordPaymentRefund(input: {
  paymentId: number;
  amount: string;
  method: string;
  reason: string;
  idempotencyKey: string;
}): Promise<RefundResult> {
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: String(parsed.error.issues[0]?.message ?? invalidPaymentInputError),
    };
  }

  return withAdmin(async (adminId, supabase) => {
    const { data, error } = await supabase.rpc("record_refund", {
      p_payment_id: parsed.data.paymentId,
      p_amount: parsed.data.amount,
      p_method: parsed.data.method,
      p_reason: parsed.data.reason,
      p_admin_id: adminId,
      p_idempotency_key: parsed.data.idempotencyKey,
    });
    if (error) {
      return { ok: false, error: paymentsPublicError(error.message, genericError) };
    }
    const result = refundResultSchema.safeParse(data);
    if (!result.success) {
      return { ok: false, error: genericError };
    }
    return {
      ok: true,
      refundId: result.data.refund_id,
      paymentId: result.data.payment_id,
      status: result.data.status,
      totalRefunded: result.data.total_refunded,
      idempotent: result.data.idempotent,
    };
  });
}
