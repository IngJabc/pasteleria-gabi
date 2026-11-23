import type { Metadata } from "next";
import {
  AdminBanner,
  AdminEmptyState,
  AdminPageHeader,
  AdminSectionTitle,
  AdminSurface,
} from "@/components/admin/admin-ui";
import {
  ExternalPaymentForm,
  type ExternalPaymentOrder,
} from "@/features/admin/components/payments/external-payment-form";
import { orderPickerLabel } from "@/features/admin/components/payments/payment-display";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";

export const metadata: Metadata = {
  title: "Pago externo | Panel administrativo",
  robots: { index: false, follow: false },
};

// The session gate reads request cookies; keep the panel blocking so no static
// shell can expose controls before authorization resolves.
export const instant = false;

const ORDER_LIMIT = 50;
const unavailableMessage = "No se pudieron cargar los pedidos. Inténtalo de nuevo.";

export default async function AdminExternalPaymentPage({
  searchParams,
}: {
  searchParams?: Promise<{ orderId?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const requestedOrderId = typeof params.orderId === "string" && /^[1-9]\d*$/.test(params.orderId) ? Number(params.orderId) : null;
  const orders: ExternalPaymentOrder[] = [];
  let unavailable = false;

  try {
    // Read-only, cookie-bound query: the existing admin RLS policy is the gate.
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("orders")
      .select("id, customer_name, total_usd")
      .eq("channel", "online")
      .in("status", ["pending", "confirmed", "ready"])
      .order("id", { ascending: false })
      .limit(ORDER_LIMIT);

    if (error) {
      unavailable = true;
    } else {
      for (const row of data ?? []) {
        if (!Number.isSafeInteger(row.id) || row.id <= 0) continue;
        const totalUsd = Number(row.total_usd);
        if (!Number.isFinite(totalUsd)) continue;
        orders.push({
          id: row.id,
          label: orderPickerLabel(row.id, row.customer_name),
          totalUsd,
        });
      }
    }
  } catch {
    unavailable = true;
  }

  return (
    <>
      <AdminPageHeader
        title="Registrar pago externo"
        subtitle="Registra un pago recibido fuera de la web contra un pedido online existente."
      />

      <div className="mb-6">
        <AdminBanner tone="lavender">
          Por ahora solo se pueden registrar pagos en efectivo USD contra pedidos
          existentes. Otros métodos y pagos combinados aún no están disponibles.
        </AdminBanner>
      </div>

      {unavailable ? (
        <div className="mb-6">
          <AdminBanner tone="yellow">{unavailableMessage}</AdminBanner>
        </div>
      ) : null}

      {orders.length === 0 ? (
        <AdminEmptyState
          title="No hay pedidos online disponibles para asociar un pago."
          description={
            unavailable
              ? "No se pudo consultar la lista de pedidos en este momento."
              : "Cuando exista un pedido online abierto, podrás seleccionarlo aquí."
          }
        />
      ) : (
        <AdminSurface>
          <div className="mb-6">
            <AdminSectionTitle>Datos del pago</AdminSectionTitle>
            <p className="mt-2 text-sm leading-6 text-muted">
              Selecciona el pedido, indica el importe y confirma. El servidor
              valida el registro y recalcula los importes.
            </p>
          </div>
          <ExternalPaymentForm orders={orders} initialOrderId={requestedOrderId} />
        </AdminSurface>
      )}
    </>
  );
}

