/**
 * Pure contracts for the decorative cart flight pub/sub. No DOM nodes are kept
 * in the flight payload; only numeric viewport coordinates are broadcast.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CART_TARGET_SELECTOR,
  MAX_VISIBLE_CART_FLIGHTS,
  announceCartFlight,
  cartFlightAnimationKeyframes,
  cartFlightBounceKeyframes,
  cartFlightCenter,
  cartFlightLaneOffset,
  formatCartFlightLabel,
  prefersReducedCartFlightMotion,
  isCartFlightPointVisible,
  shouldAnimateCartFlight,
  subscribeToCartFlights,
  unsubscribeFromCartFlights,
  type CartFlight,
} from "./cart-flight";

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeOrigin(left: number, top: number, width: number, height: number) {
  return {
    getBoundingClientRect: () => ({ left, top, width, height }),
  } as unknown as HTMLElement;
}

describe("cart flight pub/sub", () => {
  it("subscribes, broadcasts and unsubscribes listeners", () => {
    const first = vi.fn<(flight: CartFlight) => void>();
    const second = vi.fn<(flight: CartFlight) => void>();
    subscribeToCartFlights(first);
    const unsubscribeSecond = subscribeToCartFlights(second);

    announceCartFlight({ quantity: 2, origin: fakeOrigin(10, 20, 40, 30) });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    unsubscribeFromCartFlights(first);
    unsubscribeSecond();
    announceCartFlight({ quantity: 1, origin: fakeOrigin(10, 20, 40, 30) });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("converts the clicked button rect into numeric center coordinates", () => {
    const listener = vi.fn<(flight: CartFlight) => void>();
    subscribeToCartFlights(listener);
    try {
      announceCartFlight({ quantity: 3, origin: fakeOrigin(100, 200, 40, 20) });
      expect(listener).toHaveBeenCalledWith({
        id: expect.any(Number),
        label: "+3",
        origin: { x: 120, y: 210 },
      });
      const flight = listener.mock.calls[0][0];
      expect(typeof flight.origin.x).toBe("number");
      expect(typeof flight.origin.y).toBe("number");
      expect(flight).not.toHaveProperty("origin.element");
    } finally {
      unsubscribeFromCartFlights(listener);
    }
  });

  it("formats only positive integer quantities as +N", () => {
    expect(formatCartFlightLabel(1)).toBe("+1");
    expect(formatCartFlightLabel(12)).toBe("+12");
    expect(formatCartFlightLabel(0)).toBeNull();
    expect(formatCartFlightLabel(-2)).toBeNull();
    expect(formatCartFlightLabel(1.5)).toBeNull();
    expect(formatCartFlightLabel(Number.NaN)).toBeNull();
  });

  it("computes centers without relying on a live DOM node", () => {
    expect(cartFlightCenter({ left: 0, top: 0, width: 44, height: 44 })).toEqual({
      x: 22,
      y: 22,
    });
    expect(cartFlightCenter({ left: -10, top: 5, width: 20, height: 10 })).toEqual({
      x: 0,
      y: 10,
    });
    expect(cartFlightCenter(null)).toBeNull();
    expect(cartFlightCenter({ left: 0, top: 0, width: 0, height: 10 })).toBeNull();
  });

  it("requires a visible origin while allowing an offscreen bag target", () => {
    const viewport = { width: 390, height: 844 };
    expect(isCartFlightPointVisible({ x: 200, y: 400 }, viewport)).toBe(true);
    expect(isCartFlightPointVisible({ x: 200, y: -20 }, viewport)).toBe(false);
    expect(isCartFlightPointVisible({ x: 400, y: 400 }, viewport)).toBe(false);
    expect(isCartFlightPointVisible(null, viewport)).toBe(false);
    expect(isCartFlightPointVisible({ x: 1, y: 1 }, { width: 0, height: 0 })).toBe(
      false,
    );
  });

  it("skips animation for reduced motion or a missing endpoint", () => {
    const origin = { x: 10, y: 20 };
    const target = { x: 100, y: 200 };
    expect(shouldAnimateCartFlight(false, origin, target)).toBe(true);
    expect(shouldAnimateCartFlight(true, origin, target)).toBe(false);
    expect(shouldAnimateCartFlight(false, null, target)).toBe(false);
    expect(shouldAnimateCartFlight(false, origin, null)).toBe(false);
  });

  it("does not announce when prefers-reduced-motion is set", () => {
    const matchMedia = vi.fn(() => ({ matches: true }));
    vi.stubGlobal("window", { matchMedia });
    const listener = vi.fn<(flight: CartFlight) => void>();
    subscribeToCartFlights(listener);
    try {
      expect(prefersReducedCartFlightMotion()).toBe(true);
      expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
      announceCartFlight({ quantity: 1, origin: fakeOrigin(10, 20, 40, 30) });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribeFromCartFlights(listener);
    }
  });

  it("ignores a missing origin or an unusable rect", () => {
    const listener = vi.fn<(flight: CartFlight) => void>();
    subscribeToCartFlights(listener);
    try {
      announceCartFlight({ quantity: 1, origin: null });
      announceCartFlight({ quantity: 1, origin: fakeOrigin(0, 0, 0, 0) });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribeFromCartFlights(listener);
    }
  });
});

describe("cart flight presentation helpers", () => {
  it("exposes the bag selector and a four-flight visibility cap", () => {
    expect(CART_TARGET_SELECTOR).toBe("[data-cart-target]");
    expect(MAX_VISIBLE_CART_FLIGHTS).toBe(4);
  });

  it("assigns deterministic, distinct bounded lanes to the first four ids", () => {
    const lanes = [1, 2, 3, 4].map((id) => cartFlightLaneOffset(id));
    expect(lanes).toEqual([
      { x: 0, y: 0 },
      { x: -22, y: 0 },
      { x: 22, y: 0 },
      { x: 0, y: -22 },
    ]);
    expect(new Set(lanes.map((lane) => `${lane.x},${lane.y}`)).size).toBe(4);
    expect(cartFlightLaneOffset(1)).toEqual(cartFlightLaneOffset(1));
    expect(cartFlightLaneOffset(5)).toEqual(lanes[0]);
    expect(cartFlightLaneOffset(9)).toEqual(lanes[0]);
    for (const lane of lanes) {
      expect(Math.abs(lane.x)).toBeLessThanOrEqual(22);
      expect(Math.abs(lane.y)).toBeLessThanOrEqual(22);
    }
  });

  it("falls back safely for invalid ids and returns detached objects", () => {
    const invalidIds: unknown[] = [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      "2",
    ];
    for (const id of invalidIds) {
      expect(cartFlightLaneOffset(id as number)).toEqual({ x: 0, y: 0 });
    }

    const first = cartFlightLaneOffset(2);
    first.x = 999;
    first.y = -999;
    expect(cartFlightLaneOffset(2)).toEqual({ x: -22, y: 0 });
  });

  it("keeps the chip readable with pixel-only transforms at every keyframe", () => {
    const frames = cartFlightAnimationKeyframes(
      { x: 10, y: 20 },
      { x: 210, y: 180 },
    );
    expect(frames).toHaveLength(3);
    expect(frames.map((frame) => frame.offset)).toEqual([0, 0.82, 1]);
    expect(frames.every((frame) => frame.opacity === 1)).toBe(true);
    expect(frames.map((frame) => frame.transform)).toEqual([
      "translate(0px, 0px) scale(1)",
      "translate(200px, 160px) scale(1.08)",
      "translate(200px, 160px) scale(1)",
    ]);
    for (const frame of frames) {
      expect(frame).not.toHaveProperty("filter");
      expect(frame).not.toHaveProperty("boxShadow");
      const transform = String(frame.transform);
      expect(transform).toMatch(/^translate\(-?\d+px, -?\d+px\) scale\(1(?:\.08)?\)$/);
      expect(transform).not.toContain("%");
      expect(transform).not.toContain("calc(");
    }
  });

  it("keeps animation frames detached from subsequent calls", () => {
    const first = cartFlightAnimationKeyframes({ x: 0, y: 0 }, { x: 10, y: 20 });
    first[0].opacity = 0;
    first[1].transform = "blur(4px)";
    const second = cartFlightAnimationKeyframes({ x: 0, y: 0 }, { x: 10, y: 20 });
    expect(second[0].opacity).toBe(1);
    expect(second[1].transform).toBe("translate(10px, 20px) scale(1.08)");
  });

  it("bounces the bag with bounded transform-only keyframes", () => {
    const frames = cartFlightBounceKeyframes();
    expect(frames).toHaveLength(3);
    expect(frames.map((frame) => frame.offset)).toEqual([0, 0.5, 1]);
    expect(frames.map((frame) => frame.transform)).toEqual([
      "translateY(0px) scale(1)",
      "translateY(-2px) scale(1.06)",
      "translateY(0px) scale(1)",
    ]);
    for (const frame of frames) {
      expect(Object.keys(frame).sort()).toEqual(["offset", "transform"]);
      expect(String(frame.transform)).not.toContain("calc(");
    }
    expect(cartFlightBounceKeyframes()).not.toBe(frames);
  });
});
