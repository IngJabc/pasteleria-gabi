import Image from "next/image";
import Link from "next/link";
import type { CatalogProduct } from "@/features/catalog/schemas";
import { formatUsd } from "./price-format";

/**
 * Pure presentational card for one catalog product. The single link in the
 * heading is stretched over the whole card, so the entire card is one native
 * destination without nested interactive controls.
 */
export function ProductCard({
  product,
  isLead = false,
}: {
  product: CatalogProduct;
  isLead?: boolean;
}) {
  const image = product.images[0];

  return (
    <li className="group relative flex h-full overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition-colors hover:border-zinc-300 hover:shadow-md focus-within:ring-2 focus-within:ring-zinc-500 focus-within:ring-offset-2 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700 dark:focus-within:ring-zinc-400 dark:focus-within:ring-offset-zinc-950">
      <article className="flex h-full w-full flex-col">
        {image ? (
          <Image
            src={image.url}
            alt={image.alt}
            width={640}
            height={480}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            fetchPriority={isLead ? "high" : undefined}
            className="aspect-[4/3] h-auto w-full bg-zinc-100 object-cover dark:bg-zinc-900"
          />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center bg-zinc-100 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            Sin imagen
          </div>
        )}

        <div className="flex flex-1 flex-col gap-2 p-4">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            <Link
              href={`/productos/${encodeURIComponent(product.slug)}`}
              className="after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-700 dark:focus-visible:outline-zinc-300"
            >
              {product.name}
            </Link>
          </h2>
          <p className="line-clamp-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            {product.description}
          </p>
          <p className="mt-auto text-base font-medium text-zinc-900 dark:text-zinc-50">
            <span className="sr-only">Precio: </span>
            {formatUsd(product.priceUsd)}
          </p>
        </div>
      </article>
    </li>
  );
}
