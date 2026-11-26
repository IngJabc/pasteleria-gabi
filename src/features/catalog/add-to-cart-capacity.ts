/**
 * Pure capacity calculation for the product-detail add-to-bag action.
 *
 * Availability comes from the server; quantities already in the local bag are
 * client state. This module deliberately has no React, browser or server
 * environment imports so it can be reused and tested in either environment.
 */

export type AddToCartCapacityInput = {
  available: number | null;
  inCart: number;
  selected: number;
};

export type AddToCartCapacity = {
  stock: number | null;
  inCart: number;
  remaining: number | null;
  selectorMax: number | null;
  effectiveQuantity: number;
  limitReached: boolean;
};

function sanitizeNonNegativeSafeInteger(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function sanitizeInCart(value: number): number {
  return sanitizeNonNegativeSafeInteger(value);
}

function sanitizeStock(available: number | null): number | null {
  return available === null || !Number.isSafeInteger(available)
    ? null
    : Math.max(0, available);
}

function sanitizeSelected(value: number): number {
  return Number.isSafeInteger(value) && value >= 1 ? value : 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function resolveAddToCartCapacity({
  available,
  inCart: inCartValue,
  selected: selectedValue,
}: AddToCartCapacityInput): AddToCartCapacity {
  const inCart = sanitizeInCart(inCartValue);
  const selected = sanitizeSelected(selectedValue);
  const stock = sanitizeStock(available);

  if (stock === null) {
    return {
      stock: null,
      inCart,
      remaining: null,
      selectorMax: null,
      effectiveQuantity: Math.max(1, selected),
      limitReached: false,
    };
  }

  if (stock === 0) {
    return {
      stock: 0,
      inCart,
      remaining: 0,
      selectorMax: 0,
      effectiveQuantity: 0,
      limitReached: true,
    };
  }

  const remaining = Math.max(0, stock - inCart);
  return {
    stock,
    inCart,
    remaining,
    selectorMax: remaining,
    effectiveQuantity: remaining === 0 ? 0 : clamp(selected, 1, remaining),
    limitReached: remaining === 0,
  };
}

/**
 * Guards the quantity stepper in the local bag. Known server stock is a hard
 * cap; unavailable/unknown stock leaves the existing server-side checkout
 * validation as the authority instead of blocking a legitimate increase.
 */
export function canIncreaseCartItemQuantity(
  available: number | null,
  quantity: number,
): boolean {
  const stock = sanitizeStock(available);
  if (stock === null) return true;
  return sanitizeNonNegativeSafeInteger(quantity) < stock;
}
