"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button, Field, Input, LiveRegion, inputClass } from "@/components/ui/ui";
import { useToast } from "@/components/ui/toast";

/**
 * Thin client wrappers around the two existing inventory RPC actions.
 *
 * The Server Actions are passed in from the page (a Server Component), so no
 * server-only module — and no administrator id — ever enters the client bundle.
 * Both forms are progressively enhanced through `useActionState`.
 */

type ActionResult = { ok: boolean; message: string };
type MutationState = ActionResult | null;

type AdjustInput = { batchId: string; quantity: number; reason: string };
type CreateInput = {
  productId: string;
  quantity: number;
  productionDate?: string;
};

type BatchOption = { batchId: number; label: string };
type ProductOption = { id: number; name: string };

export function AdjustInventoryForm({
  batches,
  adjustAction,
}: {
  batches: BatchOption[];
  adjustAction: (input: AdjustInput) => Promise<ActionResult>;
}) {
  const { showToast } = useToast();
  const lastState = useRef<MutationState>(null);
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<MutationState, FormData>(
    async (_previous, formData) => {
      const result = await adjustAction({
        batchId: String(formData.get("batchId") ?? ""),
        quantity: Number(String(formData.get("quantity") ?? "").trim()),
        reason: String(formData.get("reason") ?? ""),
      });
      if (result.ok) setOpen(false);
      return { ok: result.ok, message: result.message };
    },
    null,
  );

  useEffect(() => {
    if (!state || state === lastState.current) return;
    lastState.current = state;
    showToast(state.message, state.ok ? "success" : "error");
  }, [state, showToast]);

  return (
    <div className="space-y-3">
      <Button type="button" variant="secondary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Cerrar ajuste" : "Ajustar existencias"}
      </Button>
      {open ? (
    <form action={formAction} aria-busy={isPending} className="space-y-4">
      <Field
        id="adjust-batch"
        label="Lote"
        hint="Selecciona uno de los lotes listados arriba."
      >
        <select
          id="adjust-batch"
          name="batchId"
          required
          defaultValue=""
          disabled={isPending}
          className={inputClass}
        >
          <option value="" disabled>
            Selecciona un lote
          </option>
          {batches.map((batch) => (
            <option key={batch.batchId} value={String(batch.batchId)}>
              {batch.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        id="adjust-quantity"
        label="Cantidad"
        hint="Usa signo menos para descontar unidades. El servidor valida el rango."
      >
        <Input
          id="adjust-quantity"
          name="quantity"
          type="text"
          inputMode="numeric"
          pattern="-?[1-9][0-9]*"
          maxLength={8}
          autoComplete="off"
          required
          disabled={isPending}
          placeholder="Ej. -3 o 5"
        />
      </Field>

      <Field
        id="adjust-reason"
        label="Motivo"
        hint="Describe por qué se ajusta el inventario."
      >
        <Input
          id="adjust-reason"
          name="reason"
          type="text"
          maxLength={240}
          autoComplete="off"
          required
          disabled={isPending}
        />
      </Field>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Ajustando…" : "Aplicar ajuste"}
      </Button>

      <LiveRegion className={state && !state.ok ? "text-pink" : "text-muted"}>
        {isPending ? "Ajustando existencias…" : (state?.message ?? "")}
      </LiveRegion>
    </form>
      ) : null}
    </div>
  );
}

export function CreateInventoryBatchForm({
  products,
  createAction,
}: {
  products: ProductOption[];
  createAction: (input: CreateInput) => Promise<ActionResult>;
}) {
  const { showToast } = useToast();
  const lastState = useRef<MutationState>(null);
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<MutationState, FormData>(
    async (_previous, formData) => {
      const productionDate = String(
        formData.get("productionDate") ?? "",
      ).trim();
      const result = await createAction({
        productId: String(formData.get("productId") ?? ""),
        quantity: Number(String(formData.get("quantity") ?? "").trim()),
        ...(productionDate ? { productionDate } : {}),
      });
      if (result.ok) setOpen(false);
      return { ok: result.ok, message: result.message };
    },
    null,
  );

  useEffect(() => {
    if (!state || state === lastState.current) return;
    lastState.current = state;
    showToast(state.message, state.ok ? "success" : "error");
  }, [state, showToast]);

  return (
    <div className="space-y-3">
      <Button type="button" variant="secondary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Cerrar formulario" : "Registrar nuevo lote"}
      </Button>
      {open ? (
    <form action={formAction} aria-busy={isPending} className="space-y-4">
      <Field
        id="batch-product"
        label="Producto"
        hint="Solo productos registrados en el catálogo."
      >
        <select
          id="batch-product"
          name="productId"
          required
          defaultValue=""
          disabled={isPending}
          className={inputClass}
        >
          <option value="" disabled>
            Selecciona un producto
          </option>
          {products.map((product) => (
            <option key={product.id} value={String(product.id)}>
              {product.name}
            </option>
          ))}
        </select>
      </Field>

      <Field
        id="batch-quantity"
        label="Unidades"
        hint="Número entero positivo; el servidor valida el máximo."
      >
        <Input
          id="batch-quantity"
          name="quantity"
          type="text"
          inputMode="numeric"
          pattern="[1-9][0-9]*"
          maxLength={7}
          autoComplete="off"
          required
          disabled={isPending}
          placeholder="Ej. 12"
        />
      </Field>

      <Field
        id="batch-production-date"
        label="Fecha de producción"
        hint="Opcional. Si se omite, la fecha la resuelve el servidor."
      >
        <Input
          id="batch-production-date"
          name="productionDate"
          type="date"
          disabled={isPending}
        />
      </Field>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Registrando…" : "Registrar lote"}
      </Button>

      <LiveRegion className={state && !state.ok ? "text-pink" : "text-muted"}>
        {isPending ? "Registrando lote…" : (state?.message ?? "")}
      </LiveRegion>
    </form>
      ) : null}
    </div>
  );
}
