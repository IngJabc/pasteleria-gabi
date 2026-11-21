import type { Metadata } from "next";
import { Suspense } from "react";
import { ReceiptReviewControl } from "@/features/payments/receipt-review-control";
import { trackingTokenSchema } from "@/features/payments/schemas";

/** OQ-12: private tracking link hosts the token-authorised receipt review control. */
export const metadata: Metadata = {
  title: "Seguimiento del pedido",
  robots: { index: false, follow: false },
};

export default function TrackingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="space-y-2">
        <p className="text-sm font-medium tracking-widest text-zinc-500 uppercase">
          Enlace privado
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Seguimiento del pedido
        </h1>
      </header>

      <Suspense
        fallback={
          <p aria-busy="true" className="text-sm text-zinc-600 dark:text-zinc-400">
            Preparando el enlace…
          </p>
        }
      >
        {params.then(({ token }) => (
          <TrackingReceiptControl token={token} />
        ))}
      </Suspense>
    </main>
  );
}

function TrackingReceiptControl({ token }: { token: string }) {
  const parsed = trackingTokenSchema.safeParse(token);
  if (!parsed.success) {
    return (
      <p className="text-sm text-red-700 dark:text-red-300">
        El enlace de seguimiento no es válido.
      </p>
    );
  }

  return <ReceiptReviewControl trackingToken={parsed.data} />;
}
