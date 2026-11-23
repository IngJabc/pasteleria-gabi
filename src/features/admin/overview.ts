import "server-only";

/**
 * Administrator dashboard READS (KPIs, recent orders and attention counts).
 *
 * Gated by `requireActiveAdminId()` before any data access. RLS-readable tables
 * go through the cookie-bound client; the service-role client is used ONLY for
 * the `get_product_stock(p_product_id)` RPC, which is service-role-only.
 *
 * Only migration 001 exists remotely, so any of these relations may be absent.
 * All DB errors are converted to an explicit `unavailable` result with a safe
 * Spanish message; no infrastructure error text reaches the UI. The stock RPC
 * is deliberately best-effort: when it is unavailable the KPI is 0 but the
 * rest of the dashboard still renders.
 */

import { requireActiveAdminId } from "@/features/payments/admin-session";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import { toAdminOrderRow, type AdminOrderRow } from "./orders";

const SAFE_MESSAGE = "No se pudieron cargar los datos. Inténtalo de nuevo más tarde.";
const TIME_ZONE = "America/Caracas";
const ACTIVE_ORDER_STATUSES = ["pending", "confirmed", "ready"];
const PENDING_PAYMENT_STATUSES = ["pending", "in_review"];

export type AdminOverviewKpis = {
  todaySalesUsd: number;
  activeOrders: number;
  pendingVerification: number;
  availableStock: number;
};

export type AdminOverviewAttention = {
  pendingReceipts: number;
  pendingCancellations: number;
};

export type AdminOverviewResult = {
  unavailable: boolean;
  message?: string;
  kpis: AdminOverviewKpis;
  recentOrders: AdminOrderRow[];
  attention: AdminOverviewAttention;
};

function toFiniteNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function zonedPart(parts: Intl.DateTimeFormatPart[], type: string): number {
  return Number(parts.find((part) => part.type === type)?.value ?? "0");
}

/** Offset of the Caracas wall clock from UTC at `now` (DST-safe via Intl). */
function caracasOffsetMs(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);

  const asUtc = Date.UTC(
    zonedPart(parts, "year"),
    zonedPart(parts, "month") - 1,
    zonedPart(parts, "day"),
    zonedPart(parts, "hour"),
    zonedPart(parts, "minute"),
    zonedPart(parts, "second"),
  );
  return asUtc - Math.floor(now.getTime() / 1000) * 1000;
}

/** ISO instant of today's 00:00 in America/Caracas. */
function startOfCaracasDayIso(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const wallClockMidnightUtc = Date.UTC(
    zonedPart(parts, "year"),
    zonedPart(parts, "month") - 1,
    zonedPart(parts, "day"),
    0,
    0,
    0,
  );
  return new Date(wallClockMidnightUtc - caracasOffsetMs(now)).toISOString();
}

function unavailableResult(): AdminOverviewResult {
  return {
    unavailable: true,
    message: SAFE_MESSAGE,
    kpis: { todaySalesUsd: 0, activeOrders: 0, pendingVerification: 0, availableStock: 0 },
    recentOrders: [],
    attention: { pendingReceipts: 0, pendingCancellations: 0 },
  };
}

/**
 * Sum of `available_quantity` for active products. Best-effort by design: the
 * RPC lives in a local-only migration and may not exist. Any failure yields 0
 * without failing the overview. Product RPCs are issued concurrently (no
 * sequential N+1).
 */
async function readAvailableStock(): Promise<number> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: products, error } = await supabase
      .from("products")
      .select("id")
      .eq("is_active", true);

    if (error || !products || products.length === 0) return 0;

    const admin = createSupabaseAdminClient();
    const results = await Promise.all(
      products.map((product) =>
        admin.rpc("get_product_stock", { p_product_id: product.id }),
      ),
    );

    if (results.some((result) => result.error || !Array.isArray(result.data))) return 0;

    return results.reduce((total, result) => {
      const rows = Array.isArray(result.data) ? result.data : [];
      return (
        total +
        rows.reduce((sum, row) => sum + toFiniteNumber(row.available_quantity), 0)
      );
    }, 0);
  } catch {
    return 0;
  }
}

