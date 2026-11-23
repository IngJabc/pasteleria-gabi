import type { Metadata } from "next";
import Link from "next/link";
import {
  AdminBanner,
  AdminEmptyState,
  AdminPageHeader,
  AdminSectionTitle,
  AdminStatusChip,
  AdminSurface,
  AdminTable,
} from "@/components/admin/admin-ui";
import {
  Button,
  buttonPrimaryClass,
  buttonSecondaryClass,
} from "@/components/ui/ui";
import {
  formatCount,
  formatDateTime,
  formatMoneyUsd,
} from "@/features/admin/format";
import { CopyQuoteMessageButton } from "@/features/admin/components/orders/copy-quote-message-button";
import { DeliveryQuoteForm } from "@/features/admin/components/orders/delivery-quote-form";
import { OrderStatusAction } from "@/features/admin/components/orders/order-status-action";
import {
  formatReportedAmount,
  paymentMethodLabel,
  paymentStatusLabel,
} from "@/features/admin/components/payments/payment-display";
import {
  getAdminOrderDetail,
  type AdminOrderDetail,
  type AdminPaymentSummaryView,
} from "@/features/admin/orders";

export const metadata: Metadata = {
  title: "Detalle de pedido | Panel administrativo",
  robots: { index: false, follow: false },
};

// The admin layout owns the fail-closed session gate; keep this route blocking.
export const instant = false;

type ChipTone = "yellow" | "mint" | "lavender" | "rose";

/** Spanish labels and pastel tones derived from REAL order status values. */
const STATUS_VIEWS: Record<string, { label: string; tone: ChipTone }> = {
  pending: { label: "Pendiente", tone: "yellow" },
  confirmed: { label: "Confirmado", tone: "mint" },
  ready: { label: "Listo", tone: "lavender" },
  completed: { label: "Completado", tone: "mint" },
  canceled: { label: "Cancelado", tone: "rose" },
  expired: { label: "Vencido", tone: "rose" },
};

function statusView(status: string): { label: string; tone: ChipTone } {
  return (
    STATUS_VIEWS[status] ?? {
      label: status.trim() !== "" ? status : "Sin estado",
      tone: "lavender",
    }
  );
}

function paymentStatusTone(status: string): ChipTone {
  if (status === "approved") return "mint";
  if (status === "pending" || status === "in_review") return "yellow";
  if (status === "rejected" || status === "refunded") return "rose";
  return "lavender";
}

/** Real channel value with a Spanish label for the two known channels. */
function channelLabel(channel: string): string {
  if (channel === "online") return "Tienda online";
  if (channel === "pos") return "Punto de venta";
  return channel.trim() !== "" ? channel : "Canal sin registrar";
}

/** Real fulfillment value; absent values are never invented. */
function fulfillmentLabel(value: string | null): string {
  if (value === "delivery") return "Delivery";
  if (value === "pickup") return "Retiro";
  return value && value.trim() !== "" ? value : "Sin información de entrega";
}

/** Builds a WhatsApp link only from a REAL stored phone number.
 * Normalizes to wa.me international digits (no +). Venezuelan local mobile
 * numbers stored as 04XX... (11 digits) are converted to 584XX... so wa.me
 * opens correctly.
 */
function whatsappHref(phone: string | null): string | null {
  if (typeof phone !== "string") return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 0) return null;
  // Venezuela local format: 0412XXXXXXX / 0424... / etc. -> 58412...
  if (digits.length === 11 && digits.startsWith("0")) {
    digits = `58${digits.slice(1)}`;
  }
  return `https://wa.me/${digits}`;
}

function OrderNotFound() {
  return (
    <AdminEmptyState
      title="Pedido no encontrado"
      description="No existe un pedido con ese identificador, o no tienes acceso a él."
      action={
        <Link href="/admin/pedidos" className={buttonPrimaryClass}>
          Ver lista de pedidos
        </Link>
      }
    />
  );
}

