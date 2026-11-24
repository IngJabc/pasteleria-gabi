import type { ReviewAggregateView } from "./schemas";

/**
 * Bayesian weighted rating (IMDb-style baseline adapted for 1..5 reviews).
 *
 * WR = (v/(v+m))*R + (m/(v+m))*C
 * - R: product average rating
 * - v: product published review count
 * - m: minimum review threshold before raw average is trusted alone
 * - C: global prior mean across published reviews
 *
 * Products with no reviews get score null and must not be fabricated/ranked as rated.
 */
export const BAYESIAN_PRIOR_MEAN = 4.0;
export const BAYESIAN_MIN_REVIEWS = 5;

export function bayesianWeightedRating(input: {
  averageRating: number;
  reviewCount: number;
  priorMean?: number;
  minReviews?: number;
}): number | null {
  const v = input.reviewCount;
  const R = input.averageRating;
  const m = input.minReviews ?? BAYESIAN_MIN_REVIEWS;
  const C = input.priorMean ?? BAYESIAN_PRIOR_MEAN;
  if (!Number.isFinite(v) || v <= 0) return null;
  if (!Number.isFinite(R) || R < 0) return null;
  const weight = v / (v + m);
  return weight * R + (1 - weight) * C;
}

export function computeGlobalPriorMean(
  aggregates: ReviewAggregateView[],
  fallback = BAYESIAN_PRIOR_MEAN,
): number {
  let totalCount = 0;
  let totalSum = 0;
  for (const agg of aggregates) {
    if (agg.reviewCount > 0) {
      totalCount += agg.reviewCount;
      totalSum += agg.averageRating * agg.reviewCount;
    }
  }
  if (totalCount === 0) return fallback;
  return totalSum / totalCount;
}

export function rankProductsByReviews<T extends { id: number }>(
  products: T[],
  aggregateByProductId: Record<number, ReviewAggregateView | undefined>,
  options?: { priorMean?: number; minReviews?: number; limit?: number },
): Array<T & { aggregate: ReviewAggregateView; score: number }> {
  const priorMean = options?.priorMean ?? BAYESIAN_PRIOR_MEAN;
  const minReviews = options?.minReviews ?? BAYESIAN_MIN_REVIEWS;
  const ranked = products
    .map((product) => {
      const aggregate = aggregateByProductId[product.id];
      if (!aggregate || aggregate.reviewCount <= 0) return null;
      const score = bayesianWeightedRating({
        averageRating: aggregate.averageRating,
        reviewCount: aggregate.reviewCount,
        priorMean,
        minReviews,
      });
      if (score === null) return null;
      return { ...product, aggregate, score };
    })
    .filter((value): value is T & { aggregate: ReviewAggregateView; score: number } => value !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.aggregate.reviewCount !== a.aggregate.reviewCount) {
        return b.aggregate.reviewCount - a.aggregate.reviewCount;
      }
      return b.aggregate.averageRating - a.aggregate.averageRating;
    });

  return typeof options?.limit === "number" ? ranked.slice(0, options.limit) : ranked;
}
