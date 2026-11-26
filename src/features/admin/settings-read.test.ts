import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import {
  getAdminSettingsSnapshot,
  listAdminNotifications,
} from "./settings-read";
import {
  markAdminNotificationAsRead,
  markAllAdminNotificationsReadAction,
} from "./sla-notification-actions";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import { requireActiveAdminId } from "@/features/payments/admin-session";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/infrastructure/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("@/infrastructure/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/features/payments/admin-session", () => ({
  requireActiveAdminId: vi.fn(),
}));

const ADMIN = "11111111-1111-4111-8111-111111111111";

const automaticRate = {
  rate_ves_per_usd: 922.5637,
  observed_at: "2026-11-25T12:00:00Z",
  source: "automatic:bcv.today",
  is_stale: false,
  age_seconds: 0,
  as_of: "2026-11-25T12:00:05Z",
};

const settingsRow = {
  id: 1,
  pickup_address: "Calle 1",
  business_hours: null,
  whatsapp_phone: null,
  payment_instructions: null,
};

const zoneRow = {
  id: 7,
  name: "Centro",
  description: null,
  fee_usd: 2.5,
  requires_quote: false,
  is_active: true,
  sort_order: 1,
};

const latestSyncRow = {
  id: 91,
  attempted_at: "2026-11-25T12:00:05Z",
  status: "success",
  source: "bcv.today",
  schedule_slot: "2026-11-25T12:00:00Z",
  effective_date: "2026-11-25",
  provider_updated_at: "2026-11-25T11:00:00Z",
  retrieved_at: "2026-11-25T12:00:00Z",
  rate_ves_per_usd: "922.5637",
  error_code: null,
  error_detail: null,
};

const lastSuccessRow = { retrieved_at: "2026-11-25T12:00:00Z" };

type QueryResult = { data: unknown; error: unknown | null };

function makeBuilder(result: QueryResult) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    in: vi.fn(),
    update: vi.fn(),
    order: vi.fn(),
    not: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
    then: (
      onfulfilled?: (value: QueryResult) => unknown,
      onrejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onfulfilled, onrejected),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.is.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.update.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.not.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue(result);
  return builder;
}

