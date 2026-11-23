"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import {
  addProductImage,
  removeProductImage,
  reorderProductImages,
} from "../admin-products";
import type { AdminProduct } from "../schemas";
import { buttonSecondaryClass, LiveRegion } from "@/components/ui/ui";
import { useToast } from "@/components/ui/toast";

type Props = {
  product: AdminProduct;
  onChanged: (product: AdminProduct) => void;
};

const dangerClass =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border-[3px] border-white bg-rose px-4 py-2 font-display text-sm font-bold text-pink shadow-sticker transition-all hover:brightness-[0.98] active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-60";

export function AdminProductImages({ product, onChanged }: Props) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  function run(action: () => Promise<{ ok: boolean; error?: string; product?: AdminProduct }>, success: string) {
    startTransition(async () => {
      setFeedback(null);
      setOk(null);
      const result = await action();
      setOk(result.ok);
      const message = result.ok ? success : (result.error ?? "No se pudo completar la operación.");
      setFeedback(message);
      showToast(message, result.ok ? "success" : "error");
      if (result.ok && result.product) onChanged(result.product);
    });
  }

  function onUpload(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) return;
    run(async () => addProductImage({ productId: product.id, file }), "Imagen agregada.");
    event.target.value = "";
  }

  function move(imageId: number, delta: -1 | 1): void {
    const ids = product.images.map((image) => image.id);
    const index = ids.indexOf(imageId);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    run(
      async () => reorderProductImages({ productId: product.id, orderedImageIds: ids }),
      "Orden de imágenes actualizado.",
    );
  }

  return (
    <section aria-labelledby={`images-${product.id}-heading`} className="space-y-4 rounded-card border border-rose/60 bg-cream p-4">
      <h4 id={`images-${product.id}-heading`} className="font-display text-base font-extrabold text-plum">
        Imágenes
      </h4>

      <div>
        <label htmlFor={`image-upload-${product.id}`} className="mb-1 block text-sm font-medium text-ink">
          Agregar imagen
        </label>
        <p id={`image-upload-${product.id}-hint`} className="mb-2 text-sm text-muted">
          JPEG, PNG o WebP. Máximo 5 MB.
        </p>
        <input ref={fileRef} id={`image-upload-${product.id}`} type="file" accept="image/jpeg,image/png,image/webp"
          aria-describedby={`image-upload-${product.id}-hint`} disabled={isPending} onChange={onUpload}
          className="block w-full text-sm text-muted file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-field file:border file:border-rose file:bg-white file:px-3 file:py-2 file:font-display file:text-sm file:font-bold file:text-plum" />
      </div>

      {product.images.length === 0 ? (
        <p className="text-sm text-muted">Este producto no tiene imágenes.</p>
      ) : (
        <ul className="space-y-3">
          {product.images.map((image, index) => (
            <li key={image.id} className="flex flex-col gap-3 rounded-field border border-rose/60 bg-white p-3 sm:flex-row sm:items-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- admin preview uses already-validated public storage URL */}
              <img src={image.url} alt={image.alt} width={96} height={96} className="size-24 rounded-field object-cover" />
              <div className="flex-1 text-sm text-ink">
                <p className="font-bold text-plum">
                  {index === 0 ? "Imagen principal" : `Imagen ${index + 1}`}
                </p>
                <p>Posición: {image.position}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonSecondaryClass} disabled={isPending || index === 0}
                  aria-label={`Mover ${image.alt} hacia arriba`} onClick={() => move(image.id, -1)}>Subir</button>
                <button type="button" className={buttonSecondaryClass} disabled={isPending || index === product.images.length - 1}
                  aria-label={`Mover ${image.alt} hacia abajo`} onClick={() => move(image.id, 1)}>Bajar</button>
                <button type="button" className={dangerClass} disabled={isPending}
                  aria-label={`Quitar ${image.alt}`}
                  onClick={() => run(async () => removeProductImage({ productId: product.id, imageId: image.id }), "Imagen eliminada.")}>
                  Quitar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <LiveRegion className={ok === false ? "text-pink" : "text-muted"}>
        {isPending ? "Procesando imagen…" : (feedback ?? "")}
      </LiveRegion>
    </section>
  );
}
