/**
 * Client-safe pub/sub for the decorative "flying +N" cart chip.
 *
 * Only numeric viewport coordinates cross this boundary: the DOM node is read
 * at click time and never stored in React state. This module has no server
 * imports and does not change the cart's data or localStorage schema.
 */

export type CartFlightPoint = { x: number; y: number };

export type CartFlight = {
  id: number;
  label: string;
  origin: CartFlightPoint;
};

export type CartFlightAnnouncement = {
  quantity: number;
  origin: HTMLElement | null;
};

type CartFlightListener = (flight: CartFlight) => void;

const listeners = new Set<CartFlightListener>();
let nextFlightId = 1;

/** Subscribe to announced flights; the returned function unsubscribes. */
export function subscribeToCartFlights(listener: CartFlightListener): () => void {
  listeners.add(listener);
  return () => unsubscribeFromCartFlights(listener);
}

export function unsubscribeFromCartFlights(listener: CartFlightListener): void {
  listeners.delete(listener);
}

/** Chip text, always Spanish-neutral: a `+` and the added quantity. */
export function formatCartFlightLabel(quantity: number): string | null {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return null;
  return `+${quantity}`;
}

/** Pure center-of-rect math used for both the button and the bag link. */
export function cartFlightCenter(
  rect: { left: number; top: number; width: number; height: number } | null,
): CartFlightPoint | null {
  if (
    !rect ||
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.top) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return null;
  }
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Only the visible launch point is required; the bag may be scrolled away. */
export function isCartFlightPointVisible(
  point: CartFlightPoint | null,
  viewport: { width: number; height: number },
): boolean {
  if (
    !point ||
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return false;
  }
  return (
    point.x >= 0 &&
    point.x <= viewport.width &&
    point.y >= 0 &&
    point.y <= viewport.height
  );
}

/**
 * Pure reduced-motion decision: no chip is rendered for reduced-motion users or
 * when either endpoint is unavailable.
 */
export function shouldAnimateCartFlight(
  prefersReducedMotion: boolean,
  origin: CartFlightPoint | null,
  target: CartFlightPoint | null,
): boolean {
  return !prefersReducedMotion && origin !== null && target !== null;
}

export function prefersReducedCartFlightMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Called from the real storefront add action. It reads the button's rect now,
 * then broadcasts only plain numbers to the mounted flight layer.
 */
export function announceCartFlight({ quantity, origin }: CartFlightAnnouncement): void {
  if (listeners.size === 0 || prefersReducedCartFlightMotion() || !origin) return;

  const label = formatCartFlightLabel(quantity);
  const point = cartFlightCenter(origin.getBoundingClientRect());
  if (!label || !point) return;

  const flight: CartFlight = { id: nextFlightId++, label, origin: point };
  for (const listener of listeners) listener(flight);
}
