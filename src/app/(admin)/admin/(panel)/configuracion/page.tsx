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
import { describeBusinessHours } from "@/features/admin/components/ops/business-hours";
import { formatDateTime } from "@/features/admin/format";
import { getAdminSettingsSnapshot } from "@/features/admin/settings-read";
import { listBcvRates } from "@/features/exchange-rates/admin-rates";
import { StoreSettingsForm } from "@/features/admin/components/settings/store-settings-form";
import { BcvRateForm } from "@/features/admin/components/settings/bcv-rate-form";
import { PaymentInstructionsForm } from "@/features/admin/components/settings/payment-instructions-form";
import { DeliveryZonesForm } from "@/features/admin/components/settings/delivery-zones-form";
import { SettingsTabs } from "@/features/admin/components/settings/settings-tabs";
import { paymentInstructionsSchema } from "@/features/settings/schemas";

function bcvSourceLabel(source: string | null): string {
  if (!source) return "—";
  if (source.startsWith("automatic:")) return `Automática (${source.replace("automatic:", "")})`;
  return `Manual (${source})`;
}

function bcvSyncStatusLabel(status: "success" | "failure" | "skipped" | "manual_overridden"): string {
  if (status === "success") return "Exitosa";
  if (status === "failure") return "Fallida";
  if (status === "manual_overridden") return "Manual prevalece";
  return "Omitida";
}

export const metadata: Metadata = {
  title: "Configuración | Panel administrativo",
  robots: { index: false, follow: false },
};

// The layout owns the session gate; keep the route blocking while cookies and
// the shell resolve.
export const instant = false;

/** Payment method data is configured via PaymentInstructionsForm below. */

