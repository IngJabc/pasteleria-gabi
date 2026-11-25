import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import { applyBcvRateForTracking, getCurrentBcvRate } from "./checkout-rates";

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("@/infrastructure/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const publicRpc = vi.fn();
const adminRpc = vi.fn();
const TOKEN = "a".repeat(64);

const currentRate = {
  rate_ves_per_usd: 36.5,
  observed_at: "2020-01-01T10:00:00Z",
  source: "manual:bcv",
  is_stale: true,
  age_seconds: 1234,
  as_of: "2026-11-20T10:00:00Z",
};

const productionRate = {
  rate_ves_per_usd: 922.5637,
  observed_at: "2026-11-25T12:00:00Z",
  source: "automatic:bcv.today",
  is_stale: false,
  age_seconds: 0,
  as_of: "2026-11-25T12:00:05Z",
};

describe("checkout rate server actions", () => {
  beforeEach(() => {
    publicRpc.mockReset();
    adminRpc.mockReset();
    vi.mocked(createSupabaseServerClient).mockReset();
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ rpc: publicRpc } as never);
    vi.mocked(createSupabaseAdminClient).mockReset();
    vi.mocked(createSupabaseAdminClient).mockReturnValue({ rpc: adminRpc } as never);
  });

  it("returns the current rate with its age and staleness flag", async () => {
    publicRpc.mockResolvedValue({ data: currentRate, error: null });
    const result = await getCurrentBcvRate();
    expect(result).toEqual({
      ok: true,
      rate: {
        rateVesPerUsd: 36.5,
        observedAt: "2020-01-01T10:00:00Z",
        source: "manual:bcv",
        isStale: true,
        ageSeconds: 1234,
        asOf: "2026-11-20T10:00:00Z",
      },
    });
    expect(publicRpc).toHaveBeenCalledExactlyOnceWith("get_bcv_rate");
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("reports the absence of a rate instead of inventing one", async () => {
    publicRpc.mockResolvedValue({ data: null, error: null });
    expect(await getCurrentBcvRate()).toEqual({ ok: true, rate: null });
    expect(createSupabaseServerClient).toHaveBeenCalledTimes(1);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("maps a public RPC error without consulting the service role", async () => {
    publicRpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    expect(await getCurrentBcvRate()).toEqual({
      ok: false,
      error: "No se pudo consultar la tasa. Inténtalo de nuevo.",
    });
    expect(createSupabaseServerClient).toHaveBeenCalledTimes(1);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a malformed rate payload without a fallback", async () => {
    publicRpc.mockResolvedValue({
      data: { ...productionRate, as_of: undefined },
      error: null,
    });
    expect(await getCurrentBcvRate()).toEqual({
      ok: false,
      error: "No se pudo consultar la tasa. Inténtalo de nuevo.",
    });
    expect(createSupabaseServerClient).toHaveBeenCalledTimes(1);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("reads the active production rate even when the service-role client is unavailable", async () => {
    vi.mocked(createSupabaseAdminClient).mockImplementation(() => {
      throw new Error("service role unavailable");
    });
    publicRpc.mockResolvedValue({ data: productionRate, error: null });

    expect(await getCurrentBcvRate()).toEqual({
      ok: true,
      rate: {
        rateVesPerUsd: 922.5637,
        observedAt: "2026-11-25T12:00:00Z",
        source: "automatic:bcv.today",
        isStale: false,
        ageSeconds: 0,
        asOf: "2026-11-25T12:00:05Z",
      },
    });
    expect(publicRpc).toHaveBeenCalledExactlyOnceWith("get_bcv_rate");
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("snapshots a rate using only the private tracking token", async () => {
    adminRpc.mockResolvedValue({
      data: {
        order_id: 42,
        bcv_rate_ves: "36.5000",
        bcv_rate_at: "2020-01-01T10:00:00Z",
        total_ves: "374.13",
        rounding_rule: "round_half_up",
        applied: true,
        age_seconds: 10,
      },
      error: null,
    });

    const result = await applyBcvRateForTracking({ trackingToken: TOKEN });
    expect(result).toEqual({
      ok: true,
      orderId: 42,
      rateVesPerUsd: "36.5000",
      rateAt: "2020-01-01T10:00:00Z",
      totalVes: "374.13",
      roundingRule: "round_half_up",
      applied: true,
      ageSeconds: 10,
    });
    expect(adminRpc).toHaveBeenCalledExactlyOnceWith("apply_bcv_rate_for_tracking", {
      p_token: TOKEN,
    });
    expect(publicRpc).not.toHaveBeenCalled();
  });

  it("validates the token before calling any RPC", async () => {
    const result = await applyBcvRateForTracking({ trackingToken: "short" });
    expect(result.ok).toBe(false);
    expect(adminRpc).not.toHaveBeenCalled();
    expect(publicRpc).not.toHaveBeenCalled();
  });

  it("maps the no-rate error to Spanish without SQL details", async () => {
    adminRpc.mockResolvedValue({
      data: null,
      error: { message: "snapshot_bcv_rate: no active BCV rate is available" },
    });
    const result = await applyBcvRateForTracking({ trackingToken: TOKEN });
    expect(result).toEqual({
      ok: false,
      error: "No hay una tasa BCV activa disponible. El pedido conserva su total en USD.",
    });
    expect(JSON.stringify(result)).not.toContain("snapshot_bcv_rate");
    expect(adminRpc).toHaveBeenCalledExactlyOnceWith("apply_bcv_rate_for_tracking", {
      p_token: TOKEN,
    });
  });
});
