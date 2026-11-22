import type { Metadata } from "next";
import {
  catalogUnavailableError,
  listAdminProducts,
} from "@/features/catalog/queries";
import { AdminProductList } from "@/features/catalog/components/admin-product-list";
import {
  AdminSessionError,
  requireActiveAdminId,
} from "@/features/payments/admin-session";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";

export const metadata: Metadata = {
  title: "Productos | Panel administrativo",
  robots: { index: false, follow: false },
};

// The session gate reads request cookies; keep the panel blocking so no static
// shell can expose controls before authorization resolves.
export const instant = false;

const shellClass = "mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-12";

export default async function AdminProductsPage() {
  let sessionError: string | null = null;
  try {
    await requireActiveAdminId();
  } catch (error) {
    if (!(error instanceof AdminSessionError)) throw error;
    sessionError = error.message;
  }

  if (sessionError) {
    return (
      <main className={shellClass}>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Productos
        </h1>
        <p className="max-w-xl leading-7 text-zinc-600 dark:text-zinc-400">
          {sessionError}
        </p>
      </main>
    );
  }

  let products: Awaited<ReturnType<typeof listAdminProducts>> = [];
  let loadError: string | null = null;
  try {
    products = await listAdminProducts(await createSupabaseServerClient());
  } catch {
    loadError = catalogUnavailableError;
  }

  return (
    <main className={shellClass}>
      <header className="space-y-2">
        <p className="text-sm font-medium tracking-widest text-zinc-500 uppercase">
          Uso interno
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Productos
        </h1>
        <p className="max-w-2xl leading-7 text-zinc-600 dark:text-zinc-400">
          Crea, edita, activa o desactiva productos y administra sus imágenes.
          Los precios y la visibilidad se validan en servidor.
        </p>
      </header>
      {loadError ? (
        <p className="max-w-xl leading-7 text-red-700 dark:text-red-300">
          {loadError}
        </p>
      ) : (
        <AdminProductList initialProducts={products} />
      )}
    </main>
  );
}