/** Single gated dashboard read; all expected DB absences degrade safely. */
export async function getAdminOverview(): Promise<AdminOverviewResult> {
  await requireActiveAdminId();

  try {
    const supabase = await createSupabaseServerClient();
    const since = startOfCaracasDayIso(new Date());

    const [todayPayments, activeOrders, pendingPayments, recentOrders, pendingReceipts, pendingCancellations] =
      await Promise.all([
        // Only approved USD components count: no cross-currency arithmetic.
        supabase
          .from("payments")
          .select("amount")
          .eq("status", "approved")
          .eq("currency", "USD")
          .gte("created_at", since),
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .in("status", ACTIVE_ORDER_STATUSES),
        supabase
          .from("payments")
          .select("id", { count: "exact", head: true })
          .in("status", PENDING_PAYMENT_STATUSES),
        supabase
          .from("orders")
          .select(
            "id, customer_name, customer_phone, total_usd, status, created_at, fulfillment_type, delivery_fee_usd, delivery_zone_id",
          )
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("receipt_submissions")
          .select("id", { count: "exact", head: true })
          .eq("review_status", "pending"),
        supabase
          .from("cancellation_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending"),
      ]);

    if (
      todayPayments.error ||
      activeOrders.error ||
      pendingPayments.error ||
      recentOrders.error ||
      pendingReceipts.error ||
      pendingCancellations.error
    ) {
      return unavailableResult();
    }

    const availableStock = await readAvailableStock();

    const recentRows = (recentOrders.data ?? []) as unknown as Array<{
      id: number;
      customer_name: string | null;
      customer_phone: string | null;
      total_usd: number;
      status: string;
      created_at: string;
      fulfillment_type?: string | null;
      delivery_fee_usd?: number | string | null;
      delivery_zone_id?: number | null;
    }>;
    const recentIds = recentRows.map((r) => r.id);
    const paymentStatusByOrder = new Map<number, string>();
    if (recentIds.length > 0) {
      const { data: recentPayments } = await supabase
        .from("payments")
        .select("order_id, status")
        .in("order_id", recentIds);
      const byOrder = new Map<number, string[]>();
      for (const row of recentPayments ?? []) {
        const orderId = Number((row as { order_id: number }).order_id);
        if (!Number.isSafeInteger(orderId)) continue;
        const statuses = byOrder.get(orderId) ?? [];
        const status = (row as { status: string }).status;
        if (typeof status === "string") statuses.push(status);
        byOrder.set(orderId, statuses);
      }
      for (const [orderId, statuses] of byOrder) {
        const normalized = [...new Set(statuses.map((s) => s.trim().toLowerCase()).filter(Boolean))];
        if (normalized.length === 0) paymentStatusByOrder.set(orderId, "none");
        else if (normalized.length === 1) paymentStatusByOrder.set(orderId, normalized[0]);
        else paymentStatusByOrder.set(orderId, "mixed");
      }
    }

    return {
      unavailable: false,
      kpis: {
        todaySalesUsd: (todayPayments.data ?? []).reduce(
          (sum, payment) => sum + toFiniteNumber(payment.amount),
          0,
        ),
        activeOrders: activeOrders.count ?? 0,
        pendingVerification: pendingPayments.count ?? 0,
        availableStock,
      },
      recentOrders: recentRows.map((row) => ({
        ...toAdminOrderRow(row),
        paymentStatus: (paymentStatusByOrder.get(row.id) as AdminOrderRow["paymentStatus"]) ?? "none",
      })),
      attention: {
        pendingReceipts: pendingReceipts.count ?? 0,
        pendingCancellations: pendingCancellations.count ?? 0,
      },
    };
  } catch {
    return unavailableResult();
  }
}
