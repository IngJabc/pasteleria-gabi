import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import { requireActiveAdminId } from "@/features/payments/admin-session";
import {
  addProductImage,
  createProduct,
  removeProductImage,
  reorderProductImages,
  setProductActive,
  updateProduct,
} from "./admin-products";
import {
  addProductImageInputSchema,
  auditFailureError,
  duplicateSlugError,
  invalidProductInputError,
  invalidSessionError,
  priceUsdInputSchema,
  productInputSchema,
  productSlugSchema,
  reorderProductImagesInputSchema,
} from "./schemas";

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/features/payments/admin-session", () => ({
  requireActiveAdminId: vi.fn(),
}));

const ADMIN = "11111111-1111-4111-8111-111111111111";

type FakeResult = { data: unknown; error: { code?: string; message?: string } | null };

class FakeQuery implements PromiseLike<FakeResult> {
  readonly select = vi.fn(() => this);
  readonly insert = vi.fn(() => this);
  readonly update = vi.fn(() => this);
  readonly delete = vi.fn(() => this);
  readonly eq = vi.fn(() => this);
  readonly in = vi.fn(() => this);
  readonly order = vi.fn(() => this);
  readonly single = vi.fn(async (): Promise<FakeResult> => this.result);
  readonly maybeSingle = vi.fn(async (): Promise<FakeResult> => this.result);

