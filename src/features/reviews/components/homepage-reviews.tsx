import Link from "next/link";
import { ReviewForm } from "./review-form";
import { ReviewFormDisclosure } from "./review-form-disclosure";
import { ReviewStars } from "./review-stars";
import { rankProductsByReviews } from "../ranking";
import type { ReviewAggregateView } from "../schemas";
import { ArrowRightIcon } from "@/components/ui/icons";

type Product = { id: number; name: string; slug: string; priceUsd: number };

export function HomepageReviewsSection({
  products,
  aggregatesByProductId,
}: {
  products: Product[];
  aggregatesByProductId: Record<number, ReviewAggregateView | undefined>;
}) {
  const ranked = rankProductsByReviews(products, aggregatesByProductId, {
    limit: 4,
  }).filter((item) => item.aggregate.reviewCount >= 3 || item.aggregate.averageRating >= 4.5);

  return (
    <section className="container-page py-12" aria-labelledby="home-reviews-heading">
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-5">
          <div>
            <p className="text-eyebrow">La voz de nuestros clientes</p>
            <h2 id="home-reviews-heading" className="mt-2 font-display text-3xl font-extrabold text-plum md:text-4xl">
              Reseñas que endulzan la confianza
            </h2>
            <p className="mt-3 max-w-prose leading-7 text-ink">
              Cualquier persona puede dejar una reseña, haya comprado por la web, WhatsApp o en persona.
              Las reseñas verificadas se identifican cuando provienen de un pedido con enlace de seguimiento.
            </p>
          </div>

          {ranked.length > 0 ? (
            <div className="rounded-section bg-lavender p-6">
              <h3 className="font-display text-2xl font-extrabold text-plum">Favoritos mejor calificados</h3>
              <p className="mt-1 text-sm text-muted">
                Ordenados con un promedio ponderado bayesiano para evitar que un producto con pocas reseñas supere injustamente a uno con historial sólido.
              </p>
              <ul className="mt-4 space-y-3">
                {ranked.map((item) => (
                  <li key={item.id} className="rounded-card bg-white/80 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/productos/${encodeURIComponent(item.slug)}`} className="font-display text-lg font-bold text-plum hover:underline">
                        {item.name}
                      </Link>
                      <span className="text-sm font-bold text-muted">${item.priceUsd.toFixed(2)}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-sm text-ink">
                      <ReviewStars rating={item.aggregate.averageRating} />
                      <span className="font-bold">{item.aggregate.averageRating.toFixed(1)}</span>
                      <span className="text-muted">({item.aggregate.reviewCount} reseñas)</span>
                    </div>
                  </li>
                ))}
              </ul>
              <Link href="/productos" className="mt-4 inline-flex items-center gap-1 font-display text-sm font-bold text-pink hover:underline">
                Ver productos <ArrowRightIcon className="size-4" />
              </Link>
            </div>
          ) : (
            <div className="rounded-section bg-lavender p-6 text-sm leading-6 text-ink">
              Aún estamos reuniendo suficientes reseñas publicadas para destacar favoritos con confianza.
              Cuando haya datos suficientes, verás aquí los productos mejor calificados.
            </div>
          )}
        </div>

        <div id="dejar-resena" className="scroll-mt-24">
          <ReviewFormDisclosure title="Escribir una reseña" openOnHashId="dejar-resena">
            <ReviewForm products={products.map((p) => ({ id: p.id, name: p.name }))} title="Cuéntanos tu experiencia" />
          </ReviewFormDisclosure>
        </div>
      </div>
    </section>
  );
}
