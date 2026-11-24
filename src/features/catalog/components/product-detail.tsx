"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useCart } from "@/features/cart/cart-context";
import { useToast } from "@/components/ui/toast";
import type { CatalogProduct } from "../schemas";
import type { DeliveryZone } from "../public-data";
import { formatUsd } from "./price-format";
import { Button, LiveRegion } from "@/components/ui/ui";
import { ArrowRightIcon, MinusIcon, PlusIcon } from "@/components/ui/icons";
import { ReviewStars } from "@/features/reviews/components/review-stars";
import { ImageModal } from "@/components/ui/image-modal";

/**
 * Product detail purchase panel. Prices and availability come from the server;
 * the quantity selector only builds the client bag and never trusts a
 * client-supplied price.
 */
export function ProductDetail({
  product,
  available,
  zones,
}: {
  product: CatalogProduct;
  available: number | null;
  zones: DeliveryZone[];
}) {
  const { addItem } = useCart();
  const { showToast } = useToast();
  const [quantity, setQuantity] = useState(1);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [imageIndex, setImageIndex] = useState<number | null>(null);

  const image = product.images[0];
  const unitPrice = product.priceUsd;
  const stockKnown = available !== null;
  const outOfStock = stockKnown && available <= 0;
  const maxQuantity = stockKnown ? Math.max(0, available) : null;
  const effectiveQuantity =
    maxQuantity !== null ? Math.min(quantity, Math.max(1, maxQuantity)) : quantity;

  function handleAdd() {
    if (outOfStock) {
      setFeedback("Este producto no tiene existencias disponibles por ahora.");
      return;
    }
    const qty =
      maxQuantity !== null ? Math.min(quantity, Math.max(1, maxQuantity)) : quantity;
    addItem(
      {
        productId: product.id,
        slug: product.slug,
        name: product.name,
        priceUsd: unitPrice,
        imageUrl: image?.url ?? null,
        imageUrls: product.images.map((img) => img.url),
      },
      qty,
    );
    const message = `Agregaste ${qty} ${qty === 1 ? "unidad" : "unidades"} de ${product.name} a la bolsa.`;
    setFeedback(message);
    showToast(message, "success");
  }

  return (
    <article className="grid gap-10 lg:grid-cols-2">
      <div>
        {image ? (
          <button
            type="button"
            onClick={() => setImageIndex(0)}
            className="block w-full cursor-zoom-in rounded-section focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lavender"
            aria-label={`Ver imagen de ${product.name} en grande`}
          >
            <Image
              src={image.url}
              alt={image.alt}
              width={1200}
              height={900}
              priority
              className="aspect-[4/3] w-full rounded-section border-4 border-white object-cover shadow-sm"
            />
          </button>
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center rounded-section border-4 border-white bg-rose text-muted">
            Sin imágenes disponibles
          </div>
        )}

        {product.images.length > 1 ? (
          <ul className="mt-4 flex gap-3 overflow-x-auto pb-1">
            {product.images.slice(1).map((extra, idx) => (
              <li key={extra.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setImageIndex(idx + 1)}
                  className="block cursor-zoom-in rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lavender"
                  aria-label={`Ver imagen ${idx + 2} de ${product.name} en grande`}
                >
                  <Image
                    src={extra.url}
                    alt={extra.alt}
                    width={240}
                    height={180}
                    className="aspect-[4/3] w-28 rounded-card border-2 border-white object-cover"
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <ImageModal
          images={product.images.map((img) => ({ url: img.url, alt: img.alt }))}
          initialIndex={imageIndex ?? 0}
          open={imageIndex !== null}
          onClose={() => setImageIndex(null)}
        />
      </div>

      <div className="flex flex-col gap-4">
        <p className="text-eyebrow">El favorito de la casa</p>
        <h1 className="font-display text-4xl font-extrabold text-plum md:text-5xl">
          {product.name}
        </h1>
        <p className="font-display text-3xl font-extrabold text-plum">
          <span className="sr-only">Precio: </span>
          {formatUsd(unitPrice)}{" "}
          <span className="text-xl">USD</span>
        </p>
        {product.reviewAggregate && product.reviewAggregate.reviewCount > 0 ? (
          <div className="flex items-center gap-2 text-sm text-ink">
            <ReviewStars rating={product.reviewAggregate.averageRating} />
            <span className="font-bold">{product.reviewAggregate.averageRating.toFixed(1)}</span>
            <span className="text-muted">({product.reviewAggregate.reviewCount} reseñas)</span>
          </div>
        ) : (
          <p className="text-sm text-muted">Aún no hay reseñas publicadas.</p>
        )}
        <p className="font-bold text-ink">
          {available === null
            ? "Existencias: —"
            : available <= 0
              ? "Agotado por ahora"
              : `${available} disponibles`}
        </p>

        <p className="max-w-prose leading-7 text-ink">{product.description}</p>

        <div className="flex items-center gap-4">
          <span className="font-display text-base font-bold text-ink">
            Cantidad
          </span>
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              aria-label="Disminuir cantidad"
              onClick={() => setQuantity((value) => Math.max(1, value - 1))}
              disabled={outOfStock || effectiveQuantity <= 1}
              className="min-h-11 px-3"
            >
              <MinusIcon />
            </Button>
            <output
              aria-live="polite"
              className="min-w-8 text-center font-display text-lg font-extrabold text-plum"
            >
              {outOfStock ? 0 : effectiveQuantity}
            </output>
            <Button
              variant="secondary"
              aria-label="Aumentar cantidad"
              onClick={() =>
                setQuantity((value) =>
                  maxQuantity !== null ? Math.min(maxQuantity, value + 1) : value + 1,
                )
              }
              disabled={outOfStock || (maxQuantity !== null && effectiveQuantity >= maxQuantity)}
              className="min-h-11 px-3"
            >
              <PlusIcon />
            </Button>
          </div>
        </div>

        <Button
          onClick={handleAdd}
          className="self-start"
          disabled={outOfStock}
          title={outOfStock ? "Sin existencias disponibles por ahora." : undefined}
        >
          {outOfStock
            ? "Agotado por ahora"
            : `Agregar al carrito · ${formatUsd(unitPrice * effectiveQuantity)}`}
        </Button>

        <LiveRegion className="text-pink">
          {outOfStock ? "Este producto está agotado por ahora." : feedback}
        </LiveRegion>

        <div className="mt-2 rounded-section bg-mint p-6">
          <h2 className="font-display text-lg font-extrabold text-plum">
            Un dulce viaje hasta ti
          </h2>
          {zones.length === 0 ? (
            <p className="mt-2 text-sm leading-6 text-ink">
              También puedes retirar en nuestro atelier.
            </p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm leading-6 text-ink">
              {zones.map((zone) => (
                <li key={zone.id}>
                  {zone.name}:{" "}
                  {zone.requires_quote
                    ? "cotización manual"
                    : zone.fee_usd === 0
                      ? "gratis"
                      : formatUsd(zone.fee_usd)}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-sm leading-6 text-ink">
            También puedes retirar en nuestro atelier.
          </p>
        </div>

        <Link
          href="/productos"
          className="inline-flex items-center gap-1 pt-2 font-display text-base font-bold text-pink hover:underline"
        >
          Volver al catálogo
          <ArrowRightIcon />
        </Link>
      </div>
    </article>
  );
}
