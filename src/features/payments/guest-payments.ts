"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import {
  RECEIPT_BUCKET,
  RECEIPT_CONTENT_TYPES,
  digitalPaymentMethodSchema,
  evidenceResultSchema,
  idempotencyKeySchema,
  invalidPaymentInputError,
  invalidReceiptError,
  MAX_RECEIPT_BYTES,
  paymentsPublicError,
  positiveMoneySchema,
  receiptFileSchema,
  referenceSchema,
  registeredPaymentSchema,
  trackedOrderSchema,
  trackingTokenSchema,
} from "./schemas";

/** Guest-side payment registration. The tracking token is the only credential. */

const registerDigitalSchema = z.object({
  trackingToken: trackingTokenSchema,
  method: digitalPaymentMethodSchema,
  amount: positiveMoneySchema,
  reference: referenceSchema,
  idempotencyKey: idempotencyKeySchema,
  file: receiptFileSchema,
});

export type RegisterDigitalPaymentResult =
  | {
      ok: true;
      paymentId: number;
      orderId: number;
      status: string;
      submissionId: number;
      attemptNumber: number;
      idempotent: boolean;
    }
  | { ok: false; error: string };

const genericError = "No se pudo registrar el pago. Inténtalo de nuevo.";

export async function registerDigitalPaymentWithReceipt(input: {
  trackingToken: string;
  method: "pago_movil" | "binance_pay" | "binance_transfer";
  amount: string;
  reference: string;
  idempotencyKey: string;
  file: unknown;
}): Promise<RegisterDigitalPaymentResult> {
  const parsed = registerDigitalSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: String(parsed.error.issues[0]?.message ?? invalidPaymentInputError),
    };
  }

  const { trackingToken, method, amount, reference, idempotencyKey, file } = parsed.data;
  const extension = RECEIPT_CONTENT_TYPES[file.type];
  if (!extension || file.size === 0 || file.size > MAX_RECEIPT_BYTES) {
    return { ok: false, error: invalidReceiptError };
  }

  const supabase = createSupabaseAdminClient();

  const tracked = await supabase.rpc("get_order_for_tracking", { p_token: trackingToken });
  if (tracked.error) {
    return { ok: false, error: paymentsPublicError(tracked.error.message, genericError) };
  }
  const order = trackedOrderSchema.safeParse(tracked.data);
  if (!order.success || !order.data) {
    return { ok: false, error: "El enlace de seguimiento no es válido." };
  }
  if (!["pending", "confirmed"].includes(order.data.status)) {
    return { ok: false, error: "El pedido ya no admite pagos." };
  }
  if (order.data.delivery_requires_quote === true && order.data.delivery_fee_usd === null) {
    return {
      ok: false,
      error: "El delivery de este pedido aún está pendiente por cotizar.",
    };
  }
  if (
    order.data.delivery_requires_quote === true &&
    order.data.delivery_fee_usd !== null &&
    !order.data.quote_accepted_at
  ) {
    return {
      ok: false,
      error: "Debes aceptar la cotización de delivery antes de registrar el pago.",
    };
  }
  const expectedTotal = Number(order.data.total_usd);
  const amountValue = Number(amount);
  if (Number.isFinite(expectedTotal) && Number.isFinite(amountValue) && method !== "pago_movil") {
    // USD/USDT are 1:1 in this system; VES is validated separately by BCV snapshot rules.
    if (Math.abs(amountValue - expectedTotal) > 0.01) {
      return {
        ok: false,
        error: "El monto debe coincidir con el total final del pedido.",
      };
    }
  }

  const path = `${order.data.order_id}/${randomUUID()}.${extension}`;
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    return { ok: false, error: invalidReceiptError };
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_RECEIPT_BYTES) {
    return { ok: false, error: invalidReceiptError };
  }

  const upload = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(path, new Blob([bytes], { type: file.type }), {
      contentType: file.type,
      upsert: false,
    });
  if (upload.error) {
    return { ok: false, error: "No se pudo subir el comprobante. Inténtalo de nuevo." };
  }

  const registration = await supabase.rpc("register_payment_for_tracking", {
    p_token: trackingToken,
    p_method: method,
    p_amount: amount,
    p_reference: reference,
    p_receipt_path: path,
    p_idempotency_key: idempotencyKey,
  });
  if (registration.error) {
    // No financial row was created: remove the orphaned private object.
    await supabase.storage.from(RECEIPT_BUCKET).remove([path]);
    return {
      ok: false,
      error: paymentsPublicError(registration.error.message, genericError),
    };
  }
  const payment = registeredPaymentSchema.safeParse(registration.data);
  if (!payment.success) {
    await supabase.storage.from(RECEIPT_BUCKET).remove([path]);
    return { ok: false, error: genericError };
  }

  // Evidence submission is the one place that consumes an order receipt
  // attempt. It stays in the same RPC transaction as the M5 submission row.
  const evidence = await supabase.rpc("submit_payment_evidence", {
    p_payment_id: payment.data.payment_id,
  });
  if (evidence.error) {
    // The payment row owns the path now; removing it would break evidence.
    return { ok: false, error: paymentsPublicError(evidence.error.message, genericError) };
  }
  const submission = evidenceResultSchema.safeParse(evidence.data);
  if (!submission.success) {
    return { ok: false, error: genericError };
  }

  return {
    ok: true,
    paymentId: payment.data.payment_id,
    orderId: payment.data.order_id,
    status: payment.data.status,
    submissionId: submission.data.submission_id,
    attemptNumber: submission.data.attempt_number,
    idempotent: payment.data.idempotent && submission.data.idempotent,
  };
}
