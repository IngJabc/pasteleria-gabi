/**
 * Static contract for the single unread badge: the shell no longer renders a
 * topbar alert pill, and the sidebar shows one combined, accessible count.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

describe("single admin notification badge contract (static)", () => {
  const shell = read("./admin-shell.tsx");
  const sidebar = read("./admin-sidebar.tsx");
  const layout = read(
    "../../app/(admin)/admin/(panel)/layout.tsx",
  );

  it("removes the topbar alerts pill and its old props", () => {
    expect(shell).not.toContain("alertsLabel");
    expect(shell).not.toContain("admin-alerts-pill");
    expect(shell).not.toContain("generalUnreadCount");
    expect(layout).not.toContain("alertsLabel");
    expect(layout).toContain("combineUnreadCounts");
  });

  it("renders one combined Spanish badge on the Notificaciones link", () => {
    expect(sidebar).toContain("unreadCount");
    expect(sidebar).toContain('href: "/admin/notificaciones"');
    expect(sidebar).toContain('aria-label={badgeLabel}');
    expect(sidebar).toContain('unreadAriaLabel(label, unreadCount)');
    expect(sidebar).toContain('return `${label}, ${unread}`;');
    expect(sidebar).toContain("notificación sin leer");
    expect(sidebar).toContain("notificaciones sin leer");
    expect(sidebar).toContain('count > 99 ? "99+"');
    expect(sidebar).toContain("aria-hidden=\"true\"");
  });

  it("subscribes to both notification sources from the layout", () => {
    expect(layout).toContain("UnifiedNotificationsRealtime");
    expect(layout).toContain("getAdminGeneralUnreadCount");
    expect(layout).toContain("getUnreadAdminNotificationCount");
  });
});
