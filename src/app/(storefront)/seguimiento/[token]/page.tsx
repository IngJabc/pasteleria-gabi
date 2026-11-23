import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { trackingTokenSchema } from "@/features/payments/schemas";
import { getOrderByTracking } from "@/features/orders/tracking";
import { getPaymentSummaryForTracking } from "@/features/payments/payment-summary";
import { TrackingView } from "@/features/orders/components/tracking-view";
import { getStoreSettings } from "@/features/settings/admin-settings";

export const metadata: Metadata = {
  title: "Seguimiento del pedido",
  robots: { index: false, follow: false },
};

export default function TrackingPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ confirmacion?: string; pago?: string }>;
}) {
  return (
    <main className="container-page flex flex-col gap-8 py-10">
      <Suspense
        fallback={
          <p aria-busy="true" className="text-sm text-muted">
            Cargando tu pedido…
          </p>
        }
      >
        <TrackingData params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function TrackingData({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ confirmacion?: string; pago?: string }>;
}) {
  await connection();
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const parsed = trackingTokenSchema.safeParse(token);
  if (!parsed.success) notFound();

  const [order, summaryResult, storeSettings] = await Promise.all([
    getOrderByTracking(parsed.data),
    getPaymentSummaryForTracking({ trackingToken: parsed.data }),
    getStoreSettings(),
  ]);
  if (!order) notFound();
  const summary =
    summaryResult.ok &&
    summaryResult.summary &&
    !Array.isArray(summaryResult.summary)
      ? (summaryResult.summary as Record<
          string,
          {
            approved_amount: number | string;
            pending_amount: number | string;
            in_review_amount: number | string;
            rejected_amount: number | string;
            refunded_amount: number | string;
            payment_count: number;
          }
        >)
      : {};

  return (
    <TrackingView
      token={parsed.data}
      order={order}
      summary={summary}
      confirmation={query.confirmacion === "1"}
      payInStoreConfirmed={query.pago === "tienda"}
      whatsappPhone={storeSettings?.whatsapp_phone ?? null}
    />
  );
}