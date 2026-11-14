/**
 * Storefront home — placeholder only.
 *
 * Phase 0 initializes structure, not features: the catalog, cart, checkout and
 * private order tracking links are documented in docs/ROADMAP.md and will be
 * implemented in later phases. Customer-facing routes live inside the
 * `(storefront)` route group.
 */
export default function HomePage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="text-sm font-medium tracking-widest text-zinc-500 uppercase">
        Fase 0 · Inicialización
      </p>
      <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Pastelería Online
      </h1>
      <p className="max-w-xl text-lg leading-8 text-zinc-600 dark:text-zinc-400">
        Tienda en línea de porciones de torta — Barquisimeto, Venezuela. El
        catálogo y el pedido online se habilitarán en las próximas fases.
      </p>
    </main>
  );
}
