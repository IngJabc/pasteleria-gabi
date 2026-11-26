import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import {
  getAdminGeneralUnreadCount,
  listAdminGeneralNotifications,
  markAllAdminGeneralNotificationsReadAction,
  setAdminGeneralNotificationReadAction,
} from "./general-notifications";
import {
  AdminSessionError,
  requireActiveAdminId,
} from "@/features/payments/admin-session";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/infrastructure/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/features/payments/admin-session", () => {
  class AdminSessionError extends Error {}
  return { AdminSessionError, requireActiveAdminId: vi.fn() };
});

const ADMIN = "11111111-1111-4111-8111-111111111111";

type Result = {
  data?: unknown;
  error?: unknown | null;
  count?: number | null;
};

type BuilderBundle = ReturnType<typeof makeBuilder>;

function makeBuilder(result: Result) {
  const calls = {
    select: [] as unknown[][],
    eq: [] as unknown[][],
    is: [] as unknown[][],
    order: [] as unknown[][],
    limit: [] as unknown[][],
    update: [] as unknown[][],
  };
  const builder = {
    select: vi.fn((...args: unknown[]) => {
      calls.select.push(args);
      return builder;
    }),
    eq: vi.fn((...args: unknown[]) => {
      calls.eq.push(args);
      return builder;
    }),
    is: vi.fn((...args: unknown[]) => {
      calls.is.push(args);
      return builder;
    }),
    order: vi.fn((...args: unknown[]) => {
      calls.order.push(args);
      return builder;
    }),
    limit: vi.fn((...args: unknown[]) => {
      calls.limit.push(args);
      return builder;
    }),
    update: vi.fn((...args: unknown[]) => {
      calls.update.push(args);
      return builder;
    }),
    then: (
      onfulfilled?: (value: Result) => unknown,
      onrejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onfulfilled, onrejected),
  };
  return { builder, calls };
}

const validRow = {
  id: 7,
  event_type: "payment_receipt",
  event_key: "payment_receipt:12",
  summary: "Nuevo comprobante de pago recibido.",
  created_at: "2026-11-26T10:00:00Z",
  read_at: null,
  order_id: 5,
  receipt_submission_id: 12,
  payment_id: 9,
  review_id: null,
  product_id: null,
};

const sessionFailure = new AdminSessionError("La sesión del administrador no es válida.");

