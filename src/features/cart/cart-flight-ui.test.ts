/**
 * Static source contracts for the decorative flying cart chip. Runtime browser
 * behavior is verified separately; these guards protect the client boundary,
 * the fixed overlay and the transform/opacity-only animation.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const layer = readFileSync(
  fileURLToPath(new URL("./components/cart-flight-layer.tsx", import.meta.url)),
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
    expect(layer).toContain('document.querySelector<HTMLElement>("[data-cart-target]")');
    expect(layer).toContain("bag?.getBoundingClientRect()");
    expect(layer).toContain("cartFlightCenter(");
    expect(layer).toContain("shouldAnimateCartFlight(prefersReducedCartFlightMotion()");
    expect(layer).not.toContain("setInterval");
  });

  it("renders chips in a fixed overlay that never takes layout space", () => {
    expect(layer).toContain('aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60]"');
    expect(layer).toContain('className="absolute grid size-8 place-items-center rounded-full border-2 border-white bg-lavender font-display text-sm font-extrabold text-plum shadow-lg"');
    expect(layer).toContain("{flight.label}");
    expect(layer).toContain("left: `${flight.origin.x}px`");
    expect(layer).toContain("top: `${flight.origin.y}px`");
    expect(layer).toContain('marginLeft: "-16px"');
    expect(layer).toContain('marginTop: "-16px"');
  });

  it("animates only transform and opacity with the Web Animations API", () => {
    expect(layer).toContain('const FLIGHT_DURATION_MS = 600');
    expect(layer).toContain('const FLIGHT_EASING = "cubic-bezier(0.22, 0.8, 0.3, 1)"');
    expect(layer).toContain("chip.animate(");
    expect(layer).toContain('{ opacity: 1, transform: "translate(0px, 0px) scale(1)" }');
    expect(layer).toContain("transform: `translate(${dx}px, ${dy}px) scale(0.85)`");
    expect(layer).not.toContain("calc(-50%");
    expect(layer).toContain("opacity: 0,");
    expect(layer).toContain('fill: "forwards"');
    expect(layer).toContain("animation.onfinish = () => onDone(flight.id)");
    expect(layer).toContain("animation.cancel()");
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
