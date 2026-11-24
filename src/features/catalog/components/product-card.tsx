"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { CatalogProduct } from "@/features/catalog/schemas";
import { formatUsd } from "./price-format";

/**
 * Catalog product card. The pastel background rotates through the design-system
 * swatches. The single heading link is stretched over the whole card, so the
 * entire card is one native destination without nested interactive controls.
 * On hover/focus, multiple images crossfade as a subtle preview.
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
  const [active, setActive] = useState(false);
  const [imageIndex, setImageIndex] = useState(0);
  const images = product.images;
  const background = productCardTones[tone % productCardTones.length];
  const hasMultipleImages = images.length > 1;

  useEffect(() => {
    if (!active || !hasMultipleImages) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;
    const id = window.setInterval(() => {
      setImageIndex((current) => (current + 1) % images.length);
    }, 1400);
    return () => window.clearInterval(id);
  }, [active, hasMultipleImages, images.length]);

  function handleActivate() {
    if (!hasMultipleImages) return;
    setActive(true);
  }

  function handleDeactivate() {
    setActive(false);
    setImageIndex(0);
  }

  return (
    <li
      className={`group relative flex h-full overflow-hidden rounded-card border border-white shadow-sm transition-transform hover:-translate-y-0.5 focus-within:ring-2 focus-within:ring-pink ${background}`}
      onMouseEnter={handleActivate}
      onMouseLeave={handleDeactivate}
      onFocusCapture={handleActivate}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          handleDeactivate();
        }
      }}
    >
      <article className="flex h-full w-full flex-col p-2">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border-2 border-white bg-white/40">
          {images.length > 0 ? (
            images.map((img, idx) => (
              <Image
                key={img.id}
                src={img.url}
                alt={idx === 0 ? img.alt : ""}
                aria-hidden={idx === 0 ? undefined : true}
                width={640}
                height={480}
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ease-in-out ${
                  idx === imageIndex ? "opacity-100" : "opacity-0"
                }`}
                priority={idx === 0}
              />
            ))
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm font-bold text-muted">
              Sin imagen
            </div>
          )}
          {hasMultipleImages ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
              {images.map((img, idx) => (
                <span
                  key={img.id}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    idx === imageIndex ? "w-4 bg-white shadow-sm" : "w-1.5 bg-white/70"
                  }`}
                />
              ))}
            </div>
          ) : null}
        </div>

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
          <div className="mt-2 flex items-center gap-2 text-xs text-muted">
            {product.reviewAggregate && product.reviewAggregate.reviewCount > 0 ? (
              <>
                <span className="font-bold text-plum">★ {product.reviewAggregate.averageRating.toFixed(1)}</span>
                <span>({product.reviewAggregate.reviewCount})</span>
              </>
            ) : (
              <span>Sin reseñas aún</span>
            )}
          </div>
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