function PaymentSummaryCard({ summary }: { summary: AdminPaymentSummaryView }) {
  return (
    <AdminSurface className="p-5 sm:p-6">
      <AdminSectionTitle>Pago</AdminSectionTitle>
      {!summary.available ? (
        <p className="mt-3 text-sm leading-6 text-muted">
          El resumen de pagos no está disponible en este momento.
        </p>
      ) : summary.byCurrency.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-muted">
          Este pedido no tiene pagos registrados.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {summary.byCurrency.map((entry) => (
            <div
              key={entry.currency}
              className="rounded-field border border-yellow bg-yellow/60 px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-eyebrow">{entry.currency}</p>
                <AdminStatusChip tone="mint">
                  {formatCount(entry.paymentCount)} pagos
                </AdminStatusChip>
              </div>
              <dl className="mt-2 grid gap-1 text-sm text-ink">
                <div className="flex justify-between gap-3">
                  <dt>Aprobado</dt>
                  <dd className="font-bold">
                    {formatReportedAmount(entry.approvedAmount, entry.currency)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Pendiente</dt>
                  <dd className="font-bold">
                    {formatReportedAmount(entry.pendingAmount, entry.currency)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>En revisión</dt>
                  <dd className="font-bold">
                    {formatReportedAmount(entry.inReviewAmount, entry.currency)}
                  </dd>
                </div>
                {entry.rejectedAmount > 0 ? (
                  <div className="flex justify-between gap-3">
                    <dt>Rechazado</dt>
                    <dd className="font-bold">
                      {formatReportedAmount(entry.rejectedAmount, entry.currency)}
                    </dd>
                  </div>
                ) : null}
                {entry.refundedAmount > 0 ? (
                  <div className="flex justify-between gap-3">
                    <dt>Reembolsado</dt>
                    <dd className="font-bold">
                      {formatReportedAmount(entry.refundedAmount, entry.currency)}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
          ))}
        </div>
      )}
    </AdminSurface>
  );
}

function DeliveryCard({ order }: { order: AdminOrderDetail }) {
  const view = statusView(order.status);
  const quotePending =
    order.deliveryZoneRequiresQuote === true && order.deliveryFeeUsd === null;
  const itemsSummary =
    order.items.length > 0
      ? order.items
          .map((item) => `${formatCount(item.quantity)} x ${item.productName}`)
          .join(", ")
      : order.reference;
  const quoteMessage = quotePending
    ? `Hola ${order.customerName ?? ""}`.trim() +
      `. Tu pedido ${order.reference} está pendiente de cotización de delivery. Te escribiremos por este medio cuando el total final esté confirmado.`
    : order.deliveryZoneRequiresQuote === true && order.deliveryFeeUsd !== null
      ? `Hola ${order.customerName ?? ""}`.trim() +
        `. La cotización de delivery de tu pedido (${itemsSummary}) es de ${formatMoneyUsd(order.deliveryFeeUsd)}. El total a pagar es ${formatMoneyUsd(order.totalUsd)}. Puedes revisarlo y confirmar la cotización desde "Mis pedidos" en nuestra web.`
      : null;
  const whatsapp = whatsappHref(order.customerPhone);
  const whatsappQuoteHref =
    quoteMessage && whatsapp ? `${whatsapp}?text=${encodeURIComponent(quoteMessage)}` : null;
  return (
    <AdminSurface className="p-5 sm:p-6">
      <AdminSectionTitle>Entrega</AdminSectionTitle>
      <div className="mt-4 rounded-field border border-lavender bg-lavender/60 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-eyebrow">Estado del pedido</p>
          <AdminStatusChip tone={view.tone}>{view.label}</AdminStatusChip>
        </div>
        <p className="mt-2 text-sm leading-6 text-ink">
          {fulfillmentLabel(order.fulfillmentType)}
        </p>
      </div>
      <dl className="mt-4 space-y-2 text-sm leading-6 text-ink">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Zona</dt>
          <dd className="text-right font-bold">
            {order.deliveryZoneName ?? "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Dirección</dt>
          <dd className="text-right font-bold">{order.addressLine ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Referencias</dt>
          <dd className="text-right font-bold">
            {order.addressReferences ?? "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Instrucciones</dt>
          <dd className="text-right font-bold">
            {order.additionalInstructions ?? "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Tarifa de entrega</dt>
          <dd className="text-right font-bold">
            {order.deliveryFeeUsd === null
              ? order.deliveryZoneRequiresQuote
                ? "Pendiente por cotizar"
                : "—"
              : formatMoneyUsd(order.deliveryFeeUsd)}
          </dd>
        </div>
        {order.quoteAcceptedAt ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Cotización aceptada</dt>
            <dd className="text-right font-bold">{formatDateTime(order.quoteAcceptedAt)}</dd>
          </div>
        ) : null}
      </dl>
      {order.deliveryZoneRequiresQuote ? (
        <div className="mt-4 space-y-3">
          <AdminBanner tone={quotePending ? "yellow" : "lavender"}>
            {quotePending
              ? "Este pedido requiere cotización manual. La reserva permanece retenida hasta que se confirme la cotización; no se confirma el pedido ni se cobra automáticamente."
              : "Cotización registrada. El cliente debe revisar y aceptar el total final en su seguimiento antes de pagar."}
          </AdminBanner>
                    <DeliveryQuoteForm
            orderId={order.id}
            currentFeeUsd={order.deliveryFeeUsd}
            canEdit={order.status === "pending" && !order.quoteAcceptedAt}
            disabledReason={
              order.status !== "pending"
                ? "La cotización solo se puede editar mientras el pedido esté pendiente."
                : undefined
            }
          />
          {quoteMessage ? (
            <div className="rounded-field border border-rose/60 bg-cream px-4 py-3">
              <p className="text-eyebrow">Mensaje WhatsApp (manual)</p>
              <p className="mt-2 text-sm leading-6 text-ink">{quoteMessage}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <CopyQuoteMessageButton message={quoteMessage} />
                {whatsappQuoteHref ? (
                  <a
                    href={whatsappQuoteHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonSecondaryClass}
                  >
                    Abrir WhatsApp
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </AdminSurface>
  );
}

function CustomerCard({ order }: { order: AdminOrderDetail }) {
  return (
    <AdminSurface className="p-5 sm:p-6">
      <AdminSectionTitle>
        {order.customerName
          ? `Un pedido para ${order.customerName}`
          : "Datos del cliente"}
      </AdminSectionTitle>
      <dl className="mt-4 space-y-2 text-sm leading-6 text-ink">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Nombre</dt>
          <dd className="text-right font-bold">{order.customerName ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Teléfono</dt>
          <dd className="text-right font-bold">{order.customerPhone ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Canal</dt>
          <dd className="text-right font-bold">{channelLabel(order.channel)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Creado</dt>
          <dd className="text-right font-bold">
            {formatDateTime(order.createdAt)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Actualizado</dt>
          <dd className="text-right font-bold">
            {formatDateTime(order.updatedAt)}
          </dd>
        </div>
      </dl>
    </AdminSurface>
  );
}

function ItemsCard({ order }: { order: AdminOrderDetail }) {
  return (
    <AdminSurface className="p-5 sm:p-6">
      <AdminSectionTitle>Lo que eligió</AdminSectionTitle>
      {order.items.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-muted">
          No hay productos registrados en este pedido.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {order.items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-field border border-rose/60 bg-cream px-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-display font-bold text-plum">
                  {item.productName}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {formatCount(item.quantity)} ×{" "}
                  {formatMoneyUsd(item.unitPriceUsd)}
                </p>
              </div>
              <p className="font-display font-bold text-plum">
                {formatMoneyUsd(item.unitPriceUsd * item.quantity)}
              </p>
            </li>
          ))}
        </ul>
      )}
      <dl className="mt-5 space-y-2 border-t border-rose/60 pt-4 text-sm text-ink">
        <div className="flex justify-between gap-3">
          <dt>Subtotal</dt>
          <dd className="font-bold">{formatMoneyUsd(order.subtotalUsd)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Entrega</dt>
          <dd className="font-bold">
            {order.deliveryFeeUsd === null
              ? "—"
              : formatMoneyUsd(order.deliveryFeeUsd)}
          </dd>
        </div>
        <div className="flex justify-between gap-3 text-base">
          <dt className="font-display font-bold text-plum">Total</dt>
          <dd className="font-display font-extrabold text-plum">
            {formatMoneyUsd(order.totalUsd)}
          </dd>
        </div>
        {order.totalVes !== null ? (
          <div className="flex justify-between gap-3">
            <dt>Total en Bs.</dt>
            <dd className="font-bold">
              {formatReportedAmount(order.totalVes, "VES")}
            </dd>
          </div>
        ) : null}
        {order.bcvRateVes !== null ? (
          <div className="flex justify-between gap-3">
            <dt>Tasa BCV registrada</dt>
            <dd className="font-bold">
              {formatReportedAmount(order.bcvRateVes, "VES")}
            </dd>
          </div>
        ) : null}
        {order.roundingRule ? (
          <div className="flex justify-between gap-3">
            <dt>Redondeo</dt>
            <dd className="font-bold">{order.roundingRule}</dd>
          </div>
        ) : null}
      </dl>
    </AdminSurface>
  );
}

function PaymentsCard({ order }: { order: AdminOrderDetail }) {
  return (
    <AdminSurface className="p-5 sm:p-6">
      <AdminSectionTitle>Pagos del pedido</AdminSectionTitle>
      {order.payments.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-muted">
          No hay pagos registrados para este pedido.
        </p>
      ) : (
        <div className="mt-4">
          <AdminTable
            caption="Pagos registrados del pedido"
            headers={["Método", "Monto", "Referencia", "Estado", "Fecha"]}
          >
            {order.payments.map((payment) => (
              <tr key={payment.id}>
                <th scope="row" className="font-bold text-ink">
                  {paymentMethodLabel(payment.method)}
                </th>
                <td>{formatReportedAmount(payment.amount, payment.currency)}</td>
                <td>{payment.reference ?? "—"}</td>
                <td>
                  <AdminStatusChip tone={paymentStatusTone(payment.status)}>
                    {paymentStatusLabel(payment.status)}
                  </AdminStatusChip>
                </td>
                <td>{formatDateTime(payment.createdAt)}</td>
              </tr>
            ))}
          </AdminTable>
        </div>
      )}
    </AdminSurface>
  );
}

function NextStepCard({
  order,
  confirmationBlockedReason,
}: {
  order: AdminOrderDetail;
  confirmationBlockedReason: string | null;
}) {
  const whatsapp = whatsappHref(order.customerPhone);
  const isPayInPersonEligible =
    order.channel === "online" &&
    ["pending", "confirmed", "ready"].includes(order.status) &&
    (order.fulfillmentType === "pickup" ||
      (order.fulfillmentType === "delivery" && order.deliveryFeeUsd === 0));
  const hasNonRejectedDigitalPayment = order.payments.some(
    (p) => p.status !== "rejected" && p.method !== "cash_usd",
  );
  const hasRegisteredCashPayment =
    order.payments.some((p) => p.status !== "rejected" && p.method === "cash_usd") ||
    order.paymentSummary.byCurrency.some(
      (c) => c.currency === "USD" && (c.approvedAmount > 0 || c.pendingAmount > 0 || c.inReviewAmount > 0),
    );
  const showRegisterExternalPayment =
    isPayInPersonEligible && !hasNonRejectedDigitalPayment;
  const canRegisterExternalPayment = showRegisterExternalPayment && !hasRegisteredCashPayment;
  return (
    <AdminSurface className="p-5 sm:p-6">
      <AdminSectionTitle>Siguiente paso</AdminSectionTitle>
      <div className="mt-4 flex flex-col gap-3">
        {canRegisterExternalPayment ? (
          <Link href={`/admin/pagos/externo?orderId=${order.id}`} className={buttonPrimaryClass}>
            Registrar pago
          </Link>
        ) : showRegisterExternalPayment ? (
          <Button variant="primary" disabled title="Este pedido ya tiene un pago en persona registrado.">
            Registrar pago
          </Button>
        ) : (
          <Link href={`/admin/comprobantes?orderId=${order.id}`} className={buttonPrimaryClass}>
            Revisar comprobante
          </Link>
        )}
        {whatsapp ? (
          <a
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonSecondaryClass}
          >
            Contactar por WhatsApp
          </a>
        ) : (
          <Button
            variant="secondary"
            disabled
            title="Este pedido no tiene un teléfono registrado."
          >
            Contactar por WhatsApp
          </Button>
        )}
        <OrderStatusAction
          orderId={order.id}
          status={order.status as "pending" | "confirmed" | "ready" | "completed" | "canceled" | "expired"}
          confirmationBlockedReason={confirmationBlockedReason}
        />
      </div>
      <p className="mt-4 text-sm leading-6 text-muted">
        Creado: {formatDateTime(order.createdAt)} · Actualizado:{" "}
        {formatDateTime(order.updatedAt)}
      </p>
    </AdminSurface>
  );
}

function CancellationsCard({ order }: { order: AdminOrderDetail }) {
  if (order.cancellations.length === 0) return null;
  return (
    <AdminSurface className="p-5 sm:p-6">
      <AdminSectionTitle>Solicitudes de cancelación</AdminSectionTitle>
      <div className="mt-4">
        <AdminTable
          caption="Solicitudes de cancelación del pedido"
          headers={["Estado", "Origen", "Motivo", "Resolución", "Fecha"]}
        >
          {order.cancellations.map((request) => (
            <tr key={request.id}>
              <th scope="row" className="font-bold text-ink">
                {request.status}
              </th>
              <td>{request.source}</td>
              <td>{request.customerReason ?? "—"}</td>
              <td>{request.resolutionNote ?? "—"}</td>
              <td>{formatDateTime(request.createdAt)}</td>
            </tr>
          ))}
        </AdminTable>
      </div>
    </AdminSurface>
  );
}

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getAdminOrderDetail(id);

  const header = (subtitle: string) => (
    <AdminPageHeader
      title={result.order ? `Pedido ${result.order.reference}` : "Detalle de pedido"}
      subtitle={subtitle}
      action={
        <Link href="/admin/pedidos" className={buttonSecondaryClass}>
          Volver a pedidos
        </Link>
      }
    />
  );

  if (result.unavailable) {
    return (
      <>
        {header("No fue posible cargar el detalle del pedido.")}
        <AdminBanner tone="pink">
          {result.message ??
            "No se pudieron cargar los datos. Inténtalo de nuevo más tarde."}
        </AdminBanner>
      </>
    );
  }

  if (!result.order) {
    return (
      <>
        {header("Detalle de un pedido registrado.")}
        <OrderNotFound />
      </>
    );
  }

  const order = result.order;
  const confirmationBlockedReason =
    order.status === "pending" &&
    order.fulfillmentType === "delivery" &&
    order.deliveryZoneRequiresQuote === true &&
    order.deliveryFeeUsd === null
      ? "Debes guardar la cotización de delivery antes de confirmar este pedido."
      : null;

  return (
    <>
      {header(
        `${formatDateTime(order.createdAt)} · ${channelLabel(order.channel)}`,
      )}

      {confirmationBlockedReason ? (
        <div className="mb-6">
          <AdminBanner tone="yellow">{confirmationBlockedReason}</AdminBanner>
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <PaymentSummaryCard summary={order.paymentSummary} />
        <DeliveryCard order={order} />
        <CustomerCard order={order} />
        <ItemsCard order={order} />
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PaymentsCard order={order} />
        </div>
        <NextStepCard order={order} confirmationBlockedReason={confirmationBlockedReason} />
      </div>

      {order.cancellations.length > 0 ? (
        <div className="mt-6">
          <CancellationsCard order={order} />
        </div>
      ) : null}

      <div className="mt-6">
        <AdminBanner tone="yellow">
          Los estados, montos y fechas mostrados provienen de los datos reales
          registrados del pedido. Las acciones de pago y entrega se gestionan en
          sus pantallas dedicadas.
        </AdminBanner>
      </div>
    </>
  );
}
