import type { Metadata } from "next";
import Image from "next/image";
import {
  AdminBanner,
  AdminEmptyState,
  AdminPageHeader,
  AdminSectionTitle,
  AdminStatusChip,
  AdminSurface,
} from "@/components/admin/admin-ui";
import { CheckIcon, ReceiptIcon } from "@/components/ui/icons";
import { formatCount, formatDateTime } from "@/features/admin/format";
import {
  formatReportedAmount,
  paymentMethodLabel,
  receiptFileName,
} from "@/features/admin/components/payments/payment-display";
import { ReceiptDecision } from "@/features/admin/components/payments/receipt-decision";
import {
  getAdminReceiptUrl,
  listPendingReceipts,
} from "@/features/admin/receipts";

export const metadata: Metadata = {
  title: "Verificar comprobante | Panel administrativo",
  robots: { index: false, follow: false },
};

// The session gate reads request cookies; keep the panel blocking so no static
// shell can expose controls before authorization resolves.
export const instant = false;

/** Manual reminders only: none of these claims a completed verification. */
const reviewReminders = [
  "Verificar destinatario y cuenta en el banco.",
  "Confirmar abono en la cuenta receptora.",
  "Comprobar que la referencia no esté duplicada.",
] as const;

export default async function AdminReceiptsPage({
  searchParams,
}: {
  searchParams?: Promise<{ orderId?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const orderId =
    typeof params.orderId === "string" && /^[1-9]\d*$/.test(params.orderId)
      ? Number(params.orderId)
      : undefined;
  const queue = await listPendingReceipts(orderId ? { orderId } : undefined);
  const pendingCount = queue.items.length;

  if (queue.unavailable || pendingCount === 0) {
    return (
      <>
        <AdminPageHeader
          title="Verificar comprobante"
          subtitle={
            queue.unavailable
              ? undefined
              : orderId
                ? `Pedido #${orderId} · ${formatCount(pendingCount)} comprobantes pendientes de revisión.`
                : `${formatCount(pendingCount)} comprobantes pendientes de revisión.`
          }
        />
        {queue.unavailable ? (
          <div className="mb-6">
            <AdminBanner tone="yellow">{queue.message}</AdminBanner>
          </div>
        ) : null}
        <AdminEmptyState
          title={orderId ? `No hay comprobantes pendientes para el pedido #${orderId}.` : "No hay comprobantes pendientes de revisión."}
          description={
            queue.unavailable
              ? "No se pudo consultar la cola de comprobantes en este momento."
              : orderId
                ? "Este pedido no tiene comprobantes pendientes de revisión."
                : "Cuando se envíe un comprobante, aparecerá aquí para su revisión."
          }
        />
      </>
    );
  }

  // Signed URLs are minted here, during server render, and are never serialized
  // into a Client Component. Only the short-lived URL reaches the <Image> tag.
  const receipts = await Promise.all(
    queue.items.map(async (item) => ({
      item,
      url: await getAdminReceiptUrl(item.receiptPath),
    })),
  );

  return (
    <>
      <AdminPageHeader
        title="Verificar comprobante"
        subtitle={
          orderId
            ? `Pedido #${orderId} · ${formatCount(pendingCount)} comprobantes pendientes de revisión.`
            : `${formatCount(pendingCount)} comprobantes pendientes de revisión.`
        }
        action={
          <AdminStatusChip tone="yellow">
            {formatCount(pendingCount)} pendientes
          </AdminStatusChip>
        }
      />

      <div className="space-y-6">
        {receipts.map(({ item, url }) => {
          const fileName = receiptFileName(item.receiptPath);

          return (
            <article
              key={item.paymentId}
              className="grid gap-6 lg:grid-cols-2"
              aria-label={`Comprobante del pedido ${item.orderReference}`}
            >
              <AdminSurface>
                <div className="flex items-center gap-2">
                  <ReceiptIcon className="size-5 text-pink" />
                  <AdminSectionTitle>Comprobante enviado</AdminSectionTitle>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Pedido {item.orderReference} · pago #{item.paymentId}
                </p>
                <div className="mt-4">
                  {url ? (
                    <Image
                      src={url}
                      alt={`Comprobante enviado para el pedido ${item.orderReference}, archivo ${fileName}`}
                      width={640}
                      height={480}
                      unoptimized
                      className="h-auto w-full rounded-field border border-rose bg-white object-contain"
                    />
                  ) : (
                    <div className="grid min-h-64 place-items-center rounded-field border border-dashed border-lavender bg-cream px-4 text-center text-sm leading-6 text-muted">
                      No se pudo cargar la imagen del comprobante. Inténtalo de
                      nuevo más tarde.
                    </div>
                  )}
                </div>
                <p className="mt-3 break-all text-sm text-muted">
                  Archivo: {fileName}
                </p>
              </AdminSurface>

              <div className="space-y-6">
                <AdminSurface>
                  <div className="flex items-center gap-2">
                    <CheckIcon className="size-5 text-pink" />
                    <AdminSectionTitle>Antes de aprobar</AdminSectionTitle>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    Datos reportados para el pedido {item.orderReference}.
                  </p>
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="font-bold text-muted">Monto reportado</dt>
                      <dd className="text-ink">
                        {formatReportedAmount(item.amount, item.currency)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-bold text-muted">Método</dt>
                      <dd className="text-ink">
                        {paymentMethodLabel(item.method)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-bold text-muted">Referencia</dt>
                      <dd className="break-all font-bold text-ink">{item.reference ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="font-bold text-muted">Fecha de envío</dt>
                      <dd className="text-ink">
                        {formatDateTime(item.submittedAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-bold text-muted">Pedido</dt>
                      <dd className="text-ink">{item.orderReference}</dd>
                    </div>
                  </dl>
                  <div className="mt-6 rounded-card border border-lavender bg-lavender/60 p-4">
                    <h3 className="font-display text-base font-bold text-plum">
                      Administración · recordatorios manuales
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-muted">
                      No son resultados de verificación: confirma cada punto
                      antes de decidir.
                    </p>
                    <ul className="mt-3 list-disc space-y-2 ps-5 text-sm leading-6 text-ink">
                      {reviewReminders.map((reminder) => (
                        <li key={reminder}>{reminder}</li>
                      ))}
                    </ul>
                  </div>
                </AdminSurface>

                <AdminSurface>
                  <div className="flex items-center gap-2">
                    <CheckIcon className="size-5 text-pink" />
                    <AdminSectionTitle>
                      Decisión de administración
                    </AdminSectionTitle>
                  </div>
                  <div className="mt-4">
                    <ReceiptDecision
                      paymentId={item.paymentId}
                      orderId={item.orderId}
                      orderReference={item.orderReference}
                    />
                  </div>
                </AdminSurface>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
