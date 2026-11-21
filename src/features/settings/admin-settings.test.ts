import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import { requireActiveAdminId } from "@/features/payments/admin-session";
import { updateStoreSettings } from "./admin-settings";
import {
  businessHoursSchema,
  STORE_TIMEZONE,
  timeIntervalSchema,
  updateStoreSettingsSchema,
  WEEKDAYS,
  type BusinessHours,
  type TimeInterval,
} from "./schemas";

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/features/payments/admin-session", () => ({
  requireActiveAdminId: vi.fn(),
}));

const ADMIN = "11111111-1111-4111-8111-111111111111";

const allClosed = Object.fromEntries(WEEKDAYS.map((day) => [day, [] as TimeInterval[]])) as Record<
  (typeof WEEKDAYS)[number],
  TimeInterval[]
>;

const hours: BusinessHours = {
  timezone: STORE_TIMEZONE,
  attention: {
    ...allClosed,
    monday: [{ start: "09:00", end: "13:00" }, { start: "15:00", end: "18:00" }],
  },
  pickup: { ...allClosed, saturday: [{ start: "10:00", end: "14:00" }] },
};

const row = {
  id: 1,
  pickup_address: "Dirección de prueba",
  whatsapp_phone: null,
  business_hours: hours,
  payment_instructions: null,
  updated_at: "2026-11-20T12:00:00Z",
  updated_by: ADMIN,
};

describe("OQ-8 store settings schemas", () => {
  it("accepts a complete schedule with closed days and multiple intervals", () => {
    expect(businessHoursSchema.safeParse(hours).success).toBe(true);
    expect(updateStoreSettingsSchema.safeParse({ pickupAddress: "x", businessHours: hours }).success).toBe(true);
  });

  it("rejects malformed times, reversed ranges and overlaps", () => {
    expect(timeIntervalSchema.safeParse({ start: "9:00", end: "18:00" }).success).toBe(false);
    expect(timeIntervalSchema.safeParse({ start: "18:00", end: "09:00" }).success).toBe(false);
    expect(
      businessHoursSchema.safeParse({
        ...hours,
        attention: { ...hours.attention, monday: [{ start: "09:00", end: "14:00" }, { start: "13:00", end: "18:00" }] },
      }).success,
    ).toBe(false);
  });

  it("rejects missing weekdays, extra keys and non-Venezuelan timezones", () => {
    const missing = Object.fromEntries(
      WEEKDAYS.filter((day) => day !== "monday").map((day) => [day, hours.attention[day]]),
    );
    expect(businessHoursSchema.safeParse({ ...hours, attention: missing }).success).toBe(false);
    expect(businessHoursSchema.safeParse({ ...hours, timezone: "UTC" }).success).toBe(false);
    expect(businessHoursSchema.safeParse({ ...hours, extra: true }).success).toBe(false);
  });

  it("requires at least one field on update", () => {
    expect(updateStoreSettingsSchema.safeParse({}).success).toBe(false);
    expect(updateStoreSettingsSchema.safeParse({ businessHours: null }).success).toBe(true);
  });
});

describe("OQ-8 administrator settings action", () => {
  const update = vi.fn();
  const eq = vi.fn();
  const select = vi.fn();
  const maybeSingle = vi.fn();

  beforeEach(() => {
    update.mockReset();
    eq.mockReset();
    select.mockReset();
    maybeSingle.mockReset();
    select.mockReturnValue({ maybeSingle });
    eq.mockReturnValue({ select });
    update.mockReturnValue({ eq });
    vi.mocked(requireActiveAdminId).mockReset();
    vi.mocked(requireActiveAdminId).mockResolvedValue(ADMIN);
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: vi.fn().mockReturnValue({ update }) } as never);
  });

  it("validates before touching Supabase and rejects a client-supplied admin id", async () => {
    const result = await updateStoreSettings({
      pickupAddress: "x",
      businessHours: { ...hours, timezone: "UTC" },
    } as never);
    expect(result.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();

    const spoofed = await updateStoreSettings({ businessHours: hours, adminId: "spoofed" } as never);
    expect(spoofed.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();

    maybeSingle.mockResolvedValue({ data: row, error: null });
    const ok = await updateStoreSettings({ businessHours: hours });
    expect(ok.ok).toBe(true);
    expect(update).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ updated_by: ADMIN, business_hours: hours }),
    );
    expect(JSON.stringify(ok)).not.toContain("spoofed");
  });

  it("returns the validation error when the session is invalid", async () => {
    vi.mocked(requireActiveAdminId).mockRejectedValue(new Error("no session"));
    const result = await updateStoreSettings({ pickupAddress: "x" });
    expect(result).toEqual({ ok: false, error: "La sesión del administrador no es válida." });
    expect(update).not.toHaveBeenCalled();
  });
});
