import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { getReceiptUrlsForTracking } from "./receipt-review";
import { receiptReviewUnavailableError } from "./schemas";

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

const token = "ab".repeat(32);
const originalPath = "42/11111111-1111-4111-8111-111111111111.png";
const correctionPath = "42/22222222-2222-4222-8222-222222222222.jpg";
const trackedOrder = { order_id: 42, status: "confirmed" };
const originalPayment = { id: 7, receipt_path: originalPath, status: "rejected" };
const correctionPayment = { id: 8, receipt_path: correctionPath, status: "approved" };

const rpc = vi.fn();
const from = vi.fn();
const storageFrom = vi.fn();
const createSignedUrl = vi.fn();
const paymentsSelect = vi.fn();
const paymentsEq = vi.fn();
const paymentsNot = vi.fn();
const paymentsOrder = vi.fn();
const submissionsSelect = vi.fn();
const submissionsEq = vi.fn();

const paymentsQuery = {
  select: paymentsSelect,
  eq: paymentsEq,
  not: paymentsNot,
  order: paymentsOrder,
};
const submissionsQuery = { select: submissionsSelect, eq: submissionsEq };

function signedUrlFor(path: string): string {
  return `https://signed.example/${encodeURIComponent(path)}`;
}

function configureSupabase(): void {
  paymentsSelect.mockReturnValue(paymentsQuery);
  paymentsEq.mockReturnValue(paymentsQuery);
  paymentsNot.mockReturnValue(paymentsQuery);
  paymentsOrder.mockResolvedValue({
    data: [originalPayment, correctionPayment],
    error: null,
  });
  submissionsSelect.mockReturnValue(submissionsQuery);
  submissionsEq.mockResolvedValue({ data: null, count: 2, error: null });

  from.mockImplementation((table: string) =>
    table === "payments" ? paymentsQuery : submissionsQuery,
  );
  storageFrom.mockReturnValue({ createSignedUrl });
  createSignedUrl.mockImplementation(async (path: string) => ({
    data: { signedUrl: signedUrlFor(path) },
    error: null,
  }));
  rpc.mockResolvedValue({ data: trackedOrder, error: null });

  vi.mocked(createSupabaseAdminClient).mockReturnValue({
    rpc,
    from,
    storage: { from: storageFrom },
  } as never);
}

