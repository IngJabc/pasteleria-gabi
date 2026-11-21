"use client";

import {
  useState,
  useTransition,
  type FormEvent,
  type MouseEvent,
  type SyntheticEvent,
} from "react";
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

const paymentIdPattern = String.raw`^[1-9]\d*$`;
const invalidPaymentIdMessage = "Revisa el identificador del pago.";
const unexpectedError = "No se pudo completar la operación. Inténtalo de nuevo.";

const inputClass =
  "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 transition-colors aria-invalid:border-red-700 aria-invalid:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:aria-invalid:border-red-400 dark:aria-invalid:bg-red-950/30 dark:focus-visible:outline-zinc-300";
const textareaClass = `${inputClass} resize-y`;
const labelClass = "mb-1 block text-sm font-medium text-zinc-800 dark:text-zinc-200";
const primaryButtonClass =
  "min-h-11 cursor-pointer rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:focus-visible:outline-zinc-100";
const secondaryButtonClass =
  "min-h-11 cursor-pointer rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:focus-visible:outline-zinc-300";

/** Client form for refunds. Currency and administrator identity stay server-side. */
export function RefundForm() {
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    createIdempotencyKey("reembolso"),
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [result, setResult] = useState<RefundResult | null>(null);
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
      event.currentTarget
        .querySelector<HTMLInputElement>("#refund-payment-id")
        ?.focus();
      return;
    }

    if (!isPositiveMoneyInput(amount)) {
      setFeedback(positiveMoneyMessage);
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
        setFeedback(
          actionResult.ok
            ? actionResult.idempotent
              ? "Este reembolso ya estaba registrado con la clave actual."
              : "Reembolso registrado."
            : actionResult.error,
        );
      } catch {
        setResult({ ok: false, error: unexpectedError });
        setFeedback(unexpectedError);
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
      <fieldset className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <legend className="px-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Datos del reembolso
        </legend>

        <div>
          <label htmlFor="refund-payment-id" className={labelClass}>
            Identificador del pago <span aria-hidden="true">*</span>
          </label>
          <p
            id="refund-payment-id-hint"
            className="mb-2 text-sm text-zinc-600 dark:text-zinc-400"
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
          <p id="refund-amount-hint" className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
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
          <p id="refund-method-hint" className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
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
          className={primaryButtonClass}
        >
          {isPending ? "Registrando reembolso…" : "Registrar reembolso"}
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
        {isPending ? "Registrando reembolso…" : (feedback ?? "")}
      </p>

      {success ? (
        <dl className="grid gap-3 rounded-lg border border-zinc-200 p-4 text-sm sm:grid-cols-2 dark:border-zinc-800">
          <div>
            <dt className="font-medium text-zinc-500 dark:text-zinc-400">Reembolso</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">#{success.refundId}</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-500 dark:text-zinc-400">Pago</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">#{success.paymentId}</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-500 dark:text-zinc-400">Estado</dt>
            <dd className="text-zinc-900 dark:text-zinc-50">{success.status}</dd>
          </div>
          {success.totalRefunded !== undefined ? (
            <div>
              <dt className="font-medium text-zinc-500 dark:text-zinc-400">
                Total reembolsado
              </dt>
              <dd className="text-zinc-900 dark:text-zinc-50">
                {String(success.totalRefunded)}
              </dd>
            </div>
          ) : null}
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
