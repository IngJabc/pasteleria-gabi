import Link from "next/link";
import {
  AdminEmptyState,
  AdminPageHeader,
  AdminSectionTitle,
  AdminStatCard,
  AdminStatusChip,
  AdminSurface,
  AdminTable,
} from "@/components/admin/admin-ui";
import {
  Button,
  Field,
  Input,
  buttonSecondaryClass,
  inputClass,
} from "@/components/ui/ui";
import { formatCount, formatDateTime, formatMoneyUsd } from "@/features/admin/format";
import {
  listAdminOrders,
  type AdminOrderListPaymentStatus,
  type AdminOrderListReservationStatus,
} from "@/features/admin/orders";

// The layout owns the session gate; keep the filtered queue blocking.
export const instant = false;

type ChipTone = "yellow" | "mint" | "lavender" | "rose";

const STATUSES = ["pending", "confirmed", "ready", "completed", "canceled", "expired"] as const;
type StatusValue = (typeof STATUSES)[number];

/** Spanish labels and pastel tones derived from real order status values. */
const statusViews: Record<StatusValue, { label: string; tone: ChipTone }> = {
  pending: { label: "Pendiente", tone: "yellow" },
  confirmed: { label: "Confirmado", tone: "mint" },
  ready: { label: "Listo", tone: "lavender" },
  completed: { label: "Completado", tone: "mint" },
  canceled: { label: "Cancelado", tone: "rose" },
  expired: { label: "Vencido", tone: "rose" },
};

function statusView(status: string): { label: string; tone: ChipTone } {
  return (
    statusViews[status as StatusValue] ?? {
      label: status.trim() !== "" ? status : "Sin estado",
      tone: "lavender",
    }
  );
}

function paymentView(status: AdminOrderListPaymentStatus): { label: string; tone: ChipTone } {
  switch (status) {
    case "none":
      return { label: "Sin pagos", tone: "lavender" };
    case "pending":
      return { label: "Pendiente", tone: "yellow" };
    case "in_review":
      return { label: "En revisión", tone: "yellow" };
    case "approved":
      return { label: "Aprobado", tone: "mint" };
    case "rejected":
      return { label: "Rechazado", tone: "rose" };
    case "refunded_partial":
      return { label: "Reembolso parcial", tone: "lavender" };
    case "refunded_full":
      return { label: "Reembolsado", tone: "lavender" };
    case "mixed":
      return { label: "Mixto", tone: "lavender" };
    case "unavailable":
    default:
      return { label: "No disponible", tone: "lavender" };
  }
}

function deliveryView(order: {
  fulfillmentType: string | null;
  deliveryFeeUsd: number | null;
  deliveryZoneRequiresQuote: boolean | null;
}): { label: string; tone: ChipTone } {
  if (order.fulfillmentType === "pickup") return { label: "Retiro", tone: "mint" };
  if (order.fulfillmentType === "delivery") {
    if (order.deliveryZoneRequiresQuote === true && order.deliveryFeeUsd === null) {
      return { label: "Por cotizar", tone: "yellow" };
    }
    return { label: "Delivery", tone: "lavender" };
  }
  if (order.fulfillmentType) return { label: order.fulfillmentType, tone: "lavender" };
  return { label: "—", tone: "lavender" };
}