describe("general admin notifications server module", () => {
  const from = vi.fn();
  let bundle: BuilderBundle;

  function setResult(result: Result): BuilderBundle {
    bundle = makeBuilder(result);
    from.mockImplementation((table: string) => {
      if (table !== "admin_general_notifications") throw new Error(`Unexpected table: ${table}`);
      return bundle.builder;
    });
    return bundle;
  }

  beforeEach(() => {
    setResult({ data: [validRow], error: null });

    vi.mocked(requireActiveAdminId).mockReset();
    vi.mocked(requireActiveAdminId).mockResolvedValue(ADMIN);
    vi.mocked(createSupabaseServerClient).mockReset();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);
    vi.mocked(revalidatePath).mockReset();
  });

  it("counts only unread rows for the session administrator", async () => {
    const current = setResult({ count: 3, error: null });
    expect(await getAdminGeneralUnreadCount()).toBe(3);
    expect(current.calls.eq).toContainEqual(["admin_id", ADMIN]);
    expect(current.calls.is).toContainEqual(["read_at", null]);
  });

  it("returns null count on database or session failure", async () => {
    setResult({ count: null, error: { message: "falló" } });
    expect(await getAdminGeneralUnreadCount()).toBeNull();

    vi.mocked(requireActiveAdminId).mockRejectedValueOnce(sessionFailure);
    expect(await getAdminGeneralUnreadCount()).toBeNull();
  });

  it("validates and maps inbox rows with the exact event-prefixed key", async () => {
    const current = setResult({ data: [validRow], error: null });
    const result = await listAdminGeneralNotifications();

    expect(result.unavailable).toBe(false);
    expect(result.message).toBe("");
    expect(result.items).toEqual([
      {
        id: 7,
        eventType: "payment_receipt",
        eventKey: "payment_receipt:12",
        summary: "Nuevo comprobante de pago recibido.",
        createdAt: "2026-11-26T10:00:00Z",
        readAt: null,
        orderId: 5,
        receiptSubmissionId: 12,
        paymentId: 9,
        reviewId: null,
        productId: null,
      },
    ]);
    expect(result.truncated).toBe(false);
    expect(current.calls.eq).toContainEqual(["admin_id", ADMIN]);
    expect(current.calls.order).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(current.calls.limit).toEqual([[200]]);
  });

  it("signals when the recent-history limit is reached", async () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({
      ...validRow,
      id: index + 1,
      event_key: `payment_receipt:${index + 1}`,
      receipt_submission_id: index + 1,
    }));
    setResult({ data: rows, error: null });
    const result = await listAdminGeneralNotifications();

    expect(result.unavailable).toBe(false);
    expect(result.items).toHaveLength(200);
    expect(result.truncated).toBe(true);
  });

  it("fails honestly when rows are malformed, the query errors or the session fails", async () => {
    setResult({ data: [{ ...validRow, event_key: "receipt:12" }], error: null });
    const invalid = await listAdminGeneralNotifications();
    expect(invalid.unavailable).toBe(true);
    expect(invalid.items).toEqual([]);
    expect(invalid.message).toMatch(/No se pudieron cargar/);

    setResult({ data: null, error: { message: "falló" } });
    expect((await listAdminGeneralNotifications()).unavailable).toBe(true);

    vi.mocked(requireActiveAdminId).mockRejectedValueOnce(sessionFailure);
    const failedSession = await listAdminGeneralNotifications();
    expect(failedSession.unavailable).toBe(true);
    expect(failedSession.message).toBe(sessionFailure.message);
  });

  it("marks one own notification read with an ISO timestamp and revalidates", async () => {
    const current = setResult({ error: null });
    const result = await setAdminGeneralNotificationReadAction({
      notificationId: "7",
      read: true,
    });

    expect(result).toEqual({ ok: true, message: "Notificación marcada como leída." });
    const payload = current.calls.update[0][0] as { read_at: string };
    expect(payload.read_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(current.calls.eq).toContainEqual(["id", 7]);
    expect(current.calls.eq).toContainEqual(["admin_id", ADMIN]);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/notificaciones");
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("marks one own notification unread with a null timestamp", async () => {
    const current = setResult({ error: null });
    const result = await setAdminGeneralNotificationReadAction({
      notificationId: "7",
      read: false,
    });

    expect(result).toEqual({ ok: true, message: "Notificación marcada como no leída." });
    expect(current.calls.update[0][0]).toEqual({ read_at: null });
  });

  it("rejects malformed notification ids before touching the database", async () => {
    for (const notificationId of ["0", "-1", "abc", "1.5", "  "]) {
      const result = await setAdminGeneralNotificationReadAction({
        notificationId,
        read: true,
      });
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/no es válido/);
    }
    expect(from).not.toHaveBeenCalled();
  });

  it("returns Spanish failure messages on update or session errors", async () => {
    setResult({ error: { message: "falló" } });
    const updateFailure = await setAdminGeneralNotificationReadAction({
      notificationId: "7",
      read: true,
    });
    expect(updateFailure.ok).toBe(false);
    expect(updateFailure.message).toMatch(/No se pudo actualizar/);

    vi.mocked(requireActiveAdminId).mockRejectedValueOnce(sessionFailure);
    const sessionError = await setAdminGeneralNotificationReadAction({
      notificationId: "7",
      read: true,
    });
    expect(sessionError.message).toBe(sessionFailure.message);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("marks all own unread rows read and scopes the update to the session admin", async () => {
    const current = setResult({ error: null });
    const result = await markAllAdminGeneralNotificationsReadAction();

    expect(result).toEqual({
      ok: true,
      message: "Todas las notificaciones se marcaron como leídas.",
    });
    const payload = current.calls.update[0][0] as { read_at: string };
    expect(payload.read_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(current.calls.eq).toContainEqual(["admin_id", ADMIN]);
    expect(current.calls.is).toContainEqual(["read_at", null]);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/notificaciones");
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("fails honestly when mark-all cannot complete", async () => {
    setResult({ error: { message: "falló" } });
    const result = await markAllAdminGeneralNotificationsReadAction();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/No se pudieron marcar/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
