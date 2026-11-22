import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adminProductSchema,
  catalogProductSchema,
  productImageRowSchema,
  productRowSchema,
  type AdminProduct,
  type CatalogProduct,
  type ProductRow,
} from "./schemas";

/**
 * Public catalog reads. The client is supplied by the caller (the request-bound
 * `createSupabaseServerClient()` in production, a fake in offline tests), so
 * this module stays pure and never reads cookies or configuration itself.
 *
 * Narrow structural type derived from the installed supabase-js client; it
 * accepts the typed request-bound client and never grants service-role access.
 */
export type CatalogClient = Pick<SupabaseClient, "from" | "storage">;

const PRODUCT_COLUMNS = "id, slug, name, description, price_usd, is_active";
const PRODUCT_IMAGE_COLUMNS = "id, product_id, storage_path, position";
const STORAGE_BUCKET = "product-images";

/** Stable, Spanish-only messages: database/SQL details are never forwarded. */
export const catalogUnavailableError =
  "No se pudo cargar el catálogo. Inténtalo de nuevo.";
export const productUnavailableError =
  "No se pudo cargar el producto. Inténtalo de nuevo.";

type ImageWithUrl = {
  id: number;
  position: number;
  url: string;
};

export async function listActiveProducts(
  client: CatalogClient,
): Promise<CatalogProduct[]> {
  const { data, error } = await client
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("is_active", true)
    .order("id", { ascending: true });

  if (error) throw new Error(catalogUnavailableError);
  if (!data) return [];

  const rows: ProductRow[] = [];
  for (const raw of data) {
    const parsed = productRowSchema.safeParse(raw);
    if (!parsed.success) throw new Error(catalogUnavailableError);
    // RLS already filters inactive rows; keep the filter explicit so a schema
    // or policy change cannot leak hidden products into the public catalog.
    if (!parsed.data.is_active) continue;
    rows.push(parsed.data);
  }

  if (rows.length === 0) return [];

  // The database query already orders by id; sort here too so the public
  // contract stays deterministic even if the data source changes.
  rows.sort((a, b) => a.id - b.id);

  const images = await fetchImages(
    client,
    rows.map((row) => row.id),
    catalogUnavailableError,
  );

  return rows.map((row) =>
    toCatalogProduct(row, images.get(row.id) ?? [], catalogUnavailableError),
  );
}

export async function getActiveProductBySlug(
  client: CatalogClient,
  slug: string,
): Promise<CatalogProduct | null> {
  const { data, error } = await client
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new Error(productUnavailableError);
  if (!data) return null;

  const parsed = productRowSchema.safeParse(data);
  if (!parsed.success) throw new Error(productUnavailableError);
  if (!parsed.data.is_active) return null;

  const images = await fetchImages(
    client,
    [parsed.data.id],
    productUnavailableError,
  );

  return toCatalogProduct(
    parsed.data,
    images.get(parsed.data.id) ?? [],
    productUnavailableError,
  );
}

/**
 * Admin read: all products, active and inactive, with their images. It reuses
 * the same injected client/session boundary and never grants service-role access.
 */
export async function listAdminProducts(
  client: CatalogClient,
): Promise<AdminProduct[]> {
  const { data, error } = await client
    .from("products")
    .select(PRODUCT_COLUMNS)
    .order("id", { ascending: true });

  if (error) throw new Error(catalogUnavailableError);
  if (!data) return [];

  const rows: ProductRow[] = [];
  for (const raw of data) {
    const parsed = productRowSchema.safeParse(raw);
    if (!parsed.success) throw new Error(catalogUnavailableError);
    rows.push(parsed.data);
  }
  rows.sort((a, b) => a.id - b.id);
  if (rows.length === 0) return [];

  const images = await fetchImages(
    client,
    rows.map((row) => row.id),
    catalogUnavailableError,
  );

  return rows.map((row) =>
    toAdminProduct(row, images.get(row.id) ?? [], catalogUnavailableError),
  );
}

/**
 * One images query for the whole list (no per-product waterfall). Images are
 * requested in `position` order with `id` as a deterministic tie-breaker.
 */
async function fetchImages(
  client: CatalogClient,
  productIds: number[],
  errorMessage: string,
): Promise<Map<number, ImageWithUrl[]>> {
  const grouped = new Map<number, ImageWithUrl[]>();
  if (productIds.length === 0) return grouped;

  const { data, error } = await client
    .from("product_images")
    .select(PRODUCT_IMAGE_COLUMNS)
    .in("product_id", productIds)
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new Error(errorMessage);
  if (!data) return grouped;

  for (const raw of data) {
    const parsed = productImageRowSchema.safeParse(raw);
    if (!parsed.success) throw new Error(errorMessage);
    if (!productIds.includes(parsed.data.product_id)) continue;

    let url: string;
    try {
      url = client.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(parsed.data.storage_path).data.publicUrl;
    } catch {
      throw new Error(errorMessage);
    }

    const image: ImageWithUrl = {
      id: parsed.data.id,
      position: parsed.data.position,
      url,
    };
    const existing = grouped.get(parsed.data.product_id);
    if (existing) {
      existing.push(image);
    } else {
      grouped.set(parsed.data.product_id, [image]);
    }
  }

  return grouped;
}

function mapImages(row: ProductRow, images: ImageWithUrl[]) {
  const ordered = [...images].sort(
    (a, b) => a.position - b.position || a.id - b.id,
  );
  return ordered.map((image, index) => ({
    id: image.id,
    position: image.position,
    url: image.url,
    // The schema stores no per-image caption; the product name plus a
    // sequential position is a truthful, descriptive alternative text.
    alt: `Imagen ${index + 1} de ${row.name}`,
  }));
}

function toCatalogProduct(
  row: ProductRow,
  images: ImageWithUrl[],
  errorMessage: string,
): CatalogProduct {
  const parsed = catalogProductSchema.safeParse({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    priceUsd: row.price_usd,
    images: mapImages(row, images),
  });

  if (!parsed.success) throw new Error(errorMessage);
  return parsed.data;
}

function toAdminProduct(
  row: ProductRow,
  images: ImageWithUrl[],
  errorMessage: string,
): AdminProduct {
  const parsed = adminProductSchema.safeParse({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    priceUsd: row.price_usd,
    isActive: row.is_active,
    images: mapImages(row, images),
  });

  if (!parsed.success) throw new Error(errorMessage);
  return parsed.data;
}
