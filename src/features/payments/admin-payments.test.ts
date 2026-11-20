import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { requireActiveAdminId } from "./admin-session";
import {
  recordPaymentRefund,
  registerCashPayment,
  registerPosCashSale,
  reviewPayment,
} from "./admin-payments";

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("./admin-session", () => ({
  requireActiveAdminId: vi.fn(),
}));

const ADMIN = "11111111-1111-4111-8111-111111111111";
const rpc = vi.fn();

const cashInput = {
  orderId: 42,
  amount: "10.00",
  amountTenderedUsd: "20.00",
  idempotencyKey: "cash-key-123",
};
const cashResult = {
  payment_id: 7,
  order_id: 42,
  status: "approved",
  change_usd: "10.00",
  idempotent: false,
};
const reviewResult = {
  payment_id: 7,
  order_id: 42,
  status: "approved",
  order_status: "pending",
  idempotent: false,
};
const posResult = {
  order_id: 9,
  payment_id: 8,
  status: "approved",
  change_usd: "10.00",
  idempotent: false,
};
const refundResult = {
  refund_id: 5,
  payment_id: 7,
  status: "refunded_partial",
  total_refunded: "4.00",
  idempotent: false,
};

describe("administrator payment server actions", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: cashResult, error: null });
    vi.mocked(requireActiveAdminId).mockReset();
    vi.mocked(requireActiveAdminId).mockResolvedValue(ADMIN);
    vi.mocked(createSupabaseAdminClient).mockReturnValue({ rpc } as never);
  });

  it("registers collected cash against the requested order with the session-derived admin", async () => {
    rpc.mockResolvedValue({ data: cashResult, error: null });

    const result = await registerCashPayment(cashInput);

    expect(result).toEqual({
      ok: true,
      paymentId: 7,
      orderId: 42,
      status: "approved",
      changeUsd: "10.00",
      idempotent: false,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("register_payment", {
      p_order_id: 42,
      p_method: "cash_usd",
      p_currency: "USD",
      p_amount: "10.00",
      p_reference: null,
      p_receipt_path: null,
      p_amount_tendered_usd: "20.00",
      p_idempotency_key: "cash-key-123",
      p_registered_by: ADMIN,
      p_collected: true,
    });
  });

  it("never accepts an admin id in a cash input", async () => {
    const result = await registerCashPayment({
      ...cashInput,
      adminId: "99999999-9999-4999-8999-999999999999",
    } as never);

    expect(result.ok).toBe(true);
    expect(rpc.mock.calls[0][1].p_registered_by).toBe(ADMIN);
    expect(JSON.stringify(rpc.mock.calls[0][1])).not.toContain("99999999");
  });

  it("approves and rejects through the matching RPC without changing order state itself", async () => {
    rpc.mockResolvedValue({ data: reviewResult, error: null });

    await expect(reviewPayment({ paymentId: 7, decision: "approve" })).resolves.toMatchObject({
      ok: true,
      paymentId: 7,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("approve_payment", {
      p_payment_id: 7,
      p_admin_id: ADMIN,
    });

    rpc.mockClear();
    await reviewPayment({ paymentId: 7, decision: "reject" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("reject_payment", {
      p_payment_id: 7,
      p_admin_id: ADMIN,
    });
  });

  it("registers a POS sale with server-computed item objects and derived admin", async () => {
    rpc.mockResolvedValue({ data: posResult, error: null });

    const result = await registerPosCashSale({
      items: [{ productId: 1, quantity: 2 }],
      amountTenderedUsd: "30.00",
      idempotencyKey: "pos-key-123",
    });

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("register_pos_cash_sale", {
      p_items: [{ product_id: 1, quantity: 2 }],
      p_amount_tendered_usd: "30.00",
      p_idempotency_key: "pos-key-123",
      p_admin_id: ADMIN,
    });
  });

  it("records a refund with the payment currency resolved in the database", async () => {
    rpc.mockResolvedValue({ data: refundResult, error: null });

    const result = await recordPaymentRefund({
      paymentId: 7,
      amount: "4.00",
      method: "cash",
      reason: "devolución",
      idempotencyKey: "refund-key-1",
    });

    expect(result).toEqual({
      ok: true,
      refundId: 5,
      paymentId: 7,
      status: "refunded_partial",
      totalRefunded: "4.00",
      idempotent: false,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("record_refund", {
      p_payment_id: 7,
      p_amount: "4.00",
      p_method: "cash",
      p_reason: "devolución",
      p_admin_id: ADMIN,
      p_idempotency_key: "refund-key-1",
    });
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_currency");
  });

  it.each([
    ["cash", () => registerCashPayment({ ...cashInput, amount: "0" })],
    ["review", () => reviewPayment({ paymentId: 0, decision: "approve" })],
    ["POS", () => registerPosCashSale({ items: [], amountTenderedUsd: "1", idempotencyKey: "pos-key-123" })],
    ["refund", () => recordPaymentRefund({ paymentId: 7, amount: "1", method: "", reason: "x", idempotencyKey: "refund-key-1" })],
  ])("validates %s input before resolving a session", async (_label, call) => {
    const result = await call();

    expect(result.ok).toBe(false);
    expect(requireActiveAdminId).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the session is not an active administrator", async () => {
    vi.mocked(requireActiveAdminId).mockRejectedValue(new Error("expired"));

    const result = await registerCashPayment(cashInput);

    expect(result).toEqual({
      ok: false,
      error: "La sesión del administrador no es válida.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps database errors to public messages without SQL details", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "register_payment: order 42 is canceled in public.orders" },
    });

    const result = await registerCashPayment(cashInput);

    expect(result).toEqual({ ok: false, error: "El pedido ya no admite pagos." });
    expect(JSON.stringify(result)).not.toContain("public.orders");
  });
});
