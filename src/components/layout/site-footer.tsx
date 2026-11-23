/** Storefront footer with the atelier identity and service information. */
export function SiteFooter() {
  return (
    <footer className="mt-auto bg-lavender">
      <div className="container-page grid gap-8 py-12 md:grid-cols-2">
        <div>
          <p className="font-display text-2xl font-extrabold text-plum">
            dulce atelier
          </p>
          <p className="mt-2 text-muted">
            Pequeños antojos. Grandes momentos.
          </p>
        </div>
        <div className="text-sm leading-6 text-ink">
          <p>Barquisimeto, Venezuela</p>
          <p>Mar–Dom · 9:00 a. m. – 6:00 p. m.</p>
        </div>
        <p className="text-sm text-muted md:col-span-2">
          Ingredientes honestos / Hecho a mano / Mucho amor
        </p>
      </div>
    </footer>
  );
}
