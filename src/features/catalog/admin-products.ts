"use server";

import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import { requireActiveAdminId } from "@/features/payments/admin-session";
import type { Database } from "@/infrastructure/database/database.types";
import {
  addProductImageInputSchema,
  auditFailureError,
  duplicateSlugError,
  genericProductError,
  genericProductImageError,
  invalidProductInputError,
  invalidSessionError,
  MAX_PRODUCT_IMAGE_BYTES,
  normalizePriceUsd,
  PRODUCT_IMAGE_CONTENT_TYPES,
  productInputSchema,
  productNotFoundError,
  productRowSchema,
  removeProductImageInputSchema,
  reorderProductImagesInputSchema,
  setProductActiveInputSchema,
  updateProductInputSchema,
  type AdminProduct,
  type ProductInput,
} from "./schemas";
import { listAdminProducts, type CatalogClient } from "./queries";

type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];
type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];
type ProductImageInsert =
  Database["public"]["Tables"]["product_images"]["Insert"];

export type ProductActionResult =
  | { ok: true; product: AdminProduct }
  | { ok: false; error: string };

export type ProductImageActionResult =
  | { ok: true; product: AdminProduct }
  | { ok: false; error: string };

const PRODUCT_BUCKET = "product-images";

function mapDuplicateSlug(error: { code?: string; message?: string } | null): string | null {
  if (error?.code === "23505") return duplicateSlugError;
  const message = error?.message ?? "";
  if (message.includes("products_slug_key")) return duplicateSlugError;
  return null;
}

async function writeAudit(
  adminId: string,
  action: string,
  entityId: number,
  data: Record<string, unknown>,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("audit_log").insert({
    admin_id: adminId,
    action,
    entity_type: "product",
    entity_id: String(entityId),
    data: data as Database["public"]["Tables"]["audit_log"]["Insert"]["data"],
  });
  return !error;
}

async function loadAdminProduct(productId: number): Promise<AdminProduct | null> {
  const supabase = await createSupabaseServerClient();
  const products = await listAdminProducts(supabase as unknown as CatalogClient);
  return products.find((product) => product.id === productId) ?? null;
}

function toAdminProductFromRow(row: {
  id: number;
  slug: string;
  name: string;
  description: string;
  price_usd: number;
  is_active: boolean;
}): AdminProduct {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    priceUsd: normalizePriceUsd(Number(row.price_usd)),
    isActive: row.is_active,
    images: [],
  };
}


export async function createProduct(
  input: ProductInput,
): Promise<ProductActionResult> {
  const parsed = productInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: invalidProductInputError };

  let adminId: string;
  try {
    adminId = await requireActiveAdminId();
  } catch {
    return { ok: false, error: invalidSessionError };
  }

  const payload: ProductInsert = {
    name: parsed.data.name.trim(),
    description: parsed.data.description.trim(),
    price_usd: normalizePriceUsd(parsed.data.priceUsd),
    slug: parsed.data.slug.trim(),
    is_active: parsed.data.isActive,
  };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("products")
    .insert(payload)
    .select("id, slug, name, description, price_usd, is_active")
    .single();

  if (error || !data) {
    return { ok: false, error: mapDuplicateSlug(error) ?? genericProductError };
  }

  const row = productRowSchema.safeParse(data);
  if (!row.success) return { ok: false, error: genericProductError };

  const audited = await writeAudit(adminId, "product.create", row.data.id, {
    after: {
      slug: row.data.slug,
      name: row.data.name,
      description: row.data.description,
      price_usd: row.data.price_usd,
      is_active: row.data.is_active,
    },
  });
  if (!audited) return { ok: false, error: auditFailureError };

  const product = await loadAdminProduct(row.data.id);
  return { ok: true, product: product ?? toAdminProductFromRow(row.data) };
}

