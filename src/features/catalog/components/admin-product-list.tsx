"use client";

import { useState, useTransition } from "react";
import { formatUsd } from "./price-format";
import { setProductActive } from "../admin-products";
import type { AdminProduct } from "../schemas";
import { AdminProductForm } from "./admin-product-form";
import { AdminProductImages } from "./admin-product-images";

type Props = { initialProducts: AdminProduct[] };

const buttonClass =
  "min-h-11 cursor-pointer rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:focus-visible:outline-zinc-300";

export function AdminProductList({ initialProducts }: Props) {
  const [products, setProducts] = useState(initialProducts);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);

  function upsert(product: AdminProduct): void {
    setProducts((current) => {
      const exists = current.some((item) => item.id === product.id);
      const next = exists
        ? current.map((item) => (item.id === product.id ? product : item))
        : [...current, product];
      return next.sort((a, b) => a.id - b.id);
    });
  }

  function toggleActive(product: AdminProduct): void {
    startTransition(async () => {
      setFeedback(null);
      setOk(null);
      const result = await setProductActive({ productId: product.id, isActive: !product.isActive });
      setOk(result.ok);
      setFeedback(result.ok ? (product.isActive ? "Producto desactivado." : "Producto activado.") : result.error);
      if (result.ok) upsert(result.product);
    });
  }

  return (
    <div className="space-y-8">
      <AdminProductForm
        onSaved={(product) => {
          upsert(product);
          setOk(true);
          setFeedback("Producto creado.");
        }}
      />

      <section aria-labelledby="existing-products-heading" className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h3 id="existing-products-heading" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Productos existentes
          </h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{products.length} producto(s)</p>
        </div>

        <p role="status" aria-live="polite" aria-atomic="true"
          className={`min-h-6 text-sm ${ok === false ? "text-red-700 dark:text-red-300" : "text-zinc-600 dark:text-zinc-400"}`}>
          {isPending ? "Actualizando producto…" : (feedback ?? "")}
        </p>

        {products.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No hay productos registrados.</p>
        ) : (
          <ul className="space-y-4">
            {products.map((product) => {
              const editing = editingId === product.id;
              return (
                <li key={product.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                        {product.name}{" "}
                        <span className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${product.isActive ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                          {product.isActive ? "Activo" : "Inactivo"}
                        </span>
                      </p>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">/{product.slug} · {formatUsd(product.priceUsd)} · {product.images.length} imagen(es)</p>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300">{product.description}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={buttonClass} disabled={isPending}
                        onClick={() => setEditingId(editing ? null : product.id)}>
                        {editing ? "Cerrar edición" : "Editar"}
                      </button>
                      <button type="button" className={buttonClass} disabled={isPending}
                        onClick={() => toggleActive(product)}>
                        {product.isActive ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  </div>

                  {editing ? (
                    <div className="mt-4 space-y-4">
                      <AdminProductForm
                        product={product}
                        onCancelEdit={() => setEditingId(null)}
                        onSaved={(saved) => {
                          upsert(saved);
                          setEditingId(null);
                          setOk(true);
                          setFeedback("Producto actualizado.");
                        }}
                      />
                      <AdminProductImages product={product} onChanged={upsert} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
