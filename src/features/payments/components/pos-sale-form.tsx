"use client";

import {
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type SyntheticEvent,
} from "react";
import { useToast } from "@/components/ui/toast";
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
  "min-h-11 w-full rounded-field border border-rose bg-white px-4 py-2 text-base text-ink shadow-sm transition-colors placeholder:text-muted/70 hover:border-lavender focus-visible:border-lavender focus-visible:outline-none aria-invalid:border-pink aria-invalid:bg-rose/40";
const labelClass = "mb-2 block font-display text-sm font-bold text-ink";
const primaryButtonClass =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full border-[3px] border-white bg-pink-soft px-6 py-2 font-display text-base font-bold text-ink shadow-sticker transition-all hover:brightness-[0.98] active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full border-[3px] border-white bg-lavender px-6 py-2 font-display text-base font-bold text-ink shadow-sticker-secondary transition-all hover:brightness-[0.98] active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-60";

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
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [amountTendered, setAmountTendered] = useState("");
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();

  const estimatedTotal = useMemo(
    () =>
      products.reduce((sum, product) => {
        const raw = quantities[product.id] ?? "";
        if (!/^[1-9]\d*$/.test(raw.trim())) return sum;
        const qty = Number(raw);
        if (!Number.isSafeInteger(qty) || qty <= 0) return sum;
        return sum + Number(product.priceUsd) * qty;
      }, 0),
    [products, quantities],
  );
  const tenderedNumber = moneyPattern && new RegExp(moneyPattern).test(amountTendered.trim())
    ? Number(amountTendered)
    : NaN;
  const estimatedChange =
    Number.isFinite(tenderedNumber) && tenderedNumber >= estimatedTotal
      ? tenderedNumber - estimatedTotal
      : null;

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
      showToast(noItemsMessage, "error");
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
        const message = actionResult.ok
          ? actionResult.idempotent
            ? "Esta venta ya estaba registrada con la clave actual."
            : "Venta registrada."
          : actionResult.error;
        setFeedback(message);
        showToast(message, actionResult.ok ? "success" : "error");
        if (actionResult.ok) {
          formRef.current?.reset();
          setInvalidFields({});
          setQuantities({});
          setAmountTendered("");
          setIdempotencyKey(createIdempotencyKey("pos"));
        }
      } catch {
        setResult({ ok: false, error: unexpectedError });
        setFeedback(unexpectedError);
        showToast(unexpectedError, "error");
      }
    });
  }

  function handleReset(): void {
    if (isPending) return;

    formRef.current?.reset();
    setInvalidFields({});
    setQuantities({});
    setAmountTendered("");
    setIdempotencyKey((current) => resolveIdempotencyKey("pos", current, "reset"));
    setResult(null);
    setFeedback(null);
  }

  if (catalogError !== null) {
    return (
      <div className="rounded-card border border-rose bg-white p-4">
        <p className="text-sm text-pink">{catalogError}</p>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="rounded-card border border-rose bg-white p-4">
        <p className="text-sm leading-6 text-muted">
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
      <fieldset className="space-y-4 rounded-card border border-rose bg-white p-4">
        <legend className="px-2 font-display text-sm font-bold text-plum">
          Productos disponibles
        </legend>
        <p className="text-sm leading-6 text-muted">
          Indica cuántas unidades se entregan. Puedes dejar los demás productos
          en blanco.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {products.map((product) => {
            const quantityId = `pos-quantity-${product.id}`;

            return (
              <li
                key={product.id}
                className="flex flex-col rounded-field border border-rose p-3"
              >
                <label htmlFor={quantityId} className={`${labelClass} cursor-pointer`}>
                  <span className="font-bold text-ink">
                    {product.name}
                  </span>{" "}
                  <span className="font-normal text-muted">
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
                  onChange={(event) => {
                    const { value } = event.currentTarget;
                    syncFieldValidity(event);
                    setQuantities((current) => ({ ...current, [product.id]: value }));
                  }}
                  onInvalid={syncFieldValidity}
                  className={inputClass}
                />
              </li>
            );
          })}
        </ul>
        <p className="text-sm leading-6 text-muted">
          El servidor recalcula los precios, el total y el vuelto.
        </p>
      </fieldset>

      <div>
        <label htmlFor="pos-amount-tendered" className={labelClass}>
          Monto entregado (USD) <span aria-hidden="true">*</span>
        </label>
        <p id="pos-amount-hint" className="mb-2 text-sm leading-6 text-muted">
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
          onChange={(event) => {
            syncFieldValidity(event);
            setAmountTendered(event.currentTarget.value);
          }}
          onInvalid={syncFieldValidity}
          className={inputClass}
        />
      </div>

      <dl className="grid gap-3 rounded-card border border-rose bg-lavender/40 p-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="font-bold text-muted">Total estimado</dt>
          <dd className="font-display text-lg font-extrabold text-plum">{formatUsd(estimatedTotal)}</dd>
        </div>
        <div>
          <dt className="font-bold text-muted">Monto recibido</dt>
          <dd className="font-display text-lg font-extrabold text-plum">{Number.isFinite(tenderedNumber) ? formatUsd(tenderedNumber) : "—"}</dd>
        </div>
        <div>
          <dt className="font-bold text-muted">Vuelto estimado</dt>
          <dd className="font-display text-lg font-extrabold text-plum">{estimatedChange !== null ? formatUsd(estimatedChange) : "—"}</dd>
        </div>
      </dl>
      <p className="text-sm leading-6 text-muted">El total y el vuelto finales los confirma el servidor al registrar la venta.</p>

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
          Limpiar formulario
        </button>
      </div>

      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={`min-h-6 text-sm ${
          result && !result.ok ? "text-pink" : "text-muted"
        }`}
      >
        {isPending ? "Registrando venta…" : (feedback ?? "")}
      </p>

      {success ? (
        <dl className="grid gap-3 rounded-card border border-rose bg-white p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-bold text-muted">Pedido</dt>
            <dd className="text-ink">#{success.orderId}</dd>
          </div>
          <div>
            <dt className="font-bold text-muted">Pago</dt>
            <dd className="text-ink">#{success.paymentId}</dd>
          </div>
          <div>
            <dt className="font-bold text-muted">Estado</dt>
            <dd className="text-ink">{success.status}</dd>
          </div>
          <div>
            <dt className="font-bold text-muted">Vuelto</dt>
            <dd className="text-ink">
              {formatUsd(Number(success.changeUsd))}
            </dd>
          </div>
          <div>
            <dt className="font-bold text-muted">Idempotente</dt>
            <dd className="text-ink">
              {success.idempotent ? "Sí" : "No"}
            </dd>
          </div>
        </dl>
      ) : null}
    </form>
  );
}
