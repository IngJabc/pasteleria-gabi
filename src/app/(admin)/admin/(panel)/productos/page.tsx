import type { Metadata } from "next";
import {
  AdminBanner,
  AdminEmptyState,
  AdminPageHeader,
  AdminSectionTitle,
  AdminSurface,
} from "@/components/admin/admin-ui";
import {
  catalogUnavailableError,
  listAdminProducts,
} from "@/features/catalog/queries";
import { AdminProductList } from "@/features/catalog/components/admin-product-list";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";

export const metadata: Metadata = {
  title: "Productos | Panel administrativo",
  robots: { index: false, follow: false },
};

// The layout owns the session gate; keep this route blocking while cookies and
// the admin shell resolve so no static shell can expose the controls early.
export const instant = false;

export default async function AdminProductsPage() {
  // Data loading and error handling are unchanged: the session-bound client is
  // still the only way this page reads the catalog.
  let products: Awaited<ReturnType<typeof listAdminProducts>> = [];
  let loadError: string | null = null;
  try {
    products = await listAdminProducts(await createSupabaseServerClient());
  } catch {
    loadError = catalogUnavailableError;
  }

  const activeCount = products.filter((product) => product.isActive).length;

  return (
    <>
      <AdminPageHeader
        title="Nuestros productos"
        subtitle="Cuida cada detalle de lo que se ve y se antoja en la tienda."
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <AdminSurface className="p-5 sm:p-6">
          {loadError ? (
            <AdminBanner tone="pink">{loadError}</AdminBanner>
          ) : (
            <AdminProductList initialProducts={products} />
          )}
        </AdminSurface>

        <div className="grid gap-6">
          <AdminSurface className="p-5">
            <AdminSectionTitle>En el catálogo</AdminSectionTitle>
            <dl className="mt-4 grid gap-3 text-sm">
              <div className="flex items-center justify-between gap-3 rounded-field border border-rose/60 bg-cream px-4 py-3">
                <dt className="text-muted">Productos registrados</dt>
                <dd className="font-display text-xl font-extrabold text-plum">
                  {loadError ? "—" : products.length}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-field border border-mint bg-mint/60 px-4 py-3">
                <dt className="text-muted">Visibles en la tienda</dt>
                <dd className="font-display text-xl font-extrabold text-plum">
                  {loadError ? "—" : activeCount}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-sm leading-6 text-muted">
              Los precios y la visibilidad se validan en el servidor antes de
              publicarse.
            </p>
          </AdminSurface>

          {!loadError && products.length === 0 ? (
            <AdminEmptyState
              title="El catálogo está vacío"
              description="Aún no hay productos registrados. Usa «Nuevo producto» para agregar el primero; aparecerá en la tienda al activarlo."
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
