import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckoutPaymentForm } from "@/features/payments/components/checkout-payment-form";
import { CheckoutSteps } from "@/features/cart/components/cart-client";
import { getOrderByTracking, getCheckoutToken } from "@/features/orders/tracking";
import { getPaymentSummaryForTracking } from "@/features/payments/payment-summary";
import { getCurrentBcvRate } from "@/features/exchange-rates/checkout-rates";
import { getPublicPaymentInstructions } from "@/features/catalog/public-data";
import { ArrowRightIcon } from "@/components/ui/icons";

export const metadata: Metadata = {
  title: "Pago",
  description: "Registra el comprobante de tu pago.",
};

// Reads the httpOnly checkout cookie and order state at request time.
export const instant = false;

export default async function PaymentPage() {
  const token = await getCheckoutToken();
  if (!token) redirect("/carrito");

  const order = await getOrderByTracking(token);
  if (!order) redirect("/carrito");

  const [summaryResult, rateResult, paymentInstructions] = await Promise.all([
    getPaymentSummaryForTracking({ trackingToken: token }),
    getCurrentBcvRate(),
    getPublicPaymentInstructions(),
  ]);

  const summary =
    summaryResult.ok && summaryResult.summary && !Array.isArray(summaryResult.summary)
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
    <main className="container-page flex flex-col gap-8 py-10">
      <div className="flex items-center justify-between gap-4">
        <CheckoutSteps current={3} />
        <Link
          href="/productos"
          className="hidden items-center gap-1 font-display text-base font-bold text-pink hover:underline sm:inline-flex"
        >
          Volver al catálogo
          <ArrowRightIcon />
        </Link>
      </div>

      <h1 className="font-display text-4xl font-extrabold text-plum md:text-5xl">
        Paga a tu manera
      </h1>

      <CheckoutPaymentForm
        orderId={order.order_id}
        trackingToken={token}
        totalUsd={order.total_usd}
        subtotalUsd={order.subtotal_usd}
        deliveryFeeUsd={order.delivery_fee_usd}
        deliveryRequiresQuote={order.delivery_requires_quote === true}
        fulfillmentType={order.fulfillment_type === "pickup" ? "pickup" : "delivery"}
        summary={summary}
        rate={rateResult.ok ? rateResult.rate : null}
        paymentInstructions={paymentInstructions}
      />
    </main>
  );
}