describe("admin settings snapshot with the public BCV rate", () => {
  const publicRpc = vi.fn();
  const from = vi.fn();
  let syncQueryIndex = 0;

  beforeEach(() => {
    publicRpc.mockReset();
    publicRpc.mockResolvedValue({ data: automaticRate, error: null });
    syncQueryIndex = 0;

    from.mockReset();
    from.mockImplementation((table: string) => {
      if (table === "store_settings") return makeBuilder({ data: settingsRow, error: null });
      if (table === "delivery_zones") return makeBuilder({ data: [zoneRow], error: null });
      if (table === "bcv_sync_attempts") {
        syncQueryIndex += 1;
        return syncQueryIndex === 1
          ? makeBuilder({ data: latestSyncRow, error: null })
          : makeBuilder({ data: lastSuccessRow, error: null });
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    vi.mocked(requireActiveAdminId).mockReset();
    vi.mocked(requireActiveAdminId).mockResolvedValue(ADMIN);
    vi.mocked(createSupabaseServerClient).mockReset();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from, rpc: publicRpc } as never);
    vi.mocked(createSupabaseAdminClient).mockReset();
    vi.mocked(createSupabaseAdminClient).mockImplementation(() => {
      throw new Error("service role unavailable");
    });
  });

  it("maps the automatic BCV rate while keeping sync status from the request-bound client", async () => {
    const snapshot = await getAdminSettingsSnapshot();

    expect(snapshot.unavailable).toBe(false);
    expect(snapshot.bcvRate).toEqual({
      rateVesPerUsd: 922.5637,
      observedAt: "2026-11-25T12:00:00Z",
      source: "automatic:bcv.today",
      isStale: false,
      ageSeconds: 0,
      asOf: "2026-11-25T12:00:05Z",
    });
    expect(snapshot.bcvSync).toEqual({
      id: 91,
      attemptedAt: "2026-11-25T12:00:05Z",
      status: "success",
      source: "bcv.today",
      scheduleSlot: "2026-11-25T12:00:00Z",
      effectiveDate: "2026-11-25",
      providerUpdatedAt: "2026-11-25T11:00:00Z",
      retrievedAt: "2026-11-25T12:00:00Z",
      rateVesPerUsd: "922.5637",
      errorCode: null,
      errorDetail: null,
    });
    expect(snapshot.bcvLastSuccessfulRetrievalAt).toBe("2026-11-25T12:00:00Z");
    expect(publicRpc).toHaveBeenCalledExactlyOnceWith("get_bcv_rate");
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });
});

describe("unified inbox SLA reads and mark-all", () => {
  const from = vi.fn();
  const notificationRow = {
    id: 8,
    created_at: "2026-11-26T10:00:00Z",
    read_at: null,
    receipt_submission_id: 30,
  };

  beforeEach(() => {
    vi.mocked(requireActiveAdminId).mockReset();
    vi.mocked(requireActiveAdminId).mockResolvedValue(ADMIN);
    vi.mocked(createSupabaseServerClient).mockReset();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);
    vi.mocked(revalidatePath).mockReset();
    from.mockReset();
  });

  it("resolves each SLA row's real order id for its destination", async () => {
    const notifications = makeBuilder({ data: [notificationRow], error: null });
    const submissions = makeBuilder({
      data: [{ id: 30, order_id: 7 }],
      error: null,
    });
    from.mockImplementation((table: string) => {
      if (table === "admin_notifications") return notifications;
      if (table === "receipt_submissions") return submissions;
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await listAdminNotifications();

    expect(result.unavailable).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.items).toEqual([
      {
        id: 8,
        createdAt: "2026-11-26T10:00:00Z",
        readAt: null,
        receiptSubmissionId: 30,
        orderId: 7,
      },
    ]);
    expect(notifications.eq).toHaveBeenCalledWith("admin_id", ADMIN);
    expect(notifications.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(notifications.limit).toHaveBeenCalledWith(50);
    expect(submissions.in).toHaveBeenCalledWith("id", [30]);
  });

  it("leaves orderId null when the lookup fails instead of inventing a link", async () => {
    const notifications = makeBuilder({ data: [notificationRow], error: null });
    const submissions = makeBuilder({ data: null, error: { message: "falló" } });
    from.mockImplementation((table: string) =>
      table === "admin_notifications" ? notifications : submissions,
    );

    const result = await listAdminNotifications();
    expect(result.unavailable).toBe(false);
    expect(result.items[0]?.orderId).toBeNull();
  });

  it("signals when the 50-row SLA cap is reached", async () => {
    const rows = Array.from({ length: 50 }, (_, index) => ({
      ...notificationRow,
      id: index + 1,
      receipt_submission_id: index + 1,
    }));
    const notifications = makeBuilder({ data: rows, error: null });
    const submissions = makeBuilder({ data: [], error: null });
    from.mockImplementation((table: string) =>
      table === "admin_notifications" ? notifications : submissions,
    );

    const result = await listAdminNotifications();
    expect(result.items).toHaveLength(50);
    expect(result.truncated).toBe(true);
  });

  it("rejects an unsafe SLA notification id before touching the database", async () => {
    const notifications = makeBuilder({ data: null, error: null });
    from.mockImplementation(() => notifications);

    const result = await markAdminNotificationAsRead({
      notificationId: "99999999999999999999999999",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBe("La notificación no es válida.");
    expect(notifications.update).not.toHaveBeenCalled();
  });

  it("marks only the session admin's unread SLA rows and revalidates both paths", async () => {
    const notifications = makeBuilder({ data: null, error: null });
    from.mockImplementation((table: string) => {
      if (table !== "admin_notifications") throw new Error(`Unexpected table: ${table}`);
      return notifications;
    });

    const result = await markAllAdminNotificationsReadAction();

    expect(result).toEqual({
      ok: true,
      message: "Todas las notificaciones se marcaron como leídas.",
    });
    const payload = notifications.update.mock.calls[0]?.[0] as { read_at: string };
    expect(payload.read_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(notifications.eq).toHaveBeenCalledWith("admin_id", ADMIN);
    expect(notifications.is).toHaveBeenCalledWith("read_at", null);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/notificaciones");
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("fails honestly when the SLA mark-all update errors", async () => {
    const notifications = makeBuilder({ data: null, error: { message: "falló" } });
    from.mockImplementation(() => notifications);

    const result = await markAllAdminNotificationsReadAction();
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no está disponible/);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
