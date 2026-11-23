"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getTrackingStatuses } from "../tracking-statuses";
import { useTrackingLinks } from "../tracking-links-store";
import { Button, LiveRegion } from "@/components/ui/ui";
import { ArrowRightIcon } from "@/components/ui/icons";

type StatusTone = "yellow" | "mint" | "lavender" | "rose";

const STATUS_VIEWS: Record<string, { label: string; tone: StatusTone }> = {
  pending: { label: "Pendiente", tone: "yellow" },
  confirmed: { label: "Confirmado", tone: "mint" },
  preparing: { label: "En preparación", tone: "lavender" },
  ready: { label: "Listo", tone: "lavender" },
  delivered: { label: "Entregado", tone: "mint" },
  completed: { label: "Entregado", tone: "mint" },
  canceled: { label: "Cancelado", tone: "rose" },
  expired: { label: "Vencido", tone: "rose" },
};

const TONE_CLASS: Record<StatusTone, string> = {
  yellow: "bg-yellow text-ink",
  mint: "bg-mint text-ink",
  lavender: "bg-lavender text-ink",
  rose: "bg-rose text-plum",
};

function statusView(status: string | undefined): { label: string; tone: StatusTone } | null {
  if (!status) return null;
  return (
    STATUS_VIEWS[status] ?? {
      label: status.trim() !== "" ? status : "Estado desconocido",
      tone: "lavender",
    }
  );
}

function formatSavedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-VE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function TrackingLinksList() {
  const { items, hydrated, remove } = useTrackingLinks();
  const [statuses, setStatuses] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!hydrated || items.length === 0) return;
    let cancelled = false;
    const tokens = items.map((item) => item.token);
    void getTrackingStatuses(tokens).then((next) => {
      if (!cancelled) setStatuses(next);
    });
    return () => {
      cancelled = true;
    };
  }, [hydrated, items]);

  if (!hydrated) {
    return (
      <p aria-busy="true" className="text-sm text-muted">
        Cargando tus pedidos guardados en este dispositivo…
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-card bg-lavender p-6 shadow-sm">
        <h2 className="font-display text-2xl font-extrabold text-plum">
          No hay pedidos guardados en este dispositivo
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-ink">
          Cuando completes un pedido, su enlace privado se guardará aquí para que
          puedas volver a consultarlo. Si ya hiciste un pedido en otro dispositivo
          o borraste los datos del navegador, usa el enlace de confirmación que
          recibiste al finalizar la compra.
        </p>
      </div>
    );
  }

  return (
    <section aria-labelledby="saved-orders-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="saved-orders-title"
            className="font-display text-2xl font-extrabold text-plum"
          >
            Pedidos guardados en este dispositivo
          </h2>
          <p className="mt-1 text-sm text-muted">
            Solo se guardan enlaces que abriste o creaste desde este navegador.
          </p>
        </div>
        <span className="rounded-full bg-lavender px-4 py-2 font-display text-sm font-bold text-ink">
          {items.length} {items.length === 1 ? "pedido" : "pedidos"}
        </span>
      </div>

      <ul className="grid gap-4">
        {items.map((item) => {
          const view = statusView(statuses[item.token]);
          return (
            <li
              key={item.token}
              className="rounded-card bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-display text-xl font-extrabold text-plum">
                      Pedido #{item.orderId}
                    </p>
                    {view ? (
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${TONE_CLASS[view.tone]}`}
                      >
                        {view.label}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    Guardado: {formatSavedDate(item.savedAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Link
                    href={`/seguimiento/${item.token}`}
                    className="inline-flex items-center gap-1 rounded-full bg-pink px-4 py-2 font-display text-sm font-bold text-white transition-all hover:opacity-90 active:translate-y-[2px]"
                  >
                    Ver seguimiento
                    <ArrowRightIcon />
                  </Link>
                  <Button
                    variant="ghost"
                    onClick={() => remove(item.token)}
                    aria-label={`Quitar pedido #${item.orderId} de esta lista`}
                  >
                    Quitar de este dispositivo
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <LiveRegion className="sr-only">{""}</LiveRegion>
    </section>
  );
}
