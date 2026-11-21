import Image from "next/image";
import type { CatalogProduct } from "@/features/catalog/schemas";
import { formatUsd } from "./price-format";

/** Pure presentational detail markup for one validated catalog product. */
export function ProductDetail({ product }: { product: CatalogProduct }) {
  return (
    <article className="grid gap-8 lg:grid-cols-2">
      <div>
        {product.images.length > 0 ? (
          <ul className="grid gap-4 sm:grid-cols-2">
            {product.images.map((image, index) => (
              <li key={image.id}>
                <Image
                  src={image.url}
                  alt={image.alt}
                  width={1200}
                  height={900}
                  sizes="(max-width: 768px) 100vw, 50vw"
                  fetchPriority={index === 0 ? "high" : undefined}
                  className="aspect-[4/3] h-auto w-full rounded-lg bg-zinc-100 object-cover dark:bg-zinc-900"
                />
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg bg-zinc-100 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            Sin imágenes disponibles
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {product.name}
        </h1>
        <p className="text-xl font-medium text-zinc-900 dark:text-zinc-50">
          <span className="sr-only">Precio: </span>
          {formatUsd(product.priceUsd)}
        </p>
        <div>
          <h2 className="text-sm font-medium tracking-widest text-zinc-500 uppercase">
            Descripción
          </h2>
          <p className="mt-2 max-w-prose leading-7 text-zinc-700 dark:text-zinc-300">
            {product.description}
          </p>
        </div>
      </div>
    </article>
  );
}

/** Static fallback kept inside the detail page's Suspense boundary. */
export function ProductDetailSkeleton() {
  return (
    <div aria-busy="true" className="grid gap-8 lg:grid-cols-2">
      <p className="sr-only">Cargando producto…</p>
      <div
        aria-hidden="true"
        className="aspect-[4/3] w-full rounded-lg bg-zinc-100 dark:bg-zinc-900"
      />
      <div aria-hidden="true" className="space-y-4">
        <div className="h-9 w-2/3 rounded bg-zinc-100 dark:bg-zinc-900" />
        <div className="h-6 w-1/3 rounded bg-zinc-100 dark:bg-zinc-900" />
        <div className="h-4 w-full rounded bg-zinc-100 dark:bg-zinc-900" />
        <div className="h-4 w-5/6 rounded bg-zinc-100 dark:bg-zinc-900" />
      </div>
    </div>
  );
}
