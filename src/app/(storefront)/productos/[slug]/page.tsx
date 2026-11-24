import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProductDetail } from "@/features/catalog/components/product-detail";
import { ProductDetailSkeleton } from "@/features/catalog/components/product-detail-skeleton";
import { getActiveProductBySlug } from "@/features/catalog/queries";
import {
  getActiveDeliveryZones,
  getProductStock,
} from "@/features/catalog/public-data";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import { listPublishedReviewsByProduct } from "@/features/reviews/queries";
import { ProductReviewsSection } from "@/features/reviews/components/product-reviews";

export const metadata: Metadata = {
  title: "Detalle del producto",
  description: "Información del producto disponible en el catálogo público.",
};

// Product detail reads request-bound Supabase/cookies; block prerendering.
export const instant = false;

export default function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return (
    <main className="container-page flex flex-col gap-8 py-10">
      <nav aria-label="Ruta de navegación" className="text-sm text-muted">
        <Link href="/" className="hover:text-pink hover:underline">
          Inicio
        </Link>
        <span aria-hidden="true"> / </span>
        <Link href="/productos" className="hover:text-pink hover:underline">
          Nuestras tortas
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page" className="text-ink">
          <Suspense fallback={null}>
            <SlugName params={params} />
          </Suspense>
        </span>
      </nav>

      <Suspense fallback={<ProductDetailSkeleton />}>
        <CatalogProduct params={params} />
      </Suspense>
    </main>
  );
}

async function SlugName({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <>{decodeURIComponent(slug)}</>;
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

  const [available, zones, reviews] = await Promise.all([
    getProductStock(product.id),
    getActiveDeliveryZones(),
    listPublishedReviewsByProduct(product.id),
  ]);

  return (
    <>
      <ProductDetail product={product} available={available} zones={zones} />
      <ProductReviewsSection
        productId={product.id}
        productName={product.name}
        reviews={reviews}
        aggregate={product.reviewAggregate ? { productId: product.id, reviewCount: product.reviewAggregate.reviewCount, averageRating: product.reviewAggregate.averageRating } : null}
      />
    </>
  );
}
