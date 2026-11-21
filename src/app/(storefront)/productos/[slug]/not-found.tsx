import Link from "next/link";

/** Localized fallback rendered when a slug is missing or no longer active. */
export default function ProductNotFound() {
  return (
    <div className="flex max-w-2xl flex-col items-start gap-4 rounded-xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-950">
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Producto no disponible
      </h1>
      <p className="leading-7 text-zinc-600 dark:text-zinc-400">
        El producto que buscas no está disponible o ya no forma parte del
        catálogo.
      </p>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center rounded-md text-sm font-medium text-zinc-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-700 dark:text-zinc-300 dark:focus-visible:outline-zinc-300"
      >
        Volver al catálogo
      </Link>
    </div>
  );
}
