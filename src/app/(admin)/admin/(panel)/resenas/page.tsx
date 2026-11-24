import type { Metadata } from "next";
import { AdminBanner, AdminEmptyState, AdminPageHeader } from "@/components/admin/admin-ui";
import { AdminReviewsManager } from "@/features/reviews/components/admin-reviews-manager";
import { listAdminReviews } from "@/features/reviews/admin";
import { listActiveReviewProducts } from "@/features/reviews/queries";
import { adminReviewFilterSchema } from "@/features/reviews/schemas";

export const metadata: Metadata = {
  title: "Reseñas | Panel administrativo",
  robots: { index: false, follow: false },
};

export const instant = false;

export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const filter = adminReviewFilterSchema.parse({
    status: typeof sp.status === "string" ? sp.status : undefined,
    productId: typeof sp.productId === "string" ? sp.productId : undefined,
    rating: typeof sp.rating === "string" ? sp.rating : undefined,
    search: typeof sp.search === "string" ? sp.search : undefined,
    page: typeof sp.page === "string" ? sp.page : undefined,
  });

  const [result, products] = await Promise.all([
    listAdminReviews(filter),
    listActiveReviewProducts(),
  ]);

  return (
    <>
      <AdminPageHeader
        title="Reseñas de productos"
        subtitle="Las reseñas se publican inmediatamente. Puedes ocultarlas o restaurarlas sin eliminarlas."
      />
      {result.unavailable ? (
        <div className="space-y-4">
          <AdminBanner tone="yellow">{result.message}</AdminBanner>
          <AdminEmptyState title="Reseñas no disponibles" description="No se pudo consultar la información de reseñas en este momento." />
        </div>
      ) : (
        <AdminReviewsManager rows={result.items} products={products} filter={filter} />
      )}
    </>
  );
}
