import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { registerDigitalPaymentWithReceipt } from "./guest-payments";

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

const rpc = vi.fn();
const upload = vi.fn();
const remove = vi.fn();
const storageFrom = vi.fn(() => ({ upload, remove }));

const validInput = {
  trackingToken: "ab".repeat(32),
  method: "pago_movil" as const,
  amount: "1500.50",
  reference: "PM-001",
  idempotencyKey: "checkout-abc-123",
  file: {
    name: "comprobante.png",
    type: "image/png",
    size: 12,
    arrayBuffer: () => Promise.resolve(new Uint8Array(12).buffer),
  },
};

const trackedOrder = { order_id: 42, status: "pending" };
const registeredPayment = {
  payment_id: 7,
  order_id: 42,
  status: "in_review",
  idempotent: false,
};
const evidence = {
  payment_id: 7,
  order_id: 42,
  submission_id: 3,
  attempt_number: 1,
  idempotent: false,
  reservations_held: 1,
};

function mockRpc(): void {
  rpc.mockImplementation(async (name: string) => {
    if (name === "get_order_for_tracking") return { data: trackedOrder, error: null };
    if (name === "register_payment_for_tracking") return { data: registeredPayment, error: null };
    if (name === "submit_payment_evidence") return { data: evidence, error: null };
    throw new Error(`unexpected RPC ${name}`);
  });
}

describe("registerDigitalPaymentWithReceipt server action", () => {
  beforeEach(() => {
    rpc.mockReset();
    upload.mockReset();
    remove.mockReset();
    storageFrom.mockClear();
    upload.mockResolvedValue({ data: { path: "stored" }, error: null });
    remove.mockResolvedValue({ data: [], error: null });
    mockRpc();
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      rpc,
      storage: { from: storageFrom },
    } as never);
  });

  it("validates ownership, uploads privately and links the evidence in order", async () => {
    const result = await registerDigitalPaymentWithReceipt(validInput);

    expect(result).toEqual({
      ok: true,
      paymentId: 7,
      orderId: 42,
      status: "in_review",
      submissionId: 3,
      attemptNumber: 1,
      idempotent: false,
    });
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      "get_order_for_tracking",
      "register_payment_for_tracking",
      "submit_payment_evidence",
    ]);
    expect(rpc).toHaveBeenCalledWith("get_order_for_tracking", {
      p_token: validInput.trackingToken,
    });
    expect(rpc).toHaveBeenCalledWith("register_payment_for_tracking", {
      p_token: validInput.trackingToken,
      p_method: "pago_movil",
      p_amount: "1500.50",
      p_reference: "PM-001",
      p_receipt_path: expect.stringMatching(/^42\/[0-9a-f-]+\.png$/),
      p_idempotency_key: "checkout-abc-123",
    });
    expect(rpc).toHaveBeenCalledWith("submit_payment_evidence", { p_payment_id: 7 });
    expect(storageFrom).toHaveBeenCalledWith("payment-receipts");
    expect(upload).toHaveBeenCalledOnce();
    const path = upload.mock.calls[0][0] as string;
    expect(rpc.mock.calls[1][1].p_receipt_path).toBe(path);
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: "image/png", upsert: false });
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([
    ["a short token", { trackingToken: "abc" }],
    ["an unsupported method", { method: "binance" }],
    ["a zero amount", { amount: "0" }],
    ["a three-decimal amount", { amount: "10.123" }],
    ["an empty reference", { reference: "  " }],
    ["a short idempotency key", { idempotencyKey: "x" }],
  ])("rejects %s before touching Supabase", async (_label, override: Record<string, unknown>) => {
    const result = await registerDigitalPaymentWithReceipt({
      ...validInput,
      ...override,
    } as Parameters<typeof registerDigitalPaymentWithReceipt>[0]);

    expect(result.ok).toBe(false);
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it.each([
    ["GIF", "image/gif", 12],
    ["empty PNG", "image/png", 0],
    ["oversized PDF", "application/pdf", 5 * 1024 * 1024 + 1],
  ])("validates the %s file from the file object itself", async (_label, type, size) => {
    const result = await registerDigitalPaymentWithReceipt({
      ...validInput,
      file: { ...validInput.file, type, size },
    });

    expect(result).toEqual({
      ok: false,
      error: "El comprobante debe ser JPG, PNG, WebP o PDF de hasta 5 MB.",
    });
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("refuses an order that can no longer accept payments before uploading", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "get_order_for_tracking") return { data: { ...trackedOrder, status: "expired" }, error: null };
      throw new Error(`unexpected RPC ${name}`);
    });

    const result = await registerDigitalPaymentWithReceipt(validInput);

    expect(result).toEqual({ ok: false, error: "El pedido ya no admite pagos." });
    expect(upload).not.toHaveBeenCalled();
  });

  it("maps token errors without leaking SQL details", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "no order matches the tracking token in public.orders" },
    });

    const result = await registerDigitalPaymentWithReceipt(validInput);

    expect(result).toEqual({ ok: false, error: "El enlace de seguimiento no es válido." });
    expect(JSON.stringify(result)).not.toContain("public.orders");
  });

  it("removes the private object when the payment RPC fails", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "get_order_for_tracking") return { data: trackedOrder, error: null };
      if (name === "register_payment_for_tracking") {
        return { data: null, error: { message: "register_payment: order 42 is expired" } };
      }
      throw new Error(`unexpected RPC ${name}`);
    });

    const result = await registerDigitalPaymentWithReceipt(validInput);

    expect(result.ok).toBe(false);
    expect(remove).toHaveBeenCalledWith([expect.stringMatching(/^42\/[0-9a-f-]+\.png$/)]);
    expect(rpc).not.toHaveBeenCalledWith("submit_payment_evidence", expect.anything());
  });

  it("does not remove evidence after the payment row has been created", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "get_order_for_tracking") return { data: trackedOrder, error: null };
      if (name === "register_payment_for_tracking") return { data: registeredPayment, error: null };
      if (name === "submit_payment_evidence") {
        return { data: null, error: { message: "submit_payment_evidence: the correction window for order 42 has closed" } };
      }
      throw new Error(`unexpected RPC ${name}`);
    });

    const result = await registerDigitalPaymentWithReceipt(validInput);

    expect(result).toEqual({
      ok: false,
      error: "El plazo para corregir el comprobante ya venció.",
    });
    expect(remove).not.toHaveBeenCalled();
  });
});
