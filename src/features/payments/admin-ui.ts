/** Pure helpers for the administrator POS/refund forms. No network or auth here. */

const QUANTITY_FIELD_PREFIX = "quantity-";

export type PosItemInput = {
  productId: number;
  quantity: number;
};

/** Field name used for each catalog product's quantity control. */
export function quantityFieldName(productId: number): string {
  return `${QUANTITY_FIELD_PREFIX}${productId}`;
}

/** CSS selector prefix for focusing the first quantity control after validation. */
export const QUANTITY_FIELD_SELECTOR_PREFIX = QUANTITY_FIELD_PREFIX;

/** Client mirror of the backend money regex (non-negative shape). */
export const moneyPattern = String.raw`^(?:0|[1-9]\d*)(?:\.\d{1,2})?$`;
export const positiveMoneyMessage = "El importe debe ser mayor que cero.";

const moneyPatternRegExp = new RegExp(moneyPattern);

/** Client-side UX check only; the server schema remains the security boundary. */
export function isPositiveMoneyInput(value: string): boolean {
  const normalized = value.trim();
  return moneyPatternRegExp.test(normalized) && Number(normalized) > 0;
}

/** Stable per-operation key; callers retain it across retries and reset explicitly. */
export function createIdempotencyKey(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

/** Retries reuse the current key; only an explicit reset generates a new one. */
export function resolveIdempotencyKey(
  prefix: string,
  current: string,
  action: "retry" | "reset",
): string {
  return action === "retry" ? current : createIdempotencyKey(prefix);
}

/**
 * Reads only quantities for IDs supplied by the server-rendered catalog.
 * Unknown product IDs, non-numeric values, and non-positive or fractional
 * quantities are ignored. Ordering follows `allowedProductIds`.
 */
export function buildPosItems(
  formData: FormData,
  allowedProductIds: Iterable<number>,
): PosItemInput[] {
  const items: PosItemInput[] = [];

  for (const productId of allowedProductIds) {
    if (!Number.isSafeInteger(productId) || productId <= 0) continue;

    const rawQuantity = formData.get(quantityFieldName(productId));
    if (typeof rawQuantity !== "string") continue;

    const quantity = parsePositiveInteger(rawQuantity);
    if (quantity === null) continue;

    items.push({ productId, quantity });
  }

  return items;
}

function parsePositiveInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const quantity = Number(trimmed);
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
}