export async function updateProduct(
  input: unknown,
): Promise<ProductActionResult> {
  const parsed = updateProductInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: invalidProductInputError };

  let adminId: string;
  try {
    adminId = await requireActiveAdminId();
  } catch {
    return { ok: false, error: invalidSessionError };
  }

  const supabase = await createSupabaseServerClient();
  const { data: existing, error: readError } = await supabase
    .from("products")
    .select("id, slug, name, description, price_usd, is_active")
    .eq("id", parsed.data.productId)
    .maybeSingle();

  if (readError) return { ok: false, error: genericProductError };
  const before = productRowSchema.safeParse(existing);
  if (!before.success) return { ok: false, error: productNotFoundError };

  const patch: ProductUpdate = {
    name: parsed.data.name.trim(),
    description: parsed.data.description.trim(),
    price_usd: normalizePriceUsd(parsed.data.priceUsd),
    slug: parsed.data.slug.trim(),
    is_active: parsed.data.isActive,
  };

  const { data, error } = await supabase
    .from("products")
    .update(patch)
    .eq("id", parsed.data.productId)
    .select("id, slug, name, description, price_usd, is_active")
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: mapDuplicateSlug(error) ?? genericProductError };
  }

  const after = productRowSchema.safeParse(data);
  if (!after.success) return { ok: false, error: genericProductError };

  const beforeData = {
    slug: before.data.slug,
    name: before.data.name,
    description: before.data.description,
    price_usd: before.data.price_usd,
    is_active: before.data.is_active,
  };
  const afterData = {
    slug: after.data.slug,
    name: after.data.name,
    description: after.data.description,
    price_usd: after.data.price_usd,
    is_active: after.data.is_active,
  };
  const changed =
    JSON.stringify(beforeData) !== JSON.stringify(afterData);

  if (changed) {
    const audited = await writeAudit(adminId, "product.update", after.data.id, {
      before: beforeData,
      after: afterData,
    });
    if (!audited) return { ok: false, error: auditFailureError };
  }

  const product = await loadAdminProduct(after.data.id);
  return { ok: true, product: product ?? toAdminProductFromRow(after.data) };
}

export async function setProductActive(
  input: unknown,
): Promise<ProductActionResult> {
  const parsed = setProductActiveInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: invalidProductInputError };

  let adminId: string;
  try {
    adminId = await requireActiveAdminId();
  } catch {
    return { ok: false, error: invalidSessionError };
  }

  const supabase = await createSupabaseServerClient();
  const { data: existing, error: readError } = await supabase
    .from("products")
    .select("id, slug, name, description, price_usd, is_active")
    .eq("id", parsed.data.productId)
    .maybeSingle();
  if (readError) return { ok: false, error: genericProductError };
  const before = productRowSchema.safeParse(existing);
  if (!before.success) return { ok: false, error: productNotFoundError };

  if (before.data.is_active === parsed.data.isActive) {
    const product = await loadAdminProduct(before.data.id);
    return { ok: true, product: product ?? toAdminProductFromRow(before.data) };
  }

  const { data, error } = await supabase
    .from("products")
    .update({ is_active: parsed.data.isActive })
    .eq("id", parsed.data.productId)
    .select("id, slug, name, description, price_usd, is_active")
    .maybeSingle();

  if (error || !data) return { ok: false, error: genericProductError };
  const after = productRowSchema.safeParse(data);
  if (!after.success) return { ok: false, error: genericProductError };

  const audited = await writeAudit(adminId, "product.update", after.data.id, {
    before: { is_active: before.data.is_active },
    after: { is_active: after.data.is_active },
  });
  if (!audited) return { ok: false, error: auditFailureError };

  const product = await loadAdminProduct(after.data.id);
  return { ok: true, product: product ?? toAdminProductFromRow(after.data) };
}

export async function addProductImage(
  input: unknown,
): Promise<ProductImageActionResult> {
  const parsed = addProductImageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: invalidProductInputError };

  const file = parsed.data.file;
  const extension = PRODUCT_IMAGE_CONTENT_TYPES[file.type];
  if (!extension || file.size <= 0 || file.size > MAX_PRODUCT_IMAGE_BYTES) {
    return { ok: false, error: invalidProductInputError };
  }

  let adminId: string;
  try {
    adminId = await requireActiveAdminId();
  } catch {
    return { ok: false, error: invalidSessionError };
  }

  const supabase = await createSupabaseServerClient();
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id")
    .eq("id", parsed.data.productId)
    .maybeSingle();
  if (productError) return { ok: false, error: genericProductImageError };
  if (!product) return { ok: false, error: productNotFoundError };

  const { data: existingImages, error: imagesError } = await supabase
    .from("product_images")
    .select("id, position")
    .eq("product_id", parsed.data.productId)
    .order("position", { ascending: true })
    .order("id", { ascending: true });
  if (imagesError) return { ok: false, error: genericProductImageError };
  const maxPosition = (existingImages ?? []).reduce(
    (max, image) => Math.max(max, Number(image.position)),
    -1,
  );
  const position = maxPosition + 1;

  const storagePath = `${parsed.data.productId}/${randomUUID()}.${extension}`;
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    return { ok: false, error: invalidProductInputError };
  }
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_PRODUCT_IMAGE_BYTES) {
    return { ok: false, error: invalidProductInputError };
  }

  const upload = await supabase.storage
    .from(PRODUCT_BUCKET)
    .upload(storagePath, new Blob([bytes], { type: file.type }), {
      contentType: file.type,
      upsert: false,
    });
  if (upload.error) return { ok: false, error: genericProductImageError };

  const imageInsert: ProductImageInsert = {
    product_id: parsed.data.productId,
    storage_path: storagePath,
    position,
  };
  const { data: imageRow, error: insertError } = await supabase
    .from("product_images")
    .insert(imageInsert)
    .select("id, product_id, storage_path, position")
    .single();

  if (insertError || !imageRow) {
    await supabase.storage.from(PRODUCT_BUCKET).remove([storagePath]);
    return { ok: false, error: genericProductImageError };
  }

  const audited = await writeAudit(adminId, "product.image_upload", parsed.data.productId, {
    after: {
      image_id: imageRow.id,
      storage_path: storagePath,
      position: imageRow.position,
    },
  });
  if (!audited) return { ok: false, error: auditFailureError };

  const adminProduct = await loadAdminProduct(parsed.data.productId);
  if (!adminProduct) return { ok: false, error: genericProductImageError };
  return { ok: true, product: adminProduct };
}

