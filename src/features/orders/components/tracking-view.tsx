"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { acceptQuoteFee } from "../accept-quote";
import { primeCheckoutPayment } from "../checkout";
import { requestOrderCancellation } from "../request-cancellation";
import type { TrackedOrder } from "../tracking";
import { saveTrackingLink } from "../tracking-links-store";
import { formatUsd } from "@/features/catalog/components/price-format";
import { getReceiptUrlsForTracking } from "@/features/payments/receipt-review";
import { Button, LiveRegion, Textarea } from "@/components/ui/ui";
import { ArrowRightIcon, CheckIcon, ClockIcon } from "@/components/ui/icons";

type Summary = Record<
  string,
  {
    approved_amount: number | string;
    pending_amount: number | string;
    in_review_amount: number | string;
    rejected_amount: number | string;
    refunded_amount: number | string;
    payment_count: number;
  }
>;

const statusLabel: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  preparing: "En preparación",
  ready: "Listo",
  delivered: "Entregado",
  completed: "Entregado",
  canceled: "Cancelado",
  expired: "Expirado",
};

function trackingHeadline(order: TrackedOrder): string {
  if (order.status === "completed" || order.status === "delivered") {
    return "Tu pedido fue entregado.";
  }
  if (order.status === "ready") {
    return order.fulfillment_type === "delivery"
      ? "Tu pedido está listo para la entrega."
      : "Tu pedido está listo para retirar.";
  }
  if (order.status === "confirmed" || order.status === "preparing") {
    return "Tu pedido fue confirmado y está en preparación.";
  }
  if (order.status === "pending") {
    return "Recibimos tu pedido.";
  }
  if (order.status === "canceled") {
    return "Este pedido fue cancelado.";
  }
  if (order.status === "expired") {
    return "Este pedido venció.";
  }
  return "Seguimiento de tu pedido.";
}

function trackingMessage(order: TrackedOrder): string {
  if (order.status === "completed" || order.status === "delivered") {
    return "Gracias por tu compra. Guarda este enlace privado si necesitas consultar los detalles.";
  }
  if (order.status === "ready") {
    return order.fulfillment_type === "delivery"
      ? "Te contactaremos por WhatsApp para coordinar la entrega. Guarda este enlace privado para seguir tu pedido."
      : "Ya puedes retirarlo en el atelier. Guarda este enlace privado para seguir tu pedido.";
  }
  if (order.status === "confirmed" || order.status === "preparing") {
    return "Te avisaremos por WhatsApp cuando haya novedades. Guarda este enlace privado para seguir tu pedido.";
  }
  if (order.status === "pending") {
    return "Estamos revisando tu pedido. Te avisaremos por WhatsApp cuando haya novedades. Guarda este enlace privado para seguir tu pedido.";
  }
  if (order.status === "canceled") {
    return "Si necesitas ayuda, contáctanos por WhatsApp. Guarda este enlace privado para consultar los detalles.";
  }
  if (order.status === "expired") {
    return "La reserva de este pedido venció. Si necesitas ayuda, contáctanos por WhatsApp.";
  }
  return "Guarda este enlace privado para seguir tu pedido.";
}

function whatsappHref(phone: string | null | undefined): string | null {
  if (typeof phone !== "string") return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.length === 11 && digits.startsWith("0")) {
    digits = `58${digits.slice(1)}`;
  }
  return `https://wa.me/${digits}`;
}

