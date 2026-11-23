/** Static fallback kept inside the detail page's Suspense boundary. */
export function ProductDetailSkeleton() {
  return (
    <div aria-busy="true" className="grid gap-10 lg:grid-cols-2">
      <p className="sr-only">Cargando producto…</p>
      <div aria-hidden="true" className="aspect-[4/3] w-full rounded-section bg-lavender/60" />
      <div aria-hidden="true" className="space-y-4">
        <div className="h-6 w-1/3 rounded bg-rose" />
        <div className="h-12 w-2/3 rounded bg-lavender/60" />
        <div className="h-8 w-1/3 rounded bg-lavender/60" />
        <div className="h-4 w-full rounded bg-rose/70" />
        <div className="h-4 w-5/6 rounded bg-rose/70" />
      </div>
    </div>
  );
}
