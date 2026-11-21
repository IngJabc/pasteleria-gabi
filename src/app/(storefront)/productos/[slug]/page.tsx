import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  ProductDetail,
  ProductDetailSkeleton,
} from "@/features/catalog/components/product-detail";
import { getActiveProductBySlug } from "@/features/catalog/queries";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";

/** Static only: dynamic metadata would read runtime data outside Suspense. */
export const metadata: Metadata = {
  title: "Detalle del producto",
  description: "Información del producto disponible en el catálogo público.",
};

/** Static shell; params and database access stay inside the Suspense boundary. */
export default function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
      <nav aria-label="Ruta de navegación">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-md text-sm font-medium text-zinc-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-700 dark:text-zinc-300 dark:focus-visible:outline-zinc-300"
        >
          Volver al catálogo
        </Link>
      </nav>

      <Suspense fallback={<ProductDetailSkeleton />}>
        <CatalogProduct params={params} />
      </Suspense>
    </main>
  );
}

async function CatalogProduct({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const client = await createSupabaseServerClient();
  const product = await getActiveProductBySlug(client, slug);

  if (!product) notFound();

  return <ProductDetail product={product} />;
}
