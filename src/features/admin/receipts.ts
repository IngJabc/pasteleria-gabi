import "server-only";

import { z } from "zod";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import { requireActiveAdminId } from "@/features/payments/admin-session";
import {
  RECEIPT_BUCKET,
  RECEIPT_CONTENT_TYPES,
  RECEIPT_REVIEW_URL_LIFETIME_SECONDS,
} from "@/features/payments/schemas";

/**
 * Admin receipt queue (read-only).
 *
 * All data comes from real rows: `payments` holds the evidence path and the
 * financial component, `receipt_submissions` holds the review clock, and
 * `orders` is queried separately to confirm that the reference refers to a
 * real order. Nothing here approves or rejects a payment — the UI reuses the
 * existing `reviewPayment` action for that.
 *
 * `receiptPath` stays server-side: this module is marked `server-only`, the
 * queue item is consumed by a Server Component, and the path is never handed
 * to a Client Component. The UI calls `getAdminReceiptUrl` per render instead.
 */

const unavailableError =
  "La cola de comprobantes no está disponible en este momento.";
const invalidSessionError = "La sesión del administrador no es válida.";

const digitalPaymentMethods = [
  "pago_movil",
  "binance_pay",
  "binance_transfer",
] as const;

const paymentRowSchema = z.object({
  id: z.number().int().positive(),
  order_id: z.number().int().positive(),
  method: z.string().min(1),
  currency: z.string().min(1),
  amount: z.coerce.number().positive(),
  reference: z.string().nullable(),
  receipt_path: z.string().min(1),
});

const submissionRowSchema = z.object({
  id: z.number().int().positive(),
  order_id: z.number().int().positive(),
  payment_id: z.number().int().positive().nullable(),
  submitted_at: z.string().min(1),
});

const orderRowSchema = z.object({ id: z.number().int().positive() });

const signedUrlSchema = z.url();

/**
 * Evidence paths are generated as `<order id>/<uuid>.<extension>` inside the
 * private bucket. Requiring that exact shape rejects absolute URLs, path
 * traversal, and any attempt to name a different bucket.
 */
const receiptExtensions = [...new Set(Object.values(RECEIPT_CONTENT_TYPES))];
const receiptPathSchema = z
  .string()
  .trim()
  .min(1)
  .regex(
    new RegExp(
      `^[0-9]+/[0-9a-f-]+\\.(${receiptExtensions.join("|")})$`,
      "i",
    ),
    "La ruta del comprobante no es válida.",
  );

export type AdminReceiptQueueItem = {
  paymentId: number;
  orderId: number;
  /** Derived from the real order id, never invented. */
  orderReference: string;
  method: string;
  amount: number;
  currency: string;
  reference: string | null;
  submittedAt: string;
  /** SERVER ONLY — never forward this field to a Client Component. */
  receiptPath: string;
};

export type AdminReceiptQueueResult = {
  unavailable: boolean;
  message: string;
  items: AdminReceiptQueueItem[];
};

function unavailableResult(message: string): AdminReceiptQueueResult {
  return { unavailable: true, message, items: [] };
}

export async function listPendingReceipts(options?: { orderId?: number }): Promise<AdminReceiptQueueResult> {
  try {
    await requireActiveAdminId();
  } catch {
    return unavailableResult(invalidSessionError);
  }

  try {
    const supabase = await createSupabaseServerClient();

    let submissionsQuery = supabase
      .from("receipt_submissions")
      .select("id, order_id, payment_id, submitted_at")
      .eq("review_status", "pending")
      .order("submitted_at", { ascending: false })
      .limit(100);
    if (typeof options?.orderId === "number" && Number.isInteger(options.orderId) && options.orderId > 0) {
      submissionsQuery = submissionsQuery.eq("order_id", options.orderId);
    }
    const submissionsResult = await submissionsQuery;
    if (submissionsResult.error) return unavailableResult(unavailableError);

    let paymentsQuery = supabase
      .from("payments")
      .select("id, order_id, method, currency, amount, reference, receipt_path")
      .in("status", ["pending", "in_review"])
      .in("method", [...digitalPaymentMethods])
      .order("id", { ascending: false })
      .limit(200);
    if (typeof options?.orderId === "number" && Number.isInteger(options.orderId) && options.orderId > 0) {
      paymentsQuery = paymentsQuery.eq("order_id", options.orderId);
    }
    const paymentsResult = await paymentsQuery;
    if (paymentsResult.error) return unavailableResult(unavailableError);

    const submissions: Array<{
      id: number;
      orderId: number;
      paymentId: number | null;
      submittedAt: string;
    }> = [];
    for (const row of submissionsResult.data ?? []) {
      const parsed = submissionRowSchema.safeParse(row);
      if (!parsed.success) continue;
      submissions.push({
        id: parsed.data.id,
        orderId: parsed.data.order_id,
        paymentId: parsed.data.payment_id,
        submittedAt: parsed.data.submitted_at,
      });
    }

    const paymentsById = new Map<number, z.infer<typeof paymentRowSchema>>();
    for (const row of paymentsResult.data ?? []) {
      const parsed = paymentRowSchema.safeParse(row);
      if (!parsed.success) continue;
      paymentsById.set(parsed.data.id, parsed.data);
    }

    const candidates = submissions.flatMap((submission) => {
      if (submission.paymentId === null) return [];
      const payment = paymentsById.get(submission.paymentId);
      if (!payment || payment.order_id !== submission.orderId) return [];
      return [{ submission, payment }];
    });
    if (candidates.length === 0) {
      return { unavailable: false, message: "", items: [] };
    }

    const orderIds = [...new Set(candidates.map((item) => item.payment.order_id))];
    const ordersResult = await supabase
      .from("orders")
      .select("id")
      .in("id", orderIds);
    if (ordersResult.error) return unavailableResult(unavailableError);

    const knownOrderIds = new Set<number>();
    for (const row of ordersResult.data ?? []) {
      const parsed = orderRowSchema.safeParse(row);
      if (parsed.success) knownOrderIds.add(parsed.data.id);
    }

    const items: AdminReceiptQueueItem[] = [];
    for (const { submission, payment } of candidates) {
      if (!knownOrderIds.has(payment.order_id)) continue;
      items.push({
        paymentId: payment.id,
        orderId: payment.order_id,
        orderReference: `#${payment.order_id}`,
        method: payment.method,
        amount: payment.amount,
        currency: payment.currency,
        reference: typeof payment.reference === "string" ? payment.reference : null,
        submittedAt: submission.submittedAt,
        receiptPath: payment.receipt_path,
      });
    }

    return { unavailable: false, message: "", items };
  } catch {
    return unavailableResult(unavailableError);
  }
}

/**
 * Mints a short-lived signed URL for one validated evidence path using the
 * cookie-bound client: the bucket's admin SELECT policy is the final gate.
 * Returns `null` for any invalid input, session failure or storage error.
 */
export async function getAdminReceiptUrl(
  receiptPath: string,
): Promise<string | null> {
  try {
    await requireActiveAdminId();
  } catch {
    return null;
  }

  const parsed = receiptPathSchema.safeParse(receiptPath);
  if (!parsed.success) return null;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.storage
      .from(RECEIPT_BUCKET)
      .createSignedUrl(
        parsed.data,
        RECEIPT_REVIEW_URL_LIFETIME_SECONDS,
      );
    if (error || !data?.signedUrl) return null;
    const signedUrl = signedUrlSchema.safeParse(data.signedUrl);
    return signedUrl.success ? signedUrl.data : null;
  } catch {
    return null;
  }
}
