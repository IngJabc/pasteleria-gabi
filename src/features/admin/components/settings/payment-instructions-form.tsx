"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AdminSectionTitle } from "@/components/admin/admin-ui";
import { Button, Field, Input, LiveRegion, Textarea } from "@/components/ui/ui";
import { useToast } from "@/components/ui/toast";
import { updateStoreSettings } from "@/features/settings/admin-settings";
import type { PaymentInstructions, PaymentMethodInstruction } from "@/features/settings/schemas";

type MethodKey = "pago_movil" | "binance_pay" | "binance_transfer";

const METHODS: Array<{ key: MethodKey; label: string; currency: string; fields: Array<keyof PaymentMethodInstruction> }> = [
  {
    key: "pago_movil",
    label: "Pago Móvil",
    currency: "VES",
    fields: ["label", "bank", "phone", "document", "holder", "account", "note"],
  },
  {
    key: "binance_pay",
    label: "Binance Pay",
    currency: "USDT",
    fields: ["label", "account", "email", "holder", "note"],
  },
  {
    key: "binance_transfer",
    label: "Transferencia Binance",
    currency: "USDT",
    fields: ["label", "account", "network", "email", "holder", "note"],
  },
];

const FIELD_LABELS: Record<string, string> = {
  label: "Nombre visible (opcional)",
  account: "Cuenta / ID / Pay ID",
  holder: "Titular",
  bank: "Banco / Plataforma",
  phone: "Teléfono",
  document: "Documento / RIF",
  email: "Correo",
  network: "Red",
  note: "Nota para el cliente",
};

function fieldLabel(method: MethodKey, field: keyof PaymentMethodInstruction): string {
  if (field === "holder" && method === "binance_pay") return "Nickname";
  return FIELD_LABELS[String(field)] ?? String(field);
}

function emptyInstruction(): PaymentMethodInstruction {
  return {};
}

function normalize(initial: PaymentInstructions | null): Record<MethodKey, PaymentMethodInstruction> {
  return {
    pago_movil: { ...emptyInstruction(), ...(initial?.pago_movil ?? {}) },
    binance_pay: { ...emptyInstruction(), ...(initial?.binance_pay ?? {}) },
    binance_transfer: { ...emptyInstruction(), ...(initial?.binance_transfer ?? {}) },
  };
}

export function PaymentInstructionsForm({
  initialPaymentInstructions,
}: {
  initialPaymentInstructions: PaymentInstructions | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(() => normalize(initialPaymentInstructions));
  const [feedback, setFeedback] = useState("");
  const [isError, setIsError] = useState(false);
  const { showToast } = useToast();

  function setField(method: MethodKey, field: keyof PaymentMethodInstruction, fieldValue: string) {
    setValue((current) => ({
      ...current,
      [method]: { ...current[method], [field]: fieldValue },
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    setFeedback("");

    // Strip empty strings so schema stores undefined/null-cleanly.
    const cleaned: PaymentInstructions = {};
    for (const method of METHODS) {
      const entry: PaymentMethodInstruction = {};
      for (const field of method.fields) {
        const raw = value[method.key][field];
        if (typeof raw === "string") {
          const trimmed = raw.trim();
          if (trimmed.length > 0) (entry as Record<string, string>)[field] = trimmed;
        }
      }
      if (Object.keys(entry).length > 0) cleaned[method.key] = entry;
    }

    startTransition(async () => {
      const result = await updateStoreSettings({
        paymentInstructions: Object.keys(cleaned).length > 0 ? cleaned : null,
      });
      if (!result.ok) {
        setIsError(true);
        setFeedback(result.error);
        showToast(result.error, "error");
        return;
      }
      setIsError(false);
      setFeedback("Datos de pago guardados.");
      showToast("Datos de pago guardados.", "success");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} aria-busy={isPending} className="space-y-6">
      <div>
        <AdminSectionTitle>Datos de métodos de pago</AdminSectionTitle>
        <p className="mt-1 text-sm leading-6 text-muted">
          Estos datos se muestran al cliente en el checkout. Solo se muestran los campos que configures; no inventamos datos.
        </p>
      </div>

      {METHODS.map((method) => (
        <fieldset key={method.key} className="rounded-field border border-rose/60 bg-cream p-4">
          <legend className="font-display font-bold text-plum">
            {method.label} <span className="text-sm font-normal text-muted">({method.currency})</span>
          </legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {method.fields.map((field) => {
              const id = `pay-${method.key}-${String(field)}`;
              const label = fieldLabel(method.key, field);
              const val = (value[method.key][field] as string | undefined) ?? "";
              if (field === "note") {
                return (
                  <div key={field} className="sm:col-span-2">
                    <label htmlFor={id} className="mb-1 block font-display text-sm font-bold text-ink">
                      {label}
                    </label>
                    <Textarea
                      id={id}
                      value={val}
                      onChange={(e) => setField(method.key, field, e.target.value)}
                      maxLength={500}
                      rows={2}
                    />
                  </div>
                );
              }
              return (
                <Field key={field} id={id} label={label}>
                  <Input
                    id={id}
                    value={val}
                    onChange={(e) => setField(method.key, field, e.target.value)}
                    maxLength={field === "account" ? 300 : 200}
                  />
                </Field>
              );
            })}
          </div>
        </fieldset>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Guardando…" : "Guardar datos de pago"}
        </Button>
        <LiveRegion className={isError ? "text-pink" : "text-muted"}>{feedback}</LiveRegion>
      </div>
    </form>
  );
}
