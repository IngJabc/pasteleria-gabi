import type { Metadata } from "next";
import {
  AdminBanner,
  AdminEmptyState,
  AdminPageHeader,
  AdminSectionTitle,
  AdminStatCard,
  AdminSurface,
  AdminTable,
} from "@/components/admin/admin-ui";
import {
  formatCount,
  formatDate,
  formatDateTime,
} from "@/features/admin/format";
import {
  adjustInventory,
  createInventoryBatch,
  listInventoryBatches,
  listInventoryMovements,
} from "@/features/admin/inventory";
import {
  AdjustInventoryForm,
  CreateInventoryBatchForm,
} from "@/features/admin/components/ops/inventory-actions";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";

export const metadata: Metadata = {
  title: "Inventario FIFO | Panel administrativo",
  robots: { index: false, follow: false },
};

// The layout owns the session gate; keep the route blocking while cookies and
// the shell resolve.
export const instant = false;

const MAX_PRODUCT_OPTIONS = 200;

type ProductOption = { id: number; name: string };

/** Real, bounded product id/name options from the cookie-bound session client. */
async function listBatchProducts(): Promise<ProductOption[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("products")
      .select("id, name")
      .order("name", { ascending: true })
      .limit(MAX_PRODUCT_OPTIONS);
    if (error || !data) return [];

    const options: ProductOption[] = [];
    for (const row of data) {
      if (
        typeof row.id === "number" &&
        Number.isInteger(row.id) &&
        row.id > 0 &&
        typeof row.name === "string" &&
        row.name.trim().length > 0
      ) {
        options.push({ id: row.id, name: row.name });
      }
    }
    return options;
  } catch {
    return [];
  }
}

