"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import {
  addProductImage,
  removeProductImage,
  reorderProductImages,
} from "../admin-products";
import type { AdminProduct } from "../schemas";

type Props = {
  product: AdminProduct;
  onChanged: (product: AdminProduct) => void;
};

const buttonClass =
  "min-h-11 cursor-pointer rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:focus-visible:outline-zinc-300";
const dangerClass =
  "min-h-11 cursor-pointer rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40";

export function AdminProductImages({ product, onChanged }: Props) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string; product?: AdminProduct }>, success: string) {
    startTransition(async () => {
      setFeedback(null);
      setOk(null);
      const result = await action();
      setOk(result.ok);
      setFeedback(result.ok ? success : (result.error ?? "No se pudo completar la operación."));
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
    <section aria-labelledby={`images-${product.id}-heading`} className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h4 id={`images-${product.id}-heading`} className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        Imágenes
      </h4>

      <div>
        <label htmlFor={`image-upload-${product.id}`} className="mb-1 block text-sm font-medium text-zinc-800 dark:text-zinc-200">
          Agregar imagen
        </label>
        <p id={`image-upload-${product.id}-hint`} className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
          JPEG, PNG o WebP. Máximo 5 MB.
        </p>
        <input ref={fileRef} id={`image-upload-${product.id}`} type="file" accept="image/jpeg,image/png,image/webp"
          aria-describedby={`image-upload-${product.id}-hint`} disabled={isPending} onChange={onUpload}
          className="block w-full text-sm text-zinc-700 file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-zinc-800 dark:text-zinc-300 dark:file:border-zinc-700 dark:file:bg-zinc-900 dark:file:text-zinc-100" />
      </div>

      {product.images.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Este producto no tiene imágenes.</p>
      ) : (
        <ul className="space-y-3">
          {product.images.map((image, index) => (
            <li key={image.id} className="flex flex-col gap-3 rounded-md border border-zinc-200 p-3 sm:flex-row sm:items-center dark:border-zinc-800">
              {/* eslint-disable-next-line @next/next/no-img-element -- admin preview uses already-validated public storage URL */}
              <img src={image.url} alt={image.alt} width={96} height={96} className="size-24 rounded-md object-cover" />
              <div className="flex-1 text-sm text-zinc-700 dark:text-zinc-300">
                <p className="font-medium text-zinc-900 dark:text-zinc-50">
                  {index === 0 ? "Imagen principal" : `Imagen ${index + 1}`}
                </p>
                <p>Posición: {image.position}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass} disabled={isPending || index === 0}
                  aria-label={`Mover ${image.alt} hacia arriba`} onClick={() => move(image.id, -1)}>Subir</button>
                <button type="button" className={buttonClass} disabled={isPending || index === product.images.length - 1}
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

      <p role="status" aria-live="polite" aria-atomic="true"
        className={`min-h-6 text-sm ${ok === false ? "text-red-700 dark:text-red-300" : "text-zinc-600 dark:text-zinc-400"}`}>
        {isPending ? "Procesando imagen…" : (feedback ?? "")}
      </p>
    </section>
  );
}
