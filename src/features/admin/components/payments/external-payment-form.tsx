"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { AdminSectionTitle } from "@/components/admin/admin-ui";
import {
  Button,
  Field,
  Input,
  LiveRegion,
  inputClass,
} from "@/components/ui/ui";
import { useToast } from "@/components/ui/toast";
import { formatMoneyUsd } from "@/features/admin/format";
import {
  registerCashPayment,
  type CashPaymentResult,
} from "@/features/payments/admin-payments";
import {
  createIdempotencyKey,
  isPositiveMoneyInput,
  moneyPattern,
  positiveMoneyMessage,
  resolveIdempotencyKey,
} from "@/features/payments/admin-ui";
import { paymentStatusLabel } from "./payment-display";

/** Projection of a REAL online order row, prepared by the server page. */
export type ExternalPaymentOrder = {
  id: number;
  label: string;
  totalUsd: number;
};

const idempotencyPrefix = "pago-externo";
const unexpectedError = "No se pudo completar la operación. Inténtalo de nuevo.";
const invalidOrderMessage = "Selecciona un pedido válido.";
const invalidTenderedMessage = "El monto recibido no es válido.";
const moneyRegExp = new RegExp(moneyPattern);

/** Feedback is built only from the real result of the existing action. */
function feedbackFor(result: CashPaymentResult): string {
  if (!result.ok) return result.error;
  const prefix = result.idempotent
    ? "Pago ya registrado con la clave actual"
    : "Pago registrado";
  const base = `${prefix}: pago #${result.paymentId} del pedido #${result.orderId} en estado ${paymentStatusLabel(result.status)}.`;
  const change =
    result.changeUsd !== null && Number.isFinite(Number(result.changeUsd))
      ? ` Vuelto: ${formatMoneyUsd(Number(result.changeUsd))}.`
      : "";
  return `${base}${change}`;
}

/**
 * Registers a cash-USD payment against an existing online order.
 * The order list and its totals are server-derived; the action remains the only
 * authority for amounts, currency, method, administrator and idempotency.
 */
