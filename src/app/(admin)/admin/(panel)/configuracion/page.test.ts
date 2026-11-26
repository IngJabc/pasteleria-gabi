/**
 * Static contract for the settings unification: no duplicate SLA inbox card;
 * the operation tab points to the single unified notifications route.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./page.tsx", import.meta.url),
  "utf8",
);

describe("settings operation tab contract (static)", () => {
  it("does not render a second notification inbox", () => {
    expect(source).not.toContain("listAdminNotifications");
    expect(source).not.toContain("notificationInbox");
    expect(source).not.toContain("Envío de comprobante #");
    expect(source).not.toContain("Bandeja al día");
  });

  it("links to the unified inbox from the Spanish card", () => {
    expect(source).toContain("Dos manos, un mismo cuidado");
    expect(source).toContain("Todas las notificaciones de la administración");
    expect(source).toContain('href="/admin/notificaciones"');
    expect(source).toContain("Abrir notificaciones");
  });
});
