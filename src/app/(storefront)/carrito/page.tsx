import type { Metadata } from "next";
import Link from "next/link";
import { CartClient, CheckoutSteps } from "@/features/cart/components/cart-client";
import {
  getActiveDeliveryZones,
  getActiveProductStockMap,
} from "@/features/catalog/public-data";
import { ArrowRightIcon } from "@/components/ui/icons";

export const metadata: Metadata = {
  title: "Tu carrito",
  description: "Revisa tu bolsa antes de confirmar la entrega.",
};

// Loads active zones and stock at request time so cart can reflect a previously
// selected delivery zone fee honestly and cap its local quantity steppers.
export const instant = false;

export default async function CartPage() {
  const [zones, stock] = await Promise.all([
    getActiveDeliveryZones().catch(() => []),
    getActiveProductStockMap().catch(() => ({})),
  ]);
  return (
    <main className="container-page flex flex-col gap-8 py-10">
      <div className="flex items-center justify-between gap-4">
        <CheckoutSteps />
        <Link
          href="/productos"
          className="hidden items-center gap-1 font-display text-base font-bold text-pink hover:underline sm:inline-flex"
        >
          Volver al catálogo
          <ArrowRightIcon />
        </Link>
      </div>

      <h1 className="font-display text-4xl font-extrabold text-plum md:text-5xl">
        Tu carrito feliz
      </h1>

      <CartClient zones={zones} stockByProductId={stock} />
    </main>
  );
}
