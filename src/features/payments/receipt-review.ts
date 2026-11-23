"use server";

import { z } from "zod";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import {
  RECEIPT_BUCKET,
  RECEIPT_REVIEW_URL_LIFETIME_SECONDS,
  receiptReviewUnavailableError,
  trackedOrderSchema,
  trackingTokenSchema,
  type ReceiptReviewResult,
} from "./schemas";

/** OQ-12: read-only, token-authorised receipt re-view. No client path or id. */

const byTokenSchema = z.object({ trackingToken: trackingTokenSchema });

const paymentRowsSchema = z.array(
  z.object({
    receipt_path: z.string().min(1),
    status: z.string().min(1),
  }),
);

const signedUrlSchema = z.string().url();

const excludedOrderStatuses = new Set(["canceled", "expired"]);

export async function getReceiptUrlsForTracking(input: {
  trackingToken: string;
}): Promise<ReceiptReviewResult> {
  const parsed = byTokenSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: receiptReviewUnavailableError };
  }

  try {
    const supabase = createSupabaseAdminClient();

    const tracked = await supabase.rpc("get_order_for_tracking", {
      p_token: parsed.data.trackingToken,
    });
    if (tracked.error) {
      return { ok: false, error: receiptReviewUnavailableError };
    }

    const order = trackedOrderSchema.safeParse(tracked.data);
    if (!order.success || !order.data || excludedOrderStatuses.has(order.data.status)) {
      return { ok: false, error: receiptReviewUnavailableError };
    }

    const orderId = order.data.order_id;

    const paymentsResult = await supabase
      .from("payments")
      .select("receipt_path, status")
      .eq("order_id", orderId)
      .not("receipt_path", "is", null)
      .order("created_at", { ascending: true });
    if (paymentsResult.error) {
      return { ok: false, error: receiptReviewUnavailableError };
    }

    const payments = paymentRowsSchema.safeParse(paymentsResult.data);
    if (!payments.success || payments.data.length === 0) {
      return { ok: false, error: receiptReviewUnavailableError };
    }

    const submissionsResult = await supabase
      .from("receipt_submissions")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId);
    if (
      submissionsResult.error ||
      typeof submissionsResult.count !== "number" ||
      submissionsResult.count < 1
    ) {
      return { ok: false, error: receiptReviewUnavailableError };
    }

    const urls: string[] = [];
    for (const payment of payments.data) {
      const signed = await supabase.storage
        .from(RECEIPT_BUCKET)
        .createSignedUrl(payment.receipt_path, RECEIPT_REVIEW_URL_LIFETIME_SECONDS);
      const signedUrl = signedUrlSchema.safeParse(signed.data?.signedUrl);
      if (signed.error || !signedUrl.success) {
        return { ok: false, error: receiptReviewUnavailableError };
      }
      urls.push(signedUrl.data);
    }

    return { ok: true, urls };
  } catch {
    return { ok: false, error: receiptReviewUnavailableError };
  }
}
