import { z } from "zod";

/**
 * Zod mirrors of the columns selected from migration 001
 * (`supabase/migrations/001_catalog_and_admin_foundation.sql`).
 *
 * The public catalog only reads active rows; these schemas are the boundary
 * where untrusted PostgREST JSON becomes a typed domain value. `price_usd` is a
 * Postgres `numeric(10,2)`, which PostgREST may return as either a number or a
 * decimal string, hence the coercion.
 */

export const productRowSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  price_usd: z.coerce.number().nonnegative(),
  is_active: z.boolean(),
});

export type ProductRow = z.infer<typeof productRowSchema>;

export const productImageRowSchema = z.object({
  id: z.number().int().positive(),
  product_id: z.number().int().positive(),
  storage_path: z.string().min(1),
  position: z.number().int().nonnegative(),
});

export type ProductImageRow = z.infer<typeof productImageRowSchema>;

/** An image ready to render: Storage URL plus descriptive alternative text. */
export const catalogProductImageSchema = z.object({
  id: z.number().int().positive(),
  position: z.number().int().nonnegative(),
  url: z.url(),
  alt: z.string().min(1),
});

export type CatalogProductImage = z.infer<typeof catalogProductImageSchema>;

export const catalogProductReviewAggregateSchema = z.object({
  reviewCount: z.number().int().nonnegative(),
  averageRating: z.number().min(0).max(5),
});

export type CatalogProductReviewAggregate = z.infer<typeof catalogProductReviewAggregateSchema>;

/** The list and detail pages both render this single validated shape. */
export const catalogProductSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  priceUsd: z.number().nonnegative(),
  images: z.array(catalogProductImageSchema),
  reviewAggregate: catalogProductReviewAggregateSchema.nullable().optional(),
});

export type CatalogProduct = z.infer<typeof catalogProductSchema>;

/**
 * Admin product CRUD input and boundary schemas (TASKS.md:729).
 * Input schemas are strict so client-supplied identity/timestamp/storage fields
 * are rejected before any Supabase call.
 */

export const PRODUCT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const PRODUCT_IMAGE_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;

export const invalidProductInputError =
  "Los datos del producto no son válidos.";
export const invalidSessionError =
  "La sesión del administrador no es válida.";
export const genericProductError =
  "No se pudo guardar el producto. Inténtalo de nuevo.";
export const genericProductImageError =
  "No se pudo guardar la imagen del producto. Inténtalo de nuevo.";
export const duplicateSlugError = "Ya existe un producto con ese slug.";
export const productNotFoundError = "El producto no existe.";
export const auditFailureError =
  "Los cambios se guardaron, pero no se pudo registrar la operación en el historial.";

export const productSlugSchema = z
  .string()
  .trim()
  .min(1, "El slug es obligatorio.")
  .max(120, "El slug es demasiado largo.")
  .regex(
    PRODUCT_SLUG_PATTERN,
    "El slug solo puede tener letras minúsculas, números y guiones.",
  );

export const productNameSchema = z
  .string()
  .trim()
  .min(1, "El nombre es obligatorio.")
  .max(160, "El nombre es demasiado largo.");

export const productDescriptionSchema = z
  .string()
  .trim()
  .min(1, "La descripción es obligatoria.")
  .max(2000, "La descripción es demasiado larga.");

export const priceUsdInputSchema = z.coerce
  .number({ message: "El precio no es válido." })
  .finite("El precio no es válido.")
  .min(0, "El precio no puede ser negativo.")
  .max(99_999_999.99, "El precio es demasiado alto.")
  .multipleOf(0.01, "El precio debe tener hasta dos decimales.");

export function normalizePriceUsd(value: number): number {
  return Number(value.toFixed(2));
}

export function slugifyProductName(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
  return slug || "producto";
}

export const productInputSchema = z.strictObject({
  name: productNameSchema,
  description: productDescriptionSchema,
  priceUsd: priceUsdInputSchema,
  slug: productSlugSchema,
  isActive: z.boolean(),
});

export type ProductInput = z.infer<typeof productInputSchema>;

export const updateProductInputSchema = productInputSchema.extend({
  productId: z.number().int().positive(),
}).strict();

export type UpdateProductInput = z.infer<typeof updateProductInputSchema>;

export const setProductActiveInputSchema = z.strictObject({
  productId: z.number().int().positive(),
  isActive: z.boolean(),
});

export type SetProductActiveInput = z.infer<typeof setProductActiveInputSchema>;

export const reorderProductImagesInputSchema = z.strictObject({
  productId: z.number().int().positive(),
  orderedImageIds: z
    .array(z.number().int().positive())
    .min(1, "Debes indicar el orden de las imágenes.")
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "El orden de las imágenes no es válido.",
    ),
});

export type ReorderProductImagesInput = z.infer<
  typeof reorderProductImagesInputSchema
>;

export const removeProductImageInputSchema = z.strictObject({
  productId: z.number().int().positive(),
  imageId: z.number().int().positive(),
});

export type RemoveProductImageInput = z.infer<
  typeof removeProductImageInputSchema
>;

export const addProductImageInputSchema = z.strictObject({
  productId: z.number().int().positive(),
  file: z
    .custom<File>((value) => value instanceof File, "Selecciona una imagen válida.")
    .refine(
      (file) => file.size > 0,
      "El archivo de imagen está vacío.",
    )
    .refine(
      (file) => file.size <= MAX_PRODUCT_IMAGE_BYTES,
      "La imagen no puede superar 5 MB.",
    )
    .refine(
      (file) => file.type in PRODUCT_IMAGE_CONTENT_TYPES,
      "La imagen debe ser JPEG, PNG o WebP.",
    ),
});

export type AddProductImageInput = z.infer<typeof addProductImageInputSchema>;

export const adminProductRowSchema = productRowSchema;
export type AdminProductRow = ProductRow;

export const adminProductImageSchema = catalogProductImageSchema;

export const adminProductSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  priceUsd: z.number().nonnegative(),
  isActive: z.boolean(),
  images: z.array(adminProductImageSchema),
});

export type AdminProduct = z.infer<typeof adminProductSchema>;
