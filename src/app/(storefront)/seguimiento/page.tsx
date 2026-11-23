import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon } from "@/components/ui/icons";
import { TrackingLinksList } from "@/features/orders/components/tracking-links-list";

export const metadata: Metadata = {
  title: "Mis pedidos",
  description: "Accede a tus pedidos guardados en este dispositivo.",
  robots: { index: false, follow: false },
};

export default function TrackingLandingPage() {
  return (
    <main className="container-page flex flex-col gap-8 py-16">
      <div className="space-y-3">
        <p className="text-eyebrow">Enlace privado</p>
        <h1 className="font-display text-4xl font-extrabold text-plum md:text-5xl">
          Sigue tus pedidos
        </h1>
        <p className="max-w-2xl text-lg leading-7 text-ink">
          Aquí ves los pedidos cuyo enlace privado se guardó en este navegador.
          Cada pedido tiene su propio enlace; por seguridad, no mostramos un listado
          público de todos los pedidos.
        </p>
        <p className="max-w-2xl text-sm leading-6 text-muted">
          Si no ves un pedido, puede ser porque lo hiciste en otro dispositivo,
          borraste los datos del navegador o no guardaste el enlace. Actualmente la
          plataforma no envía el enlace automáticamente por WhatsApp, correo o SMS;
          si lo perdiste, contáctanos por WhatsApp con los datos de tu compra.
        </p>
      </div>

      <TrackingLinksList />

      <Link
        href="/productos"
        className="inline-flex items-center gap-1 font-display text-base font-bold text-pink hover:underline"
      >
        Ver el catálogo
        <ArrowRightIcon />
      </Link>
    </main>
  );
}
