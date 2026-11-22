import type { Metadata } from "next";
import {
  catalogUnavailableError,
  listActiveProducts,
} from "@/features/catalog/queries";
import {
  AdminSessionError,
  requireActiveAdminId,
} from "@/features/payments/admin-session";
import { PosSaleForm, type PosProduct } from "@/features/payments/components/pos-sale-form";
import { RefundForm } from "@/features/payments/components/refund-form";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";

export const metadata: Metadata = {
  title: "Panel administrativo",
  robots: { index: false, follow: false },
};

// The session gate reads request cookies; keep the panel blocking so no static
// shell can expose controls before authorization resolves.
export const instant = false;

const shellClass = "mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-12";
const sectionClass =
  "space-y-5 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950";

/** Private panel: the session gate runs before any catalog read or form renders. */
export default async function AdminHomePage() {
  try {
    await requireActiveAdminId();
  } catch (error) {
    if (!(error instanceof AdminSessionError)) throw error;

    return (
      <main className={shellClass}>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Panel administrativo
        </h1>
        <p className="max-w-xl leading-7 text-zinc-600 dark:text-zinc-400">
          {error.message}
        </p>
      </main>
    );
  }

  let products: PosProduct[] = [];
  let catalogError: string | null = null;

  try {
    const catalog = await listActiveProducts(await createSupabaseServerClient());
    products = catalog.map(({ id, name, priceUsd }) => ({
      id,
      name,
      priceUsd: priceUsd.toFixed(2),
    }));
  } catch {
    // The catalog query only exposes a public Spanish message; never render
    // infrastructure details or a partial product list on failure.
    catalogError = catalogUnavailableError;
  }

  return (
    <main className={shellClass}>
      <header className="space-y-2">
        <p className="text-sm font-medium tracking-widest text-zinc-500 uppercase">
          Uso interno
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Panel administrativo
        </h1>
        <p className="max-w-2xl leading-7 text-zinc-600 dark:text-zinc-400">
          Registra ventas en efectivo y reembolsos de pagos ya registrados. El
          servidor valida cada operación y recalcula los importes.
        </p>
        <p>
          <a
            href="/admin/productos"
            className="inline-flex min-h-11 items-center rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-700 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:focus-visible:outline-zinc-300"
          >
            Administrar productos
          </a>
        </p>
      </header>

      <section aria-labelledby="pos-heading" className={sectionClass}>
        <h2
          id="pos-heading"
          className="text-xl font-semibold text-zinc-900 dark:text-zinc-50"
        >
          Venta POS en efectivo
        </h2>
        <PosSaleForm products={products} catalogError={catalogError} />
      </section>

      <section aria-labelledby="refund-heading" className={sectionClass}>
        <h2
          id="refund-heading"
          className="text-xl font-semibold text-zinc-900 dark:text-zinc-50"
        >
          Reembolso de pago
        </h2>
        <RefundForm />
      </section>
    </main>
  );
}
