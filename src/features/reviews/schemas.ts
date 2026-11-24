import { z } from "zod";

export const REVIEW_COMMENT_MAX = 1000;
export const REVIEW_NAME_MAX = 80;
export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;

export const reviewRatingSchema = z.coerce
  .number()
  .int("La calificación debe ser un número entero.")
  .min(REVIEW_RATING_MIN, "La calificación debe estar entre 1 y 5 estrellas.")
  .max(REVIEW_RATING_MAX, "La calificación debe estar entre 1 y 5 estrellas.");

export const reviewCommentSchema = z
  .string()
  .trim()
  .min(1, "El comentario es obligatorio.")
  .max(REVIEW_COMMENT_MAX, `El comentario debe tener hasta ${REVIEW_COMMENT_MAX} caracteres.`);

export const reviewNameSchema = z
  .string()
  .trim()
  .max(REVIEW_NAME_MAX, `El nombre debe tener hasta ${REVIEW_NAME_MAX} caracteres.`)
  .transform((value) => (value === "" ? null : value));

export const trackingTokenSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{64}$/, "El enlace de seguimiento no es válido.");

export const submitReviewInputSchema = z.object({
  productId: z.coerce.number().int().positive("Selecciona un producto válido."),
  rating: reviewRatingSchema,
  comment: reviewCommentSchema,
  reviewerName: reviewNameSchema.optional().default(null),
  trackingToken: trackingTokenSchema.optional().or(z.literal("")).transform((v) => (v ? v : null)),
});

export type SubmitReviewInput = z.infer<typeof submitReviewInputSchema>;

export const publicReviewSchema = z.object({
  id: z.number().int().positive(),
  product_id: z.number().int().positive(),
  reviewer_name: z.string().nullable(),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string(),
  is_verified_purchase: z.boolean(),
  created_at: z.string(),
});

export type PublicReview = z.infer<typeof publicReviewSchema>;

export const reviewAggregateSchema = z.object({
  product_id: z.number().int().positive(),
  review_count: z.coerce.number().int().nonnegative(),
  rating_sum: z.coerce.number().int().nonnegative(),
  average_rating: z.coerce.number().min(0).max(5),
  updated_at: z.string().optional(),
});

export type ReviewAggregate = z.infer<typeof reviewAggregateSchema>;

export type ReviewAggregateView = {
  productId: number;
  reviewCount: number;
  averageRating: number;
};

export const adminReviewSchema = z.object({
  id: z.number().int().positive(),
  product_id: z.number().int().positive(),
  order_id: z.number().int().positive().nullable(),
  reviewer_name: z.string().nullable(),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string(),
  is_verified_purchase: z.boolean(),
  is_hidden: z.boolean(),
  hidden_at: z.string().nullable(),
  created_at: z.string(),
});

export type AdminReviewRow = z.infer<typeof adminReviewSchema>;

export const adminReviewFilterSchema = z.object({
  status: z.enum(["all", "published", "hidden"]).default("all"),
  productId: z.coerce.number().int().positive().optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(50).default(10),
});

export type AdminReviewFilter = z.infer<typeof adminReviewFilterSchema>;