function reservationView(status: AdminOrderListReservationStatus): { label: string; tone: ChipTone } {
  switch (status) {
    case "none":
      return { label: "Sin reserva", tone: "lavender" };
    case "active":
      return { label: "Activa", tone: "mint" };
    case "held":
      return { label: "Retenida", tone: "yellow" };
    case "expired":
      return { label: "Vencida", tone: "rose" };
    case "consumed":
      return { label: "Consumida", tone: "lavender" };
    case "released":
      return { label: "Liberada", tone: "lavender" };
    case "mixed":
      return { label: "Mixta", tone: "lavender" };
    case "unavailable":
    default:
      return { label: "No disponible", tone: "lavender" };
  }
}

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function parsePage(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

/** Preserves the active filters across status links and pagination. */
function buildHref(filters: { q: string; status: string; page: number }): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  if (filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString();
  return query ? `/admin/pedidos?${query}` : "/admin/pedidos";
}

/** A short, bounded page window so the pager stays usable on large queues. */
function pageWindow(current: number, total: number): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const candidates = [1, total, current - 1, current, current + 1];
  const pages = [...new Set(candidates)]
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b);

  const result: Array<number | "ellipsis"> = [];
  pages.forEach((page, index) => {
    if (index > 0 && page - pages[index - 1] > 1) result.push("ellipsis");
    result.push(page);
  });
  return result;
}

const filterLinkClass =
  "inline-flex min-h-10 items-center rounded-full px-4 py-2 font-display text-sm font-bold text-ink transition-colors hover:bg-rose aria-[current=page]:bg-pink-soft aria-[current=page]:text-plum";
const pageLinkClass =
  "inline-flex min-h-10 min-w-10 items-center justify-center rounded-full px-3 font-display text-sm font-bold text-ink transition-colors hover:bg-rose aria-[current=page]:bg-pink-soft aria-[current=page]:text-plum";

