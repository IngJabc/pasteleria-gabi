import type { CatalogProduct } from "@/features/catalog/schemas";
import type { PublicStockMap } from "../public-data";
import { ProductCard } from "./product-card";

/** Responsive catalog grid with a graceful empty state. */
export function ProductGrid({
  products,
  stock,
}: {
  products: CatalogProduct[];
  stock?: PublicStockMap;
}) {
  if (products.length === 0) {
    return (
      <section
        aria-labelledby="catalog-empty-heading"
        className="rounded-card border border-white bg-white p-10 text-center shadow-sm"
      >
        <h2
          id="catalog-empty-heading"
          className="font-display text-2xl font-extrabold text-plum"
        >
          Aún no hay productos disponibles
        </h2>
        <p className="mt-2 text-muted">
          Vuelve pronto para conocer nuestro catálogo.
        </p>
      </section>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {products.map((product, index) => (
        <ProductCard
          key={product.id}
          product={product}
          available={stock?.[product.id] ?? null}
          tone={index}
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
      className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4"
    >
      <p className="sr-only">Cargando productos…</p>
      {[0, 1, 2, 3].map((slot) => (
        <div
          key={slot}
          aria-hidden="true"
          className="overflow-hidden rounded-card border border-white bg-white shadow-sm"
        >
          <div className="aspect-[4/3] w-full bg-lavender/60" />
          <div className="space-y-3 p-4">
            <div className="h-5 w-2/3 rounded bg-lavender/60" />
            <div className="h-4 w-full rounded bg-rose/70" />
          </div>
        </div>
      ))}
    </div>
  );
}
