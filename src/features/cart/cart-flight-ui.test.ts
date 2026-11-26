/**
 * Static source contracts for the decorative flying cart chip. Runtime browser
 * behavior is verified separately; these guards protect the client boundary,
 * the fixed overlay and the readable transform-only animation.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const layer = readFileSync(
  fileURLToPath(new URL("./components/cart-flight-layer.tsx", import.meta.url)),
  "utf8",
);
const flightModule = readFileSync(
  fileURLToPath(new URL("./cart-flight.ts", import.meta.url)),
  "utf8",
);
const productDetail = readFileSync(
  fileURLToPath(
    new URL("../catalog/components/product-detail.tsx", import.meta.url),
  ),
  "utf8",
);
const globals = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8",
);

describe("cart flight layer contract (static)", () => {
  it("subscribes to flights and targets the header bag link", () => {
    expect(layer).toContain('"use client"');
    expect(layer).toContain("subscribeToCartFlights(");
    expect(layer).toContain('document.querySelector<HTMLElement>(CART_TARGET_SELECTOR)');
    expect(flightModule).toContain('CART_TARGET_SELECTOR = "[data-cart-target]"');
    expect(layer).toContain("bag?.getBoundingClientRect()");
    expect(layer).toContain("cartFlightCenter(");
    expect(layer).toContain("shouldAnimateCartFlight(prefersReducedCartFlightMotion()");
    expect(layer).not.toContain("setInterval");
  });

  it("renders readable chips in a fixed overlay that never takes layout space", () => {
    expect(layer).toContain('aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60]"');
    expect(layer).toContain('className="absolute grid size-9 place-items-center rounded-full border-2 border-white bg-plum font-display text-base font-black text-white"');
    expect(layer).toContain("{flight.label}");
    expect(layer).toContain("left: `${start.x}px`");
    expect(layer).toContain("top: `${start.y}px`");
    expect(layer).toContain('marginLeft: "-18px"');
    expect(layer).toContain('marginTop: "-18px"');
  });

  it("plays the full WAAPI flight through the shared readable keyframes", () => {
    expect(layer).toContain('const FLIGHT_DURATION_MS = 600');
    expect(layer).toContain('const FLIGHT_EASING = "cubic-bezier(0.22, 0.8, 0.3, 1)"');
    expect(layer).toContain("chip.animate(");
    expect(layer).toContain("const start = renderedStart(flight)");
    expect(layer).toContain("const end = renderedEnd(flight)");
    expect(layer).toContain("cartFlightAnimationKeyframes(start, end)");
    expect(flightModule).toContain("export function cartFlightAnimationKeyframes(");
    expect(flightModule).toContain('{ offset: 0, opacity: 1, transform: "translate(0px, 0px) scale(1)" }');
    expect(flightModule).toContain("scale(1.08)");
    expect(layer).toContain('fill: "forwards"');
    expect(layer).toContain("animation.onfinish = () => {");
    expect(layer).toContain("animation.cancel()");
  });

  it("assigns lanes from flight ids and caps concurrent chips", () => {
    expect(layer).toMatch(
      /type RenderedFlight = CartFlight & \{[^}]*\blane: CartFlightPoint;[^}]*\}/,
    );
    expect(layer).toContain("const lane = cartFlightLaneOffset(flight.id)");
    expect(layer).toContain("...flight, target, lane");
    expect(layer).toContain("MAX_VISIBLE_CART_FLIGHTS");
    expect(layer).toContain("next.length > MAX_VISIBLE_CART_FLIGHTS");
    expect(layer).toContain("next.slice(-MAX_VISIBLE_CART_FLIGHTS)");
    expect(layer).not.toContain("current.length");
    expect(flightModule).toContain("export const MAX_VISIBLE_CART_FLIGHTS = 4");
    expect(flightModule).toContain("export function cartFlightLaneOffset(");

    expect(layer).toContain("const CART_TARGET_LANE_FACTOR = 0.35");
    expect(layer).toContain("x: flight.origin.x + flight.lane.x");
    expect(layer).toContain("y: flight.origin.y + flight.lane.y");
    expect(layer).toContain("x: flight.target.x + flight.lane.x * CART_TARGET_LANE_FACTOR");
    expect(layer).toContain("y: flight.target.y + flight.lane.y * CART_TARGET_LANE_FACTOR");
  });

  it("bounces the real bag once per arrival, after a genuine finish", () => {
    expect(layer).toContain("const activeBounces = new WeakMap<HTMLElement, Animation>()");
    expect(layer).toContain("function bounceCartTarget()");
    expect(layer).toContain("if (prefersReducedCartFlightMotion()) return;");
    expect(layer).toContain('if (!bag || typeof bag.animate !== "function") return;');
    expect(layer).toContain("activeBounces.get(bag)?.cancel()");
    expect(layer).toContain("bag.animate(cartFlightBounceKeyframes()");
    expect(flightModule).toContain("export function cartFlightBounceKeyframes()");

    const finishHandler =
      layer.match(/animation\.onfinish = \(\) => \{[\s\S]*?\n\s*\};/)?.[0] ?? "";
    expect(finishHandler).toContain("bounceCartTarget()");
    expect(finishHandler).toContain("onDone(flight.id)");
    expect(finishHandler.indexOf("bounceCartTarget()")).toBeLessThan(
      finishHandler.indexOf("onDone(flight.id)"),
    );

    const unsupported =
      layer.match(/if \(typeof chip\.animate !== "function"\) \{[\s\S]*?\n\s*\}/)?.[0] ?? "";
    expect(unsupported).toContain("onDone(flight.id)");
    expect(unsupported).not.toContain("bounceCartTarget");
  });

  it("never hides, blurs, or calculates the decorative chip", () => {
    for (const source of [layer, flightModule]) {
      expect(source).not.toContain("opacity: 0");
      expect(source).not.toContain("filter");
      expect(source).not.toContain("blur(");
      expect(source).not.toContain("boxShadow");
      expect(source).not.toContain("shadow-");
      expect(source).not.toContain("calc(");
    }
  });

  it("requires a visible launch point but lets the chip fly toward an offscreen bag", () => {
    expect(layer).toContain("isCartFlightPointVisible(flight.origin, {");
    expect(layer).toContain("!originVisible");
    expect(layer).not.toContain("target.y < 0");
  });
});

describe("product detail flight emission (static)", () => {
  it("announces from the clicked add button without changing the existing toast", () => {
    expect(productDetail).toContain("announceCartFlight({ quantity: qty, origin: event.currentTarget })");
    expect(productDetail).toContain("MouseEvent<HTMLButtonElement>");
    expect(productDetail).toContain('showToast(message, "success")');
    expect(productDetail).toContain("if (outOfStock)");
  });
});

describe("cart flight CSS contract (static)", () => {
  it("keeps the global reduced-motion rule intact and leaves no stale keyframes", () => {
    expect(globals).toContain("@media (prefers-reduced-motion: reduce)");
    expect(globals).toContain("animation-duration: 0.01ms !important");
    expect(globals).toContain("animation-iteration-count: 1 !important");
    expect(globals).toContain("scroll-behavior: auto !important");
    expect(globals).not.toContain(".cart-flight-chip");
    expect(globals).not.toContain("@keyframes cart-flight");
  });
});
