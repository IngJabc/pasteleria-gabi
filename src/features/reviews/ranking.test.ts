import { describe, expect, it } from "vitest";
import { bayesianWeightedRating, computeGlobalPriorMean, rankProductsByReviews } from "./ranking";

describe("review ranking", () => {
  it("returns null when there are no published reviews", () => {
    expect(bayesianWeightedRating({ averageRating: 5, reviewCount: 0 })).toBeNull();
  });

  it("applies Bayesian weighting", () => {
    const score = bayesianWeightedRating({ averageRating: 5, reviewCount: 1, priorMean: 4, minReviews: 5 });
    expect(score).toBeCloseTo((1 / 6) * 5 + (5 / 6) * 4, 5);
  });

  it("computes global prior mean from aggregates", () => {
    expect(computeGlobalPriorMean([
      { productId: 1, reviewCount: 2, averageRating: 5 },
      { productId: 2, reviewCount: 2, averageRating: 3 },
    ])).toBe(4);
  });

  it("ranks only products with reviews", () => {
    const ranked = rankProductsByReviews(
      [{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }],
      {
        1: { productId: 1, reviewCount: 1, averageRating: 5 },
        2: { productId: 2, reviewCount: 20, averageRating: 4.6 },
        3: { productId: 3, reviewCount: 0, averageRating: 0 },
      },
      { priorMean: 4, minReviews: 5, limit: 10 },
    );
    expect(ranked.map((r) => r.id)).toEqual([2, 1]);
    expect(ranked.find((r) => r.id === 3)).toBeUndefined();
  });
});
