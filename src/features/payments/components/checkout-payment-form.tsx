"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmPayInStoreOrder, registerCheckoutPayment } from "../checkout-payment";
import { formatUsd } from "@/features/catalog/components/price-format";
import type { CurrentBcvRate } from "@/features/exchange-rates/checkout-rates";
import { useCart } from "@/features/cart/cart-context";
import type { PaymentInstructions, PaymentMethodInstruction } from "@/features/settings/schemas";
import { Button, Field, Input, LiveRegion } from "@/components/ui/ui";
import { ArrowRightIcon, CheckIcon, ClockIcon } from "@/components/ui/icons";

type Method = "pago_movil" | "binance_pay" | "binance_transfer" | "pay_in_store";

type Summary = Record<
  string,
  {
    approved_amount: number | string;
    pending_amount: number | string;
    in_review_amount: number | string;
    rejected_amount: number | string;
    refunded_amount: number | string;
    payment_count: number;
  }
>;

const METHODS: Array<{
  id: Method;
  title: string;
  currency: "VES" | "USDT";
  fallbackNote: string;
}> = [
  {
    id: "pago_movil",
    title: "Pago Móvil",
    currency: "VES",
    fallbackNote: "Los datos para realizar el pago no están configurados todavía. Contacta al atelier antes de transferir.",
  },
  {
    id: "binance_pay",
    title: "Binance Pay",
    currency: "USDT",
    fallbackNote: "Los datos de Binance Pay no están configurados todavía. Contacta al atelier antes de transferir.",
  },
  {
    id: "binance_transfer",
    title: "Transferencia a usuario",
    currency: "USDT",
    fallbackNote: "Los datos de transferencia Binance no están configurados todavía. Contacta al atelier antes de transferir.",
  },
];

function hasConfiguredDetails(instruction: PaymentMethodInstruction | undefined): boolean {
  if (!instruction) return false;
  return Boolean(
    instruction.account ||
      instruction.holder ||
      instruction.bank ||
      instruction.phone ||
      instruction.document ||
      instruction.email ||
      instruction.network ||
      instruction.note,
  );
}

function DetailRow({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-bold text-ink">{value}</dd>
    </div>
  );
}

const numberPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

