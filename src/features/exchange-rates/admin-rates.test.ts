import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { requireActiveAdminId } from "@/features/payments/admin-session";
import {
  applyBcvRateToOrder,
  deactivateBcvRate,
  listBcvRates,
  registerBcvRate,
} from "./admin-rates";

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("@/features/payments/admin-session", () => ({
  requireActiveAdminId: vi.fn(),
}));

const ADMIN = "11111111-1111-4111-8111-111111111111";
const rpc = vi.fn();
const from = vi.fn();
const select = vi.fn();
const order = vi.fn();
const limit = vi.fn();

const rateInput = {
  rate: "36.5000",
  source: "manual:bcv",
  observedAt: "2020-01-01T10:00:00Z",
  supersedesId: 4,
  note: "corrección manual",
  idempotencyKey: "rate-key-1234",
};

const snapshot = {
  order_id: 42,
  bcv_rate_ves: 36.5,
  bcv_rate_at: "2020-01-01T10:00:00Z",
  total_ves: 374.13,
  rounding_rule: "round_half_up",
  applied: true,
  age_seconds: 42,
};

describe("administrator BCV rate server actions", () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
    select.mockReset();
    order.mockReset();
    limit.mockReset();
    from.mockReturnValue({ select });
    select.mockReturnValue({ order });
    order.mockReturnValue({ limit });
    vi.mocked(requireActiveAdminId).mockReset();
    vi.mocked(requireActiveAdminId).mockResolvedValue(ADMIN);
    vi.mocked(createSupabaseAdminClient).mockReturnValue({ rpc, from } as never);
  });

  it("registers a rate using only the session-derived administrator id", async () => {
    rpc.mockResolvedValue({ data: { rate_id: 9, idempotent: false }, error: null });

    const result = await registerBcvRate({ ...rateInput, adminId: "spoofed" } as never);

    expect(result).toEqual({ ok: true, rateId: 9, idempotent: false });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("register_bcv_rate", {
      p_rate_ves_per_usd: "36.5000",
      p_source: "manual:bcv",
      p_admin_id: ADMIN,
      p_observed_at: "2020-01-01T10:00:00Z",
      p_supersedes_id: 4,
      p_note: "corrección manual",
      p_idempotency_key: "rate-key-1234",
    });
    expect(JSON.stringify(result)).not.toContain("spoofed");
  });

  it("rejects invalid rate input before touching Supabase", async () => {
    const bad = await registerBcvRate({ ...rateInput, rate: "36.50000" });
    expect(bad.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();

    const noSource = await registerBcvRate({ ...rateInput, source: "  " });
    expect(noSource.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();

    const badDate = await registerBcvRate({ ...rateInput, observedAt: "not-a-date" });
    expect(badDate.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps database errors to Spanish text without leaking SQL", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'snapshot_bcv_rate: no active BCV rate is available' },
    });
    const result = await deactivateBcvRate({ rateId: 9 });
    expect(result).toEqual({
      ok: false,
      error: "No hay una tasa BCV activa disponible. El pedido conserva su total en USD.",
    });
    expect(JSON.stringify(result)).not.toContain("public.");
  });

  it("deactivates a rate with the session-derived admin", async () => {
    rpc.mockResolvedValue({ data: { rate_id: 9, idempotent: true }, error: null });
    expect(await deactivateBcvRate({ rateId: 9 })).toEqual({
      ok: true,
      rateId: 9,
      idempotent: true,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("deactivate_bcv_rate", {
      p_rate_id: 9,
      p_admin_id: ADMIN,
    });
  });

  it("returns the rate history newest first", async () => {
    limit.mockResolvedValue({
      data: [
        {
          id: 9,
          rate_ves_per_usd: "36.5000",
          observed_at: "2020-01-01T10:00:00Z",
          source: "manual:bcv",
          is_active: true,
          note: null,
          registered_by: ADMIN,
          supersedes_id: null,
          created_at: "2020-01-01T10:00:01Z",
        },
      ],
      error: null,
    });

    const result = await listBcvRates();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rates).toHaveLength(1);
      expect(result.rates[0]?.rate_ves_per_usd).toBe("36.5000");
    }
    expect(from).toHaveBeenCalledExactlyOnceWith("exchange_rates");
    expect(order).toHaveBeenCalledExactlyOnceWith("observed_at", { ascending: false });
    expect(limit).toHaveBeenCalledExactlyOnceWith(200);
  });

  it("applies a rate snapshot to an order without trusting a client admin id", async () => {
    rpc.mockResolvedValue({ data: snapshot, error: null });
    const result = await applyBcvRateToOrder({ orderId: 42 });
    expect(result).toEqual({
      ok: true,
      orderId: 42,
      rateVesPerUsd: 36.5,
      rateAt: "2020-01-01T10:00:00Z",
      totalVes: 374.13,
      roundingRule: "round_half_up",
      applied: true,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("apply_bcv_rate_to_order", {
      p_order_id: 42,
      p_admin_id: ADMIN,
    });
  });

  it("fails closed when the session is not an active administrator", async () => {
    vi.mocked(requireActiveAdminId).mockRejectedValue(new Error("sesión inválida"));
    expect(await registerBcvRate(rateInput)).toEqual({
      ok: false,
      error: "La sesión del administrador no es válida.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