export default async function AdminInventoryPage() {
  const [inventory, movements, products] = await Promise.all([
    listInventoryBatches(),
    listInventoryMovements(),
    listBatchProducts(),
  ]);

  const batchOptions = inventory.items.map((item) => ({
    batchId: item.batchId,
    label: `${item.productName ?? `Producto #${item.productId}`} · Lote #${item.batchId}`,
  }));

  const reservedLabel =
    inventory.unavailable || inventory.summary.reservedUnits === null
      ? "—"
      : formatCount(inventory.summary.reservedUnits);
  const availableLabel =
    inventory.unavailable || inventory.summary.availableUnits === null
      ? "—"
      : formatCount(inventory.summary.availableUnits);

  return (
    <>
      <AdminPageHeader
        title="Inventario FIFO"
        subtitle="Registra lotes y ajusta existencias respetando el orden de producción."
      />

      {inventory.unavailable ? (
        <div className="mb-6">
          <AdminBanner tone="pink">{inventory.message}</AdminBanner>
        </div>
      ) : null}

      <section aria-label="Resumen de inventario" className="grid gap-4 sm:grid-cols-3">
        <AdminStatCard
          label="Unidades físicas"
          value={
            inventory.unavailable ? "—" : formatCount(inventory.summary.totalUnits)
          }
          caption="Suma de las existencias listadas"
          tone="mint"
        />
        <AdminStatCard
          label="Unidades reservadas"
          value={reservedLabel}
          caption="Reservas activas por lote"
          tone="mint"
        />
        <AdminStatCard
          label="Unidades libres"
          value={availableLabel}
          caption="Disponibles para nuevas ventas"
          tone="mint"
        />
      </section>

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-6">
          <AdminSurface className="p-5 sm:p-6">
            <AdminSectionTitle>Lotes activos</AdminSectionTitle>
            <p className="mt-1 text-sm leading-6 text-muted">
              Orden FIFO real por fecha de producción y número de lote. La fecha
              de producción es visible solo en este panel.
            </p>
            <div className="mt-5">
              {inventory.unavailable ? (
                <AdminEmptyState
                  title="Inventario no disponible"
                  description="No fue posible consultar los lotes. Inténtalo de nuevo más tarde."
                />
              ) : inventory.items.length === 0 ? (
                <AdminEmptyState
                  title="Aún no hay lotes"
                  description="Registra tu primer lote desde el formulario para comenzar a controlar las existencias."
                />
              ) : (
                <AdminTable
                  caption="Lotes de inventario en orden FIFO"
                  headers={[
                    "Producto",
                    "Lote",
                    "Producción",
                    "Físico",
                    "Reserva",
                    "Libre",
                    "FIFO",
                  ]}
                >
                  {inventory.items.map((item, index) => (
                    <tr key={item.batchId}>
                      <th scope="row" className="font-bold text-ink">
                        {item.productName ?? `Producto #${item.productId}`}
                      </th>
                      <td>#{item.batchId}</td>
                      <td>{formatDate(item.productionDate)}</td>
                      <td>{formatCount(item.remainingQuantity)}</td>
                      <td>
                        {item.reservedUnits === null
                          ? "—"
                          : formatCount(item.reservedUnits)}
                      </td>
                      <td>
                        {item.availableUnits === null
                          ? "—"
                          : formatCount(item.availableUnits)}
                      </td>
                      <td>{formatCount(index + 1)}</td>
                    </tr>
                  ))}
                </AdminTable>
              )}
            </div>
          </AdminSurface>

          <AdminSurface className="p-5 sm:p-6">
            <AdminSectionTitle>Movimientos recientes</AdminSectionTitle>
            <div className="mt-5">
              {movements.unavailable ? (
                <AdminBanner tone="pink">{movements.message}</AdminBanner>
              ) : movements.items.length === 0 ? (
                <AdminEmptyState
                  title="Sin movimientos registrados"
                  description="Los ajustes y altas de lote aparecerán aquí con su motivo y fecha reales."
                />
              ) : (
                <AdminTable
                  caption="Movimientos recientes de inventario"
                  headers={["Lote", "Tipo", "Cantidad", "Motivo", "Fecha"]}
                >
                  {movements.items.map((movement) => (
                    <tr key={movement.id}>
                      <th scope="row" className="font-bold text-ink">
                        #{movement.batchId}
                      </th>
                      <td>{movement.type}</td>
                      <td>{formatCount(movement.quantity)}</td>
                      <td>{movement.reason ?? "—"}</td>
                      <td>{formatDateTime(movement.createdAt)}</td>
                    </tr>
                  ))}
                </AdminTable>
              )}
            </div>
          </AdminSurface>
        </div>

        <div className="grid gap-6">
          <AdminSurface className="p-5">
            <AdminSectionTitle>Ajustar existencias</AdminSectionTitle>
            <p className="mt-1 text-sm leading-6 text-muted">
              El ajuste se registra como un movimiento con motivo. Un número
              negativo descuenta unidades del lote elegido.
            </p>
            <div className="mt-4">
              {batchOptions.length === 0 ? (
                <AdminEmptyState
                  title="No hay lotes para ajustar"
                  description="Registra un lote antes de aplicar un ajuste de existencias."
                />
              ) : (
                <AdjustInventoryForm
                  batches={batchOptions}
                  adjustAction={adjustInventory}
                />
              )}
            </div>
          </AdminSurface>

          <AdminSurface className="p-5">
            <AdminSectionTitle>Registrar lote</AdminSectionTitle>
            <p className="mt-1 text-sm leading-6 text-muted">
              Se agrega al final del orden FIFO del producto seleccionado.
            </p>
            <div className="mt-4">
              {products.length === 0 ? (
                <AdminEmptyState
                  title="No hay productos disponibles"
                  description="Crea un producto en el catálogo antes de registrar un lote de inventario."
                />
              ) : (
                <CreateInventoryBatchForm
                  products={products}
                  createAction={createInventoryBatch}
                />
              )}
            </div>
          </AdminSurface>

          <AdminBanner tone="lavender">
            <p className="font-display text-lg font-extrabold text-plum">
              Reserva sin perder el control
            </p>
            <p className="mt-2 text-sm leading-6 text-ink">
              Las reservas activas se descuentan de las unidades libres de cada
              lote. En este inventario hay {reservedLabel} unidades reservadas y{" "}
              {availableLabel} libres.
            </p>
            <p className="mt-2 text-sm leading-6 text-muted">
              Los lotes registran fecha de producción, no fecha de vencimiento;
              no hay vencimientos disponibles para mostrar.
            </p>
          </AdminBanner>
        </div>
      </div>
    </>
  );
}
