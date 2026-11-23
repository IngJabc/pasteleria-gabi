import Image from "next/image";
import Link from "next/link";
import type { CatalogProduct } from "@/features/catalog/schemas";
import { formatUsd } from "./price-format";

/**
 * Pure presentational card for one catalog product.
 *
 * The pastel background rotates through the design-system swatches so the grid
 * reproduces the reference without inventing per-product colors. The single
 * heading link is stretched over the whole card, so the entire card is one
 * native destination without nested interactive controls.
 */

export const productCardTones = [
  "bg-rose",
  "bg-lavender",
  "bg-mint",
  "bg-yellow",
] as const;

export function ProductCard({
  product,
  available,
  tone = 0,
}: {
  product: CatalogProduct;
  available?: number | null;
  tone?: number;
}) {
  const image = product.images[0];
  const background = productCardTones[tone % productCardTones.length];

  return (
    <li
      className={`group relative flex h-full overflow-hidden rounded-card border border-white shadow-sm transition-transform hover:-translate-y-0.5 focus-within:ring-2 focus-within:ring-pink ${background}`}
    >
      <article className="flex h-full w-full flex-col p-2">
        {image ? (
          <Image
            src={image.url}
            alt={image.alt}
            width={640}
            height={480}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            className="aspect-[4/3] h-auto w-full rounded-2xl border-2 border-white object-cover"
          />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center rounded-2xl border-2 border-white bg-white/60 text-sm font-bold text-muted">
            Sin imagen
          </div>
        )}

        <div className="flex flex-1 flex-col gap-1 px-2 pt-3 pb-2">
          <h2 className="font-display text-xl font-extrabold text-plum">
            <Link
              href={`/productos/${encodeURIComponent(product.slug)}`}
              className="after:absolute after:inset-0 focus-visible:outline-none"
            >
              {product.name}
            </Link>
          </h2>
          <p className="line-clamp-2 text-sm leading-6 text-muted">
            {product.description}
          </p>
          <div className="mt-auto flex items-end justify-between gap-2 pt-3">
            <span className="font-display text-lg font-extrabold text-plum">
              <span className="sr-only">Precio: </span>
              {formatUsd(product.priceUsd)}
            </span>
            <span className="text-xs font-bold text-muted">
              {available === null || available === undefined
                ? "Existencias: —"
                : available <= 0
                  ? "Agotado por ahora"
                  : `${available} disponibles`}
            </span>
          </div>
        </div>
      </article>
    </li>
  );
}
