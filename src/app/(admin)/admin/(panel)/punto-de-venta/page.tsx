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
  listActiveProducts,
} from "@/features/catalog/queries";
import { PosSaleForm, type PosProduct } from "@/features/payments/components/pos-sale-form";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";

export const metadata: Metadata = {
  title: "Punto de venta | Panel administrativo",
  robots: { index: false, follow: false },
};

// The session gate reads request cookies; keep the panel blocking so no static
// shell can expose controls before authorization resolves.
export const instant = false;

export default async function AdminPosPage() {
  let products: PosProduct[] = [];
  let catalogError: string | null = null;

  try {
    const catalog = await listActiveProducts(await createSupabaseServerClient());
    products = catalog.map(({ id, name, priceUsd }) => ({
      id,
      name,
      priceUsd: priceUsd.toFixed(2),
    }));
  } catch {
    // Only the public Spanish message is rendered; no infrastructure detail.
    catalogError = catalogUnavailableError;
  }

  return (
    <>
      <AdminPageHeader
        title="Un antojo, al instante"
        subtitle="Punto de venta · Venta en mostrador · Salida FIFO"
      />

      <div className="mb-6">
        <AdminBanner tone="lavender">
          Los pagos combinados aún no están disponibles; el POS registra ventas
          en efectivo USD.
        </AdminBanner>
      </div>

      {catalogError ? (
        <div className="mb-6">
          <AdminBanner tone="yellow">{catalogError}</AdminBanner>
        </div>
      ) : null}

      {products.length === 0 ? (
        <AdminEmptyState
          title="El catálogo aún no tiene productos activos."
          description="No se puede registrar una venta hasta que existan productos activos con precio. El catálogo se administra desde Productos."
        />
      ) : (
        <AdminSurface>
          <div className="mb-6">
            <div id="pos-heading">
              <AdminSectionTitle>Venta en efectivo</AdminSectionTitle>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted">
              Indica las unidades que se entregan y el monto recibido. Los
              precios, el total y el vuelto los recalcula el servidor.
            </p>
          </div>
          <PosSaleForm products={products} />
        </AdminSurface>
      )}
    </>
  );
}
