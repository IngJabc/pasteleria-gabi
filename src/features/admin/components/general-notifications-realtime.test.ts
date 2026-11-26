/**
 * Static contract for the two-channel Realtime refresher. Runtime delivery is
 * still validated in Staging; these guards prevent regressions in the local
 * subscription, reconnect and cleanup promises.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./general-notifications-realtime.tsx", import.meta.url)),
  "utf8",
);

describe("unified notifications realtime component contract (static)", () => {
  it("subscribes to INSERT events on both notification tables", () => {
    expect(source).toContain("generalNotificationsChangeConfig(adminId)");
    expect(source).toContain("slaNotificationsChangeConfig(adminId)");
    expect(source).toContain('.on("postgres_changes", config');
    expect(source).toContain("scheduler.schedule()");
    expect(source).not.toContain("setInterval");
  });

  it("allows exactly one delayed reconnect per failed channel", () => {
    expect(source).toContain('status === "CHANNEL_ERROR" || status === "TIMED_OUT"');
    expect(source).toContain("!state.reconnected");
    expect(source).toContain("state.reconnected = true");
    expect(source).toContain("supabase.removeChannel(state.channel)");
    expect(source).toContain("setTimeout(() => {");
    expect(source).toContain("GENERAL_NOTIFICATIONS_RECONNECT_DELAY_MS");
  });

  it("cancels pending timers and channels on unmount", () => {
    expect(source).toContain("disposed = true");
    expect(source).toContain("scheduler.cancel()");
    expect(source).toContain("clearTimeout(state.reconnectTimer)");
    expect(source).toContain("if (!disposed) subscribe(index)");
  });

  it("raises a Spanish in-app toast from payload.new via the existing provider", () => {
    expect(source).toContain('import { useToast } from "@/components/ui/toast"');
    expect(source).toContain("const { showToast } = useToast()");
    expect(source).toContain("createNotificationToastDeduplicator()");
    expect(source).toContain("shouldToast(source, payload.new)");
    expect(source).toContain('showToast(notificationToastMessage(source, payload.new), "info")');
    expect(source).toContain("handleInsert(source, payload)");
    expect(source).toContain("scheduler.schedule()");
    expect(source).not.toContain("requestPermission");
    expect(source).not.toContain("serviceWorker");
    expect(source).not.toContain("registration.showNotification");
  });

  it("never reads old payloads or adds polling", () => {
    const executableSource = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(executableSource).not.toContain("payload.old");
    expect(executableSource).not.toContain("setInterval");
    expect(executableSource).not.toContain("fetch(");
  });
});
