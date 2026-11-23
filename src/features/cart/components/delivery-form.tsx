"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCart } from "../cart-context";
import { useCheckoutDraft } from "../checkout-draft";
import { createOnlineOrder } from "@/features/orders/checkout";
import type { DeliveryZone } from "@/features/catalog/public-data";
import { formatUsd } from "@/features/catalog/components/price-format";
import { Button, Field, Input, LiveRegion, Textarea } from "@/components/ui/ui";
import { ArrowRightIcon } from "@/components/ui/icons";

const noItemsMessage =
  "Tu bolsa está vacía. Agrega un producto antes de continuar.";

const selectClass =
  "min-h-12 w-full rounded-field border border-rose bg-white px-4 py-2 text-base text-ink shadow-sm transition-colors focus-visible:border-lavender focus-visible:outline-none";

export function DeliveryForm({
  zones,
  pickupAddress,
}: {
  zones: DeliveryZone[];
  pickupAddress: string | null;
}) {
  const router = useRouter();
  const { items, subtotalUsd, hydrated } = useCart();
  const { draft, setDraft } = useCheckoutDraft();
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">(
    draft.fulfillmentType,
  );
  const [zoneId, setZoneId] = useState<number | "">(draft.deliveryZoneId ?? "");
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setDraft({
      fulfillmentType: fulfillment,
      deliveryZoneId: fulfillment === "delivery" && zoneId !== "" ? zoneId : null,
    });
  }, [fulfillment, zoneId, setDraft]);

  const selectedZone = zones.find((zone) => zone.id === zoneId) ?? null;
  const deliveryFee =
    selectedZone && !selectedZone.requires_quote ? selectedZone.fee_usd : 0;
  const totalUsd =
    subtotalUsd + (fulfillment === "delivery" ? deliveryFee : 0);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;

    const form = event.currentTarget;
    if (!form.reportValidity()) {
      form.querySelector<HTMLElement>(":invalid")?.focus();
      return;
    }

    if (items.length === 0) {
      setFeedback(noItemsMessage);
      return;
    }

    const formData = new FormData(form);
    const name = String(formData.get("customerName") ?? "").trim();
    const phone = String(formData.get("customerPhone") ?? "").trim();
    const addressLine = String(formData.get("addressLine") ?? "").trim();
    const addressReferences = String(
      formData.get("addressReferences") ?? "",
    ).trim();
    const instructions = String(formData.get("instructions") ?? "").trim();

    if (fulfillment === "delivery" && zoneId === "") {
      setFeedback("Selecciona una zona de entrega.");
      return;
    }

    startTransition(async () => {
      const result = await createOnlineOrder({
        customerName: name,
        customerPhone: phone,
        fulfillmentType: fulfillment,
        deliveryZoneId: fulfillment === "delivery" ? Number(zoneId) : null,
        addressLine: fulfillment === "delivery" ? addressLine : null,
        addressReferences: fulfillment === "delivery" ? addressReferences : null,
        additionalInstructions: fulfillment === "delivery" ? instructions : null,
        items: items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
      });

      if (result.ok) {
        const needsQuote = fulfillment === "delivery" && selectedZone?.requires_quote === true;
        if (needsQuote && result.trackingToken) {
          router.push(`/seguimiento/${result.trackingToken}?confirmacion=1`);
          return;
        }
        router.push("/checkout/pago");
        return;
      }
      setFeedback(result.error);
    });
  }

  if (!hydrated) {
    return (
      <div aria-busy="true" className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <p className="sr-only">Cargando el formulario de entrega…</p>
        <div className="h-96 rounded-card bg-white shadow-sm" />
        <div className="h-64 rounded-card bg-lavender/60" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-card bg-white p-10 text-center shadow-sm">
        <h2 className="font-display text-2xl font-extrabold text-plum">
          Tu bolsa está vacía
        </h2>
        <p className="mt-2 text-muted">{noItemsMessage}</p>
        <Link
          href="/productos"
          className="mt-6 inline-flex items-center gap-2 rounded-full border-[3px] border-white bg-pink-soft px-6 py-2 font-display text-base font-bold text-ink shadow-sticker transition-all hover:brightness-[0.98] active:translate-y-[2px] active:shadow-none"
        >
          Ver tortas
          <ArrowRightIcon />
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={isPending}
      className="grid gap-8 lg:grid-cols-[1fr_360px]"
    >
      <div className="flex flex-col gap-6">
        <Field id="checkout-name" label="Nombre y apellido">
          <Input
            id="checkout-name"
            name="customerName"
            autoComplete="name"
            required
            maxLength={160}
            placeholder="María Rodríguez"
          />
        </Field>

        <Field id="checkout-phone" label="WhatsApp">
          <Input
            id="checkout-phone"
            name="customerPhone"
            type="tel"
            autoComplete="tel"
            required
            maxLength={40}
            placeholder="+58 412 000 1234"
          />
        </Field>

        <fieldset>
          <legend className="mb-2 font-display text-base font-extrabold text-plum">
            ¿Cómo recibirás tu pedido?
          </legend>
          <div className="flex flex-wrap gap-4">
            <label className="flex min-h-11 cursor-pointer items-center gap-2 font-bold text-ink">
              <input
                type="radio"
                name="fulfillment"
                value="delivery"
                checked={fulfillment === "delivery"}
                onChange={() => setFulfillment("delivery")}
                className="size-5 accent-pink"
              />
              Delivery
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 font-bold text-ink">
              <input
                type="radio"
                name="fulfillment"
                value="pickup"
                checked={fulfillment === "pickup"}
                onChange={() => setFulfillment("pickup")}
                className="size-5 accent-pink"
              />
              Retiro en atelier
            </label>
          </div>
        </fieldset>

        {fulfillment === "delivery" ? (
          <>
            <Field id="checkout-zone" label="Zona de entrega">
              <select
                id="checkout-zone"
                name="zoneId"
                required
                value={zoneId}
                onChange={(event) =>
                  setZoneId(
                    event.target.value === "" ? "" : Number(event.target.value),
                  )
                }
                className={selectClass}
              >
                <option value="" disabled>
                  Selecciona tu zona
                </option>
                {zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                    {zone.requires_quote
                      ? " · cotización manual"
                      : zone.fee_usd === 0
                        ? " · GRATIS"
                        : ` · ${formatUsd(zone.fee_usd)}`}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-sm text-muted">
                Norte: GRATIS · Resto de la ciudad: tarifa según la zona · Fuera
                de Barquisimeto: cotización manual.
              </p>
            </Field>

            <Field
              id="checkout-address"
              label="Dirección y punto de referencia"
            >
              <Textarea
                id="checkout-address"
                name="addressLine"
                required
                maxLength={300}
                placeholder="Urb. El Cují, calle 4, casa 18"
              />
            </Field>

            <Field
              id="checkout-references"
              label="Referencias adicionales (opcional)"
            >
              <Textarea
                id="checkout-references"
                name="addressReferences"
                maxLength={300}
                placeholder="Junto a la panadería, portón azul"
              />
            </Field>
          </>
        ) : (
          <p className="rounded-section bg-mint p-5 text-sm leading-6 text-ink">
            {pickupAddress
              ? `Retiras en nuestro atelier: ${pickupAddress}.`
              : "Retiras en nuestro atelier. Te avisaremos cuando tu pedido esté listo."}
          </p>
        )}

        <Field
          id="checkout-instructions"
          label="Instrucciones adicionales (opcional)"
        >
          <Textarea
            id="checkout-instructions"
            name="instructions"
            maxLength={500}
            placeholder="Dedicatoria, horario preferido, etc."
          />
        </Field>

        {selectedZone?.requires_quote ? (
          <p className="rounded-section bg-yellow p-5 text-sm font-bold leading-6 text-ink">
            Fuera de la ciudad, la tarifa se verifica antes del pago. No pagues
            hasta recibir la cotización.
          </p>
        ) : null}

        <LiveRegion className="text-pink">
          {isPending ? "Creando tu pedido…" : (feedback ?? "")}
        </LiveRegion>
      </div>

      <aside className="h-fit rounded-card bg-lavender p-6 shadow-sm lg:sticky lg:top-24">
        <h2 className="font-display text-2xl font-extrabold text-plum">
          Tu momento dulce
        </h2>
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li
              key={item.productId}
              className="font-display text-base font-bold text-ink"
            >
              {item.name} × {item.quantity}
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-1 text-ink">
          <div className="flex justify-between gap-4">
            <dt>Subtotal</dt>
            <dd className="font-bold">{formatUsd(subtotalUsd)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Delivery</dt>
            <dd className="font-bold">
              {fulfillment === "pickup"
                ? "Retiro"
                : selectedZone === null
                  ? "—"
                  : selectedZone.requires_quote
                    ? "Cotización"
                    : selectedZone.fee_usd === 0
                      ? "GRATIS"
                      : formatUsd(selectedZone.fee_usd)}
            </dd>
          </div>
        </dl>
        <div className="mt-4 flex justify-between gap-4 border-t border-white pt-4 font-display text-xl font-extrabold text-plum">
          <span>Total USD</span>
          <span>{formatUsd(totalUsd)}</span>
        </div>
        <p className="mt-4 text-sm leading-6 text-ink">
          Precios en USD. Pagos en VES según BCV. Tu pago se verifica de forma
          manual.
        </p>
        <Button type="submit" disabled={isPending} className="mt-6 w-full">
          {isPending ? "Creando pedido…" : "Confirmar entrega"}
          <ArrowRightIcon />
        </Button>
      </aside>
    </form>
  );
}
