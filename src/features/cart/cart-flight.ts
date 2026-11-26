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

/** The real header bag link, read only at animation time. */
export const CART_TARGET_SELECTOR = "[data-cart-target]";

/** At most four decorative chips may be in flight at once. */
export const MAX_VISIBLE_CART_FLIGHTS = 4;

const CART_FLIGHT_LANES: readonly CartFlightPoint[] = [
  { x: 0, y: 0 },
  { x: -22, y: 0 },
  { x: 22, y: 0 },
  { x: 0, y: -22 },
];

const listeners = new Set<CartFlightListener>();
let nextFlightId = 1;

/**
 * Deterministic bounded lane for a flight id. The first four ids are distinct;
 * later ids wrap around. Every call returns a fresh object so callers cannot
 * mutate the shared lane table.
 */
export function cartFlightLaneOffset(id: number): CartFlightPoint {
  if (!Number.isSafeInteger(id) || id <= 0) return { x: 0, y: 0 };
  const lane = CART_FLIGHT_LANES[(id - 1) % CART_FLIGHT_LANES.length];
  return { x: lane.x, y: lane.y };
}

/**
 * Pixel-only WAAPI frames. Opacity stays at 1 throughout, and the final frame
 * returns to scale 1 so the label is fully readable until the chip is removed.
 */
export function cartFlightAnimationKeyframes(
  start: CartFlightPoint,
  end: CartFlightPoint,
): Keyframe[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return [
    { offset: 0, opacity: 1, transform: "translate(0px, 0px) scale(1)" },
    {
      offset: 0.82,
      opacity: 1,
      transform: `translate(${dx}px, ${dy}px) scale(1.08)`,
    },
    { offset: 1, opacity: 1, transform: `translate(${dx}px, ${dy}px) scale(1)` },
  ];
}

/** Subtle transform-only bag bounce played when a chip really arrives. */
export function cartFlightBounceKeyframes(): Keyframe[] {
  return [
    { offset: 0, transform: "translateY(0px) scale(1)" },
    { offset: 0.5, transform: "translateY(-2px) scale(1.06)" },
    { offset: 1, transform: "translateY(0px) scale(1)" },
  ];
}

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
