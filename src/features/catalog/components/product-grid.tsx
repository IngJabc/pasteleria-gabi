import type { CatalogProduct } from "@/features/catalog/schemas";
import { ProductCard } from "./product-card";

/** Responsive catalog grid with a graceful empty state. */
export function ProductGrid({ products }: { products: CatalogProduct[] }) {
  if (products.length === 0) {
    return (
      <section
        aria-labelledby="catalog-empty-heading"
        className="rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-950"
      >
        <h2
          id="catalog-empty-heading"
          className="text-xl font-semibold text-zinc-900 dark:text-zinc-50"
        >
          Sin productos disponibles
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Vuelve pronto para conocer nuestro catálogo.
        </p>
      </section>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((product, index) => (
        <ProductCard
          key={product.id}
          product={product}
          isLead={index === 0}
        />
      ))}
    </ul>
  );
}

/** Static fallback kept inside the page's Suspense boundary. */
export function ProductGridSkeleton() {
  return (
    <div
      aria-busy="true"
      className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
    >
      <p className="sr-only">Cargando productos…</p>
      {[0, 1, 2].map((slot) => (
        <div
          key={slot}
          aria-hidden="true"
          className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800"
        >
          <div className="aspect-[4/3] w-full bg-zinc-100 dark:bg-zinc-900" />
          <div className="space-y-3 p-4">
            <div className="h-5 w-2/3 rounded bg-zinc-100 dark:bg-zinc-900" />
            <div className="h-4 w-full rounded bg-zinc-100 dark:bg-zinc-900" />
          </div>
        </div>
      ))}
    </div>
  );
}
