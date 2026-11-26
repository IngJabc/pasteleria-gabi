/**
 * Static contract for the unified inbox manager. It guards the UI promise that
 * both the summary and the target are real Next.js links with Spanish accessible
 * labels, and that SLA rows never gain an unmark control.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const managerFile = fileURLToPath(
  new URL("./general-notifications-manager.tsx", import.meta.url),
);

describe("unified notifications manager contract (static)", () => {
  const source = readFileSync(managerFile, "utf8");

  it("renders both sources in one table", () => {
    expect(source).toContain("Bandeja unificada de notificaciones del panel");
    expect(source).toContain("Avisos generales y recordatorios SLA en una sola bandeja");
    expect(source).toContain("UnifiedNotificationItem");
    expect(source).not.toContain("generalNotificationHref(item)");
  });

  it("makes both summary and destination real accessible links", () => {
    const linkCount = [...source.matchAll(/<Link\b/g)].length;
    expect(linkCount).toBeGreaterThanOrEqual(2);
    expect(source).toContain('href={item.href}');
    expect(source).toContain('aria-label={`Abrir aviso: ${item.summary}`}');
    expect(source).toContain('aria-label={`Abrir destino: ${item.targetLabel}`}');
  });

  it("keeps SLA mark-read-only and marks both sources on mark-all", () => {
    expect(source).toContain("markAdminNotificationAsRead");
    expect(source).toContain("markAllAdminNotificationsReadAction");
    expect(source).toContain("markAllAdminGeneralNotificationsReadAction");
    expect(source).not.toContain("Marcar como no leída\" : \"Marcar como leída");
    expect(source).toContain('item.source === "general" ?');
  });

  it("marks both sources read from the shared link click handler", () => {
    expect(source).toContain("function markReadOnOpen(item: UnifiedNotificationItem)");
    const clickHandlers = [...source.matchAll(/onClick=\{\(\) => markReadOnOpen\(item\)\}/g)];
    expect(clickHandlers).toHaveLength(2);
    expect(source).not.toContain("preventDefault");
    expect(source).toContain("item.readAt !== null");
    expect(source).toContain("item.href.trim().length === 0");
    expect(source).toContain("Number.isSafeInteger(id)");
    expect(source).toContain("markReadWithoutBlocking(");
  });

  it("uses the narrow existing actions without inventing local read state", () => {
    expect(source).toContain(
      "setAdminGeneralNotificationReadAction({\n          notificationId: String(item.generalId),\n          read: true,\n        })",
    );
    expect(source).toContain(
      "markAdminNotificationAsRead({ notificationId: String(item.slaId) })",
    );
    expect(source).toContain("Promise.resolve(action())");
    expect(source).toContain("if (result.ok) onSuccess?.();");
    const handler = source.slice(
      source.indexOf("function markReadOnOpen"),
      source.indexOf("function markAllRead"),
    );
    expect(handler).toContain("() => router.refresh()");
    expect(handler).not.toContain("setFeedback");
  });

  it("states both honest truncation caps in Spanish", () => {
    expect(source).toContain(
      "las 200 notificaciones generales más recientes; puede haber historial anterior",
    );
    expect(source).toContain(
      "los 50 avisos SLA más recientes; puede haber historial anterior",
    );
  });
});
