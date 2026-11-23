"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, LiveRegion } from "@/components/ui/ui";
import { useToast } from "@/components/ui/toast";
import { setAdminDeliveryQuote } from "@/features/admin/delivery-quote";

function moneyInputValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  return value.toFixed(2);
}

export function DeliveryQuoteForm({
  orderId,
  currentFeeUsd,
  canEdit,
  disabledReason,
}: {
  orderId: number;
  currentFeeUsd: number | null;
  canEdit: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");
  const [isError, setIsError] = useState(false);
  const { showToast } = useToast();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending || !canEdit) return;
    const formData = new FormData(event.currentTarget);
    const deliveryFeeUsd = String(formData.get("deliveryFeeUsd") ?? "").trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(deliveryFeeUsd)) {
      setIsError(true);
      setFeedback("Ingresa una tarifa válida en USD (ej. 5.00).");
      return;
    }

    setFeedback("");
    startTransition(async () => {
      const result = await setAdminDeliveryQuote({ orderId, deliveryFeeUsd });
      if (!result.ok) {
        setIsError(true);
        setFeedback(result.error);
        showToast(result.error, "error");
        return;
      }
      const message = result.idempotent
        ? "La cotización ya estaba guardada con ese valor."
        : "Cotización de delivery guardada.";
      setIsError(false);
      setFeedback(message);
      showToast(message, "success");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3" aria-busy={isPending}>
      <Field id={`delivery-quote-${orderId}`} label="Tarifa delivery (USD)" hint="Se recalcula el total del pedido al guardar.">
        <Input
          id={`delivery-quote-${orderId}`}
          name="deliveryFeeUsd"
          inputMode="decimal"
          defaultValue={moneyInputValue(currentFeeUsd)}
          placeholder="5.00"
          disabled={!canEdit || isPending}
          required
        />
      </Field>
      {!canEdit && disabledReason ? (
        <p className="text-sm leading-6 text-muted">{disabledReason}</p>
      ) : null}
      <Button type="submit" variant="secondary" disabled={!canEdit || isPending}>
        {isPending ? "Guardando…" : "Guardar cotización"}
      </Button>
      <LiveRegion className={isError ? "text-pink" : "text-muted"}>{feedback}</LiveRegion>
    </form>
  );
}
