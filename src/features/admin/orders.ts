import "server-only";

/**
 * Administrator-only ORDER READS.
 *
 * Every exported helper is gated by `requireActiveAdminId()` before touching
 * data. All reads use the cookie-bound client so the existing `*_admin_all`
 * RLS policies apply. No order reference/customer/payment value is invented:
 * references are derived from the real order id via `formatOrderReference`.
 *
 * A missing table (only migration 001 is applied remotely) is an expected DB
 * absence, so it yields an explicit `unavailable` result with a safe message;
 * infrastructure error details are never exposed to the UI.
 */

import { requireActiveAdminId } from "@/features/payments/admin-session";
import { getAdminPaymentSummary } from "@/features/payments/payment-summary";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import { formatOrderReference } from "./format";

const SAFE_MESSAGE = "No se pudieron cargar los datos. Inténtalo de nuevo más tarde.";
const DEFAULT_PAGE_SIZE = 10;
const MIN_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 50;
const MAX_SEARCH_LENGTH = 100;

const ORDER_STATUSES = new Set([
  "pending",
  "confirmed",
  "ready",
  "completed",
  "canceled",
  "expired",
]);

export type AdminOrderListPaymentStatus =
  | "none"
  | "pending"
  | "in_review"
  | "approved"
  | "rejected"
  | "refunded_partial"
  | "refunded_full"
  | "mixed"
  | "unavailable";

export type AdminOrderListReservationStatus =
  | "none"
  | "active"
  | "held"
  | "expired"
  | "consumed"
  | "released"
  | "mixed"
  | "unavailable";

/** Serializable projection of one real `orders` row for admin lists. */
export type AdminOrderRow = {
  id: number;
  reference: string;
  customerName: string | null;
  customerPhone: string | null;
  totalUsd: number;
  status: string;
  createdAt: string;
  fulfillmentType: string | null;
  deliveryFeeUsd: number | null;
  deliveryZoneRequiresQuote: boolean | null;
  paymentStatus: AdminOrderListPaymentStatus;
  reservationStatus: AdminOrderListReservationStatus;
};

