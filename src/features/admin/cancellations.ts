import "server-only";

/**
 * Administrator cancellation-request READ (no approve/reject action).
 *
 * The business rule for resolving a cancellation request is still an open
 * decision, so this module is read-only. Values come from real
 * `cancellation_requests` rows; the order reference is derived from the real
 * order id in a SEPARATE `orders` lookup (no invented SQL joins or sequences).
 * Missing tables yield an explicit `unavailable` result with a safe message.
 */

import { requireActiveAdminId } from "@/features/payments/admin-session";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import { formatOrderReference } from "./format";

const SAFE_MESSAGE = "No se pudieron cargar los datos. Inténtalo de nuevo más tarde.";
const MAX_REQUESTS = 200;

export type AdminCancellationRequest = {
  id: number;
  orderId: number;
  orderReference: string;
  orderCustomerName: string | null;
  status: string;
  source: string;
  customerReason: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

export type AdminCancellationsResult = {
  unavailable: boolean;
  message?: string;
  items: AdminCancellationRequest[];
};

type OrderLookupRow = {
  id: number;
  customer_name: string | null;
};

function unavailableResult(): AdminCancellationsResult {
  return { unavailable: true, message: SAFE_MESSAGE, items: [] };
}

/** Latest cancellation requests with their real order reference and fields. */
export async function listCancellationRequests(): Promise<AdminCancellationsResult> {
  await requireActiveAdminId();

  try {
    const supabase = await createSupabaseServerClient();
    const { data: requests, error } = await supabase
      .from("cancellation_requests")
      .select("id, order_id, status, source, customer_reason, resolution_note, resolved_at, created_at")
      .order("created_at", { ascending: false })
      .limit(MAX_REQUESTS);

    if (error || !requests) return unavailableResult();

    const orderIds = Array.from(new Set(requests.map((request) => request.order_id)));
    const ordersById = new Map<number, OrderLookupRow>();

    if (orderIds.length > 0) {
      const { data: orders, error: ordersError } = await supabase
        .from("orders")
        .select("id, customer_name")
        .in("id", orderIds);

      if (ordersError || !orders) return unavailableResult();
      for (const order of orders) ordersById.set(order.id, order);
    }

    const items: AdminCancellationRequest[] = requests.map((request) => {
      const order = ordersById.get(request.order_id);
      return {
        id: request.id,
        orderId: request.order_id,
        orderReference: formatOrderReference(String(request.order_id)),
        orderCustomerName:
          typeof order?.customer_name === "string" ? order.customer_name : null,
        status: request.status,
        source: request.source,
        customerReason:
          typeof request.customer_reason === "string" ? request.customer_reason : null,
        resolutionNote:
          typeof request.resolution_note === "string" ? request.resolution_note : null,
        resolvedAt: typeof request.resolved_at === "string" ? request.resolved_at : null,
        createdAt: request.created_at,
      };
    });

    return { unavailable: false, items };
  } catch {
    return unavailableResult();
  }
}