export function CheckoutPaymentForm({
  orderId,
  trackingToken,
  totalUsd,
  subtotalUsd,
  deliveryFeeUsd,
  deliveryRequiresQuote,
  fulfillmentType,
  summary,
  rate,
  paymentInstructions,
}: {
  orderId: number;
  trackingToken: string;
  totalUsd: number;
  subtotalUsd: number;
  deliveryFeeUsd: number | null;
  deliveryRequiresQuote: boolean;
  fulfillmentType: "delivery" | "pickup";
  summary: Summary;
  rate: CurrentBcvRate | null;
  paymentInstructions: PaymentInstructions | null;
}) {
  const router = useRouter();
  const { clear: clearCart } = useCart();
  const formRef = useRef<HTMLFormElement>(null);
  const [method, setMethod] = useState<Method>("pago_movil");
  const isPayInStore = method === "pay_in_store";
  const [isPending, startTransition] = useTransition();
  const [isPayInStorePending, startPayInStoreTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [copyAmountFeedback, setCopyAmountFeedback] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const quotePending = deliveryRequiresQuote && deliveryFeeUsd === null;

  const referenceRate = rate?.rateVesPerUsd ?? null;
  const referenceVes =
    referenceRate === null ? null : totalUsd * Number(referenceRate);

  async function handleCopyAmount() {
    if (referenceVes === null) return;
    const value = referenceVes.toFixed(2);
    try {
      await navigator.clipboard.writeText(value);
      setCopyAmountFeedback("Monto copiado.");
    } catch {
      setCopyAmountFeedback("No se pudo copiar automáticamente.");
    }
  }

  function handlePayInStore() {
    if (isPending || isPayInStorePending) return;
    setFeedback(null);
    startPayInStoreTransition(async () => {
      const result = await confirmPayInStoreOrder();
      if (result.ok) {
        clearCart();
        router.push(`/seguimiento/${result.trackingToken}?confirmacion=1&pago=tienda`);
        return;
      }
      setFeedback(result.error);
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending || isPayInStorePending) return;

    const form = event.currentTarget;
    if (!form.reportValidity()) {
      form.querySelector<HTMLElement>(":invalid")?.focus();
      return;
    }

    const formData = new FormData(form);
    const amount = String(formData.get("amount") ?? "").trim();
    const reference = String(formData.get("reference") ?? "").trim();
    const file = formData.get("file");

    if (!numberPattern.test(amount) || Number(amount) <= 0) {
      setFeedback("El monto no es válido.");
      return;
    }
    if (reference.length === 0) {
      setFeedback("La referencia del pago es obligatoria.");
      return;
    }
    if (!(file instanceof File) || file.size === 0) {
      setFeedback(
        "Adjunta el comprobante (JPG, PNG, WebP o PDF de hasta 5 MB).",
      );
      return;
    }

    const idempotencyKey = `checkout-${orderId}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;

    startTransition(async () => {
      const result = await registerCheckoutPayment({
        method,
        amount,
        reference,
        idempotencyKey,
        file,
      });

      if (result.ok) {
        clearCart();
        router.push(`/seguimiento/${result.trackingToken}?confirmacion=1`);
        return;
      }
      setFeedback(result.error);
    });
  }

  if (quotePending) {
    return (
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <section className="rounded-card bg-yellow p-6 shadow-sm">
          <h2 className="font-display text-2xl font-extrabold text-plum">
            Delivery pendiente por cotizar
          </h2>
          <p className="mt-3 text-sm leading-6 text-ink">
            Tu pedido está reservado mientras confirmamos la tarifa de delivery. Cuando la cotización esté lista, verás aquí el total final antes de pagar.
          </p>
          <p className="mt-3 text-sm leading-6 text-ink">
            Te avisaremos por WhatsApp cuando el total final esté confirmado. Luego podrás volver a este paso para registrar tu pago.
          </p>
          <div className="mt-6">
            <Link
              href={`/seguimiento/${trackingToken}?confirmacion=1`}
              className="inline-flex min-h-11 items-center justify-center rounded-button bg-plum px-6 py-3 font-display font-extrabold text-cream transition hover:brightness-110"
            >
              Ver seguimiento del pedido
              <ArrowRightIcon />
            </Link>
          </div>
        </section>

        <aside className="h-fit rounded-card bg-lavender p-6 shadow-sm">
          <h2 className="font-display text-2xl font-extrabold text-plum">Tu momento dulce</h2>
          <dl className="mt-4 space-y-1 text-ink">
            <div className="flex justify-between gap-4">
              <dt>Subtotal</dt>
              <dd className="font-bold">{formatUsd(subtotalUsd)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Delivery</dt>
              <dd className="font-bold">Por confirmar</dd>
            </div>
            <div className="flex justify-between gap-4 font-display text-lg font-extrabold text-plum">
              <dt>Total provisional</dt>
              <dd>{formatUsd(totalUsd)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-muted">El total final se actualizará cuando se confirme la tarifa de delivery.</p>
        </aside>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      aria-busy={isPending}
      className="grid gap-8 lg:grid-cols-[1fr_360px]"
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="font-display text-lg font-extrabold text-ink">
            Pedido #{orderId} · Total {formatUsd(totalUsd)}
          </p>
          <p className="text-sm text-muted">
            Combina métodos. Revisaremos cada comprobante.
          </p>
          {deliveryRequiresQuote && deliveryFeeUsd === null ? (
            <p className="rounded-field bg-yellow px-4 py-3 text-sm font-bold text-ink">
              El delivery está pendiente por cotizar. Podrás registrar el pago cuando el total final esté confirmado.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          {METHODS.map((option, index) => {
            const selected = method === option.id;
            const instruction = paymentInstructions?.[option.id as keyof PaymentInstructions];
            const configured = hasConfiguredDetails(instruction);
            return (
              <label
                key={option.id}
                className={`flex cursor-pointer flex-col gap-2 rounded-card border-[3px] p-5 transition-colors ${
                  selected
                    ? "border-white bg-rose shadow-sm"
                    : "border-transparent bg-white shadow-sm hover:border-rose"
                }`}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="method"
                    value={option.id}
                    checked={selected}
                    onChange={() => setMethod(option.id)}
                    className="size-5 accent-pink"
                  />
                  <span className="font-display text-lg font-extrabold text-plum">
                    <span className="text-pink">{`0${index + 1}`}</span>{" "}
                    {instruction?.label?.trim() || option.title} · {option.currency}
                  </span>
                </span>
                <div className="pl-8 text-sm leading-6 text-ink">
                  {configured ? (
                    <dl className="space-y-1 rounded-field bg-white/70 p-3">
                      <DetailRow label="Banco / Plataforma" value={instruction?.bank} />
                      <DetailRow label={option.id === "binance_pay" ? "Nickname" : "Titular"} value={instruction?.holder} />
                      <DetailRow label="Cuenta / ID" value={instruction?.account} />
                      <DetailRow label="Teléfono" value={instruction?.phone} />
                      <DetailRow label="Documento" value={instruction?.document} />
                      <DetailRow label="Correo" value={instruction?.email} />
                      <DetailRow label="Red" value={instruction?.network} />
                      {instruction?.note ? (
                        <p className="pt-1 text-sm text-muted">{instruction.note}</p>
                      ) : null}
                    </dl>
                  ) : (
                    <p className="text-muted">{option.fallbackNote}</p>
                  )}
                </div>
              </label>
            );
          })}

          {(() => {
            const canPayInStore = fulfillmentType === "pickup" || (fulfillmentType === "delivery" && deliveryFeeUsd === 0);
            return (
              <label
                className={`flex cursor-pointer flex-col gap-2 rounded-card border-[3px] p-5 transition-colors ${
                  isPayInStore
                    ? "border-white bg-yellow shadow-sm"
                    : "border-transparent bg-yellow/80 shadow-sm hover:border-yellow"
                } ${!canPayInStore ? "cursor-not-allowed opacity-80" : ""}`}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="method"
                    value="pay_in_store"
                    checked={isPayInStore}
                    onChange={() => setMethod("pay_in_store")}
                    disabled={!canPayInStore}
                    className="size-5 accent-pink"
                  />
                  <span className="font-display text-lg font-extrabold text-plum">
                    <span className="text-pink">04</span> Pagar en tienda
                  </span>
                </span>
                <span className="pl-8 text-sm leading-6 text-ink">
                  {canPayInStore
                    ? fulfillmentType === "pickup"
                      ? "Paga en persona al retirar en el atelier, con el método de pago que prefieras. No necesitas enviar monto ni comprobante digital ahora."
                      : "Paga en persona al recibir tu delivery gratis, con el método de pago que prefieras. No necesitas enviar monto ni comprobante digital ahora."
                    : "Disponible solo para retiro en atelier o delivery gratis. Para delivery con costo, usa un método digital."}
                </span>
              </label>
            );
          })()}
        </div>

        {isPayInStore ? (
          <div className="rounded-card border border-mint bg-mint/30 p-5 text-sm leading-6 text-ink">
            <p className="font-display text-base font-extrabold text-plum">Pago en tienda seleccionado</p>
            <p className="mt-2">
              {fulfillmentType === "pickup"
                ? "Pagarás en persona al retirar tu pedido en el atelier. Puedes usar el método de pago que prefieras. No necesitas registrar monto, referencia ni comprobante ahora."
                : "Pagarás en persona al recibir tu delivery gratis. Puedes usar el método de pago que prefieras. No necesitas registrar monto, referencia ni comprobante ahora."}
            </p>
          </div>
        ) : (
          <>
            <Field
              id="payment-amount"
              label={method === "pago_movil" ? "Monto (VES)" : "Monto (USDT)"}
              hint={
                method === "pago_movil" && referenceRate !== null
                  ? `Tasa BCV de referencia: Bs. ${referenceRate} por USD.`
                  : "1 USDT = 1 USD."
              }
            >
              <Input
                id="payment-amount"
                name="amount"
                inputMode="decimal"
                required
                pattern={numberPattern.source}
                placeholder={method === "pago_movil" ? "700.00" : totalUsd.toFixed(2)}
                aria-invalid={invalid["payment-amount"] ?? false}
                onInvalid={() =>
                  setInvalid((current) => ({ ...current, "payment-amount": true }))
                }
                onBlur={() =>
                  setInvalid((current) => ({ ...current, "payment-amount": false }))
                }
              />
            </Field>

            {method === "pago_movil" && referenceVes !== null ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-mint px-4 py-3 text-sm font-bold text-ink">
                <p>
                  Monto aproximado: Bs. {referenceVes.toFixed(2)}
                </p>
                <Button type="button" variant="ghost" className="min-h-10 px-3 py-2 text-sm" onClick={handleCopyAmount}>
                  Copiar monto
                </Button>
              </div>
            ) : null}
            <LiveRegion className="text-sm text-muted">{copyAmountFeedback ?? ""}</LiveRegion>

            <Field
              id="payment-reference"
              label="Referencia del pago"
              hint="Últimos dígitos, número de confirmación o ID de transferencia."
            >
              <Input
                id="payment-reference"
                name="reference"
                required
                maxLength={120}
                placeholder="982415"
              />
            </Field>

            <div>
              <span className={labelSpanClass}>
                Adjuntar o cambiar comprobante
              </span>
              <p className="mb-2 text-sm text-muted">
                JPG, PNG, WebP o PDF · Máximo 5 MB
              </p>
              <input
                id="payment-file"
                name="file"
                type="file"
                required
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="w-full rounded-field border border-rose bg-white px-4 py-3 text-sm text-ink file:mr-4 file:rounded-full file:border-0 file:bg-lavender file:px-4 file:py-2 file:font-display file:font-bold file:text-ink hover:file:bg-pink-soft"
              />
            </div>
          </>
        )}

        <LiveRegion className="text-pink">{feedback ?? ""}</LiveRegion>
      </div>

      <aside className="h-fit rounded-card bg-lavender p-6 shadow-sm lg:sticky lg:top-24">
        <h2 className="font-display text-2xl font-extrabold text-plum">
          Tu momento dulce
        </h2>
        <dl className="mt-4 space-y-1 text-ink">
          <div className="flex justify-between gap-4">
            <dt>Subtotal</dt>
            <dd className="font-bold">{formatUsd(subtotalUsd)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Delivery</dt>
            <dd className="font-bold">
              {deliveryFeeUsd === null
                ? deliveryRequiresQuote
                  ? "Por confirmar"
                  : "—"
                : formatUsd(deliveryFeeUsd)}
            </dd>
          </div>
          <div className="flex justify-between gap-4 font-display text-lg font-extrabold text-plum">
            <dt>Total USD</dt>
            <dd>{formatUsd(totalUsd)}</dd>
          </div>
        </dl>

        <dl className="mt-4 space-y-2 text-sm text-ink">
          {Object.entries(summary).map(([currency, values]) => {
            const reported =
              Number(values.pending_amount) + Number(values.in_review_amount);
            const verified = Number(values.approved_amount);
            return (
              <div key={currency} className="flex justify-between gap-4">
                <dt>
                  Reportado ({currency}) · Verificado ({currency})
                </dt>
                <dd className="text-right font-bold">
                  {reported.toFixed(2)} · {verified.toFixed(2)}
                </dd>
              </div>
            );
          })}
        </dl>

        {isPayInStore ? (
          <>
            <Button
              type="button"
              disabled={isPending || isPayInStorePending || quotePending || (fulfillmentType === "delivery" && deliveryFeeUsd !== 0)}
              className="mt-6 w-full"
              onClick={handlePayInStore}
            >
              {isPayInStorePending ? "Enviando…" : "Hacer pedido"}
              <ArrowRightIcon />
            </Button>
            <p className="mt-4 flex items-start gap-2 text-sm leading-6 text-ink">
              <CheckIcon className="mt-0.5 size-4 shrink-0 text-pink" />
              {fulfillmentType === "pickup"
                ? "Tu pedido quedará registrado para pagar en persona al retirar en el atelier."
                : "Tu pedido quedará registrado para pagar en persona al recibir tu delivery gratis."}
            </p>
          </>
        ) : (
          <>
            <Button type="submit" disabled={isPending || isPayInStorePending || quotePending} className="mt-6 w-full">
              {isPending ? "Enviando…" : quotePending ? "Cotización pendiente" : "Hacer pedido"}
              <ArrowRightIcon />
            </Button>
            <p className="mt-4 flex items-start gap-2 text-sm leading-6 text-ink">
              <ClockIcon className="mt-0.5 size-4 shrink-0 text-pink" />
              Tu pago queda en revisión. El equipo lo verifica de forma manual.
            </p>
          </>
        )}

        <p className="mt-2 flex items-start gap-2 text-sm leading-6 text-ink">
          <CheckIcon className="mt-0.5 size-4 shrink-0 text-pink" />
          Recibirás tu enlace privado al final.
        </p>
      </aside>
    </form>
  );
}

const labelSpanClass = "mb-2 block font-display text-sm font-bold text-ink";


