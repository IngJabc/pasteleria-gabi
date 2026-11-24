import { describe, expect, it } from "vitest";
import { submitReviewInputSchema } from "./schemas";

describe("review schemas", () => {
  it("accepts a valid public review", () => {
    const parsed = submitReviewInputSchema.safeParse({
      productId: 1, rating: 5, comment: "Excelente", reviewerName: "Ana", trackingToken: ""
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.trackingToken).toBeNull();
  });

  it("rejects invalid rating and empty comment", () => {
    const badRating = submitReviewInputSchema.safeParse({ productId: 1, rating: 6, comment: "ok" });
    const badComment = submitReviewInputSchema.safeParse({ productId: 1, rating: 5, comment: "  " });
    expect(badRating.success).toBe(false);
    expect(badComment.success).toBe(false);
  });

  it("rejects invalid tracking token format", () => {
    const parsed = submitReviewInputSchema.safeParse({ productId: 1, rating: 4, comment: "Bien", trackingToken: "bad" });
    expect(parsed.success).toBe(false);
  });
});
