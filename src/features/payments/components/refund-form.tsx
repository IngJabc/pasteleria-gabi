"use client";

import {
  useState,
  useTransition,
  type FormEvent,
  type MouseEvent,
  type SyntheticEvent,
} from "react";
import { useToast } from "@/components/ui/toast";
import {
  recordPaymentRefund,
  type RefundResult,
} from "@/features/payments/admin-payments";
import {
  createIdempotencyKey,
  isPositiveMoneyInput,
  moneyPattern,
  positiveMoneyMessage,
  resolveIdempotencyKey,
} from "@/features/payments/admin-ui";
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  hintClass,
  inputClass,
  labelClass,
  LiveRegion,
  textareaClass,
} from "@/components/ui/ui";

const paymentIdPattern = String.raw`^[1-9]\d*$`;
const invalidPaymentIdMessage = "Revisa el identificador del pago.";
const unexpectedError = "No se pudo completar la operación. Inténtalo de nuevo.";

/** Client form for refunds. Currency and administrator identity stay server-side. */
export function RefundForm() {
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    createIdempotencyKey("reembolso"),
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [result, setResult] = useState<RefundResult | null>(null);
  const [invalidFields, setInvalidFields] = useState<Record<string, boolean>>({});
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();

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
    const rawPaymentId = formData.get("paymentId");
    const rawAmount = formData.get("amount");
    const rawMethod = formData.get("method");
    const rawReason = formData.get("reason");

    const paymentId =
      typeof rawPaymentId === "string" ? Number(rawPaymentId.trim()) : Number.NaN;
    const amount = typeof rawAmount === "string" ? rawAmount.trim() : "";
    const method = typeof rawMethod === "string" ? rawMethod : "";
    const reason = typeof rawReason === "string" ? rawReason : "";

    setResult(null);
    setFeedback(null);

    if (!Number.isSafeInteger(paymentId) || paymentId <= 0) {
      setFeedback(invalidPaymentIdMessage);
      showToast(invalidPaymentIdMessage, "error");
      event.currentTarget
        .querySelector<HTMLInputElement>("#refund-payment-id")
        ?.focus();
      return;
    }

    if (!isPositiveMoneyInput(amount)) {
      setFeedback(positiveMoneyMessage);
      showToast(positiveMoneyMessage, "error");
      event.currentTarget.querySelector<HTMLInputElement>("#refund-amount")?.focus();
      return;
    }

    startTransition(async () => {
      try {
        const actionResult = await recordPaymentRefund({
          paymentId,
          amount,
          method,
          reason,
          idempotencyKey: resolveIdempotencyKey("reembolso", idempotencyKey, "retry"),
        });
        setResult(actionResult);
        const message = actionResult.ok
          ? actionResult.idempotent
            ? "Este reembolso ya estaba registrado con la clave actual."
            : "Reembolso registrado."
          : actionResult.error;
        setFeedback(message);
        showToast(message, actionResult.ok ? "success" : "error");
      } catch {
        setResult({ ok: false, error: unexpectedError });
        setFeedback(unexpectedError);
        showToast(unexpectedError, "error");
      }
    });
  }

  function handleReset(event: MouseEvent<HTMLButtonElement>): void {
    if (isPending) return;

    event.currentTarget.form?.reset();
    setInvalidFields({});
    setIdempotencyKey((current) =>
      resolveIdempotencyKey("reembolso", current, "reset"),
    );
    setResult(null);
    setFeedback(null);
  }

  const success = result?.ok ? result : null;

  return (
    <form
      aria-labelledby="refund-heading"
      aria-busy={isPending}
      onSubmit={handleSubmit}
      className="space-y-6"
    >
      <fieldset className="space-y-4 rounded-card border border-rose/60 bg-cream p-4">
        <legend className="px-2 font-display text-sm font-bold text-plum">
          Datos del reembolso
        </legend>

        <div>
          <label htmlFor="refund-payment-id" className={labelClass}>
            Identificador del pago <span aria-hidden="true">*</span>
          </label>
          <p
            id="refund-payment-id-hint"
            className={hintClass}
          >
            Número entero del pago registrado.
          </p>
          <input
            id="refund-payment-id"
            name="paymentId"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            required
            pattern={paymentIdPattern}
            aria-describedby="refund-payment-id-hint"
            aria-invalid={invalidFields["refund-payment-id"] ?? false}
            onBlur={syncFieldValidity}
            onChange={syncFieldValidity}
            onInvalid={syncFieldValidity}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="refund-amount" className={labelClass}>
            Monto a reembolsar <span aria-hidden="true">*</span>
          </label>
          <p id="refund-amount-hint" className={hintClass}>
            Hasta dos decimales, sin símbolo de moneda ni coma. La divisa la
            resuelve el servidor.
          </p>
          <input
            id="refund-amount"
            name="amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            required
            pattern={moneyPattern}
            aria-describedby="refund-amount-hint"
            aria-invalid={invalidFields["refund-amount"] ?? false}
            onBlur={syncFieldValidity}
            onChange={syncFieldValidity}
            onInvalid={syncFieldValidity}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="refund-method" className={labelClass}>
            Método <span aria-hidden="true">*</span>
          </label>
          <p id="refund-method-hint" className={hintClass}>
            Escribe el medio usado para devolver el dinero.
          </p>
          <input
            id="refund-method"
            name="method"
            type="text"
            maxLength={80}
            autoComplete="off"
            required
            aria-describedby="refund-method-hint"
            aria-invalid={invalidFields["refund-method"] ?? false}
            onBlur={syncFieldValidity}
            onChange={syncFieldValidity}
            onInvalid={syncFieldValidity}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="refund-reason" className={labelClass}>
            Motivo <span aria-hidden="true">*</span>
          </label>
          <textarea
            id="refund-reason"
            name="reason"
            rows={3}
            maxLength={240}
            autoComplete="off"
            required
            aria-invalid={invalidFields["refund-reason"] ?? false}
            onBlur={syncFieldValidity}
            onChange={syncFieldValidity}
            onInvalid={syncFieldValidity}
            className={textareaClass}
          />
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={isPending}
          className={buttonPrimaryClass}
        >
          {isPending ? "Registrando reembolso…" : "Registrar reembolso"}
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={isPending}
          className={buttonSecondaryClass}
        >
          Limpiar formulario
        </button>
      </div>

      <LiveRegion
        className={
          result && !result.ok ? "text-pink" : "text-muted"
        }
      >
        {isPending ? "Registrando reembolso…" : (feedback ?? "")}
      </LiveRegion>

      {success ? (
        <dl className="grid gap-3 rounded-card border border-rose/60 bg-cream p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-medium text-muted">Reembolso</dt>
            <dd className="text-ink">#{success.refundId}</dd>
          </div>
          <div>
            <dt className="font-medium text-muted">Pago</dt>
            <dd className="text-ink">#{success.paymentId}</dd>
          </div>
          <div>
            <dt className="font-medium text-muted">Estado</dt>
            <dd className="text-ink">{success.status}</dd>
          </div>
          {success.totalRefunded !== undefined ? (
            <div>
              <dt className="font-medium text-muted">
                Total reembolsado
              </dt>
              <dd className="text-ink">
                {String(success.totalRefunded)}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="font-medium text-muted">Idempotente</dt>
            <dd className="text-ink">
              {success.idempotent ? "Sí" : "No"}
            </dd>
          </div>
        </dl>
      ) : null}
    </form>
  );
}