export type AdminOrdersResult = {
  unavailable: boolean;
  message?: string;
  items: AdminOrderRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminOrderItemView = {
  id: number;
  productId: number;
  productName: string;
  unitPriceUsd: number;
  quantity: number;
};

export type AdminOrderPaymentView = {
  id: number;
  method: string;
  currency: string;
  amount: number;
  reference: string | null;
  status: string;
  createdAt: string;
};

export type AdminOrderCancellationView = {
  id: number;
  status: string;
  source: string;
  customerReason: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

export type AdminCurrencySummary = {
  currency: string;
  approvedAmount: number;
  pendingAmount: number;
  inReviewAmount: number;
  rejectedAmount: number;
  refundedAmount: number;
  paymentCount: number;
};

/** `available: false` means the existing summary RPC degraded gracefully. */
export type AdminPaymentSummaryView = {
  available: boolean;
  byCurrency: AdminCurrencySummary[];
};

export type AdminOrderDetail = {
  id: number;
  reference: string;
  channel: string;
  status: string;
  customerName: string | null;
  customerPhone: string | null;
  fulfillmentType: string | null;
  /** Real delivery columns from `orders`; null when the row has no value. */
  addressLine: string | null;
  addressReferences: string | null;
  additionalInstructions: string | null;
  deliveryZoneId: number | null;
  deliveryZoneName: string | null;
  deliveryZoneRequiresQuote: boolean | null;
  deliveryFeeUsd: number | null;
  quoteAcceptedAt: string | null;
  bcvRateVes: number | null;
  totalVes: number | null;
  roundingRule: string | null;
  subtotalUsd: number;
  totalUsd: number;
  createdAt: string;
  updatedAt: string;
  items: AdminOrderItemView[];
  payments: AdminOrderPaymentView[];
  cancellations: AdminOrderCancellationView[];
  paymentSummary: AdminPaymentSummaryView;
};

export type AdminOrderDetailResult = {
  unavailable: boolean;
  message?: string;
  /** `null` means the order does not exist; it is not an availability failure. */
  order: AdminOrderDetail | null;
};

type OrderRowForList = {
  id: number;
  customer_name: string | null;
  customer_phone: string | null;
  total_usd: number;
  status: string;
  created_at: string;
  fulfillment_type?: string | null;
  delivery_fee_usd?: number | string | null;
  delivery_zone_id?: number | null;
};

function toFiniteNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function aggregatePaymentStatus(statuses: string[]): AdminOrderListPaymentStatus {
  if (statuses.length === 0) return "none";
  const normalized = statuses.map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (normalized.length === 0) return "none";
  const unique = [...new Set(normalized)];
  if (unique.length === 1) {
    const s = unique[0];
    if (
      s === "pending" ||
      s === "in_review" ||
      s === "approved" ||
      s === "rejected" ||
      s === "refunded_partial" ||
      s === "refunded_full"
    ) {
      return s;
    }
    return "mixed";
  }
  return "mixed";
}

function aggregateReservationStatus(
  rows: Array<{ status: string; expires_at: string | null }>,
): AdminOrderListReservationStatus {
  if (rows.length === 0) return "none";
  const now = Date.now();
  const normalized = rows.map((row) => {
    const s = row.status.trim().toLowerCase();
    if (s === "active") {
      const expires = row.expires_at ? Date.parse(row.expires_at) : NaN;
      if (row.expires_at === null) return "held" as const;
      if (Number.isFinite(expires) && expires <= now) return "expired" as const;
      return "active" as const;
    }
    if (s === "consumed" || s === "released" || s === "expired") return s;
    return "mixed" as const;
  });
  const unique = [...new Set(normalized)];
  return unique.length === 1 ? unique[0] : "mixed";
}

async function readOrderListEnrichment(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  rows: OrderRowForList[],
): Promise<{
  paymentByOrder: Map<number, AdminOrderListPaymentStatus>;
  reservationByOrder: Map<number, AdminOrderListReservationStatus>;
  quoteRequiredByZone: Map<number, boolean | null>;
}> {
  const orderIds = rows.map((r) => r.id);
  const paymentByOrder = new Map<number, AdminOrderListPaymentStatus>();
  const reservationByOrder = new Map<number, AdminOrderListReservationStatus>();
  const quoteRequiredByZone = new Map<number, boolean | null>();

  if (orderIds.length === 0) {
    return { paymentByOrder, reservationByOrder, quoteRequiredByZone };
  }

  try {
    const zoneIds = [
      ...new Set(
        rows
          .map((r) => r.delivery_zone_id)
          .filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0),
      ),
    ];

    const [paymentsResult, reservationsResult, zonesResult] = await Promise.all([
      supabase.from("payments").select("order_id, status").in("order_id", orderIds),
      supabase
        .from("inventory_reservations")
        .select("order_id, status, expires_at")
        .in("order_id", orderIds),
      zoneIds.length > 0
        ? supabase.from("delivery_zones").select("id, requires_quote").in("id", zoneIds)
        : Promise.resolve({ data: [] as Array<{ id: number; requires_quote: boolean }>, error: null }),
    ]);

    if (!paymentsResult.error && paymentsResult.data) {
      const byOrder = new Map<number, string[]>();
      for (const row of paymentsResult.data) {
        const orderId = Number(row.order_id);
        if (!Number.isSafeInteger(orderId)) continue;
        const list = byOrder.get(orderId) ?? [];
        if (typeof row.status === "string") list.push(row.status);
        byOrder.set(orderId, list);
      }
      for (const orderId of orderIds) {
        paymentByOrder.set(orderId, aggregatePaymentStatus(byOrder.get(orderId) ?? []));
      }
    } else {
      for (const orderId of orderIds) paymentByOrder.set(orderId, "unavailable");
    }

    if (!reservationsResult.error && reservationsResult.data) {
      const byOrder = new Map<number, Array<{ status: string; expires_at: string | null }>>();
      for (const row of reservationsResult.data) {
        const orderId = Number(row.order_id);
        if (!Number.isSafeInteger(orderId)) continue;
        const list = byOrder.get(orderId) ?? [];
        list.push({
          status: typeof row.status === "string" ? row.status : "",
          expires_at: typeof row.expires_at === "string" ? row.expires_at : null,
        });
        byOrder.set(orderId, list);
      }
      for (const orderId of orderIds) {
        reservationByOrder.set(orderId, aggregateReservationStatus(byOrder.get(orderId) ?? []));
      }
    } else {
      for (const orderId of orderIds) reservationByOrder.set(orderId, "unavailable");
    }

    if (!zonesResult.error && zonesResult.data) {
      for (const zone of zonesResult.data as Array<{ id: number; requires_quote: boolean }>) {
        if (Number.isSafeInteger(zone.id)) quoteRequiredByZone.set(zone.id, zone.requires_quote === true);
      }
    }
  } catch {
    for (const orderId of orderIds) {
      if (!paymentByOrder.has(orderId)) paymentByOrder.set(orderId, "unavailable");
      if (!reservationByOrder.has(orderId)) reservationByOrder.set(orderId, "unavailable");
    }
  }

  return { paymentByOrder, reservationByOrder, quoteRequiredByZone };
}

/** Shared mapper so list and overview rows carry the same base projection. */
export function toAdminOrderRow(row: OrderRowForList): AdminOrderRow {
  const deliveryFeeUsd =
    row.delivery_fee_usd === null || row.delivery_fee_usd === undefined
      ? null
      : toFiniteNumber(row.delivery_fee_usd);
  const deliveryZoneId =
    typeof row.delivery_zone_id === "number" && Number.isSafeInteger(row.delivery_zone_id)
      ? row.delivery_zone_id
      : null;
  return {
    id: row.id,
    reference: formatOrderReference(String(row.id)),
    customerName: typeof row.customer_name === "string" ? row.customer_name : null,
    customerPhone: typeof row.customer_phone === "string" ? row.customer_phone : null,
    totalUsd: toFiniteNumber(row.total_usd),
    status: row.status,
    createdAt: row.created_at,
    fulfillmentType: typeof row.fulfillment_type === "string" ? row.fulfillment_type : null,
    deliveryFeeUsd,
    deliveryZoneRequiresQuote: deliveryZoneId ? null : null,
    paymentStatus: "unavailable",
    reservationStatus: "unavailable",
  };
}

function unavailableList(page: number, pageSize: number): AdminOrdersResult {
  return { unavailable: true, message: SAFE_MESSAGE, items: [], total: 0, page, pageSize };
}

function unavailableDetail(): AdminOrderDetailResult {
  return { unavailable: true, message: SAFE_MESSAGE, order: null };
}

function normalizePage(value: number | undefined): number {
  const page = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 1;
  return page >= 1 ? page : 1;
}

function normalizePageSize(value: number | undefined): number {
  const size =
    typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, size));
}

