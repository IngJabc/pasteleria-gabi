/**
 * Pure contracts for the Spanish in-app notification toast. No polling, service
 * worker, permission prompt or external channel is involved.
 */

import { describe, expect, it } from "vitest";
import {
  GENERAL_NOTIFICATION_TOAST_MESSAGE,
  SLA_NOTIFICATION_TOAST_MESSAGE,
  createNotificationToastDeduplicator,
  notificationToastKey,
  notificationToastMessage,
} from "./notification-realtime-toast";

describe("notification realtime toast helpers", () => {
  it("uses the generic Spanish messages when no usable summary exists", () => {
    expect(notificationToastMessage("general", null)).toBe(GENERAL_NOTIFICATION_TOAST_MESSAGE);
    expect(notificationToastMessage("general", { summary: "   " })).toBe(
      GENERAL_NOTIFICATION_TOAST_MESSAGE,
    );
    expect(notificationToastMessage("sla", { summary: "dato del worker" })).toBe(
      SLA_NOTIFICATION_TOAST_MESSAGE,
    );
  });

  it("shows a non-empty general summary from payload.new only", () => {
    expect(notificationToastMessage("general", { summary: "  Pedido #42 nuevo.  " })).toBe(
      "Pedido #42 nuevo.",
    );
    expect(notificationToastMessage("general", { summary: 42 })).toBe(
      GENERAL_NOTIFICATION_TOAST_MESSAGE,
    );
  });

  it("keys only real row ids and suppresses repeated INSERT deliveries", () => {
    expect(notificationToastKey("general", { id: 7 })).toBe("general:7");
    expect(notificationToastKey("sla", { id: 7 })).toBe("sla:7");
    expect(notificationToastKey("general", { id: 0 })).toBeNull();
    expect(notificationToastKey("general", { id: 1.5 })).toBeNull();
    expect(notificationToastKey("general", null)).toBeNull();

    const shouldToast = createNotificationToastDeduplicator(2);
    expect(shouldToast("general", { id: 1 })).toBe(true);
    expect(shouldToast("general", { id: 1 })).toBe(false);
    expect(shouldToast("sla", { id: 1 })).toBe(true);
    expect(shouldToast("general", { id: 2 })).toBe(true);
    // The oldest key is evicted, keeping memory bounded without hiding new rows.
    expect(shouldToast("general", { id: 1 })).toBe(true);
    expect(shouldToast("general", {})).toBe(true);
    expect(shouldToast("general", {})).toBe(true);
  });
});