export default async function AdminSettingsPage() {
  const [snapshot, rateHistory] = await Promise.all([
    getAdminSettingsSnapshot(),
    listBcvRates(),
  ]);

  const businessHours = describeBusinessHours(snapshot.settings.businessHours);
  const currentRate = snapshot.bcvRate;
  const bcvSync = snapshot.bcvSync;
  const bcvLastSuccessfulRetrievalAt = snapshot.bcvLastSuccessfulRetrievalAt;
  const rates = rateHistory.ok ? rateHistory.rates : [];
  const parsedPaymentInstructions = paymentInstructionsSchema.safeParse(
    snapshot.settings.paymentInstructions,
  );

  return (
    <>
      <AdminPageHeader
        title="Configuración"
        subtitle="Una mirada clara a la entrega, los pagos y las reglas que acompañan a cada pedido."
      />

      {snapshot.unavailable ? (
        <div className="mb-6">
          <AdminBanner tone="pink">{snapshot.message}</AdminBanner>
        </div>
      ) : null}

      <SettingsTabs
        tabs={[
          {
            id: "tienda",
            label: "Tienda y horarios",
            content: (
              <>
                <AdminSurface className="p-5 sm:p-6">
                  <StoreSettingsForm
                    initialPickupAddress={snapshot.settings.pickupAddress}
                    initialWhatsappPhone={snapshot.settings.whatsappPhone}
                    initialBusinessHours={snapshot.settings.businessHours}
                  />
                </AdminSurface>
              </>
            ),
          },
          {
            id: "zonas",
            label: "Zonas de entrega",
            content: (
              <AdminSurface className="p-5 sm:p-6">
                <DeliveryZonesForm zones={snapshot.deliveryZones} />
              </AdminSurface>
            ),
          },
          {
            id: "pagos",
            label: "Pagos y BCV",
            content: (
              <>
                <AdminSurface className="p-5 sm:p-6">
                  <PaymentInstructionsForm
                    initialPaymentInstructions={
                      parsedPaymentInstructions.success ? parsedPaymentInstructions.data : null
                    }
                  />
                  <div className="mt-6 border-t border-rose/60 pt-4">
                    <p className="text-sm leading-6 text-muted">
                      Efectivo USD se registra en el atelier (no en línea). La activación/desactivación por método aún no está disponible en este panel.
                    </p>
                  </div>
                </AdminSurface>

                <AdminSurface className="p-5 sm:p-6">
                  <AdminSectionTitle>Reglas del atelier</AdminSectionTitle>
                  <div className="mt-4 rounded-field border border-yellow bg-yellow/60 px-4 py-3">
                    <p className="text-eyebrow">Tasa BCV registrada</p>
                    <p className="mt-1 font-display text-2xl font-extrabold text-plum">
                      {currentRate ? String(currentRate.rateVesPerUsd) : "Sin configurar"}
                    </p>
                    {currentRate ? (
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-ink">
                        <AdminStatusChip tone={currentRate.isStale ? "yellow" : "mint"}>
                          {currentRate.isStale ? "Desactualizada" : "Vigente"}
                        </AdminStatusChip>
                        <span>Observada: {formatDateTime(currentRate.observedAt)}</span>
                        <span>Origen: {bcvSourceLabel(currentRate.source)}</span>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm leading-6 text-ink">
                        Registra una tasa para habilitar pagos en VES por Pago Móvil.
                      </p>
                    )}
                  </div>

                  <div className="mt-4 rounded-field border border-rose/60 bg-cream px-4 py-3">
                    <p className="text-eyebrow">Sincronización automática BCV</p>
                    {bcvSync ? (
                      <div className="mt-2 space-y-2 text-sm leading-6 text-ink">
                        <div className="flex flex-wrap items-center gap-3">
                          <AdminStatusChip
                            tone={
                              bcvSync.status === "success"
                                ? "mint"
                                : bcvSync.status === "failure"
                                  ? "rose"
                                  : bcvSync.status === "manual_overridden"
                                    ? "lavender"
                                    : "yellow"
                            }
                          >
                            {bcvSyncStatusLabel(bcvSync.status)}
                          </AdminStatusChip>
                          <span>Último intento: {formatDateTime(bcvSync.attemptedAt)}</span>
                        </div>
                        <p>Última recuperación exitosa: {bcvLastSuccessfulRetrievalAt ? formatDateTime(bcvLastSuccessfulRetrievalAt) : "—"}</p>
                        <p>Fecha efectiva: {bcvSync.effectiveDate ?? "—"}</p>
                        <p>Actualización proveedor: {bcvSync.providerUpdatedAt ? formatDateTime(bcvSync.providerUpdatedAt) : "—"}</p>
                        <p>Slot: {bcvSync.scheduleSlot}</p>
                        {bcvSync.errorDetail ? (
                          <p className="text-pink">Error: {bcvSync.errorDetail}</p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm leading-6 text-muted">
                        Aún no hay intentos de sincronización registrados.
                      </p>
                    )}
                  </div>

                  <div className="mt-6 border-t border-rose/60 pt-6">
                    <BcvRateForm />
                  </div>

                  <div className="mt-6 border-t border-rose/60 pt-6">
                    <p className="text-eyebrow">Horarios de atención y retiro</p>
                    <ul className="mt-2 space-y-1 text-sm leading-6 text-ink">
                      {businessHours.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                </AdminSurface>

                <AdminSurface className="p-5 sm:p-6">
                  <AdminSectionTitle>Historial de tasas BCV</AdminSectionTitle>
                  <div className="mt-4">
                    {!rateHistory.ok ? (
                      <AdminBanner tone="pink">{rateHistory.error}</AdminBanner>
                    ) : rates.length === 0 ? (
                      <AdminEmptyState
                        title="Sin tasas registradas"
                        description="Aún no hay tasas BCV registradas en el historial."
                      />
                    ) : (
                      <AdminTable
                        caption="Historial de tasas BCV registradas"
                        headers={["Tasa", "Observada", "Origen", "Estado"]}
                      >
                        {rates.map((rate) => (
                          <tr key={rate.id}>
                            <th scope="row" className="font-bold text-ink">
                              {String(rate.rate_ves_per_usd)}
                            </th>
                            <td>{formatDateTime(rate.observed_at)}</td>
                            <td>{bcvSourceLabel(rate.source)}</td>
                            <td>
                              <AdminStatusChip tone={rate.is_active ? "mint" : "lavender"}>
                                {rate.is_active ? "Activa" : "Inactiva"}
                              </AdminStatusChip>
                            </td>
                          </tr>
                        ))}
                      </AdminTable>
                    )}
                  </div>
                </AdminSurface>
              </>
            ),
          },
          {
            id: "operacion",
            label: "Operación y notificaciones",
            content: (
              <>
                <div className="grid gap-6 lg:grid-cols-3">
                  <AdminSurface className="p-5">
                    <AdminSectionTitle>Política de reservas</AdminSectionTitle>
                    <p className="mt-2 text-sm leading-6 text-muted">
                      No hay una interfaz para modificar la política de reservas. Las unidades reservadas pueden consultarse en Inventario FIFO.
                    </p>
                  </AdminSurface>
                  <AdminSurface className="p-5">
                    <AdminSectionTitle>Equipo administrativo</AdminSectionTitle>
                    <p className="mt-2 text-sm leading-6 text-muted">
                      La creación de nuevas cuentas administrativas aún no está disponible en este panel.
                    </p>
                  </AdminSurface>
                  <AdminSurface className="p-5">
                    <AdminSectionTitle>Estado operativo</AdminSectionTitle>
                    <p className="mt-2 text-sm leading-6 text-muted">
                      Guarda dirección/horarios y registra la tasa BCV aquí para completar el flujo operativo de la tienda.
                    </p>
                  </AdminSurface>
                </div>

                <AdminSurface className="p-5 sm:p-6">
                  <AdminSectionTitle>Dos manos, un mismo cuidado</AdminSectionTitle>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    Todas las notificaciones de la administración —avisos generales y
                    recordatorios SLA de comprobantes— se gestionan en una sola bandeja.
                    Consulta allí el estado, los destinos y las acciones de lectura.
                  </p>
                  <Link
                    href="/admin/notificaciones"
                    className="mt-4 inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border-[3px] border-white bg-lavender px-6 py-2 font-display text-sm font-bold text-ink shadow-sticker-secondary transition-all hover:brightness-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink"
                  >
                    Abrir notificaciones
                  </Link>
                </AdminSurface>
              </>
            ),
          },
        ]}
      />
    </>
  );
}