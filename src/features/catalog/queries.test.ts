import { describe, expect, it, vi } from "vitest";
import {
  catalogUnavailableError,
  getActiveProductBySlug,
  listActiveProducts,
  productUnavailableError,
  type CatalogClient,
} from "./queries";

type FakeResult = { data: unknown; error: { message: string } | null };

/** Minimal thenable query builder: every chain method returns itself. */
class FakeQuery implements PromiseLike<FakeResult> {
  readonly select = vi.fn(() => this);
  readonly eq = vi.fn(() => this);
  readonly in = vi.fn(() => this);
  readonly order = vi.fn(() => this);
  readonly maybeSingle = vi.fn(async (): Promise<FakeResult> => this.result);

  constructor(private readonly result: FakeResult) {}

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?: ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function makeClient(products: FakeResult, images: FakeResult = { data: [], error: null }) {
  const productsQuery = new FakeQuery(products);
  const imagesQuery = new FakeQuery(images);
  const getPublicUrl = vi.fn(
    (path: string) => ({
      data: {
        publicUrl: `https://supabase.test/storage/v1/object/public/product-images/${path}`,
      },
    }),
  );
  const storageFrom = vi.fn(() => ({ getPublicUrl }));
  const from = vi.fn((table: string) => {
    if (table === "products") return productsQuery;
    if (table === "product_images") return imagesQuery;
    throw new Error(`Tabla inesperada: ${table}`);
  });

  return {
    client: { from, storage: { from: storageFrom } } as unknown as CatalogClient,
    productsQuery,
    imagesQuery,
    getPublicUrl,
    storageFrom,
  };
}

const activeA = {
  id: 2,
  slug: "torta-de-chocolate",
  name: "Torta de chocolate",
  description: "Porción de torta de chocolate.",
  price_usd: "12.50",
  is_active: true,
};
const activeB = {
  id: 1,
  slug: "brownie",
  name: "Brownie",
  description: "Brownie de cacao.",
  price_usd: 8,
  is_active: true,
};
const inactive = {
  ...activeA,
  id: 3,
  slug: "producto-inactivo",
  is_active: false,
};

describe("public catalog queries", () => {
  it("lists only active products in deterministic id order", async () => {
    const { client, productsQuery, imagesQuery } = makeClient({
      data: [activeA, inactive, activeB],
      error: null,
    });

    const products = await listActiveProducts(client);

    expect(products.map((product) => product.id)).toEqual([1, 2]);
    expect(products.map((product) => product.priceUsd)).toEqual([8, 12.5]);
    expect(productsQuery.eq).toHaveBeenCalledWith("is_active", true);
    expect(productsQuery.order).toHaveBeenCalledWith("id", { ascending: true });
    expect(imagesQuery.in).toHaveBeenCalledWith("product_id", [1, 2]);
  });

  it("treats an empty catalog as a valid empty list", async () => {
    const { client, imagesQuery } = makeClient({ data: [], error: null });

    expect(await listActiveProducts(client)).toEqual([]);
    expect(imagesQuery.in).not.toHaveBeenCalled();
  });

  it("rejects malformed rows and database errors with stable Spanish errors", async () => {
    const malformed = makeClient({
      data: [{ ...activeA, price_usd: -1 }],
      error: null,
    });
    await expect(listActiveProducts(malformed.client)).rejects.toThrow(
      catalogUnavailableError,
    );

    const broken = makeClient({
      data: null,
      error: { message: 'ERROR: relation "products" does not exist LINE 1' },
    });
    await expect(listActiveProducts(broken.client)).rejects.toThrow(
      catalogUnavailableError,
    );
  });

  it("returns null for a missing or inactive slug", async () => {
    const missing = makeClient({ data: null, error: null });
    expect(await getActiveProductBySlug(missing.client, "no-existe")).toBeNull();
    expect(missing.productsQuery.eq).toHaveBeenCalledWith("slug", "no-existe");
    expect(missing.productsQuery.eq).toHaveBeenCalledWith("is_active", true);
    expect(missing.productsQuery.maybeSingle).toHaveBeenCalledTimes(1);
    expect(missing.imagesQuery.in).not.toHaveBeenCalled();

    const hidden = makeClient({ data: inactive, error: null });
    expect(await getActiveProductBySlug(hidden.client, inactive.slug)).toBeNull();
    expect(hidden.imagesQuery.in).not.toHaveBeenCalled();
  });

  it("orders images by position and maps them to public URLs with alt text", async () => {
    const { client, imagesQuery, getPublicUrl, storageFrom } = makeClient(
      { data: activeA, error: null },
      {
        data: [
          { id: 30, product_id: 2, storage_path: "tercera.png", position: 2 },
          { id: 10, product_id: 2, storage_path: "primera.png", position: 0 },
          { id: 20, product_id: 2, storage_path: "segunda.png", position: 1 },
          { id: 40, product_id: 1, storage_path: "ajena.png", position: 0 },
        ],
        error: null,
      },
    );

    const product = await getActiveProductBySlug(client, activeA.slug);

    expect(product?.images.map((image) => image.position)).toEqual([0, 1, 2]);
    expect(product?.images.map((image) => image.url)).toEqual([
      "https://supabase.test/storage/v1/object/public/product-images/primera.png",
      "https://supabase.test/storage/v1/object/public/product-images/segunda.png",
      "https://supabase.test/storage/v1/object/public/product-images/tercera.png",
    ]);
    expect(product?.images[0].alt).toBe("Imagen 1 de Torta de chocolate");
    expect(imagesQuery.order).toHaveBeenCalledWith("position", {
      ascending: true,
    });
    expect(storageFrom).toHaveBeenCalledWith("product-images");
    expect(getPublicUrl).toHaveBeenCalledTimes(3);
    expect(getPublicUrl).toHaveBeenCalledWith("primera.png");
  });

  it("maps each listed product to only its own images in position,id order", async () => {
    const { client, getPublicUrl, imagesQuery } = makeClient(
      { data: [activeA, activeB], error: null },
      {
        data: [
          { id: 31, product_id: 1, storage_path: "brownie-tercera.png", position: 2 },
          { id: 32, product_id: 2, storage_path: "torta-tercera.png", position: 2 },
          { id: 21, product_id: 1, storage_path: "brownie-segunda.png", position: 1 },
          { id: 12, product_id: 2, storage_path: "torta-primera.png", position: 0 },
          { id: 99, product_id: 999, storage_path: "ajena.png", position: 0 },
          { id: 11, product_id: 1, storage_path: "brownie-primera.png", position: 1 },
          { id: 22, product_id: 2, storage_path: "torta-segunda.png", position: 1 },
        ],
        error: null,
      },
    );

    const products = await listActiveProducts(client);

    expect(products.map((product) => product.id)).toEqual([1, 2]);
    expect(products[0].images.map((image) => image.url)).toEqual([
      "https://supabase.test/storage/v1/object/public/product-images/brownie-primera.png",
      "https://supabase.test/storage/v1/object/public/product-images/brownie-segunda.png",
      "https://supabase.test/storage/v1/object/public/product-images/brownie-tercera.png",
    ]);
    expect(products[0].images.map((image) => [image.position, image.id])).toEqual([
      [1, 11],
      [1, 21],
      [2, 31],
    ]);
    expect(products[1].images.map((image) => image.url)).toEqual([
      "https://supabase.test/storage/v1/object/public/product-images/torta-primera.png",
      "https://supabase.test/storage/v1/object/public/product-images/torta-segunda.png",
      "https://supabase.test/storage/v1/object/public/product-images/torta-tercera.png",
    ]);
    expect(products[1].images.map((image) => [image.position, image.id])).toEqual([
      [0, 12],
      [1, 22],
      [2, 32],
    ]);
    expect(getPublicUrl).toHaveBeenCalledTimes(6);
    expect(getPublicUrl).not.toHaveBeenCalledWith("ajena.png");
    expect(imagesQuery.in).toHaveBeenCalledWith("product_id", [1, 2]);
  });

  it("maps a detail database error to productUnavailableError", async () => {
    const { client } = makeClient({
      data: null,
      error: { message: 'ERROR: relation "products" does not exist LINE 1' },
    });

    await expect(getActiveProductBySlug(client, activeA.slug)).rejects.toThrow(
      new Error(productUnavailableError),
    );
  });

  it("rejects malformed image rows without leaking SQL details", async () => {
    const { client } = makeClient(
      { data: activeA, error: null },
      {
        data: [
          {
            id: 10,
            product_id: 2,
            storage_path: "rota.png",
            position: -1,
          },
        ],
        error: null,
      },
    );

    await expect(
      getActiveProductBySlug(client, activeA.slug),
    ).rejects.toThrow(productUnavailableError);
  });
});
