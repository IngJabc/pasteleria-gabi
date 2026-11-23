import type { Metadata } from "next";
import {
  AdminBanner,
  AdminEmptyState,
  AdminPageHeader,
  AdminSectionTitle,
  AdminStatusChip,
  AdminSurface,
  AdminTable,
} from "@/components/admin/admin-ui";
import { formatCount, formatDateTime, formatMoneyUsd } from "@/features/admin/format";
import { listCancellationRequests } from "@/features/admin/cancellations";
import { listRecentRefunds } from "@/features/admin/refunds-read";
import { RefundForm } from "@/features/payments/components/refund-form";

export const metadata: Metadata = {
  title: "Cancelaciones y reembolsos | Panel administrativo",
  robots: { index: false, follow: false },
};

// The layout owns the session gate; keep the route blocking while cookies and
// the shell resolve.
export const instant = false;

function statusTone(status: string): "yellow" | "mint" | "lavender" | "rose" {
  const value = status.toLowerCase();
  if (value.includes("pending") || value.includes("pendiente")) return "yellow";
  if (
    value.includes("approved") ||
    value.includes("aprobad") ||
    value.includes("resolved") ||
    value.includes("resuelt")
  ) {
    return "mint";
  }
  if (
    value.includes("reject") ||
    value.includes("rechaz") ||
    value.includes("cancel")
  ) {
    return "rose";
  }
  return "lavender";
}

export default async function AdminCancellationsPage() {
  const [cancellations, refunds] = await Promise.all([
    listCancellationRequests(),
    listRecentRefunds(),
  ]);

  return (
    <>
      <AdminPageHeader
        title="Cancelaciones y reembolsos"
        subtitle="Revisa las solicitudes recibidas y registra devoluciones de pagos ya existentes."
      />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="grid gap-6">
          <AdminSurface className="p-5 sm:p-6">
            <AdminSectionTitle>Solicitud por revisar</AdminSectionTitle>
            <p className="mt-1 text-sm leading-6 text-muted">
              Lista de solo lectura con los datos reales de cada solicitud.
            </p>

            <div className="mt-5 space-y-4">
              {cancellations.unavailable ? (
                <AdminBanner tone="pink">
                  {cancellations.message ??
                    "No se pudieron cargar las solicitudes. Inténtalo de nuevo más tarde."}
                </AdminBanner>
              ) : cancellations.items.length === 0 ? (
                <AdminEmptyState
                  title="Sin solicitudes pendientes"
                  description="Todavía no se han registrado solicitudes de cancelación."
                />
              ) : (
                cancellations.items.map((request) => (
                  <article
                    key={request.id}
                    className="rounded-card border border-rose/60 bg-cream p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-display text-lg font-extrabold text-plum">
                          Pedido {request.orderReference}
                        </p>
                        {request.orderCustomerName ? (
                          <p className="text-sm text-muted">
                            {request.orderCustomerName}
                          </p>
                        ) : null}
                      </div>
                      <AdminStatusChip tone={statusTone(request.status)}>
                        {request.status}
                      </AdminStatusChip>
                    </div>

                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-muted">Motivo del cliente</dt>
                        <dd className="mt-0.5 text-ink">
                          {request.customerReason ?? "Sin motivo registrado"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted">Origen</dt>
                        <dd className="mt-0.5 text-ink">{request.source}</dd>
                      </div>
                      <div>
                        <dt className="text-muted">Solicitada</dt>
                        <dd className="mt-0.5 text-ink">
                          {formatDateTime(request.createdAt)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted">Resuelta</dt>
                        <dd className="mt-0.5 text-ink">
                          {formatDateTime(request.resolvedAt)}
                        </dd>
                      </div>
                    </dl>

                    {request.resolutionNote ? (
                      <p className="mt-3 text-sm leading-6 text-muted">
                        Nota de resolución: {request.resolutionNote}
                      </p>
                    ) : null}
                  </article>
                ))
              )}
            </div>

            <div className="mt-5">
              <AdminBanner tone="yellow">
                La aprobación de cancelaciones aún no está disponible. Esta
                pantalla solo consulta solicitudes; no las aprueba ni las
                rechaza.
              </AdminBanner>
            </div>
          </AdminSurface>

          <AdminBanner tone="lavender">
            <p className="font-display text-lg font-extrabold text-plum">
              Al aprobar
            </p>
            <p className="mt-2 text-sm leading-6 text-ink">
              El registro de una solicitud guarda su estado, su nota de
              resolución y la fecha en que se resolvió. Esos son los únicos
              efectos que esta pantalla puede consultar.
            </p>
            <p className="mt-2 text-sm leading-6 text-muted">
              La liberación de reservas no está conectada a ninguna acción de
              aprobación en este panel, y los reembolsos se registran por
              separado con el formulario de la derecha usando un pago ya
              existente.
            </p>
          </AdminBanner>
        </div>

        <AdminSurface className="p-5 sm:p-6">
          <AdminSectionTitle>Registrar reembolso</AdminSectionTitle>
          <p className="mt-1 text-sm leading-6 text-muted">
            La divisa y la identidad del administrador las resuelve el servidor.
          </p>
          <div className="mt-5">
            <RefundForm />
          </div>
        </AdminSurface>
      </div>

      <AdminSurface className="mt-6 p-5 sm:p-6">
        <AdminSectionTitle>Reembolsos recientes</AdminSectionTitle>
        <div className="mt-5">
          {refunds.unavailable ? (
            <AdminBanner tone="pink">{refunds.message}</AdminBanner>
          ) : refunds.items.length === 0 ? (
            <AdminEmptyState
              title="Sin reembolsos registrados"
              description="Los reembolsos que se registren aparecerán aquí con su importe, motivo y fecha reales."
            />
          ) : (
            <AdminTable
              caption="Reembolsos registrados recientemente"
              headers={[
                "Pedido",
                "Pago",
                "Monto",
                "Método",
                "Motivo",
                "Registrado",
              ]}
            >
              {refunds.items.map((refund) => (
                <tr key={refund.id}>
                  <th scope="row" className="font-bold text-ink">
                    {refund.orderReference ?? `#${refund.orderId ?? refund.paymentId}`}
                  </th>
                  <td>
                    {refund.paymentReference ?? `#${refund.paymentId}`}
                  </td>
                  <td>
                    {refund.currency === "USD"
                      ? formatMoneyUsd(refund.amount)
                      : `${formatCount(refund.amount)} ${refund.currency}`}
                  </td>
                  <td>{refund.method}</td>
                  <td>{refund.reason}</td>
                  <td>{formatDateTime(refund.createdAt)}</td>
                </tr>
              ))}
            </AdminTable>
          )}
        </div>
      </AdminSurface>
    </>
  );
}
