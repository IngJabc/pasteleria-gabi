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

/** The list and detail pages both render this single validated shape. */
export const catalogProductSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  priceUsd: z.number().nonnegative(),
  images: z.array(catalogProductImageSchema),
});

export type CatalogProduct = z.infer<typeof catalogProductSchema>;