export async function removeProductImage(
  input: unknown,
): Promise<ProductImageActionResult> {
  const parsed = removeProductImageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: invalidProductInputError };

  let adminId: string;
  try {
    adminId = await requireActiveAdminId();
  } catch {
    return { ok: false, error: invalidSessionError };
  }

  const supabase = await createSupabaseServerClient();
  const { data: existing, error: readError } = await supabase
    .from("product_images")
    .select("id, product_id, storage_path, position")
    .eq("id", parsed.data.imageId)
    .eq("product_id", parsed.data.productId)
    .maybeSingle();

  if (readError) return { ok: false, error: genericProductImageError };
  if (!existing) return { ok: false, error: productNotFoundError };

  const { error: deleteError } = await supabase
    .from("product_images")
    .delete()
    .eq("id", parsed.data.imageId)
    .eq("product_id", parsed.data.productId);

  if (deleteError) return { ok: false, error: genericProductImageError };

  // Row delete is authoritative; best-effort storage cleanup must not leave a
  // broken storefront reference by reversing the order.
  await supabase.storage.from(PRODUCT_BUCKET).remove([existing.storage_path]);

  const audited = await writeAudit(adminId, "product.image_remove", parsed.data.productId, {
    before: {
      image_id: existing.id,
      storage_path: existing.storage_path,
      position: existing.position,
    },
  });
  if (!audited) return { ok: false, error: auditFailureError };

  const adminProduct = await loadAdminProduct(parsed.data.productId);
  if (!adminProduct) return { ok: false, error: genericProductImageError };
  return { ok: true, product: adminProduct };
}

export async function reorderProductImages(
  input: unknown,
): Promise<ProductImageActionResult> {
  const parsed = reorderProductImagesInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: invalidProductInputError };

  let adminId: string;
  try {
    adminId = await requireActiveAdminId();
  } catch {
    return { ok: false, error: invalidSessionError };
  }

  const supabase = await createSupabaseServerClient();
  const { data: existing, error: readError } = await supabase
    .from("product_images")
    .select("id, position")
    .eq("product_id", parsed.data.productId)
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (readError) return { ok: false, error: genericProductImageError };
  const images = existing ?? [];
  const existingIds = images.map((image) => Number(image.id));
  const requested = parsed.data.orderedImageIds;
  if (
    existingIds.length !== requested.length ||
    !requested.every((id) => existingIds.includes(id))
  ) {
    return { ok: false, error: invalidProductInputError };
  }

  const before = images.map((image) => ({
    image_id: Number(image.id),
    position: Number(image.position),
  }));

  // Bounded to this product's images (D4): sequential updates + verification read.
  for (let index = 0; index < requested.length; index += 1) {
    const imageId = requested[index];
    const { error } = await supabase
      .from("product_images")
      .update({ position: index })
      .eq("id", imageId)
      .eq("product_id", parsed.data.productId);
    if (error) return { ok: false, error: genericProductImageError };
  }

  const { data: verified, error: verifyError } = await supabase
    .from("product_images")
    .select("id, position")
    .eq("product_id", parsed.data.productId)
    .order("position", { ascending: true })
    .order("id", { ascending: true });
  if (verifyError) return { ok: false, error: genericProductImageError };

  const after = (verified ?? []).map((image) => ({
    image_id: Number(image.id),
    position: Number(image.position),
  }));
  const ok = after.every(
    (image, index) => image.image_id === requested[index] && image.position === index,
  );
  if (!ok) return { ok: false, error: genericProductImageError };

  if (JSON.stringify(before) !== JSON.stringify(after)) {
    const audited = await writeAudit(
      adminId,
      "product.image_reorder",
      parsed.data.productId,
      { before, after },
    );
    if (!audited) return { ok: false, error: auditFailureError };
  }

  const adminProduct = await loadAdminProduct(parsed.data.productId);
  if (!adminProduct) return { ok: false, error: genericProductImageError };
  return { ok: true, product: adminProduct };
}
