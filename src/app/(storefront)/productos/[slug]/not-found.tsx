import Link from "next/link";

/** Localized fallback rendered when a slug is missing or no longer active. */
export default function ProductNotFound() {
  return (
    <div className="flex max-w-2xl flex-col items-start gap-4 rounded-card bg-white p-10 shadow-sm">
      <h1 className="font-display text-3xl font-extrabold text-plum">
        Producto no disponible
      </h1>
      <p className="leading-7 text-muted">
        El producto que buscas no está disponible o ya no forma parte del
        catálogo.
      </p>
      <Link
        href="/productos"
        className="inline-flex min-h-11 items-center font-display text-base font-bold text-pink underline-offset-4 hover:underline"
      >
        Volver al catálogo
      </Link>
    </div>
  );
}
