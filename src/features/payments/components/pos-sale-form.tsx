"use client";

import {
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type SyntheticEvent,
} from "react";
import { formatUsd } from "@/features/catalog/components/price-format";
import {
  registerPosCashSale,
  type PosSaleResult,
} from "@/features/payments/admin-payments";
import {
  buildPosItems,
  createIdempotencyKey,
  moneyPattern,
  QUANTITY_FIELD_SELECTOR_PREFIX,
  quantityFieldName,
  resolveIdempotencyKey,
} from "@/features/payments/admin-ui";

export type PosProduct = {
  id: number;
  name: string;
  priceUsd: string;
};

const noItemsMessage = "Selecciona al menos un producto con una cantidad mayor que cero.";
const unexpectedError = "No se pudo completar la operación. Inténtalo de nuevo.";

const inputClass =
  "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 transition-colors aria-invalid:border-red-700 aria-invalid:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:aria-invalid:border-red-400 dark:aria-invalid:bg-red-950/30 dark:focus-visible:outline-zinc-300";
const labelClass = "mb-1 block text-sm font-medium text-zinc-800 dark:text-zinc-200";
const primaryButtonClass =
  "min-h-11 cursor-pointer rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:focus-visible:outline-zinc-100";
const secondaryButtonClass =
  "min-h-11 cursor-pointer rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:focus-visible:outline-zinc-300";

/** Client form for collected cash sales. All prices stay server-controlled. */
export function PosSaleForm({
  products,
  catalogError = null,
}: {
  products: PosProduct[];
  catalogError?: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    createIdempotencyKey("pos"),
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [result, setResult] = useState<PosSaleResult | null>(null);
  const [invalidFields, setInvalidFields] = useState<Record<string, boolean>>({});
  const [isPending, startTransition] = useTransition();

  function syncFieldValidity(
    event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void {
    const control = event.currentTarget;
    const invalid = control.matches(":user-invalid");
    setInvalidFields((current) =>
      current[control.id] === invalid
        ? current
        : { ...current, [control.id]: invalid },
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (isPending) return;

    const formData = new FormData(event.currentTarget);
    const items = buildPosItems(
      formData,
      products.map((product) => product.id),
    );
    const rawAmount = formData.get("amountTenderedUsd");
    const amountTenderedUsd = typeof rawAmount === "string" ? rawAmount.trim() : "";

    setResult(null);
    setFeedback(null);

    if (items.length === 0) {
      setFeedback(noItemsMessage);
      formRef.current
        ?.querySelector<HTMLInputElement>(
          `input[name^="${QUANTITY_FIELD_SELECTOR_PREFIX}"]`,
        )
        ?.focus();
      return;
    }

    startTransition(async () => {
      try {
        const actionResult = await registerPosCashSale({
          items,
          amountTenderedUsd,
          idempotencyKey: resolveIdempotencyKey("pos", idempotencyKey, "retry"),
        });
        setResult(actionResult);
        setFeedback(
          actionResult.ok
            ? actionResult.idempotent
              ? "Esta venta ya estaba registrada con la clave actual."
              : "Venta registrada."
            : actionResult.error,
        );
      } catch {
        setResult({ ok: false, error: unexpectedError });
        setFeedback(unexpectedError);
      }
    });
  }

  function handleReset(): void {
    if (isPending) return;

    formRef.current?.reset();
    setInvalidFields({});
    setIdempotencyKey((current) => resolveIdempotencyKey("pos", current, "reset"));
    setResult(null);
    setFeedback(null);
  }

  if (catalogError !== null) {
    return (
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="text-sm text-red-700 dark:text-red-300">{catalogError}</p>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No hay productos activos disponibles. No se puede registrar una venta
          POS hasta que el catálogo tenga productos.
        </p>
      </div>
    );
  }

  const success = result?.ok ? result : null;

  return (
    <form
      ref={formRef}
      aria-labelledby="pos-heading"
      aria-busy={isPending}
      onSubmit={handleSubmit}
      className="space-y-6"
    >
      <fieldset className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <legend className="px-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Productos disponibles
        </legend>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Indica cuántas unidades se entregan. Puedes dejar los demás productos
          en blanco.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {products.map((product) => {
            const quantityId = `pos-quantity-${product.id}`;

            return (
              <li
                key={product.id}
                className="flex flex-col rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <label htmlFor={quantityId} className={`${labelClass} cursor-pointer`}>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                    {product.name}
                  </span>{" "}
                  <span className="font-normal text-zinc-600 dark:text-zinc-400">
                    {formatUsd(Number(product.priceUsd))}
                  </span>
                </label>
                <input
                  id={quantityId}
                  name={quantityFieldName(product.id)}
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-invalid={invalidFields[quantityId] ?? false}
                  onBlur={syncFieldValidity}
                  onChange={syncFieldValidity}
                  onInvalid={syncFieldValidity}
                  className={inputClass}
                />
              </li>
            );
          })}
        </ul>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          El servidor recalcula los precios, el total y el vuelto.
        </p>
      </fieldset>

      <div>
        <label htmlFor="pos-amount-tendered" className={labelClass}>
          Monto entregado (USD) <span aria-hidden="true">*</span>
        </label>
        <p id="pos-amount-hint" className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
          Hasta dos decimales, sin símbolo de moneda ni coma.
        </p>
        <input
          id="pos-amount-tendered"
          name="amountTenderedUsd"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          required
          pattern={moneyPattern}
          aria-describedby="pos-amount-hint"
          aria-invalid={invalidFields["pos-amount-tendered"] ?? false}
          onBlur={syncFieldValidity}
          onChange={syncFieldValidity}
          onInvalid={syncFieldValidity}
          className={inputClass}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={isPending}
          className={primaryButtonClass}
        >
          {isPending ? "Registrando venta…" : "Registrar venta"}
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={isPending}
          className={secondaryButtonClass}
        >
          Nueva operación
        </button>
      </div>

      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={`min-h-6 text-sm ${
          result && !result.ok
            ? "text-red-700 dark:text-red-300"
            : "text-zinc-600 dark:text-zinc-400"
        }`}
      >
        {isPending ? "Registrando venta…" : (feedback ?? "")}
      </p>

      {success ? (
        <dl className="grid gap-3 rounded-lg border border-zinc-200 p-4 text-sm sm:grid-cols-2 dark:border-zinc-800">
          <div>
            <dt className="font-medium text-zinc-500 dark:text-zinc-400">Pedido</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">#{success.orderId}</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-500 dark:text-zinc-400">Pago</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">#{success.paymentId}</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-500 dark:text-zinc-400">Estado</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">{success.status}</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-500 dark:text-zinc-400">Vuelto</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">
              {formatUsd(Number(success.changeUsd))}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-500 dark:text-zinc-400">Idempotente</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">
              {success.idempotent ? "Sí" : "No"}
            </dd>
          </div>
        </dl>
      ) : null}
    </form>
  );
}
