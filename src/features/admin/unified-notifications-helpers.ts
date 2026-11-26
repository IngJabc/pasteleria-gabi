/**
 * Client-safe contracts for the single unified administrator inbox.
 *
 * The two database tables stay separate. This module only combines their
 * validated read models for presentation: every destination is derived from a
 * real target id, and a missing id produces no link at all.
 */

import {
  GENERAL_NOTIFICATION_LABELS,
  generalNotificationHref,
  type AdminGeneralNotificationItem,
} from "@/features/admin/general-notifications-helpers";
/** Structural SLA read model kept here so this helper stays strictly client-safe. */
export type SlaNotificationLike = {
  id: number;
  createdAt: string;
  readAt: string | null;
  receiptSubmissionId: number;
  orderId: number | null;
};

export type UnifiedNotificationSource = "general" | "sla";

export type UnifiedNotificationItem = {
  key: string;
  source: UnifiedNotificationSource;
  sourceLabel: string;
  eventLabel: string;
  summary: string;
  createdAt: string;
  readAt: string | null;
  href: string | null;
  targetLabel: string;
  generalId: number | null;
  slaId: number | null;
};

/**
 * Adds two independently available unread counts. A single unavailable source
 * is omitted rather than replaced with zero; two unavailable sources stay null
 * so the UI shows no badge at all.
 */
export function combineUnreadCounts(
  generalCount: number | null,
  slaCount: number | null,
): number | null {
  const available = [generalCount, slaCount].filter(
    (count): count is number =>
      typeof count === "number" && Number.isFinite(count) && count >= 0,
  );
  if (available.length === 0) return null;
  return available.reduce((total, count) => total + count, 0);
}

/** SLA rows always point at the receipt review screen for their real order. */
export function slaNotificationHref(orderId: number | null): string | null {
  if (orderId === null || !Number.isSafeInteger(orderId) || orderId <= 0) return null;
  return `/admin/comprobantes?orderId=${orderId}`;
}

function generalTargetLabel(item: AdminGeneralNotificationItem): string {
  if (item.eventType === "new_order") {
    return item.orderId !== null ? `Pedido #${item.orderId}` : "—";
  }
  if (item.eventType === "payment_receipt" || item.eventType === "receipt_correction") {
    const order = item.orderId !== null ? `Pedido #${item.orderId}` : null;
    const receipt =
      item.receiptSubmissionId !== null
        ? `comprobante #${item.receiptSubmissionId}`
        : null;
    return [order, receipt].filter(Boolean).join(" · ") || "—";
  }
  const review = item.reviewId !== null ? `Reseña #${item.reviewId}` : null;
  const product = item.productId !== null ? `producto #${item.productId}` : null;
  return [review, product].filter(Boolean).join(" · ") || "—";
}

export function generalNotificationToUnified(
  item: AdminGeneralNotificationItem,
): UnifiedNotificationItem {
  return {
    key: `general:${item.id}`,
    source: "general",
    sourceLabel: "General",
    eventLabel: GENERAL_NOTIFICATION_LABELS[item.eventType],
    summary: item.summary,
    createdAt: item.createdAt,
    readAt: item.readAt,
    href: generalNotificationHref(item),
    targetLabel: generalTargetLabel(item),
    generalId: item.id,
    slaId: null,
  };
}

export function slaNotificationToUnified(
  item: SlaNotificationLike,
): UnifiedNotificationItem {
  return {
    key: `sla:${item.id}`,
    source: "sla",
    sourceLabel: "SLA",
    eventLabel: "Aviso SLA de comprobante",
    summary: `Envío de comprobante #${item.receiptSubmissionId}.`,
    createdAt: item.createdAt,
    readAt: item.readAt,
    href: slaNotificationHref(item.orderId),
    targetLabel:
      item.orderId !== null
        ? `Pedido #${item.orderId}`
        : item.receiptSubmissionId !== null
          ? `comprobante #${item.receiptSubmissionId}`
          : "—",
    generalId: null,
    slaId: item.id,
  };
}

/** Newest first, with a stable tie-break across both sources. */
export function mergeUnifiedNotifications(
  general: AdminGeneralNotificationItem[],
  sla: SlaNotificationLike[],
): UnifiedNotificationItem[] {
  return [...general.map(generalNotificationToUnified), ...sla.map(slaNotificationToUnified)].sort(
    (a, b) => {
      const byDate = b.createdAt.localeCompare(a.createdAt);
      return byDate !== 0 ? byDate : a.key.localeCompare(b.key);
    },
  );
}
