"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  CART_TARGET_SELECTOR,
  MAX_VISIBLE_CART_FLIGHTS,
  cartFlightAnimationKeyframes,
  cartFlightBounceKeyframes,
  cartFlightCenter,
  cartFlightLaneOffset,
  isCartFlightPointVisible,
  prefersReducedCartFlightMotion,
  shouldAnimateCartFlight,
  subscribeToCartFlights,
  type CartFlight,
  type CartFlightPoint,
} from "@/features/cart/cart-flight";

const FLIGHT_DURATION_MS = 600;
const FLIGHT_EASING = "cubic-bezier(0.22, 0.8, 0.3, 1)";
const CART_TARGET_LANE_FACTOR = 0.35;
const CART_BOUNCE_DURATION_MS = 260;

/** At most one bounce per bag element; the key is held weakly. */
const activeBounces = new WeakMap<HTMLElement, Animation>();

type RenderedFlight = CartFlight & {
  target: CartFlightPoint;
  lane: CartFlightPoint;
};

function renderedStart(flight: RenderedFlight): CartFlightPoint {
  return {
    x: flight.origin.x + flight.lane.x,
    y: flight.origin.y + flight.lane.y,
  };
}

function renderedEnd(flight: RenderedFlight): CartFlightPoint {
  return {
    x: flight.target.x + flight.lane.x * CART_TARGET_LANE_FACTOR,
    y: flight.target.y + flight.lane.y * CART_TARGET_LANE_FACTOR,
  };
}

function bounceCartTarget(): void {
  if (prefersReducedCartFlightMotion()) return;

  const bag = document.querySelector<HTMLElement>(CART_TARGET_SELECTOR);
  if (!bag || typeof bag.animate !== "function") return;

  activeBounces.get(bag)?.cancel();
  const bounce = bag.animate(cartFlightBounceKeyframes(), {
    duration: CART_BOUNCE_DURATION_MS,
    easing: "ease-out",
  });
  activeBounces.set(bag, bounce);
  bounce.onfinish = () => {
    if (activeBounces.get(bag) === bounce) activeBounces.delete(bag);
  };
}

function CartFlightChip({
  flight,
  onDone,
}: {
  flight: RenderedFlight;
  onDone: (id: number) => void;
}) {
  const chipRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const chip = chipRef.current;
    if (!chip) return;

    // The animation is driven from JavaScript so it does not depend on custom
    // keyframes surviving CSS bundling. Only transform and opacity are touched.
    if (typeof chip.animate !== "function") {
      onDone(flight.id);
      return;
    }

    const start = renderedStart(flight);
    const end = renderedEnd(flight);
    // Pixel-only translations from the shared keyframe helper stay out of the
    // `pending` state that percentage calc translations can cause in Chromium.
    const animation = chip.animate(cartFlightAnimationKeyframes(start, end), {
      duration: FLIGHT_DURATION_MS,
      easing: FLIGHT_EASING,
      fill: "forwards",
    });
    animation.onfinish = () => {
      bounceCartTarget();
      onDone(flight.id);
    };

    return () => {
      animation.onfinish = null;
      animation.cancel();
    };
  }, [flight, onDone]);

  // The chip is 36px (size-9); fixed negative margins center it without
  // changing the pixel-only animated transform.
  const start = renderedStart(flight);
  const style = {
    left: `${start.x}px`,
    top: `${start.y}px`,
    marginLeft: "-18px",
    marginTop: "-18px",
  } as CSSProperties;

  return (
    <span
      ref={chipRef}
      aria-hidden="true"
      className="absolute grid size-9 place-items-center rounded-full border-2 border-white bg-plum font-display text-base font-black text-white"
      style={style}
    >
      {flight.label}
    </span>
  );
}

/** Decorative only: the bag counter and the existing toast carry the real feedback. */
export function CartFlightLayer() {
  const [flights, setFlights] = useState<RenderedFlight[]>([]);

  const removeFlight = useCallback((id: number) => {
    setFlights((current) => {
      const remaining: RenderedFlight[] = [];
      for (const item of current) {
        if (item.id !== id) remaining.push(item);
      }
      return remaining;
    });
  }, []);

  useEffect(() => {
    return subscribeToCartFlights((flight) => {
      const bag = document.querySelector<HTMLElement>(CART_TARGET_SELECTOR);
      const target = cartFlightCenter(bag?.getBoundingClientRect() ?? null);
      // The bag can be scrolled out of view while the add button is visible.
      // In that case the chip flies toward the bag's real coordinates and exits
      // the viewport naturally; only the visible launch point is required.
      const originVisible = isCartFlightPointVisible(flight.origin, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      if (
        !originVisible ||
        !target ||
        !shouldAnimateCartFlight(prefersReducedCartFlightMotion(), flight.origin, target)
      ) {
        return;
      }
      // The lane comes from the flight id, not the current array position, so
      // rapid adds stay distinct even if an older chip was already removed.
      const lane = cartFlightLaneOffset(flight.id);
      setFlights((current) => {
        const next = [...current, { ...flight, target, lane }];
        return next.length > MAX_VISIBLE_CART_FLIGHTS
          ? next.slice(-MAX_VISIBLE_CART_FLIGHTS)
          : next;
      });
    });
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60]">
      {flights.map((flight) => (
        <CartFlightChip key={flight.id} flight={flight} onDone={removeFlight} />
      ))}
    </div>
  );
}
