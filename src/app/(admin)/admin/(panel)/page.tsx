import Link from "next/link";
import {
  AdminBanner,
  AdminEmptyState,
  AdminPageHeader,
  AdminSectionTitle,
  AdminStatCard,
  AdminStatusChip,
  AdminSurface,
  AdminTable,
} from "@/components/admin/admin-ui";
import { buttonPrimaryClass } from "@/components/ui/ui";
import { formatCount, formatDateTime, formatMoneyUsd } from "@/features/admin/format";
import { getAdminOverview } from "@/features/admin/overview";

// The admin layout owns the session gate. Keep this segment blocking so no
// static dashboard shell can render before authorization resolves.
export const instant = false;

/** Resumen: only server-derived overview values; no illustration data. */
export default async function AdminHomePage() {
  const overview = await getAdminOverview();
  const { kpis, recentOrders, attention } = overview;

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Resumen"
        subtitle="Así va tu atelier hoy. Cada pedido, una pequeña alegría."
        action={
          <Link href="/admin/punto-de-venta" className={buttonPrimaryClass}>
            Abrir punto de venta
          </Link>
        }
      />

      {overview.unavailable ? (
        <div className="space-y-5">
          <AdminBanner tone="yellow">
            <p className="font-display font-bold text-plum">Resumen no disponible</p>
            <p className="mt-1 text-sm text-muted">
              {overview.message ?? "No se pudieron cargar los datos del atelier."}
            </p>
          </AdminBanner>
          <AdminEmptyState
            title="Sin datos para mostrar"
            description="Vuelve a intentarlo más tarde para ver las cifras y los pedidos recientes."
          />
        </div>
      ) : (
        <>
          <section aria-label="Indicadores del día" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <AdminStatCard
              label="Ventas de hoy"
              value={formatMoneyUsd(kpis.todaySalesUsd)}
              caption="Pagos aprobados en USD de hoy"
              tone="pink"
            />
            <AdminStatCard
              label="Pedidos activos"
              value={formatCount(kpis.activeOrders)}
              tone="lavender"
            />
            <AdminStatCard
              label="Por verificar"
              value={formatCount(kpis.pendingVerification)}
              tone="yellow"
            />
            <AdminStatCard
              label="Stock disponible"
              value={formatCount(kpis.availableStock)}
              caption="Unidades listas para la venta"
              tone="mint"
            />
          </section>

          <div className="grid gap-5 lg:grid-cols-3">
            <AdminSurface className="lg:col-span-2">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <AdminSectionTitle>Recién llegados</AdminSectionTitle>
                <Link
                  href="/admin/pedidos"
                  className="font-display text-sm font-bold text-pink underline-offset-4 hover:underline"
                >
                  Ver todos
                </Link>
              </div>
              {recentOrders.length === 0 ? (
                <AdminEmptyState
                  title="Aún no hay pedidos"
                  description="Cuando llegue el primer pedido, aparecerá aquí."
                />
              ) : (
                <>
                  <AdminTable
                    caption="Pedidos recientes"
                    headers={["Pedido", "Fecha", "Cliente", "Pago", "Total USD"]}
                  >
                    {recentOrders.map((order) => (
                      <tr key={order.id}>
                        <th scope="row" className="font-display font-bold text-plum">
                          <Link
                            href={`/admin/pedidos/${order.id}`}
                            className="text-pink underline-offset-4 hover:underline"
                          >
                            {order.reference}
                          </Link>
                        </th>
                        <td className="whitespace-nowrap text-sm text-muted">{formatDateTime(order.createdAt)}</td>
                        <td>{order.customerName ?? "—"}</td>
                        <td>
                          <AdminStatusChip
                            tone={
                              order.paymentStatus === "approved"
                                ? "mint"
                                : order.paymentStatus === "rejected" || order.paymentStatus === "refunded_full"
                                  ? "rose"
                                  : order.paymentStatus === "in_review" || order.paymentStatus === "pending"
                                    ? "yellow"
                                    : "lavender"
                            }
                          >
                            {(
                              {
                                none: "Sin pagos",
                                pending: "Pendiente",
                                in_review: "En revisión",
                                approved: "Aprobado",
                                rejected: "Rechazado",
                                refunded_partial: "Reembolso parcial",
                                refunded_full: "Reembolsado",
                                mixed: "Mixto",
                                unavailable: "No disponible",
                              } as Record<string, string>
                            )[order.paymentStatus] ?? order.paymentStatus}
                          </AdminStatusChip>
                        </td>
                        <td className="font-bold text-ink">{formatMoneyUsd(order.totalUsd)}</td>
                      </tr>
                    ))}
                  </AdminTable>
                  <p className="mt-3 text-xs text-muted">
                    Resumen de pagos de los pedidos recientes.
                  </p>
                </>
              )}
            </AdminSurface>

            <AdminBanner tone="lavender">
              <AdminSectionTitle>Tu atención, por favor</AdminSectionTitle>
              <dl className="mt-4 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-sm text-muted">Comprobantes nuevos</dt>
                  <dd className="font-display text-2xl font-extrabold text-plum">
                    {formatCount(attention.pendingReceipts)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-sm text-muted">Solicitudes de cancelación</dt>
                  <dd className="font-display text-2xl font-extrabold text-plum">
                    {formatCount(attention.pendingCancellations)}
                  </dd>
                </div>
              </dl>
              <p className="mt-4 text-xs text-muted">Pendientes de revisión en el atelier.</p>
            </AdminBanner>
          </div>

          <AdminSurface>
            <AdminSectionTitle>Todo listo para el próximo antojo</AdminSectionTitle>
            <p className="mt-3 leading-7 text-muted">
              Hay {formatCount(kpis.availableStock)} unidades disponibles para la venta entre los
              productos activos.
            </p>
          </AdminSurface>
        </>
      )}
    </div>
  );
}
