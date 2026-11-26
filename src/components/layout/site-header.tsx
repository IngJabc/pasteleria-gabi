"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCart } from "@/features/cart/cart-context";
import { CartFlightLayer } from "@/features/cart/components/cart-flight-layer";
import {
  BagIcon,
  CloseIcon,
  FlowerIcon,
  MenuIcon,
} from "@/components/ui/icons";

const navLinkClass =
  "font-display text-base font-bold text-ink transition-colors hover:text-pink";

/** Storefront header: brand, primary navigation and the live bag counter. */
export function SiteHeader() {
  const { count } = useCart();
  const pathname = usePathname();
  // The open state records where the menu was opened. Any route change clears
  // it, including browser history navigation that did not use a header link.
  const [openMenuForPath, setOpenMenuForPath] = useState<string | null>(null);
  const [previousPathname, setPreviousPathname] = useState(pathname);
  if (previousPathname !== pathname) {
    setPreviousPathname(pathname);
    setOpenMenuForPath(null);
  }
  const mobileNavOpen = openMenuForPath === pathname;
  const toggleRef = useRef<HTMLButtonElement>(null);

  const closeMobileNav = useCallback(() => setOpenMenuForPath(null), []);
  const toggleMobileNav = useCallback(
    () => setOpenMenuForPath((current) => (current === pathname ? null : pathname)),
    [pathname],
  );

  useEffect(() => {
    if (!mobileNavOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        toggleRef.current?.focus();
        closeMobileNav();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileNavOpen, closeMobileNav]);

  return (
    <header className="relative bg-cream">
      <div className="container-page flex items-center justify-between gap-4 py-4">
        <Link
          href="/"
          className="flex items-center gap-2 font-display text-2xl font-extrabold text-plum"
        >
          dulce atelier
          <FlowerIcon className="size-5 text-pink" />
        </Link>

        <nav
          aria-label="Navegación principal"
          className="hidden items-center gap-8 md:flex"
        >
          <Link href="/" className={navLinkClass}>
            Inicio
          </Link>
          <Link href="/productos" className={navLinkClass}>
            Nuestras tortas
          </Link>
          <Link href="/seguimiento" className={navLinkClass}>
            Mis pedidos
          </Link>
        </nav>

        <button
          ref={toggleRef}
          type="button"
          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-[3px] border-white bg-lavender text-ink shadow-sticker-secondary transition-all hover:brightness-[0.98] md:hidden"
          aria-controls="storefront-mobile-nav"
          aria-expanded={mobileNavOpen}
          aria-label={mobileNavOpen ? "Cerrar menú" : "Abrir menú"}
          onClick={toggleMobileNav}
        >
          {mobileNavOpen ? <CloseIcon /> : <MenuIcon />}
        </button>

        <Link
          href="/carrito"
          data-cart-target
          className="inline-flex min-h-11 items-center gap-2 rounded-full border-[3px] border-white bg-lavender px-5 py-2 font-display text-base font-bold text-ink shadow-sticker-secondary transition-all hover:brightness-[0.98] active:translate-y-[2px] active:shadow-none"
          aria-label={`Bolsa, ${count} artículo(s)`}
        >
          <BagIcon className="size-5" />
          <span className="hidden sm:inline">Bolsa</span>
          <span aria-hidden="true" className="hidden text-muted sm:inline">
            ·
          </span>
          <span>{count}</span>
        </Link>
      </div>

      <nav
        id="storefront-mobile-nav"
        aria-label="Navegación móvil"
        aria-hidden={!mobileNavOpen}
        className={`absolute inset-x-0 top-full z-40 origin-top overflow-hidden border-t border-rose/60 bg-cream shadow-lg transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-none md:hidden ${
          mobileNavOpen
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-2 opacity-0"
        }`}
      >
        <div className="container-page flex flex-col gap-1 py-3">
          <Link
            href="/"
            tabIndex={mobileNavOpen ? 0 : -1}
            className={`${navLinkClass} flex min-h-11 items-center`}
            onClick={closeMobileNav}
          >
            Inicio
          </Link>
          <Link
            href="/productos"
            tabIndex={mobileNavOpen ? 0 : -1}
            className={`${navLinkClass} flex min-h-11 items-center`}
            onClick={closeMobileNav}
          >
            Nuestras tortas
          </Link>
          <Link
            href="/seguimiento"
            tabIndex={mobileNavOpen ? 0 : -1}
            className={`${navLinkClass} flex min-h-11 items-center`}
            onClick={closeMobileNav}
          >
            Mis pedidos
          </Link>
        </div>
      </nav>

      <CartFlightLayer />
    </header>
  );
}
