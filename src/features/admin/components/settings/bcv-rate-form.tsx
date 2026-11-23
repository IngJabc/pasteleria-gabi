"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AdminSectionTitle } from "@/components/admin/admin-ui";
import { Button, Field, Input, LiveRegion } from "@/components/ui/ui";
import { useToast } from "@/components/ui/toast";
import { registerBcvRate } from "@/features/exchange-rates/admin-rates";
import { createIdempotencyKey, resolveIdempotencyKey } from "@/features/payments/admin-ui";

const ratePattern = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;

export function BcvRateForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [idempotencyKey, setIdempotencyKey] = useState(() => createIdempotencyKey("bcv-rate"));
  const [feedback, setFeedback] = useState("");
  const [isError, setIsError] = useState(false);
  const { showToast } = useToast();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    setFeedback("");

    const formData = new FormData(event.currentTarget);
    const rate = String(formData.get("rate") ?? "").trim();
    const source = String(formData.get("source") ?? "").trim();
    const note = String(formData.get("note") ?? "").trim();
    const observedAtRaw = String(formData.get("observedAt") ?? "").trim();

    if (!ratePattern.test(rate) || Number(rate) <= 0) {
      setIsError(true);
      const msg = "La tasa debe ser un número mayor que cero con hasta 4 decimales.";
      setFeedback(msg);
      showToast(msg, "error");
      return;
    }
    if (source.length === 0) {
      setIsError(true);
      const msg = "El origen de la tasa es obligatorio.";
      setFeedback(msg);
      showToast(msg, "error");
      return;
    }

    let observedAt: string | undefined;
    if (observedAtRaw) {
      const parsed = new Date(observedAtRaw);
      if (!Number.isFinite(parsed.getTime())) {
        setIsError(true);
        const msg = "La fecha de observación no es válida.";
        setFeedback(msg);
        showToast(msg, "error");
        return;
      }
      observedAt = parsed.toISOString();
    }

    startTransition(async () => {
      const result = await registerBcvRate({
        rate,
        source,
        observedAt,
        note: note.length > 0 ? note : undefined,
        idempotencyKey: resolveIdempotencyKey("bcv-rate", idempotencyKey, "retry"),
      });
      if (!result.ok) {
        setIsError(true);
        setFeedback(result.error);
        showToast(result.error, "error");
        return;
      }
      const message = result.idempotent
        ? `Tasa ya registrada (id ${result.rateId}).`
        : `Tasa BCV registrada (id ${result.rateId}).`;
      setIsError(false);
      setFeedback(message);
      showToast(message, "success");
      setIdempotencyKey(createIdempotencyKey("bcv-rate"));
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} aria-busy={isPending} className="space-y-4">
      <div>
        <AdminSectionTitle>Registrar tasa BCV</AdminSectionTitle>
        <p className="mt-1 text-sm leading-6 text-muted">
          La tasa activa se usa para el snapshot informativo en VES de los pedidos. Registrar una nueva tasa no modifica snapshots ya aplicados.
        </p>
      </div>

      <Field id="bcv-rate" label="Tasa (VES por USD)" hint="Hasta 4 decimales. Ej.: 36.5000">
        <Input id="bcv-rate" name="rate" inputMode="decimal" required pattern={ratePattern.source} placeholder="36.5000" />
      </Field>

      <Field id="bcv-source" label="Origen / referencia" hint="Ej.: BCV, captura manual, URL o nota interna.">
        <Input id="bcv-source" name="source" required maxLength={120} placeholder="BCV" />
      </Field>

      <Field id="bcv-observed-at" label="Fecha/hora observada (opcional)" hint="Si se omite, se usa la hora actual del servidor.">
        <Input id="bcv-observed-at" name="observedAt" type="datetime-local" />
      </Field>

      <Field id="bcv-note" label="Nota (opcional)">
        <Input id="bcv-note" name="note" maxLength={500} placeholder="Nota interna" />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Registrando…" : "Registrar tasa"}
        </Button>
        <LiveRegion className={isError ? "text-pink" : "text-muted"}>{feedback}</LiveRegion>
      </div>
    </form>
  );
}