import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GENERAL_NOTIFICATIONS_CHANNEL,
  GENERAL_NOTIFICATIONS_RECONNECT_DELAY_MS,
  GENERAL_NOTIFICATIONS_REFRESH_DELAY_MS,
  GENERAL_NOTIFICATIONS_TABLE,
  GENERAL_NOTIFICATION_LABELS,
  SLA_NOTIFICATIONS_CHANNEL,
  SLA_NOTIFICATIONS_TABLE,
  type AdminGeneralNotificationItem,
  buildGeneralNotificationsFilter,
  buildSlaNotificationsFilter,
  createGeneralNotificationsRefreshScheduler,
  generalNotificationEventKey,
  generalNotificationHref,
  generalNotificationsChangeConfig,
  slaNotificationsChangeConfig,
} from "./general-notifications-helpers";

const ADMIN = "11111111-1111-4111-8111-111111111111";

function item(overrides: Partial<AdminGeneralNotificationItem> = {}): AdminGeneralNotificationItem {
  return {
    id: 1,
    eventType: "new_order",
    eventKey: "new_order:5",
    summary: "Nuevo pedido online recibido.",
    createdAt: "2026-11-26T10:00:00Z",
    readAt: null,
    orderId: 5,
    receiptSubmissionId: null,
    paymentId: null,
    reviewId: null,
    productId: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("general notification helper contracts", () => {
  it("builds exact event-prefixed deterministic keys", () => {
    expect(generalNotificationEventKey("new_order", 5)).toBe("new_order:5");
    expect(generalNotificationEventKey("payment_receipt", 12)).toBe("payment_receipt:12");
    expect(generalNotificationEventKey("receipt_correction", 12)).toBe("receipt_correction:12");
    expect(generalNotificationEventKey("product_review", 34)).toBe("product_review:34");
  });

  it("uses Spanish labels for every event type", () => {
    expect(GENERAL_NOTIFICATION_LABELS).toEqual({
      new_order: "Pedido online",
      payment_receipt: "Comprobante de pago",
      receipt_correction: "Comprobante corregido",
      product_review: "Reseña de producto",
    });
  });

  it("maps each event to its canonical admin destination", () => {
    expect(generalNotificationHref(item())).toBe("/admin/pedidos/5");
    expect(
      generalNotificationHref(
        item({ eventType: "payment_receipt", eventKey: "payment_receipt:12", orderId: 7, receiptSubmissionId: 12, paymentId: 9 }),
      ),
    ).toBe("/admin/comprobantes?orderId=7");
    expect(
      generalNotificationHref(
        item({
          eventType: "receipt_correction",
          eventKey: "receipt_correction:12",
          orderId: 7,
          receiptSubmissionId: 12,
          paymentId: 9,
        }),
      ),
    ).toBe("/admin/comprobantes?orderId=7");
    expect(
      generalNotificationHref(
        item({
          eventType: "product_review",
          eventKey: "product_review:34",
          orderId: null,
          reviewId: 34,
          productId: 3,
        }),
      ),
    ).toBe("/admin/resenas?productId=3");
  });

  it("returns no link when the target id is missing", () => {
    expect(generalNotificationHref(item({ orderId: null }))).toBeNull();
    expect(
      generalNotificationHref(
        item({ eventType: "receipt_correction", eventKey: "receipt_correction:12", orderId: null }),
      ),
    ).toBeNull();
    expect(
      generalNotificationHref(
        item({ eventType: "product_review", eventKey: "product_review:34", productId: null }),
      ),
    ).toBeNull();
  });

  it("builds stable per-admin INSERT-only realtime channels for both tables", () => {
    expect(buildGeneralNotificationsFilter(ADMIN)).toBe(`admin_id=eq.${ADMIN}`);
    expect(generalNotificationsChangeConfig(ADMIN)).toEqual({
      event: "INSERT",
      schema: "public",
      table: "admin_general_notifications",
      filter: `admin_id=eq.${ADMIN}`,
    });
    expect(buildSlaNotificationsFilter(ADMIN)).toBe(`admin_id=eq.${ADMIN}`);
    expect(slaNotificationsChangeConfig(ADMIN)).toEqual({
      event: "INSERT",
      schema: "public",
      table: "admin_notifications",
      filter: `admin_id=eq.${ADMIN}`,
    });
    expect(GENERAL_NOTIFICATIONS_CHANNEL).toBe("admin-general-notifications");
    expect(GENERAL_NOTIFICATIONS_TABLE).toBe("admin_general_notifications");
    expect(SLA_NOTIFICATIONS_CHANNEL).toBe("admin-sla-notifications");
    expect(SLA_NOTIFICATIONS_TABLE).toBe("admin_notifications");
    expect(GENERAL_NOTIFICATIONS_RECONNECT_DELAY_MS).toBe(5000);
    expect(GENERAL_NOTIFICATIONS_REFRESH_DELAY_MS).toBe(350);
  });

  it("debounces refreshes and cancels pending work", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const scheduler = createGeneralNotificationsRefreshScheduler(refresh, 100);

    scheduler.schedule();
    scheduler.schedule();
    vi.advanceTimersByTime(99);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    scheduler.schedule();
    scheduler.cancel();
    vi.advanceTimersByTime(200);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
