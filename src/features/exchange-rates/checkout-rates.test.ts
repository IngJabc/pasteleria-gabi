import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { applyBcvRateForTracking, getCurrentBcvRate } from "./checkout-rates";

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

const rpc = vi.fn();
const TOKEN = "a".repeat(64);

const currentRate = {
  rate_ves_per_usd: 36.5,
  observed_at: "2020-01-01T10:00:00Z",
  source: "manual:bcv",
  is_stale: true,
  age_seconds: 1234,
  as_of: "2026-11-20T10:00:00Z",
};

describe("checkout rate server actions", () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.mocked(createSupabaseAdminClient).mockReturnValue({ rpc } as never);
  });

  it("returns the current rate with its age and staleness flag", async () => {
    rpc.mockResolvedValue({ data: currentRate, error: null });
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
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_bcv_rate");
  });

  it("reports the absence of a rate instead of inventing one", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getCurrentBcvRate()).toEqual({ ok: true, rate: null });
  });

  it("snapshots a rate using only the private tracking token", async () => {
    rpc.mockResolvedValue({
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
    expect(rpc).toHaveBeenCalledExactlyOnceWith("apply_bcv_rate_for_tracking", {
      p_token: TOKEN,
    });
  });

  it("validates the token before calling any RPC", async () => {
    const result = await applyBcvRateForTracking({ trackingToken: "short" });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps the no-rate error to Spanish without SQL details", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "snapshot_bcv_rate: no active BCV rate is available" },
    });
    const result = await applyBcvRateForTracking({ trackingToken: TOKEN });
    expect(result).toEqual({
      ok: false,
      error: "No hay una tasa BCV activa disponible. El pedido conserva su total en USD.",
    });
    expect(JSON.stringify(result)).not.toContain("snapshot_bcv_rate");
  });
});
