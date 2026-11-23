import type { Metadata } from "next";
import Link from "next/link";
import { DeliveryForm } from "@/features/cart/components/delivery-form";
import { CheckoutSteps } from "@/features/cart/components/cart-client";
import { getActiveDeliveryZones } from "@/features/catalog/public-data";
import { getStoreSettings } from "@/features/settings/admin-settings";
import { ArrowRightIcon } from "@/components/ui/icons";

export const metadata: Metadata = {
  title: "Entrega",
  description: "Cuéntanos dónde llevamos tu pedido.",
};

// Reads delivery zones/settings at request time; block prerendering.
export const instant = false;

export default async function DeliveryPage() {
  const [zones, settings] = await Promise.all([
    getActiveDeliveryZones(),
    getStoreSettings(),
  ]);

  return (
    <main className="container-page flex flex-col gap-8 py-10">
      <div className="flex items-center justify-between gap-4">
        <CheckoutSteps current={2} />
        <Link
          href="/productos"
          className="hidden items-center gap-1 font-display text-base font-bold text-pink hover:underline sm:inline-flex"
        >
          Volver al catálogo
          <ArrowRightIcon />
        </Link>
      </div>

      <h1 className="font-display text-4xl font-extrabold text-plum md:text-5xl">
        ¿Dónde te llevamos alegría?
      </h1>

      <DeliveryForm zones={zones} pickupAddress={settings?.pickup_address ?? null} />
    </main>
  );
}
