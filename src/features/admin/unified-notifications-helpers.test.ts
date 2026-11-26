import { describe, expect, it } from "vitest";
import type { AdminGeneralNotificationItem } from "./general-notifications-helpers";
import {
  combineUnreadCounts,
  generalNotificationToUnified,
  mergeUnifiedNotifications,
  slaNotificationHref,
  slaNotificationToUnified,
  type SlaNotificationLike,
} from "./unified-notifications-helpers";

function generalItem(
  overrides: Partial<AdminGeneralNotificationItem> = {},
): AdminGeneralNotificationItem {
  return {
    id: 4,
    eventType: "new_order",
    eventKey: "new_order:9",
    summary: "Nuevo pedido online recibido.",
    createdAt: "2026-11-26T10:00:00Z",
    readAt: null,
    orderId: 9,
    receiptSubmissionId: null,
    paymentId: null,
    reviewId: null,
    productId: null,
    ...overrides,
  };
}

function slaItem(overrides: Partial<SlaNotificationLike> = {}): SlaNotificationLike {
  return {
    id: 12,
    createdAt: "2026-11-26T11:00:00Z",
    readAt: null,
    receiptSubmissionId: 30,
    orderId: 7,
    ...overrides,
  };
}

describe("unified notification helpers", () => {
  it("combines only available real unread counts", () => {
    expect(combineUnreadCounts(2, 3)).toBe(5);
    expect(combineUnreadCounts(null, 3)).toBe(3);
    expect(combineUnreadCounts(2, null)).toBe(2);
    expect(combineUnreadCounts(null, null)).toBeNull();
    expect(combineUnreadCounts(0, 0)).toBe(0);
    expect(combineUnreadCounts(Number.NaN, 3)).toBe(3);
  });

  it("maps an SLA row to the real order destination or no link", () => {
    expect(slaNotificationHref(7)).toBe("/admin/comprobantes?orderId=7");
    expect(slaNotificationHref(null)).toBeNull();
    expect(slaNotificationHref(0)).toBeNull();
    expect(slaNotificationHref(1.5)).toBeNull();
  });

  it("gives both sources clickable summary and target hrefs", () => {
    const fromGeneral = generalNotificationToUnified(generalItem());
    const fromSla = slaNotificationToUnified(slaItem());

    expect(fromGeneral).toMatchObject({
      key: "general:4",
      source: "general",
      href: "/admin/pedidos/9",
      targetLabel: "Pedido #9",
      generalId: 4,
      slaId: null,
    });
    expect(fromSla).toMatchObject({
      key: "sla:12",
      source: "sla",
      href: "/admin/comprobantes?orderId=7",
      targetLabel: "Pedido #7",
      generalId: null,
      slaId: 12,
    });
    expect(fromSla.summary).toContain("#30");
    expect(fromSla.eventLabel).toBe("Aviso SLA de comprobante");
  });

  it("never fabricates a destination when the SLA order id is missing", () => {
    const mapped = slaNotificationToUnified(slaItem({ orderId: null }));
    expect(mapped.href).toBeNull();
    expect(mapped.targetLabel).toBe("comprobante #30");
  });

  it("merges both sources newest first with stable keys", () => {
    const merged = mergeUnifiedNotifications(
      [generalItem()],
      [slaItem(), slaItem({ id: 13, createdAt: "2026-11-26T10:00:00Z" })],
    );

    expect(merged.map((item) => item.key)).toEqual(["sla:12", "general:4", "sla:13"]);
    expect(new Set(merged.map((item) => item.key)).size).toBe(3);
  });
});
