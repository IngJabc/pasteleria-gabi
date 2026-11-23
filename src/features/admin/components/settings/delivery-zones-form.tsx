"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AdminSectionTitle, AdminStatusChip } from "@/components/admin/admin-ui";
import { Button, Field, Input, LiveRegion } from "@/components/ui/ui";
import { useToast } from "@/components/ui/toast";
import { updateDeliveryZone } from "@/features/settings/admin-delivery-zones";
import type { AdminDeliveryZoneView } from "@/features/admin/settings-read";

type ZoneDraft = {
  name: string;
  description: string;
  feeUsd: string;
  requiresQuote: boolean;
  isActive: boolean;
  sortOrder: string;
};

function toDraft(zone: AdminDeliveryZoneView): ZoneDraft {
  return {
    name: zone.name,
    description: zone.description ?? "",
    feeUsd: zone.feeUsd.toFixed(2),
    requiresQuote: zone.requiresQuote,
    isActive: zone.isActive,
    sortOrder: String(zone.sortOrder),
  };
}

function ZoneRow({ zone }: { zone: AdminDeliveryZoneView }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<ZoneDraft>(() => toDraft(zone));
  const [feedback, setFeedback] = useState("");
  const [isError, setIsError] = useState(false);

  function set<K extends keyof ZoneDraft>(key: K, value: ZoneDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    setFeedback("");

    const sortOrder = Number(draft.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      const msg = "El orden debe ser un número entero mayor o igual a 0.";
      setIsError(true);
      setFeedback(msg);
      showToast(msg, "error");
      return;
    }

    startTransition(async () => {
      const result = await updateDeliveryZone({
        id: zone.id,
        name: draft.name,
        description: draft.description.trim() ? draft.description : null,
        feeUsd: draft.requiresQuote ? "0.00" : draft.feeUsd,
        requiresQuote: draft.requiresQuote,
        isActive: draft.isActive,
        sortOrder,
      });
      if (!result.ok) {
        setIsError(true);
        setFeedback(result.error);
        showToast(result.error, "error");
        return;
      }
      setIsError(false);
      setFeedback("Zona actualizada.");
      showToast(`Zona "${draft.name}" actualizada.`, "success");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={isPending}
      className="rounded-card border border-rose/60 bg-cream p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-extrabold text-plum">{zone.name}</p>
          <p className="text-sm text-muted">ID {zone.id}</p>
        </div>
        <AdminStatusChip tone={draft.isActive ? "mint" : "lavender"}>
          {draft.isActive ? "Activa" : "Inactiva"}
        </AdminStatusChip>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field id={`zone-${zone.id}-name`} label="Nombre">
          <Input id={`zone-${zone.id}-name`} value={draft.name} maxLength={120} required
            onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field
          id={`zone-${zone.id}-fee`}
          label="Tarifa USD"
          hint={
            draft.requiresQuote
              ? "Esta zona se cotiza manualmente según el caso; no tiene tarifa fija."
              : "Tarifa fija en USD para esta zona."
          }
        >
          <Input
            id={`zone-${zone.id}-fee`}
            value={draft.requiresQuote ? "0.00" : draft.feeUsd}
            inputMode="decimal"
            required
            pattern="^(?:0|[1-9]\d*)(?:\.\d{1,2})?$"
            disabled={draft.requiresQuote}
            onChange={(e) => set("feeUsd", e.target.value)}
          />
        </Field>
        <Field id={`zone-${zone.id}-sort`} label="Orden">
          <Input id={`zone-${zone.id}-sort`} value={draft.sortOrder} inputMode="numeric" required
            pattern="^\d+$" onChange={(e) => set("sortOrder", e.target.value)} />
        </Field>
        <Field id={`zone-${zone.id}-desc`} label="Descripción (opcional)">
          <Input id={`zone-${zone.id}-desc`} value={draft.description} maxLength={500}
            onChange={(e) => set("description", e.target.value)} />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap gap-4 text-sm">
        <label className="inline-flex items-center gap-2 font-bold text-ink">
          <input type="checkbox" checked={draft.requiresQuote}
            onChange={(e) => set("requiresQuote", e.target.checked)}
            className="size-4 accent-pink" />
          Requiere cotización
        </label>
        <label className="inline-flex items-center gap-2 font-bold text-ink">
          <input type="checkbox" checked={draft.isActive}
            onChange={(e) => set("isActive", e.target.checked)}
            className="size-4 accent-pink" />
          Zona activa
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Guardando…" : "Guardar zona"}
        </Button>
        <LiveRegion className={isError ? "text-pink" : "text-muted"}>{feedback}</LiveRegion>
      </div>
    </form>
  );
}

export function DeliveryZonesForm({ zones }: { zones: AdminDeliveryZoneView[] }) {
  if (zones.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-rose/60 bg-cream p-4 text-sm text-muted">
        No hay zonas de entrega registradas. La creación de nuevas zonas aún no está disponible en este panel.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <AdminSectionTitle>Zonas de entrega</AdminSectionTitle>
        <p className="mt-1 text-sm leading-6 text-muted">
          Edita nombre, tarifa, cotización, estado y orden. Los cambios se aplican a pedidos nuevos; los pedidos existentes conservan su snapshot.
        </p>
      </div>
      {zones.map((zone) => (
        <ZoneRow key={zone.id} zone={zone} />
      ))}
    </div>
  );
}
