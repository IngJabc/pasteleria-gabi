/**
 * Client-safe contracts for the general administrator notification inbox.
 *
 * No server-only imports here: this module is shared by server read models,
 * client components and their tests. Targets are derived only from real ids in
 * a validated notification row; a missing target produces no link at all.
 */

export const GENERAL_NOTIFICATION_EVENT_TYPES = [
  "new_order",
  "payment_receipt",
  "receipt_correction",
  "product_review",
] as const;

export type GeneralNotificationEventType = (typeof GENERAL_NOTIFICATION_EVENT_TYPES)[number];

/** Spanish labels used by the inbox table. */
export const GENERAL_NOTIFICATION_LABELS: Record<GeneralNotificationEventType, string> = {
  new_order: "Pedido online",
  payment_receipt: "Comprobante de pago",
  receipt_correction: "Comprobante corregido",
  product_review: "Reseña de producto",
};

/**
 * Canonical database key. The event type is always part of the key; the id is
 * the originating row for that event (order, receipt submission or review).
 */
export function generalNotificationEventKey(
  eventType: GeneralNotificationEventType,
  targetId: number,
): string {
  return `${eventType}:${targetId}`;
}

export type AdminGeneralNotificationItem = {
  id: number;
  eventType: GeneralNotificationEventType;
  eventKey: string;
  summary: string;
  createdAt: string;
  readAt: string | null;
  orderId: number | null;
  receiptSubmissionId: number | null;
  paymentId: number | null;
  reviewId: number | null;
  productId: number | null;
};

/** Canonical destination for each event, or null when the target id is absent. */
export function generalNotificationHref(
  item: AdminGeneralNotificationItem,
): string | null {
  switch (item.eventType) {
    case "new_order":
      return item.orderId !== null ? `/admin/pedidos/${item.orderId}` : null;
    case "payment_receipt":
    case "receipt_correction":
      return item.orderId !== null
        ? `/admin/comprobantes?orderId=${item.orderId}`
        : null;
    case "product_review":
      return item.productId !== null
        ? `/admin/resenas?productId=${item.productId}`
        : null;
    default:
      return null;
  }
}

export const GENERAL_NOTIFICATIONS_CHANNEL = "admin-general-notifications";
export const GENERAL_NOTIFICATIONS_TABLE = "admin_general_notifications";

/** Realtime filter string; the id must come from the server-side session. */
export function buildGeneralNotificationsFilter(adminId: string): string {
  return `admin_id=eq.${adminId}`;
}

export function generalNotificationsChangeConfig(adminId: string) {
  return {
    event: "INSERT" as const,
    schema: "public",
    table: GENERAL_NOTIFICATIONS_TABLE,
    filter: buildGeneralNotificationsFilter(adminId),
  };
}

export const SLA_NOTIFICATIONS_CHANNEL = "admin-sla-notifications";
export const SLA_NOTIFICATIONS_TABLE = "admin_notifications";

/** Realtime filter for the OQ-16 SLA inbox; the id comes from the server session. */
export function buildSlaNotificationsFilter(adminId: string): string {
  return `admin_id=eq.${adminId}`;
}

export function slaNotificationsChangeConfig(adminId: string) {
  return {
    event: "INSERT" as const,
    schema: "public",
    table: SLA_NOTIFICATIONS_TABLE,
    filter: buildSlaNotificationsFilter(adminId),
  };
}

export const GENERAL_NOTIFICATIONS_RECONNECT_DELAY_MS = 5000;
export const GENERAL_NOTIFICATIONS_REFRESH_DELAY_MS = 350;

export type GeneralNotificationsRefreshScheduler = {
  schedule: () => void;
  cancel: () => void;
};

/**
 * Debounces consecutive Realtime events into one router refresh. `cancel()`
 * clears a pending timer so unmount/reconnect never schedules stale work.
 */
export function createGeneralNotificationsRefreshScheduler(
  onRefresh: () => void,
  delayMs: number = GENERAL_NOTIFICATIONS_REFRESH_DELAY_MS,
): GeneralNotificationsRefreshScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onRefresh();
      }, delayMs);
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
