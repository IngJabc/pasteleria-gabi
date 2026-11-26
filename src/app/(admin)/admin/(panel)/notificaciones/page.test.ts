/**
 * Static contract for the unified notifications page. A partial read failure
 * must never be rendered as an all-clear empty inbox.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./page.tsx", import.meta.url),
  "utf8",
);

describe("unified notifications page contract (static)", () => {
  it("reads both sources and merges them before rendering", () => {
    expect(source).toContain("listAdminGeneralNotifications()");
    expect(source).toContain("listAdminNotifications()");
    expect(source).toContain("mergeUnifiedNotifications(general.items, sla.items)");
  });

  it("does not show the all-clear state when a source was unavailable", () => {
    expect(source).toContain("messages.length > 0");
    expect(source).toContain("Consulta incompleta");
    expect(source).toContain("No fue posible consultar todas las notificaciones");
    const allClearIndex = source.indexOf('title="Todo al día"');
    const partialIndex = source.indexOf('title="Consulta incompleta"');
    expect(partialIndex).toBeGreaterThan(-1);
    expect(allClearIndex).toBeGreaterThan(partialIndex);
  });
});
