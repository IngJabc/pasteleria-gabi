/**
 * Static source contract for the accessible storefront header. Runtime browser
 * verification is explicitly out of scope for these node-based tests.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const header = readFileSync(
  fileURLToPath(new URL("./site-header.tsx", import.meta.url)),
  "utf8",
);
const icons = readFileSync(
  fileURLToPath(new URL("../ui/icons.tsx", import.meta.url)),
  "utf8",
);
const storefrontLayout = readFileSync(
  fileURLToPath(new URL("../../app/(storefront)/layout.tsx", import.meta.url)),
  "utf8",
);

describe("storefront header contract (static)", () => {
  it("mounts the decorative flight layer and marks the bag target", () => {
    expect(header).toContain("<CartFlightLayer />");
    expect(header).toContain("data-cart-target");
    expect(header).toContain('aria-label={`Bolsa, ${count} artículo(s)`}');
    expect(header).toContain('aria-label="Navegación principal"');
    expect(header).toContain("hidden items-center gap-8 md:flex");
  });

  it("exposes a 44px hamburger with a Spanish toggling label", () => {
    expect(header).toContain("size-11 shrink-0");
    expect(header).toContain('aria-controls="storefront-mobile-nav"');
    expect(header).toContain("aria-expanded={mobileNavOpen}");
    expect(header).toContain('aria-label={mobileNavOpen ? "Cerrar menú" : "Abrir menú"}');
    expect(header).toContain("{mobileNavOpen ? <CloseIcon /> : <MenuIcon />}");
    expect(header).toContain("md:hidden");
  });

  it("renders an animated mobile-only overlay with the three real destinations", () => {
    expect(header).toContain('<header className="relative bg-cream">');
    expect(header).toContain('id="storefront-mobile-nav"');
    expect(header).toContain('aria-label="Navegación móvil"');
    expect(header).toContain("aria-hidden={!mobileNavOpen}");
    expect(header).toContain("absolute inset-x-0 top-full z-40");
    expect(header).toContain("transition-[opacity,translate] duration-200 ease-out");
    expect(header).toContain("motion-reduce:transition-none");
    expect(header).toContain("pointer-events-auto translate-y-0 opacity-100");
    expect(header).toContain("pointer-events-none -translate-y-2 opacity-0");
    expect(header).toContain("tabIndex={mobileNavOpen ? 0 : -1}");
    expect(header).toContain('href="/"');
    expect(header).toContain('href="/productos"');
    expect(header).toContain('href="/seguimiento"');
    expect(header).toContain("Nuestras tortas");
    expect(header).toContain("Mis pedidos");
    expect(header).toContain('className="hidden sm:inline"');
  });

  it("closes on link click, Escape and route change, restoring focus", () => {
    expect(header).toContain("usePathname()");
    expect(header).toContain("const mobileNavOpen = openMenuForPath === pathname");
    expect(header).toContain("if (previousPathname !== pathname) {");
    expect(header).toContain("setPreviousPathname(pathname);");
    expect(header).toContain("onClick={toggleMobileNav}");
    expect(header).toContain("onClick={closeMobileNav}");
    expect(header).toContain('event.key === "Escape"');
    expect(header).toContain("closeMobileNav();");
    expect(header).toContain("toggleRef.current?.focus()");
    expect(header).toContain("document.addEventListener(\"keydown\", handleKeyDown)");
    expect(header).toContain("document.removeEventListener(\"keydown\", handleKeyDown)");
  });
});

describe("storefront header mount contract (static)", () => {
  it("streams the pathname-aware header inside a Suspense boundary", () => {
    expect(storefrontLayout).toContain("import { Suspense, type ReactNode } from \"react\"");
    expect(storefrontLayout).toContain("<Suspense fallback=");
    expect(storefrontLayout).toContain("<SiteHeader />");
    expect(storefrontLayout).toContain('className="h-[4.75rem] bg-cream"');
  });
});

describe("storefront menu icons contract (static)", () => {
  it("adds MenuIcon and CloseIcon in the shared 24x24 stroke style", () => {
    expect(icons).toContain("export function MenuIcon(");
    expect(icons).toContain("export function CloseIcon(");
    expect(icons).not.toContain("☰");
    expect(icons).not.toContain("✕");
    expect(icons).not.toContain("❌");
    const menuBlock = icons.slice(
      icons.indexOf("export function MenuIcon("),
      icons.indexOf("export function HeartIcon("),
    );
    expect(menuBlock).toContain('viewBox="0 0 24 24"');
    expect(menuBlock).toContain("strokeWidth={1.8}");
    expect(menuBlock.match(/aria-hidden="true"/g)).toHaveLength(2);
  });
});
