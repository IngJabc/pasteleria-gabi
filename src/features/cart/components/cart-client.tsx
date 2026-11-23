"use client";

import Image from "next/image";
import Link from "next/link";
import { useCart } from "../cart-context";
import { useCheckoutDraft } from "../checkout-draft";
import type { DeliveryZone } from "@/features/catalog/public-data";
import { formatUsd } from "@/features/catalog/components/price-format";
import { Button } from "@/components/ui/ui";
import { ArrowRightIcon, MinusIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";

export function CheckoutSteps({ current = 1 }: { current?: 1 | 2 | 3 }) {
  const step = (index: 1 | 2 | 3, label: string) => (
    <li className={index <= current ? "text-ink" : "text-muted"}>
      <span className={index <= current ? "text-pink" : ""}>{`0${index}`}</span>{" "}
      {label}
    </li>
  );

  return (
    <ol className="flex flex-wrap items-center gap-2 font-display text-base font-bold text-ink">
      {step(1, "Carrito")}
      <li aria-hidden="true" className="text-muted">
        /
      </li>
      {step(2, "Entrega")}
      <li aria-hidden="true" className="text-muted">
        /
      </li>
      {step(3, "Pago")}
    </ol>
  );
}

/**
 * Client bag view. It only reads/writes the local bag; the server re-validates
 * every price, product and stock value when the order is created.
 */
export function CartClient({ zones = [] }: { zones?: DeliveryZone[] }) {
  const { items, subtotalUsd, setQuantity, removeItem, hydrated } = useCart();
  const { draft, hydrated: draftHydrated } = useCheckoutDraft();
  const selectedZone =
    draft.fulfillmentType === "delivery" && draft.deliveryZoneId !== null
      ? zones.find((zone) => zone.id === draft.deliveryZoneId) ?? null
      : null;
  const deliveryFee =
    selectedZone && !selectedZone.requires_quote ? selectedZone.fee_usd : 0;
  const totalUsd =
    subtotalUsd + (draft.fulfillmentType === "delivery" ? deliveryFee : 0);

  if (!hydrated) {
    return (
      <div aria-busy="true" className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <p className="sr-only">Cargando tu bolsa…</p>
        <div className="h-40 rounded-card bg-white shadow-sm" />
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
        <p className="mt-2 text-muted">
          Explora el catálogo y encuentra tu próximo antojo.
        </p>
        <Link href="/productos" className={`${buttonLinkClass} mt-6`}>
          Ver tortas
          <ArrowRightIcon />
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li
              key={item.productId}
              className="flex gap-4 rounded-card bg-white p-4 shadow-sm"
            >
              {item.imageUrl ? (
                <Image
                  src={item.imageUrl}
                  alt={item.name}
                  width={240}
                  height={180}
                  className="aspect-[4/3] w-24 shrink-0 rounded-field border-2 border-rose object-cover"
                />
              ) : (
                <div className="aspect-[4/3] w-24 shrink-0 rounded-field border-2 border-rose bg-rose/60" />
              )}

              <div className="flex flex-1 flex-col gap-2">
                <h2 className="font-display text-xl font-extrabold text-plum">
                  {item.name}
                </h2>
                <p className="font-display text-lg font-extrabold text-plum">
                  {formatUsd(item.priceUsd * item.quantity)}{" "}
                  <span className="text-sm">USD</span>
                </p>

                <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="font-display text-sm font-bold text-ink">
                      Cantidad
                    </span>
                    <Button
                      variant="secondary"
                      aria-label={`Disminuir cantidad de ${item.name}`}
                      onClick={() =>
                        setQuantity(item.productId, item.quantity - 1)
                      }
                      className="min-h-10 px-3"
                    >
                      <MinusIcon className="size-4" />
                    </Button>
                    <output className="min-w-7 text-center font-display text-base font-extrabold text-plum">
                      {item.quantity}
                    </output>
                    <Button
                      variant="secondary"
                      aria-label={`Aumentar cantidad de ${item.name}`}
                      onClick={() =>
                        setQuantity(item.productId, item.quantity + 1)
                      }
                      className="min-h-10 px-3"
                    >
                      <PlusIcon className="size-4" />
                    </Button>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeItem(item.productId)}
                    className="inline-flex min-h-10 cursor-pointer items-center gap-1 font-display text-sm font-bold text-pink hover:underline"
                  >
                    <TrashIcon className="size-4" />
                    Eliminar
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <p className="text-sm leading-6 text-muted">
          Tu torta se reserva al confirmar el pedido, por un máximo de 24 horas.
        </p>
        <Link
          href="/productos"
          className="inline-flex items-center gap-1 font-display text-base font-bold text-pink hover:underline"
        >
          Seguir mirando tortas
        </Link>
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
              {!draftHydrated ? (
                <span className="text-muted">Cargando…</span>
              ) : draft.fulfillmentType === "pickup" ? (
                "Retiro"
              ) : selectedZone === null ? (
                <span className="text-muted">Se calcula en la entrega</span>
              ) : selectedZone.requires_quote ? (
                "Cotización manual"
              ) : selectedZone.fee_usd === 0 ? (
                "GRATIS"
              ) : (
                formatUsd(selectedZone.fee_usd)
              )}
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
        <Link
          href="/checkout/entrega"
          className={`${buttonLinkClass} mt-6 w-full`}
        >
          Continuar con mi pedido
          <ArrowRightIcon />
        </Link>
      </aside>
    </div>
  );
}

const buttonLinkClass =
  "inline-flex items-center justify-center gap-2 rounded-full border-[3px] border-white bg-pink-soft px-6 py-2 font-display text-base font-bold text-ink shadow-sticker transition-all hover:brightness-[0.98] active:translate-y-[2px] active:shadow-none";