  constructor(private readonly result: FakeResult) {}

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?: ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function makeClient(
  tableResults: Record<string, FakeResult[]>,
  storage: { upload?: FakeResult; remove?: FakeResult } = {},
) {
  const queues = new Map(
    Object.entries(tableResults).map(([table, results]) => [table, [...results]]),
  );
  const queries: Record<string, FakeQuery[]> = {};
  const from = vi.fn((table: string) => {
    const queue = queues.get(table) ?? [];
    const query = new FakeQuery(queue.shift() ?? { data: null, error: null });
    queries[table] = [...(queries[table] ?? []), query];
    return query;
  });
  const upload = vi.fn(async () => storage.upload ?? { data: { path: "p" }, error: null });
  const remove = vi.fn(async () => storage.remove ?? { data: [], error: null });
  const getPublicUrl = vi.fn((path: string) => ({
    data: { publicUrl: `https://supabase.test/storage/v1/object/public/product-images/${path}` },
  }));
  const storageFrom = vi.fn(() => ({ upload, remove, getPublicUrl }));
  return {
    client: { from, storage: { from: storageFrom } } as never,
    from,
    queries,
    upload,
    remove,
  };
}

const productRow = {
  id: 7,
  slug: "torta-fria",
  name: "Torta fría",
  description: "Porción fría",
  price_usd: 12.5,
  is_active: true,
};

function fileOf(type = "image/jpeg", size = 128): File {
  return new File([new Uint8Array(size)], "foto.jpg", { type });
}

describe("admin product schemas", () => {
  it("accepts valid product input and slug", () => {
    expect(
      productInputSchema.safeParse({
        name: "Torta fría",
        description: "Desc",
        priceUsd: 0,
        slug: "torta-fria",
        isActive: true,
      }).success,
    ).toBe(true);
    expect(productSlugSchema.safeParse("torta-fria-2").success).toBe(true);
  });

  it("rejects invalid product fields and spoofed keys", () => {
    expect(priceUsdInputSchema.safeParse(-1).success).toBe(false);
    expect(priceUsdInputSchema.safeParse(1.234).success).toBe(false);
    expect(priceUsdInputSchema.safeParse(100000000).success).toBe(false);
    expect(productSlugSchema.safeParse("Torta Fría").success).toBe(false);
    expect(
      productInputSchema.safeParse({
        name: "",
        description: "",
        priceUsd: 10,
        slug: "ok",
        isActive: true,
      }).success,
    ).toBe(false);
    expect(
      productInputSchema.safeParse({
        name: "N",
        description: "D",
        priceUsd: 10,
        slug: "ok",
        isActive: true,
        adminId: "spoofed",
      } as never).success,
    ).toBe(false);
  });

  it("validates image file input and reorder ids", () => {
    expect(addProductImageInputSchema.safeParse({ productId: 1, file: fileOf("image/png", 10) }).success).toBe(true);
    expect(addProductImageInputSchema.safeParse({ productId: 1, file: fileOf("application/pdf", 10) }).success).toBe(false);
    expect(
      addProductImageInputSchema.safeParse({
        productId: 1,
        file: fileOf("image/jpeg", 5 * 1024 * 1024 + 1),
      }).success,
    ).toBe(false);
    expect(reorderProductImagesInputSchema.safeParse({ productId: 1, orderedImageIds: [1, 1] }).success).toBe(false);
  });
});

describe("admin product actions", () => {
  beforeEach(() => {
    vi.mocked(requireActiveAdminId).mockReset();
    vi.mocked(requireActiveAdminId).mockResolvedValue(ADMIN);
    vi.mocked(createSupabaseServerClient).mockReset();
  });

  it("rejects invalid input before touching Supabase", async () => {
    const result = await createProduct({
      name: "",
      description: "",
      priceUsd: -1,
      slug: "Bad Slug",
      isActive: true,
    } as never);
    expect(result).toEqual({ ok: false, error: invalidProductInputError });
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("rejects invalid session without writes", async () => {
    vi.mocked(requireActiveAdminId).mockRejectedValue(new Error("bad session"));
    const result = await createProduct({
      name: "Torta",
      description: "Desc",
      priceUsd: 10,
      slug: "torta",
      isActive: true,
    });
    expect(result).toEqual({ ok: false, error: invalidSessionError });
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("creates a product and writes a self-attributed audit row", async () => {
    const { client, queries } = makeClient({
      products: [{ data: productRow, error: null }, { data: [productRow], error: null }],
      product_images: [{ data: [], error: null }],
      audit_log: [{ data: null, error: null }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client);

    const result = await createProduct({
      name: "Torta fría",
      description: "Porción fría",
      priceUsd: 12.5,
      slug: "torta-fria",
      isActive: true,
    });

    expect(result.ok).toBe(true);
    const insert = (queries.products[0]!.insert.mock.calls as unknown[][])[0]?.[0];
    expect(insert).toMatchObject({ slug: "torta-fria", is_active: true });
    expect(insert).not.toHaveProperty("id");
    expect(queries.audit_log[0]!.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        admin_id: ADMIN,
        action: "product.create",
        entity_type: "product",
        entity_id: "7",
      }),
    );
  });

  it("maps duplicate slug to a stable Spanish error", async () => {
    const { client } = makeClient({
      products: [{ data: null, error: { code: "23505", message: "products_slug_key" } }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client);
    const result = await createProduct({
      name: "Torta",
      description: "Desc",
      priceUsd: 10,
      slug: "torta",
      isActive: true,
    });
    expect(result).toEqual({ ok: false, error: duplicateSlugError });
  });

  it("returns audit failure message when audit insert fails after mutation", async () => {
    const { client } = makeClient({
      products: [{ data: productRow, error: null }],
      audit_log: [{ data: null, error: { message: "audit failed" } }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client);
    const result = await createProduct({
      name: "Torta fría",
      description: "Porción fría",
      priceUsd: 12.5,
      slug: "torta-fria",
      isActive: true,
    });
    expect(result).toEqual({ ok: false, error: auditFailureError });
  });
});

describe("product image and reorder actions", () => {
  beforeEach(() => {
    vi.mocked(requireActiveAdminId).mockReset();
    vi.mocked(requireActiveAdminId).mockResolvedValue(ADMIN);
    vi.mocked(createSupabaseServerClient).mockReset();
  });

  it("removes storage object if image row insert fails (orphan cleanup)", async () => {
    const { client, remove } = makeClient(
      {
        products: [{ data: { id: 7 }, error: null }],
        product_images: [
          { data: [], error: null },
          { data: null, error: { message: "insert failed" } },
        ],
      },
      { upload: { data: { path: "x" }, error: null } },
    );
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client);
    const result = await addProductImage({ productId: 7, file: fileOf("image/jpeg", 32) });
    expect(result.ok).toBe(false);
    expect(remove).toHaveBeenCalledTimes(1);
    const removedPath = ((remove.mock.calls as unknown[][][])[0]?.[0] as string[] | undefined)?.[0] as string;
    expect(removedPath).toMatch(/^7\/.+\.jpg$/);
  });

  it("deletes row before storage and still audits on best-effort storage failure", async () => {
    const { client, queries, remove } = makeClient(
      {
        product_images: [
          { data: { id: 3, product_id: 7, storage_path: "7/a.jpg", position: 0 }, error: null },
          { data: null, error: null },
          { data: [], error: null },
        ],
        products: [{ data: [productRow], error: null }],
        audit_log: [{ data: null, error: null }],
      },
      { remove: { data: null, error: { message: "storage fail" } } },
    );
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client);
    const result = await removeProductImage({ productId: 7, imageId: 3 });
    expect(result.ok).toBe(true);
    expect(queries.product_images[1].delete).toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith(["7/a.jpg"]);
    expect(queries.audit_log[0]!.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: "product.image_remove", admin_id: ADMIN }),
    );
  });

  it("rejects reorder with foreign/unknown image ids before writing", async () => {
    const { client, queries } = makeClient({
      product_images: [{ data: [{ id: 1, position: 0 }, { id: 2, position: 1 }], error: null }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client);
    const result = await reorderProductImages({ productId: 7, orderedImageIds: [2, 999] });
    expect(result).toEqual({ ok: false, error: invalidProductInputError });
    expect(queries.product_images[0].update).not.toHaveBeenCalled();
  });
});

  it("updates a product and writes before/after audit", async () => {
    const updated = { ...productRow, name: "Nuevo", slug: "nuevo" };
    const { client, queries } = makeClient({
      products: [
        { data: productRow, error: null },
        { data: updated, error: null },
        { data: [updated], error: null },
      ],
      product_images: [{ data: [], error: null }],
      audit_log: [{ data: null, error: null }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client);
    const result = await updateProduct({
      productId: 7,
      name: "Nuevo",
      description: "Porción fría",
      priceUsd: 12.5,
      slug: "nuevo",
      isActive: true,
    });
    expect(result.ok).toBe(true);
    expect(queries.audit_log[0]!.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: "product.update", admin_id: ADMIN }),
    );
  });

  it("activates/deactivates and writes audit", async () => {
    const deactivated = { ...productRow, is_active: false };
    const { client, queries } = makeClient({
      products: [
        { data: productRow, error: null },
        { data: deactivated, error: null },
        { data: [deactivated], error: null },
      ],
      product_images: [{ data: [], error: null }],
      audit_log: [{ data: null, error: null }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client);
    const result = await setProductActive({ productId: 7, isActive: false });
    expect(result.ok).toBe(true);
    expect(queries.audit_log[0]!.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "product.update",
        data: { before: { is_active: true }, after: { is_active: false } },
      }),
    );
  });