/** Keep user-supplied search text out of PostgREST filter syntax. */
function sanitizeSearch(raw: string | undefined): string {
  if (typeof raw !== "string") return "";
  return Array.from(raw)
    .filter((character) => /[\p{L}\p{N}\s.+\-@_]/u.test(character))
    .join("")
    .slice(0, MAX_SEARCH_LENGTH)
    .trim();
}

function ilikePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/** Admin order queue with bounded server-side filtering and pagination. */
export async function listAdminOrders(input: {
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<AdminOrdersResult> {
  await requireActiveAdminId();

  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);

  try {
    const supabase = await createSupabaseServerClient();
    const search = sanitizeSearch(input.search);
    const status = typeof input.status === "string" && ORDER_STATUSES.has(input.status)
      ? input.status
      : null;

    let query = supabase
      .from("orders")
      .select(
        "id, customer_name, customer_phone, total_usd, status, created_at, fulfillment_type, delivery_fee_usd, delivery_zone_id",
        { count: "exact" },
      );

    // There is no reference column on `orders`: search the real customer
    // columns plus an exact numeric id (the source of the derived reference).
    if (search) {
      const filters = [
        `customer_name.ilike.${ilikePattern(search)}`,
        `customer_phone.ilike.${ilikePattern(search)}`,
      ];
      if (/^\d+$/.test(search)) {
        const orderId = Number(search);
        if (Number.isSafeInteger(orderId)) filters.push(`id.eq.${orderId}`);
      }
      query = query.or(filters.join(","));
    }

    if (status) query = query.eq("status", status);

    const from = (page - 1) * pageSize;
    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (error || !data) return unavailableList(page, pageSize);

    const rows = data as unknown as OrderRowForList[];
    const enrichment = await readOrderListEnrichment(supabase, rows);
    const items = rows.map((row) => {
      const base = toAdminOrderRow(row);
      const zoneId =
        typeof row.delivery_zone_id === "number" && Number.isSafeInteger(row.delivery_zone_id)
          ? row.delivery_zone_id
          : null;
      return {
        ...base,
        deliveryZoneRequiresQuote: zoneId ? enrichment.quoteRequiredByZone.get(zoneId) ?? null : false,
        paymentStatus: enrichment.paymentByOrder.get(row.id) ?? "unavailable",
        reservationStatus: enrichment.reservationByOrder.get(row.id) ?? "unavailable",
      };
    });

    return {
      unavailable: false,
      items,
      total: count ?? 0,
      page,
      pageSize,
    };
  } catch {
    return unavailableList(page, pageSize);
  }
}

/** Best-effort enrichment: a failing summary never fails the detail read. */
async function readPaymentSummary(orderId: number): Promise<AdminPaymentSummaryView> {
  const empty: AdminPaymentSummaryView = { available: false, byCurrency: [] };
  try {
    const result = await getAdminPaymentSummary({ orderId });
    if (!result.ok || !isRecord(result.summary)) return empty;

    const byCurrency = Object.entries(result.summary).map(([currency, raw]) => {
      const entry = isRecord(raw) ? raw : {};
      return {
        currency: currency.toUpperCase(),
        approvedAmount: toFiniteNumber(entry.approved_amount),
        pendingAmount: toFiniteNumber(entry.pending_amount),
        inReviewAmount: toFiniteNumber(entry.in_review_amount),
        rejectedAmount: toFiniteNumber(entry.rejected_amount),
        refundedAmount: toFiniteNumber(entry.refunded_amount),
        paymentCount: toFiniteNumber(entry.payment_count),
      };
    });

    return { available: true, byCurrency };
  } catch {
    return empty;
  }
}

/** Order detail built from separate real queries — no invented SQL joins. */
export async function getAdminOrderDetail(orderId: string): Promise<AdminOrderDetailResult> {
  await requireActiveAdminId();

  const parsedId = Number(orderId);
  // A malformed id means "not found", not a data-source failure.
  if (!Number.isSafeInteger(parsedId) || parsedId <= 0) {
    return { unavailable: false, order: null };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const [orderResult, itemsResult, paymentsResult, cancellationsResult] = await Promise.all([
      supabase
        .from("orders")
        .select(
          "id, channel, status, customer_name, customer_phone, fulfillment_type, address_line, address_references, additional_instructions, delivery_zone_id, delivery_fee_usd, quote_accepted_at, bcv_rate_ves, total_ves, rounding_rule, subtotal_usd, total_usd, created_at, updated_at",
        )
        .eq("id", parsedId)
        .maybeSingle(),
      supabase
        .from("order_items")
        .select("id, product_id, product_name, unit_price_usd, quantity")
        .eq("order_id", parsedId)
        .order("id", { ascending: true }),
      supabase
        .from("payments")
        .select("id, method, currency, amount, reference, status, created_at")
        .eq("order_id", parsedId)
        .order("created_at", { ascending: false }),
      supabase
        .from("cancellation_requests")
        .select("id, status, source, customer_reason, resolution_note, resolved_at, created_at")
        .eq("order_id", parsedId)
        .order("created_at", { ascending: false }),
    ]);

    if (orderResult.error || itemsResult.error || paymentsResult.error || cancellationsResult.error) {
      return unavailableDetail();
    }
    if (!orderResult.data) return { unavailable: false, order: null };

    const row = orderResult.data;

    // Best-effort, real zone metadata. A failing/absent lookup degrades to null;
    // no zone value is invented and this never fails the whole detail read.
    let deliveryZoneName: string | null = null;
    let deliveryZoneRequiresQuote: boolean | null = null;
    const rawZoneId = row.delivery_zone_id;
    const zoneId =
      typeof rawZoneId === "number"
        ? rawZoneId
        : typeof rawZoneId === "string" && /^\d+$/.test(rawZoneId)
          ? Number(rawZoneId)
          : null;
    if (zoneId !== null && Number.isSafeInteger(zoneId)) {
      const zoneResult = await supabase
        .from("delivery_zones")
        .select("name, requires_quote")
        .eq("id", zoneId)
        .maybeSingle();
      if (!zoneResult.error) {
        if (typeof zoneResult.data?.name === "string") {
          deliveryZoneName = zoneResult.data.name;
        }
        if (typeof zoneResult.data?.requires_quote === "boolean") {
          deliveryZoneRequiresQuote = zoneResult.data.requires_quote;
        }
      }
    }

    const order: AdminOrderDetail = {
      id: row.id,
      reference: formatOrderReference(String(row.id)),
      channel: row.channel,
      status: row.status,
      customerName: typeof row.customer_name === "string" ? row.customer_name : null,
      customerPhone: typeof row.customer_phone === "string" ? row.customer_phone : null,
      fulfillmentType:
        typeof row.fulfillment_type === "string" ? row.fulfillment_type : null,
      addressLine: typeof row.address_line === "string" ? row.address_line : null,
      addressReferences:
        typeof row.address_references === "string" ? row.address_references : null,
      additionalInstructions:
        typeof row.additional_instructions === "string" ? row.additional_instructions : null,
      deliveryZoneId: zoneId,
      deliveryZoneName,
      deliveryZoneRequiresQuote,
      deliveryFeeUsd:
        row.delivery_fee_usd === null || row.delivery_fee_usd === undefined
          ? null
          : toFiniteNumber(row.delivery_fee_usd),
      quoteAcceptedAt:
        typeof row.quote_accepted_at === "string" ? row.quote_accepted_at : null,
      bcvRateVes:
        row.bcv_rate_ves === null || row.bcv_rate_ves === undefined
          ? null
          : toFiniteNumber(row.bcv_rate_ves),
      totalVes:
        row.total_ves === null || row.total_ves === undefined
          ? null
          : toFiniteNumber(row.total_ves),
      roundingRule: typeof row.rounding_rule === "string" ? row.rounding_rule : null,
      subtotalUsd: toFiniteNumber(row.subtotal_usd),
      totalUsd: toFiniteNumber(row.total_usd),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      items: (itemsResult.data ?? []).map((item) => ({
        id: item.id,
        productId: item.product_id,
        productName: item.product_name,
        unitPriceUsd: toFiniteNumber(item.unit_price_usd),
        quantity: toFiniteNumber(item.quantity),
      })),
      payments: (paymentsResult.data ?? []).map((payment) => ({
        id: payment.id,
        method: payment.method,
        currency: payment.currency,
        amount: toFiniteNumber(payment.amount),
        reference: typeof payment.reference === "string" ? payment.reference : null,
        status: payment.status,
        createdAt: payment.created_at,
      })),
      cancellations: (cancellationsResult.data ?? []).map((request) => ({
        id: request.id,
        status: request.status,
        source: request.source,
        customerReason:
          typeof request.customer_reason === "string" ? request.customer_reason : null,
        resolutionNote:
          typeof request.resolution_note === "string" ? request.resolution_note : null,
        resolvedAt: typeof request.resolved_at === "string" ? request.resolved_at : null,
        createdAt: request.created_at,
      })),
      paymentSummary: await readPaymentSummary(parsedId),
    };

    return { unavailable: false, order };
  } catch {
    return unavailableDetail();
  }
}
