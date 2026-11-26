/**
 * Capacity rules for «Agregar al carrito» plus static guards that keep the
 * product-detail panel from reintroducing unlimited repeated adds.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canIncreaseCartItemQuantity,
  resolveAddToCartCapacity,
} from "./add-to-cart-capacity";

const helperSource = readFileSync(
  fileURLToPath(new URL("./add-to-cart-capacity.ts", import.meta.url)),
  "utf8",
);
const productDetail = readFileSync(
  fileURLToPath(new URL("./components/product-detail.tsx", import.meta.url)),
  "utf8",
);
const cartClient = readFileSync(
  fileURLToPath(new URL("../cart/components/cart-client.tsx", import.meta.url)),
  "utf8",
);

describe("resolveAddToCartCapacity", () => {
  it("keeps unknown stock unlimited and always selects at least one unit", () => {
    const result = resolveAddToCartCapacity({
      available: null,
      inCart: 2,
      selected: 4,
    });

    expect(result).toEqual({
      stock: null,
      inCart: 2,
      remaining: null,
      selectorMax: null,
      effectiveQuantity: 4,
      limitReached: false,
    });

    for (const selected of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        resolveAddToCartCapacity({ available: null, inCart: 0, selected })
          .effectiveQuantity,
      ).toBe(1);
    }
  });

  it("caps the effective quantity by known stock", () => {
    expect(
      resolveAddToCartCapacity({ available: 5, inCart: 0, selected: 10 }),
    ).toEqual({
      stock: 5,
      inCart: 0,
      remaining: 5,
      selectorMax: 5,
      effectiveQuantity: 5,
      limitReached: false,
    });
  });

  it("subtracts the units already in the bag from the remaining capacity", () => {
    const result = resolveAddToCartCapacity({
      available: 5,
      inCart: 2,
      selected: 4,
    });

    expect(result).toEqual({
      stock: 5,
      inCart: 2,
      remaining: 3,
      selectorMax: 3,
      effectiveQuantity: 3,
      limitReached: false,
    });
  });

  it("returns zero and blocks when the bag already holds all the stock", () => {
    for (const input of [
      { available: 2, inCart: 2, selected: 1 },
      { available: 2, inCart: 7, selected: 3 },
    ]) {
      expect(resolveAddToCartCapacity(input)).toEqual({
        stock: 2,
        inCart: input.inCart,
        remaining: 0,
        selectorMax: 0,
        effectiveQuantity: 0,
        limitReached: true,
      });
    }
  });

  it("returns zero and blocks for out-of-stock products", () => {
    for (const available of [0, -3]) {
      expect(
        resolveAddToCartCapacity({ available, inCart: 0, selected: 4 }),
      ).toEqual({
        stock: 0,
        inCart: 0,
        remaining: 0,
        selectorMax: 0,
        effectiveQuantity: 0,
        limitReached: true,
      });
    }
  });

  it("falls back safely for invalid inputs", () => {
    for (const inCart of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      const result = resolveAddToCartCapacity({
        available: 5,
        inCart: inCart as number,
        selected: 2,
      });
      expect(result.inCart).toBe(0);
      expect(result.remaining).toBe(5);
    }

    for (const selected of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      const result = resolveAddToCartCapacity({
        available: 5,
        inCart: 2,
        selected: selected as number,
      });
      expect(result.effectiveQuantity).toBe(1);
    }

    for (const available of [
      Number.NaN,
      2.5,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      const result = resolveAddToCartCapacity({
        available: available as number,
        inCart: 2,
        selected: 3,
      });
      expect(result.stock).toBeNull();
      expect(result.remaining).toBeNull();
      expect(result.effectiveQuantity).toBe(3);
      expect(result.limitReached).toBe(false);
    }
  });

  it("never returns negative or fractional results", () => {
    const availables: unknown[] = [
      null,
      -2,
      0,
      1,
      6,
      2.5,
      Number.NaN,
      Number.MAX_SAFE_INTEGER + 1,
    ];
    const inCarts: unknown[] = [-1, 0, 2, 9, 1.5, Number.NaN];
    const selecteds: unknown[] = [0, 1, 3, -2, 2.5, Number.POSITIVE_INFINITY];

    for (const available of availables) {
      for (const inCart of inCarts) {
        for (const selected of selecteds) {
          const result = resolveAddToCartCapacity({
            available: available as number | null,
            inCart: inCart as number,
            selected: selected as number,
          });
          for (const value of [
            result.stock,
            result.inCart,
            result.remaining,
            result.selectorMax,
            result.effectiveQuantity,
          ]) {
            if (value === null) continue;
            expect(Number.isSafeInteger(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
          }
          expect(result.limitReached).toBe(result.remaining === 0);
        }
      }
    }
  });
});

describe("canIncreaseCartItemQuantity", () => {
  it("allows an increase while known stock is above the current quantity", () => {
    expect(canIncreaseCartItemQuantity(5, 0)).toBe(true);
    expect(canIncreaseCartItemQuantity(5, 4)).toBe(true);
  });

  it("blocks increases at or above known stock, including stale bags", () => {
    expect(canIncreaseCartItemQuantity(5, 5)).toBe(false);
    expect(canIncreaseCartItemQuantity(5, 7)).toBe(false);
    expect(canIncreaseCartItemQuantity(-2, 0)).toBe(false);
  });

  it("blocks every increase for zero stock", () => {
    for (const quantity of [0, 1, 7]) {
      expect(canIncreaseCartItemQuantity(0, quantity)).toBe(false);
    }
  });

  it("leaves unknown or unsafe stock to the server fallback", () => {
    const unavailable: Array<number | null> = [
      null,
      Number.NaN,
      1.5,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ];
    for (const available of unavailable) {
      expect(canIncreaseCartItemQuantity(available, 0)).toBe(true);
      expect(canIncreaseCartItemQuantity(available, 99)).toBe(true);
    }
  });

  it("sanitizes an invalid quantity to zero before comparing", () => {
    for (const quantity of [
      -3,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(canIncreaseCartItemQuantity(3, quantity as number)).toBe(true);
      expect(canIncreaseCartItemQuantity(0, quantity as number)).toBe(false);
    }
  });
});

describe("add-to-cart capacity contract (static)", () => {
  it("keeps the helper environment-neutral", () => {
    expect(helperSource).not.toContain('"use client"');
    expect(helperSource).not.toContain('from "react"');
    expect(helperSource).not.toContain("server-only");
  });

  it("caps addItem with the computed qty", () => {
    expect(productDetail).toContain(
      'import { resolveAddToCartCapacity } from "../add-to-cart-capacity";',
    );
    expect(productDetail).toContain("const { addItem, items } = useCart();");
    expect(productDetail).toMatch(/const inCart =[\s\S]*?items\.find\(/);
    expect(productDetail).toContain(
      "resolveAddToCartCapacity({ available, inCart, selected: quantity })",
    );

    const handler =
      productDetail.match(/function handleAdd\([\s\S]*?\n  \}/)?.[0] ?? "";
    const successStart = handler.indexOf("const qty = effectiveQuantity;");
    expect(successStart).toBeGreaterThan(-1);

    const addItemCall =
      handler.match(/addItem\([\s\S]*?\n    \);/)?.[0] ?? "";
    expect(addItemCall).toContain("qty,");
    expect(handler).toContain('showToast(message, "success")');
    expect(handler).toContain(
      "announceCartFlight({ quantity: qty, origin: event.currentTarget })",
    );
  });

  it("never adds or announces a flight on the blocked path", () => {
    const handler =
      productDetail.match(/function handleAdd\([\s\S]*?\n  \}/)?.[0] ?? "";
    const successStart = handler.indexOf("const qty = effectiveQuantity;");
    expect(successStart).toBeGreaterThan(-1);

    const blockedPath = handler.slice(0, successStart);
    expect(blockedPath).toContain("if (outOfStock)");
    expect(blockedPath).toContain("if (limitReached");
    expect(blockedPath).toContain("return;");
    expect(blockedPath).not.toContain("addItem(");
    expect(blockedPath).not.toContain("showToast(");
    expect(blockedPath).not.toContain("announceCartFlight(");
  });

  it("disables the add button and explains the no-capacity state", () => {
    expect(productDetail).toContain("disabled={outOfStock || limitReached}");
    expect(productDetail).toContain("Sin unidades disponibles para agregar");
    expect(productDetail).toContain("en la bolsa");
    expect(productDetail).toContain("selectorMax");
    expect(productDetail).toContain("quedan ${remaining}");
  });

  it("guards the cart plus control with the same helper", () => {
    expect(cartClient).toContain(
      'import { canIncreaseCartItemQuantity } from "@/features/catalog/add-to-cart-capacity";',
    );
    expect(cartClient).toContain("const available = stockByProductId[item.productId] ?? null;");
    expect(cartClient).toContain(
      "const canIncrease = canIncreaseCartItemQuantity(available, item.quantity);",
    );

    const increaseLabel = cartClient.indexOf("? `Aumentar cantidad de ${item.name}`");
    expect(increaseLabel).toBeGreaterThan(-1);
    const plusButton = cartClient.slice(
      cartClient.lastIndexOf("<Button", increaseLabel),
      cartClient.indexOf("/>", increaseLabel) + 2,
    );
    expect(plusButton).toContain("disabled={!canIncrease}");
  });
});