/** Pedidos: server-filtered queue, honest placeholders for absent fields. */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const query = await searchParams;
  const q = firstValue(query.q);
  const requestedStatus = firstValue(query.status);
  const status = (STATUSES as readonly string[]).includes(requestedStatus) ? requestedStatus : "";
  const page = parsePage(firstValue(query.page));

  const result = await listAdminOrders({
    search: q || undefined,
    status: status || undefined,
    page,
  });

  // Counts are derived exclusively from the returned page rows; the caption
  // below states that scope so no global total is implied.
  const items = result.items;
  const activeCount = items.filter((item) =>
    ["pending", "confirmed", "ready"].includes(item.status),
  ).length;
  const pendingCount = items.filter((item) => item.status === "pending").length;
  const reservedCount = items.filter((item) => item.status === "confirmed").length;
  const readyCount = items.filter((item) => item.status === "ready").length;
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Pedidos"
        subtitle="Organiza cada antojo, desde la reserva hasta la entrega."
        action={
          <Button
            disabled
            title="La creación manual de pedidos aún no está disponible."
          >
            Nuevo pedido
          </Button>
        }
      />

      {result.unavailable ? (
        <AdminEmptyState
          title="No pudimos cargar los pedidos"
          description={result.message ?? "No se pudieron cargar los datos. Inténtalo de nuevo más tarde."}
        />
      ) : (
        <>
          <section aria-label="Resumen de la lista" className="space-y-2">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <AdminStatCard label="Total activos" value={formatCount(activeCount)} tone="pink" />
              <AdminStatCard label="Por verificar" value={formatCount(pendingCount)} tone="yellow" />
              <AdminStatCard label="Reservas activas" value={formatCount(reservedCount)} tone="lavender" />
              <AdminStatCard label="Listos para entregar" value={formatCount(readyCount)} tone="mint" />
            </div>
            <p className="text-xs text-muted">
              Conteos de la página actual · {formatCount(result.total)} pedidos coinciden con los
              filtros.
            </p>
          </section>

          <AdminSurface>
            <form
              method="get"
              action="/admin/pedidos"
              className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_auto] sm:items-end"
            >
              <Field id="orders-search" label="Buscar pedido">
                <Input
                  id="orders-search"
                  name="q"
                  defaultValue={q}
                  placeholder="Nombre, teléfono o número"
                />
              </Field>
              <Field id="orders-status" label="Estado">
                <select
                  id="orders-status"
                  name="status"
                  className={inputClass}
                  defaultValue={status}
                >
                  <option value="">Todos</option>
                  {STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {statusViews[value].label}
                    </option>
                  ))}
                </select>
              </Field>
              <Button type="submit" variant="secondary">
                Buscar
              </Button>
            </form>
          </AdminSurface>

          {/* Filter state lives in the URL; these are navigation links, not tabs. */}
          <nav aria-label="Filtrar pedidos por estado" className="flex flex-wrap gap-2">
            <Link
              href={buildHref({ q, status: "", page: 1 })}
              className={filterLinkClass}
              aria-current={status === "" ? "page" : undefined}
            >
              Todos
            </Link>
            {STATUSES.map((value) => (
              <Link
                key={value}
                href={buildHref({ q, status: value, page: 1 })}
                className={filterLinkClass}
                aria-current={status === value ? "page" : undefined}
              >
                {statusViews[value].label}
              </Link>
            ))}
          </nav>

          {items.length === 0 ? (
            <AdminEmptyState
              title="No hay pedidos"
              description="No encontramos pedidos con los filtros actuales."
              action={
                <Link href="/admin/pedidos" className={buttonSecondaryClass}>
                  Ver todos los pedidos
                </Link>
              }
            />
          ) : (
            <AdminSurface>
              <AdminSectionTitle>Lista de pedidos</AdminSectionTitle>
              <div className="mt-4">
                <AdminTable
                  caption="Pedidos administrativos"
                  headers={["Pedido", "Fecha", "Cliente", "Total USD", "Pago", "Entrega", "Reserva"]}
                >
                  {items.map((order) => {
                    const view = statusView(order.status);
                    const payment = paymentView(order.paymentStatus);
                    const delivery = deliveryView(order);
                    const reservation = reservationView(order.reservationStatus);
                    return (
                      <tr key={order.id}>
                        <th scope="row">
                          <Link
                            href={`/admin/pedidos/${order.id}`}
                            className="font-display font-bold text-pink underline-offset-4 hover:underline"
                          >
                            {order.reference}
                          </Link>
                          <span className="mt-2 block">
                            <AdminStatusChip tone={view.tone}>{view.label}</AdminStatusChip>
                          </span>
                        </th>
                        <td className="whitespace-nowrap text-sm text-muted">{formatDateTime(order.createdAt)}</td>
                        <td>{order.customerName ?? "—"}</td>
                        <td className="font-bold text-ink">{formatMoneyUsd(order.totalUsd)}</td>
                        <td><AdminStatusChip tone={payment.tone}>{payment.label}</AdminStatusChip></td>
                        <td><AdminStatusChip tone={delivery.tone}>{delivery.label}</AdminStatusChip></td>
                        <td><AdminStatusChip tone={reservation.tone}>{reservation.label}</AdminStatusChip></td>
                      </tr>
                    );
                  })}
                </AdminTable>
              </div>
            </AdminSurface>
          )}

          {totalPages > 1 ? (
            <nav aria-label="Paginación de pedidos" className="flex flex-wrap items-center justify-center gap-2">
              {page > 1 ? (
                <Link
                  href={buildHref({ q, status, page: page - 1 })}
                  className={buttonSecondaryClass}
                  aria-label="Página anterior"
                >
                  Anterior
                </Link>
              ) : (
                <Button variant="secondary" disabled>
                  Anterior
                </Button>
              )}
              {pageWindow(page, totalPages).map((entry, index) =>
                entry === "ellipsis" ? (
                  <span key={`ellipsis-${index}`} className="px-2 text-muted" aria-hidden="true">
                    …
                  </span>
                ) : (
                  <Link
                    key={entry}
                    href={buildHref({ q, status, page: entry })}
                    className={pageLinkClass}
                    aria-current={entry === page ? "page" : undefined}
                    aria-label={`Página ${entry}`}
                  >
                    {entry}
                  </Link>
                ),
              )}
              {page < totalPages ? (
                <Link
                  href={buildHref({ q, status, page: page + 1 })}
                  className={buttonSecondaryClass}
                  aria-label="Página siguiente"
                >
                  Siguiente
                </Link>
              ) : (
                <Button variant="secondary" disabled>
                  Siguiente
                </Button>
              )}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