describe("getReceiptUrlsForTracking server action", () => {
  beforeEach(() => {
    for (const mock of [
      vi.mocked(createSupabaseAdminClient),
      rpc,
      from,
      storageFrom,
      createSignedUrl,
      paymentsSelect,
      paymentsEq,
      paymentsNot,
      paymentsOrder,
      submissionsSelect,
      submissionsEq,
    ]) {
      mock.mockReset();
    }
    configureSupabase();
  });

  it("returns signed URLs only for the token-resolved order", async () => {
    const result = await getReceiptUrlsForTracking({ trackingToken: token });

    expect(result).toEqual({
      ok: true,
      urls: [signedUrlFor(originalPath), signedUrlFor(correctionPath)],
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_order_for_tracking", { p_token: token });
    expect(from.mock.calls).toEqual([["payments"], ["receipt_submissions"]]);
    expect(paymentsEq).toHaveBeenCalledTimes(1);
    expect(paymentsEq).toHaveBeenCalledWith("order_id", 42);
    expect(submissionsEq).toHaveBeenCalledTimes(1);
    expect(submissionsEq).toHaveBeenCalledWith("order_id", 42);
    expect(rpc.mock.calls.map((call) => call[0])).toEqual(["get_order_for_tracking"]);
    expect(JSON.stringify(result)).not.toContain(originalPath);
    expect(JSON.stringify(result)).not.toContain(correctionPath);
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("ignores client-supplied identifiers and uses only the token-resolved order", async () => {
    const result = await getReceiptUrlsForTracking({
      trackingToken: token,
      orderId: 999,
      customerEmail: "cliente@example.com",
      adminId: "00000000-0000-4000-8000-000000000000",
      receiptPath: "999/attacker.png",
    } as never);

    expect(result.ok).toBe(true);
    expect(paymentsEq).toHaveBeenCalledWith("order_id", 42);
    expect(submissionsEq).toHaveBeenCalledWith("order_id", 42);
    expect(createSignedUrl.mock.calls.map((call) => call[0])).toEqual([
      originalPath,
      correctionPath,
    ]);
    expect(JSON.stringify(result)).not.toContain("999");
    expect(JSON.stringify(result)).not.toContain("cliente@example.com");
  });

  it.each([
    ["a short token", "abc"],
    ["an uppercase token", token.toUpperCase()],
    ["a non-hex token", `${"g".repeat(63)}0`],
    ["a long token", `${token}0`],
  ])("rejects %s before touching Supabase", async (_label, invalidToken) => {
    const result = await getReceiptUrlsForTracking({ trackingToken: invalidToken });

    expect(result).toEqual({ ok: false, error: receiptReviewUnavailableError });
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it.each(["canceled", "expired"])(
    "returns a generic error for a %s order",
    async (status) => {
      rpc.mockResolvedValueOnce({ data: { ...trackedOrder, status }, error: null });

      const result = await getReceiptUrlsForTracking({ trackingToken: token });

      expect(result).toEqual({ ok: false, error: receiptReviewUnavailableError });
      expect(from).not.toHaveBeenCalled();
      expect(createSignedUrl).not.toHaveBeenCalled();
    },
  );

  it.each(["pending", "confirmed", "ready", "completed"])(
    "allows receipt re-view for an order in %s state",
    async (status) => {
      rpc.mockResolvedValueOnce({ data: { ...trackedOrder, status }, error: null });

      const result = await getReceiptUrlsForTracking({ trackingToken: token });

      expect(result.ok).toBe(true);
      expect(createSignedUrl).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["approved", "rejected"])(
    "allows receipt re-view after payment %s",
    async (status) => {
      paymentsOrder.mockResolvedValueOnce({
        data: [{ id: 9, receipt_path: originalPath, status }],
        error: null,
      });

      const result = await getReceiptUrlsForTracking({ trackingToken: token });

      expect(result).toEqual({ ok: true, urls: [signedUrlFor(originalPath)] });
      expect(createSignedUrl).toHaveBeenCalledWith(originalPath, 300);
    },
  );

  it("returns a still-unreviewed correction alongside a reviewed original", async () => {
    paymentsOrder.mockResolvedValueOnce({
      data: [
        { id: 7, receipt_path: originalPath, status: "rejected" },
        { id: 8, receipt_path: correctionPath, status: "in_review" },
      ],
      error: null,
    });

    const result = await getReceiptUrlsForTracking({ trackingToken: token });

    expect(result).toEqual({
      ok: true,
      urls: [signedUrlFor(originalPath), signedUrlFor(correctionPath)],
    });
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it("returns the original and the correction when both were submitted", async () => {
    const result = await getReceiptUrlsForTracking({ trackingToken: token });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.urls).toHaveLength(2);
    }
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
    expect(createSignedUrl).toHaveBeenNthCalledWith(1, originalPath, 300);
    expect(createSignedUrl).toHaveBeenNthCalledWith(2, correctionPath, 300);
  });

  it("mints every signed URL with the exact approved 300-second lifetime", async () => {
    await getReceiptUrlsForTracking({ trackingToken: token });

    expect(createSignedUrl.mock.calls).toEqual([
      [originalPath, 300],
      [correctionPath, 300],
    ]);
  });

  it("rejects an order with no payment receipts", async () => {
    paymentsOrder.mockResolvedValueOnce({ data: [], error: null });

    const result = await getReceiptUrlsForTracking({ trackingToken: token });

    expect(result).toEqual({ ok: false, error: receiptReviewUnavailableError });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects an order with no submitted receipt history", async () => {
    submissionsEq.mockResolvedValueOnce({ data: null, count: 0, error: null });

    const result = await getReceiptUrlsForTracking({ trackingToken: token });

    expect(result).toEqual({ ok: false, error: receiptReviewUnavailableError });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects payments that are only pending or in review", async () => {
    paymentsOrder.mockResolvedValueOnce({
      data: [
        { id: 7, receipt_path: originalPath, status: "pending" },
        { id: 8, receipt_path: correctionPath, status: "in_review" },
      ],
      error: null,
    });

    const result = await getReceiptUrlsForTracking({ trackingToken: token });

    expect(result).toEqual({ ok: false, error: receiptReviewUnavailableError });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("returns a generic error and no SQL details when token resolution fails", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: `no order matches ${token} in public.orders` },
    });

    const result = await getReceiptUrlsForTracking({ trackingToken: token });

    expect(result).toEqual({ ok: false, error: receiptReviewUnavailableError });
    expect(JSON.stringify(result)).not.toContain("public.orders");
    expect(JSON.stringify(result)).not.toContain(token);
    expect(from).not.toHaveBeenCalled();
  });

  it("does not expose payment-query errors", async () => {
    paymentsOrder.mockResolvedValueOnce({
      data: null,
      error: { message: `permission denied for ${originalPath}` },
    });

    const result = await getReceiptUrlsForTracking({ trackingToken: token });

    expect(result).toEqual({ ok: false, error: receiptReviewUnavailableError });
    expect(JSON.stringify(result)).not.toContain(originalPath);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("does not expose submission-query errors", async () => {
    submissionsEq.mockResolvedValueOnce({
      data: null,
      count: null,
      error: { message: `failed on order 42: ${correctionPath}` },
    });

    const result = await getReceiptUrlsForTracking({ trackingToken: token });

    expect(result).toEqual({ ok: false, error: receiptReviewUnavailableError });
    expect(JSON.stringify(result)).not.toContain(correctionPath);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("does not expose signed-URL errors or partially signed results", async () => {
    createSignedUrl
      .mockResolvedValueOnce({ data: { signedUrl: signedUrlFor(originalPath) }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: `storage denied for ${correctionPath}` } });

    const result = await getReceiptUrlsForTracking({ trackingToken: token });

    expect(result).toEqual({ ok: false, error: receiptReviewUnavailableError });
    expect(JSON.stringify(result)).not.toContain(correctionPath);
    expect(JSON.stringify(result)).not.toContain(originalPath);
  });

  it("returns a generic error when the service client throws", async () => {
    vi.mocked(createSupabaseAdminClient).mockImplementationOnce(() => {
      throw new Error(`database unavailable for ${token}`);
    });

    const result = await getReceiptUrlsForTracking({ trackingToken: token });

    expect(result).toEqual({ ok: false, error: receiptReviewUnavailableError });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never mutates payments, submissions, receipts or storage", async () => {
    await getReceiptUrlsForTracking({ trackingToken: token });

    expect(storageFrom).toHaveBeenCalledWith("payment-receipts");
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map((call) => call[0])).toEqual(["get_order_for_tracking"]);

    const source = readFileSync(new URL("./receipt-review.ts", import.meta.url), "utf8");
    expect(source).toContain('.select("receipt_path, status")');
    expect(source).not.toMatch(/register_payment_for_tracking|submit_payment_evidence|approve_payment|reject_payment/);
    expect(source).not.toMatch(/\.upload\(|\.remove\(|\.list\(/);
    expect(source).not.toMatch(/tracking_token_hash|customer_email|customer_name|customer_phone/);
  });

  it("uses an explicit accessible control with one live region and a semantic list", () => {
    const source = readFileSync(
      new URL("./receipt-review-control.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('"use client"');
    expect(source).not.toContain("useEffect");
    expect(source).toMatch(/<button\s/);
    expect(source).toContain('type="button"');
    expect(source).toContain("onClick={handleReview}");
    expect(source).toContain('aria-disabled={isPending}');
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toMatch(/<ul\s/);
    expect(source).not.toContain("receipt_path");
    expect(source).not.toContain("orderId");
  });
});
