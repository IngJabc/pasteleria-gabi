import { formatDateTime } from "@/features/admin/format";
import type { PublicReview, ReviewAggregateView } from "../schemas";
import { ReviewStars } from "./review-stars";
import { ReviewForm } from "./review-form";
import { ReviewFormDisclosure } from "./review-form-disclosure";
import { ProductReviewsRealtime } from "./reviews-realtime";

export function ProductReviewsSection({
  productId,
  productName,
  reviews,
  aggregate,
  trackingToken,
}: {
  productId: number;
  productName: string;
  reviews: PublicReview[];
  aggregate: ReviewAggregateView | null;
  trackingToken?: string | null;
}) {
  return (
    <section className="mt-10 space-y-6" aria-labelledby="product-reviews-heading">
      <ProductReviewsRealtime productId={productId} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow">Opiniones reales</p>
          <h2 id="product-reviews-heading" className="font-display text-3xl font-extrabold text-plum">
            Reseñas
          </h2>
        </div>
        {aggregate && aggregate.reviewCount > 0 ? (
          <div className="rounded-card bg-lavender px-4 py-3 text-sm text-ink">
            <div className="flex items-center gap-2">
              <ReviewStars rating={aggregate.averageRating} label={`${aggregate.averageRating.toFixed(1)} de 5 estrellas`} />
              <span className="font-display font-bold text-plum">{aggregate.averageRating.toFixed(1)}</span>
            </div>
            <p className="mt-1 text-muted">{aggregate.reviewCount} {aggregate.reviewCount === 1 ? "reseña publicada" : "reseñas publicadas"}</p>
          </div>
        ) : (
          <p className="text-sm text-muted">Aún no hay reseñas publicadas para este producto.</p>
        )}
      </div>

      <ReviewFormDisclosure title="Escribir una reseña">
        <ReviewForm
          products={[{ id: productId, name: productName }]}
          initialProductId={productId}
          trackingToken={trackingToken}
          title="Califica este producto"
          compact
        />
      </ReviewFormDisclosure>

      {reviews.length > 0 ? (
        <ul className="space-y-4">
          {reviews.map((review) => (
            <li key={review.id} className="rounded-card bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <ReviewStars rating={review.rating} />
                <span className="font-display text-sm font-bold text-plum">
                  {review.reviewer_name?.trim() || "Cliente anónimo"}
                </span>
                {review.is_verified_purchase ? (
                  <span className="rounded-full bg-mint px-2.5 py-1 text-xs font-bold text-ink">
                    Compra verificada
                  </span>
                ) : null}
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink">{review.comment}</p>
              <p className="mt-3 text-xs text-muted">{formatDateTime(review.created_at)}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