export function TrackingView({
  token,
  order,
  summary,
  confirmation,
  payInStoreConfirmed = false,
  whatsappPhone = null,
}: {
  token: string;
  order: TrackedOrder;
  summary: Summary;
  confirmation: boolean;
  payInStoreConfirmed?: boolean;
  whatsappPhone?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const [receiptUrls, setReceiptUrls] = useState<string[] | null>(null);
  const [receiptFeedback, setReceiptFeedback] = useState<string | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<{ url: string; index: number } | null>(null);

  const status = statusLabel[order.status] ?? order.status;
  const headline = trackingHeadline(order);
  const message = trackingMessage(order);
  const pendingCancellation = order.cancellation_requests.some(
    (request) => request.status === "pending",
  );
  const canCancel =
    ["pending", "confirmed"].includes(order.status) && !pendingCancellation;
  const quotePending =
    order.delivery_requires_quote === true && order.delivery_fee_usd === null;
  const hasReportedPayments = Object.values(summary).some(
    (values) =>
      Number(values.pending_amount) +
        Number(values.in_review_amount) +
        Number(values.approved_amount) >
      0,
  );
  const hasRejectedPayments = Object.values(summary).some(
    (values) => Number(values.rejected_amount) > 0,
  );
  const canPay =
    ["pending", "confirmed"].includes(order.status) &&
    !(order.quote_acceptance_available === true) &&
    !quotePending &&
    !hasReportedPayments;
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const contactWhatsappHref = whatsappHref(whatsappPhone);
  const showCanceledPaymentHelp =
    order.status === "canceled" && hasRejectedPayments;

  useEffect(() => {
    saveTrackingLink({ token, orderId: order.order_id });
  }, [token, order.order_id]);

  async function handleCopyLink() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopyFeedback("Enlace copiado. Guárdalo para seguir tu pedido.");
    } catch {
      setCopyFeedback("No se pudo copiar automáticamente. Copia la URL desde la barra del navegador.");
    }
  }

  function handleAcceptQuote() {
    if (isPending) return;
    setFeedback(null);
    startTransition(async () => {
      const result = await acceptQuoteFee({ trackingToken: token });
      if (result.ok) {
        setFeedback(
          result.idempotent
            ? "La cotización ya estaba aceptada."
            : "Cotización aceptada. Ya puedes registrar tu pago.",
        );
        router.refresh();
        return;
      }
      setFeedback(result.error);
    });
  }

  function handleCancel() {
    if (isPending) return;
    setFeedback(null);
    startTransition(async () => {
      const result = await requestOrderCancellation({
        trackingToken: token,
        reason: cancelReason,
      });
      if (result.ok) {
        setFeedback("Solicitud de cancelación enviada.");
        setShowCancel(false);
        router.refresh();
        return;
      }
      setFeedback(result.error);
    });
  }

  function handleReceipts() {
    if (isPending) return;
    setReceiptFeedback(null);
    startTransition(async () => {
      const result = await getReceiptUrlsForTracking({ trackingToken: token });
      if (result.ok) {
        setReceiptUrls(result.urls);
        setReceiptFeedback("Comprobantes disponibles.");
      } else {
        setReceiptFeedback(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <section
        className={`rounded-section p-8 shadow-sm ${confirmation ? "bg-mint text-center" : "bg-lavender"}`}
      >
        {confirmation ? (
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-white text-pink">
            <CheckIcon className="size-7" />
          </div>
        ) : (
          <p className="text-eyebrow">Enlace privado</p>
        )}
        <h1 className="font-display text-4xl font-extrabold text-plum md:text-5xl">
          {headline}
        </h1>
        <p className={`mt-3 text-lg text-ink ${confirmation ? "" : "max-w-2xl"}`}>
          {payInStoreConfirmed
            ? "Tu pedido quedó registrado para pago en tienda. Puedes pagar en efectivo USD al retirar en el atelier. Guarda este enlace privado para seguir tu pedido."
            : showCanceledPaymentHelp
              ? "Tu pedido fue cancelado porque el comprobante fue rechazado más de una vez. Si necesitas ayuda para volver a pedir o aclarar el pago, contáctanos por WhatsApp."
              : message}
        </p>
        <div className={`mt-5 flex flex-wrap gap-3 ${confirmation ? "justify-center" : ""}`}>
          <Button variant="secondary" onClick={handleCopyLink}>
            Copiar enlace privado
          </Button>
        </div>
        <LiveRegion className="mt-2 text-sm text-ink">{copyFeedback ?? ""}</LiveRegion>
      </section>

      <section className="rounded-card bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-display text-2xl font-extrabold text-plum">
              Pedido #{order.order_id}
            </p>
            <p className="mt-1 text-sm text-muted">
              {order.fulfillment_type === "delivery" ? "Delivery" : "Retiro en atelier"} ·{" "}
              {status}
            </p>
          </div>
          <span className="rounded-full bg-lavender px-4 py-2 font-display text-sm font-bold text-ink">
            {status}
          </span>
        </div>

        <ul className="mt-6 divide-y divide-rose">
          {order.items.map((item, index) => (
            <li
              key={`${item.product_name}-${index}`}
              className="flex justify-between gap-4 py-3 font-display text-base font-bold text-ink"
            >
              <span>
                {item.product_name} × {item.quantity}
              </span>
              <span className="text-plum">
                {formatUsd(item.unit_price_usd * item.quantity)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-1 border-t border-rose pt-4 text-ink">
          <div className="flex justify-between gap-4">
            <dt>Subtotal</dt>
            <dd className="font-bold">{formatUsd(order.subtotal_usd)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Delivery</dt>
            <dd className="font-bold">
              {order.delivery_fee_usd === null
                ? "Por confirmar"
                : order.delivery_fee_usd === 0
                  ? "GRATIS"
                  : formatUsd(order.delivery_fee_usd)}
            </dd>
          </div>
          {quotePending ? (
            <p className="pt-2 text-sm leading-6 text-muted">
              Estamos calculando la tarifa de delivery. Te avisaremos por WhatsApp cuando el total final esté listo.
            </p>
          ) : null}
          <div className="flex justify-between gap-4 font-display text-xl font-extrabold text-plum">
            <dt>Total USD</dt>
            <dd>{formatUsd(order.total_usd)}</dd>
          </div>
        </dl>
      </section>

      {order.quote_acceptance_available ? (
        <section className="rounded-section bg-yellow p-6 shadow-sm">
          <h2 className="font-display text-2xl font-extrabold text-plum">
            Cotización de delivery lista
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink">
            Revisa el total con la tarifa confirmada antes de registrar tu pago.
            Al aceptar, la reserva se mantiene por 20 minutos.
          </p>
          <Button onClick={handleAcceptQuote} disabled={isPending} className="mt-4">
            {isPending ? "Aceptando..." : "Aceptar cotización"}
            <ArrowRightIcon />
          </Button>
          <LiveRegion className="mt-2 text-muted">{feedback ?? ""}</LiveRegion>
        </section>
      ) : quotePending ? (
        <section className="rounded-section bg-yellow p-6 shadow-sm">
          <h2 className="font-display text-2xl font-extrabold text-plum">
            Delivery pendiente por cotizar
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink">
            Tu pedido está reservado mientras confirmamos la tarifa de delivery. Cuando la cotización esté lista, verás aquí el total final antes de pagar.
          </p>
        </section>
      ) : null}

      <section className="rounded-card bg-lavender p-6 shadow-sm">
        <h2 className="font-display text-2xl font-extrabold text-plum">
          Pagos
        </h2>
        {Object.keys(summary).length === 0 ? (
          <p className="mt-2 text-sm text-ink">
            Aún no hay pagos registrados para este pedido.
          </p>
        ) : (
          <dl className="mt-4 space-y-2 text-sm text-ink">
            {Object.entries(summary).map(([currency, values]) => (
              <div
                key={currency}
                className="flex justify-between gap-4 rounded-field bg-white/70 px-4 py-3"
              >
                <dt className="font-bold">{currency}</dt>
                <dd className="text-right">
                  <div>Reportado: {(Number(values.pending_amount) + Number(values.in_review_amount)).toFixed(2)}</div>
                  <div>Verificado: {Number(values.approved_amount).toFixed(2)}</div>
                </dd>
              </div>
            ))}
          </dl>
        )}

        {canPay ? (
          <div className="mt-4 space-y-3">
            {hasRejectedPayments ? (
              <div className="rounded-field bg-rose/40 p-4 text-sm leading-6 text-ink">
                <p className="font-display font-bold text-plum">
                  Tu comprobante anterior fue rechazado.
                </p>
                <p className="mt-1">
                  Revisa el monto y la referencia, asegúrate de que la imagen sea legible y
                  vuelve a registrar el pago con un comprobante válido.
                </p>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => {
                  setFeedback(null);
                  startTransition(async () => {
                    const result = await primeCheckoutPayment({ trackingToken: token });
                    if (result.ok) {
                      router.push("/checkout/pago");
                      return;
                    }
                    setFeedback(result.error);
                  });
                }}
                disabled={isPending}
              >
                {isPending
                  ? "Abriendo pago..."
                  : hasRejectedPayments
                    ? "Subir nuevo comprobante"
                    : "Registrar pago"}
                <ArrowRightIcon />
              </Button>
              <p className="flex items-start gap-2 text-sm leading-6 text-ink">
                <ClockIcon className="mt-0.5 size-4 shrink-0 text-pink" />
                Los pagos se verifican de forma manual.
              </p>
            </div>
          </div>
        ) : hasReportedPayments && ["pending", "confirmed"].includes(order.status) ? (
          <p className="mt-4 flex items-start gap-2 text-sm leading-6 text-ink">
            <ClockIcon className="mt-0.5 size-4 shrink-0 text-pink" />
            Ya registraste un pago para este pedido. Está en revisión manual; te avisaremos por WhatsApp si necesitamos algo más.
          </p>
        ) : null}
      </section>

      <section className="rounded-card bg-white p-6 shadow-sm">
        <h2 className="font-display text-2xl font-extrabold text-plum">
          Comprobantes
        </h2>
        <p className="mt-2 text-sm text-muted">
          Los comprobantes solo se muestran tras verificar el enlace privado.
        </p>
        <Button
          variant="secondary"
          onClick={handleReceipts}
          disabled={isPending}
          className="mt-4"
        >
          {isPending ? "Consultando…" : "Ver comprobantes"}
        </Button>
        <LiveRegion className="mt-2 text-muted">
          {receiptFeedback ?? ""}
        </LiveRegion>
        {receiptUrls && receiptUrls.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {receiptUrls.map((url, index) => (
              <li key={`${url}-${index}`}>
                <button
                  type="button"
                  onClick={() => setSelectedReceipt({ url, index })}
                  className="font-display text-sm font-bold text-pink underline-offset-4 hover:underline"
                >
                  Ver comprobante {index + 1}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {showCanceledPaymentHelp ? (
        <section className="rounded-card bg-rose/30 p-6 shadow-sm">
          <h2 className="font-display text-2xl font-extrabold text-plum">
            ¿Necesitas ayuda con tu pedido?
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink">
            Este pedido se canceló automáticamente tras dos intentos de comprobante rechazados.
            Escríbenos por WhatsApp y te ayudaremos con los siguientes pasos.
          </p>
          {contactWhatsappHref ? (
            <a
              href={contactWhatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-plum px-5 py-3 font-display text-sm font-bold text-white transition hover:bg-plum/90"
            >
              Contactar por WhatsApp
              <ArrowRightIcon />
            </a>
          ) : (
            <p className="mt-4 text-sm font-bold text-muted">
              El número de WhatsApp no está disponible por ahora. Intenta más tarde.
            </p>
          )}
        </section>
      ) : canCancel ? (
        <section className="rounded-card bg-white p-6 shadow-sm">
          <h2 className="font-display text-2xl font-extrabold text-plum">
            ¿Necesitas cancelar?
          </h2>
          {!showCancel ? (
            <Button
              variant="ghost"
              onClick={() => setShowCancel(true)}
              className="mt-2 px-0"
            >
              Solicitar cancelación
              <ArrowRightIcon />
            </Button>
          ) : (
            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="mb-2 block font-display text-sm font-bold text-ink">
                  Comentario (opcional)
                </span>
                <Textarea
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  maxLength={500}
                  placeholder="Cuéntanos el motivo si quieres"
                />
              </label>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="secondary"
                  onClick={handleCancel}
                  disabled={isPending}
                >
                  {isPending ? "Enviando…" : "Enviar solicitud"}
                </Button>
                <Button variant="ghost" onClick={() => setShowCancel(false)}>
                  Mantener pedido
                </Button>
              </div>
            </div>
          )}
        </section>
      ) : pendingCancellation ? (
        <p className="rounded-card bg-rose p-5 text-sm font-bold text-ink">
          Ya hay una solicitud de cancelación pendiente para este pedido.
        </p>
      ) : null}

      <LiveRegion className="text-pink">{feedback ?? ""}</LiveRegion>

      <Link
        href="/productos"
        className="inline-flex items-center gap-1 font-display text-base font-bold text-pink hover:underline"
      >
        Volver al catálogo
        <ArrowRightIcon />
      </Link>

      {selectedReceipt ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-plum/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Comprobante ${selectedReceipt.index + 1}`}
          onClick={() => setSelectedReceipt(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-section bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-rose px-4 py-3">
              <h3 className="font-display text-lg font-extrabold text-plum">
                Comprobante {selectedReceipt.index + 1}
              </h3>
              <Button variant="ghost" type="button" className="min-h-10 px-3 py-2" onClick={() => setSelectedReceipt(null)}>
                Cerrar
              </Button>
            </div>
            <div className="max-h-[calc(90vh-4.5rem)] overflow-auto bg-cream p-4">
              {selectedReceipt.url.toLowerCase().includes(".pdf") ? (
                <iframe
                  src={selectedReceipt.url}
                  title={`Comprobante ${selectedReceipt.index + 1}`}
                  className="h-[70vh] w-full rounded-card bg-white"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL is dynamic/short-lived; next/image remote config not required.
                <img
                  src={selectedReceipt.url}
                  alt={`Comprobante ${selectedReceipt.index + 1}`}
                  className="mx-auto max-h-[70vh] w-auto rounded-card bg-white object-contain"
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
