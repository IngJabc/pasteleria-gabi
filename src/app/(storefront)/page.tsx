import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProductGrid } from "@/features/catalog/components/product-grid";
import { listActiveProducts } from "@/features/catalog/queries";
import { getProductStockMap } from "@/features/catalog/public-data";
import { getStoreSettings } from "@/features/settings/admin-settings";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import { ArrowRightIcon, FlowerIcon, HeartIcon } from "@/components/ui/icons";
import { buttonPrimaryClass } from "@/components/ui/ui";
import { HomepageReviewsSection } from "@/features/reviews/components/homepage-reviews";

export default function HomePage() {
  return (
    <main className="flex flex-col">
      <Suspense fallback={<HomeSkeleton />}>
        <HomeData />
      </Suspense>
    </main>
  );
}

async function HomeData() {
  await connection();
  const client = await createSupabaseServerClient();
  const products = await listActiveProducts(client).catch(() => []);
  const stock = await getProductStockMap(products.map((p) => p.id)).catch(() => ({}));
  const settings = await getStoreSettings().catch(() => null);

  const featured = products.slice(0, 4);
  const heroImage = products[0]?.images[0] ?? null;
  const whatsapp = settings?.whatsapp_phone ?? null;

  return (
    <>
      <section className="container-page pt-8">
        <div className="relative overflow-hidden rounded-section bg-lavender px-6 py-12 md:px-12 md:py-16">
          <div className="grid items-center gap-10 md:grid-cols-2">
            <div className="flex flex-col items-start gap-5">
              <p className="text-eyebrow">Pequeñas alegrías, recién hechas</p>
              <h1 className="font-display text-4xl font-extrabold leading-[1.05] text-plum md:text-6xl">
                La vida es más dulce con torta.
              </h1>
              <p className="max-w-md text-lg leading-7 text-ink">
                Hechas con amor, ingredientes honestos y ese sabor que convierte
                cualquier día en celebración.
              </p>
              <Link
                href="/productos"
                className={`${buttonPrimaryClass} mt-2`}
              >
                Encuentra tu favorita
                <ArrowRightIcon />
              </Link>
              <p className="flex items-center gap-2 text-sm font-bold text-ink">
                <HeartIcon className="size-4 text-pink" />
                Horneado artesanal
                <span aria-hidden="true" className="text-muted">
                  •
                </span>
                Barquisimeto
              </p>
            </div>

            <div className="relative">
              {heroImage ? (
                <Image
                  src={heroImage.url}
                  alt={heroImage.alt}
                  width={1200}
                  height={900}
                  priority
                  className="aspect-[4/3] w-full rounded-section border-4 border-white object-cover shadow-sm"
                />
              ) : (
                <div className="flex aspect-[4/3] w-full items-center justify-center rounded-section border-4 border-white bg-rose text-pink">
                  <FlowerIcon className="size-16" />
                </div>
              )}
              <p className="absolute right-4 bottom-4 rounded-full border-2 border-white bg-pink-soft px-4 py-1 text-sm font-bold text-ink shadow-sm">
                100% hecho con amor
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="container-page pt-12">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-eyebrow">Tortas para celebrar o darte un gusto</p>
            <h2 className="mt-2 font-display text-3xl font-extrabold text-plum md:text-4xl">
              Los favoritos de todos
            </h2>
          </div>
          <Link
            href="/productos"
            className="hidden items-center gap-1 font-display text-base font-bold text-pink hover:underline sm:inline-flex"
          >
            Ver todo el catálogo
            <ArrowRightIcon />
          </Link>
        </div>

        <div className="mt-6">
          {products.length === 0 ? (
            <p className="rounded-card border border-white bg-white p-8 text-center text-muted shadow-sm">
              Aún no hay productos publicados. Vuelve pronto.
            </p>
          ) : (
            <ProductGrid products={featured} stock={stock} />
          )}
        </div>

        <Link
          href="/productos"
          className="mt-6 inline-flex items-center gap-1 font-display text-base font-bold text-pink hover:underline sm:hidden"
        >
          Ver todo el catálogo
          <ArrowRightIcon />
        </Link>
      </section>

      <section className="container-page pt-12">
        <div className="grid gap-8 rounded-section bg-yellow px-6 py-10 md:grid-cols-2 md:px-12">
          <div>
            <h2 className="font-display text-3xl font-extrabold text-plum md:text-4xl">
              Mucho más que una torta.
            </h2>
            <p className="mt-3 max-w-md leading-7 text-ink">
              Ingredientes de verdad. Pequeños lotes. Recetas que saben a hogar y
              se ven de fiesta.
            </p>
          </div>
          <ol className="flex flex-col gap-2 font-display text-lg font-bold text-plum">
            <li>
              <span className="text-pink">01</span> Elige tu antojo
            </li>
            <li>
              <span className="text-pink">02</span> Paga a tu manera
            </li>
            <li>
              <span className="text-pink">03</span> Recibe un momento feliz
            </li>
          </ol>
        </div>
      </section>

      <HomepageReviewsSection
        products={products.map((p) => ({ id: p.id, name: p.name, slug: p.slug, priceUsd: p.priceUsd }))}
        aggregatesByProductId={Object.fromEntries(
          products.map((p) => [p.id, p.reviewAggregate ? { productId: p.id, reviewCount: p.reviewAggregate.reviewCount, averageRating: p.reviewAggregate.averageRating } : undefined]),
        )}
      />

      <section className="container-page py-12">
        <div className="grid gap-8 rounded-section bg-sky px-6 py-10 md:grid-cols-2 md:px-12">
          <h2 className="font-display text-3xl font-extrabold text-plum md:text-4xl">
            ¿Tienes algo especial en mente?
          </h2>
          <div className="flex flex-col items-start gap-4">
            <p className="leading-7 text-ink">
              Cumpleaños, sorpresas o un &ldquo;porque sí&rdquo;. Nos encanta ser
              parte de tu historia.
            </p>
            {whatsapp ? (
              <a
                href={(() => {
                  let digits = whatsapp.replace(/\D/g, "");
                  if (digits.length === 11 && digits.startsWith("0")) {
                    digits = `58${digits.slice(1)}`;
                  }
                  return `https://wa.me/${digits}`;
                })()}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonPrimaryClass}
              >
                Hablemos por WhatsApp
              </a>
            ) : (
              <span
                aria-disabled="true"
                title="La atención por WhatsApp se anunciará pronto."
                className={`${buttonPrimaryClass} cursor-not-allowed opacity-60`}
              >
                Hablemos por WhatsApp
              </span>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

function HomeSkeleton() {
  return (
    <div aria-busy="true" className="container-page flex flex-col gap-12 py-8">
      <p className="sr-only">Cargando la página principal…</p>
      <div className="h-80 rounded-section bg-lavender/60" />
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((slot) => (
          <div
            key={slot}
            className="overflow-hidden rounded-card border border-white bg-white shadow-sm"
          >
            <div className="aspect-[4/3] w-full bg-rose/70" />
            <div className="space-y-3 p-4">
              <div className="h-5 w-2/3 rounded bg-lavender/60" />
              <div className="h-4 w-full rounded bg-rose/70" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
