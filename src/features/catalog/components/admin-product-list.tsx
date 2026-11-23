"use client";

import { useEffect, useState, useTransition } from "react";
import { formatUsd } from "./price-format";
import { setProductActive } from "../admin-products";
import type { AdminProduct } from "../schemas";
import { AdminProductForm } from "./admin-product-form";
import { AdminProductImages } from "./admin-product-images";
import { AdminStatusChip } from "@/components/admin/admin-ui";
import { Button, buttonSecondaryClass, LiveRegion } from "@/components/ui/ui";
import { useToast } from "@/components/ui/toast";

type Props = { initialProducts: AdminProduct[] };

export function AdminProductList({ initialProducts }: Props) {
  const [products, setProducts] = useState(initialProducts);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    if (window.location.hash !== "#product-create") return;
    const id = window.requestAnimationFrame(() => setShowCreate(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

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
      const message = result.ok ? (product.isActive ? "Producto desactivado." : "Producto activado.") : result.error;
      setFeedback(message);
      showToast(message, result.ok ? "success" : "error");
      if (result.ok) upsert(result.product);
    });
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Button type="button" onClick={() => setShowCreate((v) => !v)} aria-expanded={showCreate} aria-controls="product-create">
          {showCreate ? "Cerrar formulario" : "Nuevo producto"}
        </Button>
        {showCreate ? (
          <AdminProductForm
            onSaved={(product) => {
              upsert(product);
              setOk(true);
              setFeedback("Producto creado.");
              showToast("Producto creado.", "success");
              setShowCreate(false);
            }}
            onCancelEdit={() => setShowCreate(false)}
          />
        ) : null}
      </div>

      <section aria-labelledby="existing-products-heading" className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h3 id="existing-products-heading" className="font-display text-lg font-extrabold text-plum">
            Productos existentes
          </h3>
          <p className="text-sm text-muted">{products.length} producto(s)</p>
        </div>

        <LiveRegion className={ok === false ? "text-pink" : "text-muted"}>
          {isPending ? "Actualizando producto…" : (feedback ?? "")}
        </LiveRegion>

        {products.length === 0 ? (
          <p className="text-sm text-muted">No hay productos registrados.</p>
        ) : (
          <ul className="space-y-4">
            {products.map((product) => {
              const editing = editingId === product.id;
              return (
                <li key={product.id} className="rounded-card border border-rose/60 bg-cream p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <p className="text-base font-bold text-ink">
                        {product.name}{" "}
                        <AdminStatusChip tone={product.isActive ? "mint" : "lavender"}>
                          {product.isActive ? "Activo" : "Inactivo"}
                        </AdminStatusChip>
                      </p>
                      <p className="text-sm text-muted">/{product.slug} · {formatUsd(product.priceUsd)} · {product.images.length} imagen(es)</p>
                      <p className="text-sm text-ink">{product.description}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={buttonSecondaryClass} disabled={isPending}
                        onClick={() => setEditingId(editing ? null : product.id)}>
                        {editing ? "Cerrar edición" : "Editar"}
                      </button>
                      <button type="button" className={buttonSecondaryClass} disabled={isPending}
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
