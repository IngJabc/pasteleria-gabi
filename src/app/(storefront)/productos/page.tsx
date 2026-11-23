import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { CatalogBrowser } from "@/features/catalog/components/catalog-browser";
import { ProductGridSkeleton } from "@/features/catalog/components/product-grid";
import { listActiveProducts } from "@/features/catalog/queries";
import { getProductStockMap } from "@/features/catalog/public-data";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";

export const metadata: Metadata = {
  title: "Nuestras tortas",
  description: "Catálogo de tortas y porciones artesanales en Barquisimeto.",
};

export default function CatalogPage() {
  return (
    <main className="container-page flex flex-col gap-8 py-10">
      <header className="flex flex-col gap-3">
        <p className="text-eyebrow">Elige tu momento feliz</p>
        <h1 className="font-display text-4xl font-extrabold text-plum md:text-5xl">
          Un antojo para cada día.
        </h1>
        <p className="max-w-xl text-lg leading-7 text-ink">
          Hechas hoy, listas para enamorarte.
        </p>
      </header>

      <Suspense fallback={<ProductGridSkeleton />}>
        <CatalogData />
      </Suspense>
    </main>
  );
}

async function CatalogData() {
  await connection();
  const client = await createSupabaseServerClient();
  const products = await listActiveProducts(client);
  const stock = await getProductStockMap(products.map((product) => product.id));
  return <CatalogBrowser products={products} stock={stock} />;
}
