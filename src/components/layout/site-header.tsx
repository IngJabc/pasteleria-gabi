"use client";

import Link from "next/link";
import { useCart } from "@/features/cart/cart-context";
import { BagIcon, FlowerIcon } from "@/components/ui/icons";

const navLinkClass =
  "font-display text-base font-bold text-ink transition-colors hover:text-pink";

/** Storefront header: brand, primary navigation and the live bag counter. */
export function SiteHeader() {
  const { count } = useCart();

  return (
    <header className="bg-cream">
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

        <Link
          href="/carrito"
          className="inline-flex min-h-11 items-center gap-2 rounded-full border-[3px] border-white bg-lavender px-5 py-2 font-display text-base font-bold text-ink shadow-sticker-secondary transition-all hover:brightness-[0.98] active:translate-y-[2px] active:shadow-none"
          aria-label={`Bolsa, ${count} artículo(s)`}
        >
          <BagIcon className="size-5" />
          <span>Bolsa</span>
          <span aria-hidden="true" className="text-muted">
            ·
          </span>
          <span>{count}</span>
        </Link>
      </div>
    </header>
  );
}
