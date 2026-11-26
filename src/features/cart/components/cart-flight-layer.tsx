"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  cartFlightCenter,
  isCartFlightPointVisible,
  prefersReducedCartFlightMotion,
  shouldAnimateCartFlight,
  subscribeToCartFlights,
  type CartFlight,
  type CartFlightPoint,
} from "@/features/cart/cart-flight";

const FLIGHT_DURATION_MS = 600;
const FLIGHT_EASING = "cubic-bezier(0.22, 0.8, 0.3, 1)";

type RenderedFlight = CartFlight & { target: CartFlightPoint };

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

    const dx = flight.target.x - flight.origin.x;
    const dy = flight.target.y - flight.origin.y;
    // Pixel-only transforms keep the WAAPI animation out of the `pending`
    // state that percentage `calc()` translations can cause in Chromium.
    const animation = chip.animate(
      [
        { opacity: 1, transform: "translate(0px, 0px) scale(1)" },
        {
          opacity: 0,
          transform: `translate(${dx}px, ${dy}px) scale(0.85)`,
        },
      ],
      { duration: FLIGHT_DURATION_MS, easing: FLIGHT_EASING, fill: "forwards" },
    );
    animation.onfinish = () => onDone(flight.id);

    return () => {
      animation.onfinish = null;
      animation.cancel();
    };
  }, [flight, onDone]);

  // The chip is 32px (size-8); negative margins center it without putting a
  // percentage calc into the animated transform.
  const style = {
    left: `${flight.origin.x}px`,
    top: `${flight.origin.y}px`,
    marginLeft: "-16px",
    marginTop: "-16px",
  } as CSSProperties;

  return (
    <span
      ref={chipRef}
      aria-hidden="true"
      className="absolute grid size-8 place-items-center rounded-full border-2 border-white bg-lavender font-display text-sm font-extrabold text-plum shadow-lg"
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
    setFlights((current) => current.filter((item) => item.id !== id));
  }, []);

  useEffect(() => {
    return subscribeToCartFlights((flight) => {
      const bag = document.querySelector<HTMLElement>("[data-cart-target]");
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
      setFlights((current) => [...current, { ...flight, target }]);
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
