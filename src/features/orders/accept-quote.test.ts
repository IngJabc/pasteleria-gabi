import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { acceptQuoteFee } from "./accept-quote";

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

const rpc = vi.fn();

const validResult = {
  order_id: 42,
  quote_accepted_at: "2026-11-20T14:00:00.000Z",
  quote_acceptance_expires_at: "2026-11-20T14:20:00.000Z",
  reservations_updated: 2,
  idempotent: false,
};

describe("OQ-17 acceptQuoteFee server action", () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.mocked(createSupabaseAdminClient).mockReturnValue({ rpc } as never);
  });

  it("calls only the token-authorized service-role RPC and maps its result", async () => {
    rpc.mockResolvedValue({ data: validResult, error: null });
    const token = "ab".repeat(32);

    const result = await acceptQuoteFee({ trackingToken: token });

    expect(createSupabaseAdminClient).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("accept_quote_fee_for_tracking", {
      p_token: token,
    });
    expect(result).toEqual({
      ok: true,
      orderId: 42,
      quoteAcceptedAt: validResult.quote_accepted_at,
      quoteAcceptanceExpiresAt: validResult.quote_acceptance_expires_at,
      reservationsUpdated: 2,
      idempotent: false,
    });
  });

  it("exposes idempotent replays unchanged", async () => {
    rpc.mockResolvedValue({ data: { ...validResult, idempotent: true }, error: null });

    const result = await acceptQuoteFee({ trackingToken: "cd".repeat(32) });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.idempotent).toBe(true);
      expect(result.quoteAcceptanceExpiresAt).toBe(validResult.quote_acceptance_expires_at);
    }
  });

  it.each([
    ["an order id", "42"],
    ["an empty token", ""],
    ["a short token", "abc123"],
    ["a non-hex token", "zz".repeat(32)],
  ])("rejects %s before touching Supabase", async (_label, token) => {
    const result = await acceptQuoteFee({ trackingToken: token });

    expect(result).toEqual({ ok: false, error: "El enlace de seguimiento no es válido." });
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps database errors to localized messages without leaking SQL details", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "accept_quote_fee: order 42 already has a submitted receipt" },
    });

    const result = await acceptQuoteFee({ trackingToken: "ef".repeat(32) });

    expect(result).toEqual({
      ok: false,
      error: "El pedido ya tiene un comprobante enviado; la cotización no se puede aceptar.",
    });
    expect(JSON.stringify(result)).not.toContain("accept_quote_fee");
  });

  it("fails closed when the RPC returns an unexpected payload", async () => {
    rpc.mockResolvedValue({ data: { order_id: 42 }, error: null });

    const result = await acceptQuoteFee({ trackingToken: "12".repeat(32) });

    expect(result).toEqual({
      ok: false,
      error: "No se pudo aceptar la cotización. Inténtalo de nuevo.",
    });
  });

  it("never writes tables directly and never accepts an order id parameter", () => {
    const source = readFileSync(new URL("./accept-quote.ts", import.meta.url), "utf8");

    expect(source).toContain('"use server"');
    expect(source).toContain("createSupabaseAdminClient");
    expect(source).toContain('supabase.rpc("accept_quote_fee_for_tracking"');
    expect(source).not.toMatch(/\.from\s*\(/);
    expect(source).not.toMatch(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(/);
    expect(source).not.toMatch(/p_order_id/);
    expect(source).toMatch(/input:\s*\{\s*trackingToken:\s*string;\s*\}/);
    expect(source).toMatch(/\^\[0-9a-f\]\{64\}\$/);
  });
});
