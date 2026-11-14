/**
 * Administrative panel — placeholder only.
 *
 * The `/admin` segment is reserved for the private panel used by the two
 * administrators (SPEC.md sections 2 and 15). Authentication and every admin
 * module arrive in later phases; this route intentionally renders no data and
 * has no permission checks yet, so nothing sensitive can leak in Phase 0.
 * Administrative routes are kept apart from customer-facing routes both at the
 * route level (`app/(admin)/admin`) and at the feature level (`src/features`).
 */
export default function AdminHomePage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="text-sm font-medium tracking-widest text-zinc-500 uppercase">
        Fase 0 · Inicialización
      </p>
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Panel administrativo
      </h1>
      <p className="max-w-xl leading-8 text-zinc-600 dark:text-zinc-400">
        Ruta reservada para el panel privado: pedidos, productos, inventario,
        pagos y estadísticas. La autenticación y los módulos se construirán en
        fases posteriores.
      </p>
    </main>
  );
}