export function ExternalPaymentForm({
  orders,
  initialOrderId = null,
}: {
  orders: ExternalPaymentOrder[];
  initialOrderId?: number | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    createIdempotencyKey(idempotencyPrefix),
  );
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(
    initialOrderId !== null && orders.some((order) => order.id === initialOrderId)
      ? initialOrderId
      : null,
  );
  const [feedback, setFeedback] = useState("");
  const [isError, setIsError] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();

  const selectedOrder =
    orders.find((order) => order.id === selectedOrderId) ?? null;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (isPending) return;

    const formData = new FormData(event.currentTarget);
    const rawOrderId = formData.get("orderId");
    const orderId =
      typeof rawOrderId === "string" && /^[1-9]\d*$/.test(rawOrderId.trim())
        ? Number(rawOrderId.trim())
        : Number.NaN;
    const rawAmount = formData.get("amount");
    const amount = typeof rawAmount === "string" ? rawAmount.trim() : "";
    const rawTendered = formData.get("amountTenderedUsd");
    const tendered = typeof rawTendered === "string" ? rawTendered.trim() : "";

    setFeedback("");

    if (!orders.some((order) => order.id === orderId)) {
      setIsError(true);
      setFeedback(invalidOrderMessage);
      showToast(invalidOrderMessage, "error");
      return;
    }
    if (!isPositiveMoneyInput(amount)) {
      setIsError(true);
      setFeedback(positiveMoneyMessage);
      showToast(positiveMoneyMessage, "error");
      formRef.current?.querySelector<HTMLInputElement>("#external-amount")?.focus();
      return;
    }
    if (tendered !== "" && !moneyRegExp.test(tendered)) {
      setIsError(true);
      setFeedback(invalidTenderedMessage);
      showToast(invalidTenderedMessage, "error");
      formRef.current
        ?.querySelector<HTMLInputElement>("#external-amount-tendered")
        ?.focus();
      return;
    }

    startTransition(async () => {
      try {
        const result = await registerCashPayment({
          orderId,
          amount,
          amountTenderedUsd: tendered === "" ? undefined : tendered,
          idempotencyKey: resolveIdempotencyKey(
            idempotencyPrefix,
            idempotencyKey,
            "retry",
          ),
        });
        const message = feedbackFor(result);
        setIsError(!result.ok);
        setFeedback(message);
        showToast(message, result.ok ? "success" : "error");
        if (result.ok) {
          formRef.current?.reset();
          setSelectedOrderId(null);
          setIdempotencyKey(createIdempotencyKey(idempotencyPrefix));
        }
      } catch {
        setIsError(true);
        setFeedback(unexpectedError);
        showToast(unexpectedError, "error");
      }
    });
  }

  function handleReset(): void {
    if (isPending) return;
    formRef.current?.reset();
    setSelectedOrderId(null);
    setIdempotencyKey((current) =>
      resolveIdempotencyKey(idempotencyPrefix, current, "reset"),
    );
    setFeedback("");
    setIsError(false);
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      aria-busy={isPending}
      aria-label="Registrar pago externo en efectivo USD"
      className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]"
    >
      <div className="space-y-8">
        <fieldset className="space-y-4">
          <legend className="mb-4 font-display text-lg font-extrabold text-plum">
            1. Asocia el pedido
          </legend>
          <Field
            id="external-order"
            label="Pedido online existente"
            hint="Se muestran los pedidos online disponibles en la cola real."
          >
            <select
              id="external-order"
              name="orderId"
              required
              defaultValue={selectedOrderId !== null ? String(selectedOrderId) : ""}
              className={inputClass}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setSelectedOrderId(
                  /^[1-9]\d*$/.test(value) ? Number(value) : null,
                );
              }}
            >
              <option value="" disabled>
                Selecciona un pedido
              </option>
              {orders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.label}
                </option>
              ))}
            </select>
          </Field>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-4 font-display text-lg font-extrabold text-plum">
            2. Detalles del pago
          </legend>
          <Field id="external-method" label="Método de pago">
            <Input
              id="external-method"
              value="Efectivo USD"
              readOnly
              aria-describedby="external-method-hint"
            />
            <p id="external-method-hint" className="mt-2 text-sm text-muted">
              El registro se realiza como pago en efectivo en USD.
            </p>
          </Field>
          <Field
            id="external-amount"
            label="Monto del pago (USD)"
            hint="Hasta dos decimales, sin símbolo de moneda ni coma."
          >
            <Input
              id="external-amount"
              name="amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              required
              pattern={moneyPattern}
            />
          </Field>
          <Field
            id="external-amount-tendered"
            label="Monto recibido (USD)"
            hint="Si se deja en blanco, se usa el monto del pago. Hasta dos decimales."
          >
            <Input
              id="external-amount-tendered"
              name="amountTenderedUsd"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              pattern={moneyPattern}
            />
          </Field>
          <Field
            id="external-reference"
            label="Referencia"
            hint="Los pagos en efectivo USD no registran una referencia bancaria; este dato corresponde al pedido."
          >
            <Input
              id="external-reference"
              value={selectedOrder ? `#${selectedOrder.id}` : "—"}
              readOnly
              tabIndex={-1}
            />
          </Field>
        </fieldset>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Registrando pago…" : "Registrar pago"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleReset}
            disabled={isPending}
          >
            Limpiar formulario
          </Button>
        </div>
        <LiveRegion className={isError ? "text-pink" : "text-muted"}>
          {isPending ? "Registrando pago…" : feedback}
        </LiveRegion>
      </div>

      <aside
        aria-labelledby="external-conciliation-heading"
        className="h-fit space-y-4 rounded-card border border-rose bg-cream p-5"
      >
        <div id="external-conciliation-heading">
          <AdminSectionTitle>Conciliación del pedido</AdminSectionTitle>
        </div>
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="font-bold text-muted">Pedido asociado</dt>
            <dd className="text-ink">
              {selectedOrder ? `#${selectedOrder.id}` : "—"}
            </dd>
          </div>
          <div>
            <dt className="font-bold text-muted">Total registrado del pedido</dt>
            <dd className="font-display text-lg font-extrabold text-plum">
              {selectedOrder ? formatMoneyUsd(selectedOrder.totalUsd) : "—"}
            </dd>
          </div>
        </dl>
        <p className="text-sm leading-6 text-muted">
          {selectedOrder
            ? "El total mostrado corresponde al pedido seleccionado. El servidor valida el importe que se registra."
            : "Selecciona un pedido para consultar su total registrado."}
        </p>
      </aside>
    </form>
  );
}
