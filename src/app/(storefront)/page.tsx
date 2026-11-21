import { Suspense } from "react";
import {
  ProductGrid,
  ProductGridSkeleton,
} from "@/features/catalog/components/product-grid";
import { listActiveProducts } from "@/features/catalog/queries";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";

/** Static shell: all request-bound data lives inside the Suspense boundary. */
export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
      <header className="space-y-2">
        <p className="text-sm font-medium tracking-widest text-zinc-500 uppercase">
          Catálogo público
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Productos disponibles
        </h1>
        <p className="max-w-2xl leading-7 text-zinc-600 dark:text-zinc-400">
          Explora las opciones que tenemos preparadas para ti. Los precios están
          expresados en dólares estadounidenses.
        </p>
      </header>

      <Suspense fallback={<ProductGridSkeleton />}>
        <CatalogList />
      </Suspense>
    </main>
  );
}

async function CatalogList() {
  const client = await createSupabaseServerClient();
  const products = await listActiveProducts(client);
  return <ProductGrid products={products} />;
}
