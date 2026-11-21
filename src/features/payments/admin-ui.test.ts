import { describe, expect, it } from "vitest";
import {
  buildPosItems,
  createIdempotencyKey,
  isPositiveMoneyInput,
  moneyPattern,
  positiveMoneyMessage,
  quantityFieldName,
  resolveIdempotencyKey,
} from "./admin-ui";
import {
  idempotencyKeySchema,
  nonNegativeMoneySchema,
  positiveMoneySchema,
} from "./schemas";

describe("createIdempotencyKey", () => {
  it("uses the prefix and a UUID with server-safe characters", () => {
    const key = createIdempotencyKey("pos");

    expect(key).toMatch(/^pos-[0-9a-f-]{36}$/i);
    expect(key).toMatch(/^[A-Za-z0-9._:-]+$/);
  });

  it("produces a distinct key for every operation", () => {
    const keys = new Set(
      Array.from({ length: 10 }, () => createIdempotencyKey("reembolso")),
    );

    expect(keys.size).toBe(10);
  });
});

describe("buildPosItems", () => {
  it("ignores unknown IDs, invalid quantities, and unrelated form fields", () => {
    const formData = new FormData();
    formData.set(quantityFieldName(1), "2");
    formData.set(quantityFieldName(2), "0");
    formData.set(quantityFieldName(3), "-1");
    formData.set(quantityFieldName(4), "1.5");
    formData.set(quantityFieldName(5), "not-a-number");
    formData.set(quantityFieldName(999), "5");
    formData.set("price-1", "10.00");
    formData.set("currency", "USD");
    formData.set("adminId", "spoofed");
    formData.set("customerName", "spoofed");

    const items = buildPosItems(formData, [1, 2, 3, 4, 5]);

    expect(items).toEqual([{ productId: 1, quantity: 2 }]);
    expect(Object.keys(items[0])).toEqual(["productId", "quantity"]);
  });

  it("returns quantities in the order of the allowed product IDs", () => {
    const formData = new FormData();
    formData.set(quantityFieldName(5), "2");
    formData.set(quantityFieldName(8), "1");
    formData.set(quantityFieldName(2), "3");

    expect(buildPosItems(formData, [8, 2, 5])).toEqual([
      { productId: 8, quantity: 1 },
      { productId: 2, quantity: 3 },
      { productId: 5, quantity: 2 },
    ]);
  });

  it("accepts a positive integer written with leading zeros", () => {
    const formData = new FormData();
    formData.set(quantityFieldName(7), "003");

    expect(buildPosItems(formData, [7])).toEqual([{ productId: 7, quantity: 3 }]);
  });
});

describe("resolveIdempotencyKey", () => {
  const current = "pos-existing-key-123";

  it("retries with the exact same key", () => {
    expect(resolveIdempotencyKey("pos", current, "retry")).toBe(current);
  });

  it("resets to a different valid key", () => {
    const reset = resolveIdempotencyKey("reembolso", current, "reset");

    expect(reset).not.toBe(current);
    expect(reset).toMatch(/^reembolso-[0-9a-f-]{36}$/i);
    expect(idempotencyKeySchema.safeParse(reset).success).toBe(true);
  });

  it("retains the reset key on a subsequent retry", () => {
    const reset = resolveIdempotencyKey("reembolso", current, "reset");

    expect(resolveIdempotencyKey("reembolso", reset, "retry")).toBe(reset);
  });
});

describe("client money validation parity", () => {
  it.each(["0", "0.00", "0.5", "00.50", "01", "1", "1.234", ""])(
    "matches the backend schemas for %j",
    (value) => {
      const patternValid = new RegExp(moneyPattern).test(value.trim());

      expect(patternValid).toBe(nonNegativeMoneySchema.safeParse(value).success);
      expect(isPositiveMoneyInput(value)).toBe(positiveMoneySchema.safeParse(value).success);
    },
  );

  it("uses the backend positive-amount message", () => {
    const parsed = positiveMoneySchema.safeParse("0");

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe(positiveMoneyMessage);
    }
  });
});
