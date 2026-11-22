"use client";

import { useState, useTransition, type FormEvent, type SyntheticEvent } from "react";
import {
  createProduct,
  updateProduct,
  type ProductActionResult,
} from "../admin-products";
import {
  invalidProductInputError,
  productInputSchema,
  slugifyProductName,
  type AdminProduct,
} from "../schemas";

type Props = {
  product?: AdminProduct | null;
  onSaved: (product: AdminProduct) => void;
  onCancelEdit?: () => void;
};

const inputClass =
  "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 transition-colors aria-invalid:border-red-700 aria-invalid:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:aria-invalid:border-red-400 dark:aria-invalid:bg-red-950/30 dark:focus-visible:outline-zinc-300";
const labelClass = "mb-1 block text-sm font-medium text-zinc-800 dark:text-zinc-200";
const buttonClass =
  "min-h-11 cursor-pointer rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:focus-visible:outline-zinc-100";
const secondaryClass =
  "min-h-11 cursor-pointer rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:focus-visible:outline-zinc-300";

export function AdminProductForm({ product, onSaved, onCancelEdit }: Props) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [invalidFields, setInvalidFields] = useState<Record<string, boolean>>({});
  const [slugTouched, setSlugTouched] = useState(Boolean(product));
  const [name, setName] = useState(product?.name ?? "");
  const [slug, setSlug] = useState(product?.slug ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [priceUsd, setPriceUsd] = useState(
    product ? product.priceUsd.toFixed(2) : "",
  );
  const [isActive, setIsActive] = useState(product?.isActive ?? true);

  function syncFieldValidity(
    event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void {
    const control = event.currentTarget;
    const invalid = control.matches(":user-invalid");
    setInvalidFields((current) =>
      current[control.id] === invalid ? current : { ...current, [control.id]: invalid },
    );
  }

  function onNameChange(value: string): void {
    setName(value);
    if (!slugTouched && !product) setSlug(slugifyProductName(value));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (isPending) return;
    const form = event.currentTarget;
    if (!form.reportValidity()) {
      const first = form.querySelector<HTMLElement>(":invalid");
      first?.focus();
      return;
    }

    const candidate = {
      name: name.trim(),
      description: description.trim(),
      priceUsd: Number(priceUsd),
      slug: slug.trim(),
      isActive,
    };
    const parsed = productInputSchema.safeParse(candidate);
    if (!parsed.success) {
      setOk(false);
      setFeedback(parsed.error.issues[0]?.message ?? invalidProductInputError);
      return;
    }

    startTransition(async () => {
      setFeedback(null);
      setOk(null);
      const result: ProductActionResult = product
        ? await updateProduct({ ...parsed.data, productId: product.id })
        : await createProduct(parsed.data);
      setOk(result.ok);
      setFeedback(
        result.ok
          ? product
            ? "Producto actualizado."
            : "Producto creado."
          : result.error,
      );
      if (result.ok) {
        onSaved(result.product);
        if (!product) {
          setName("");
          setSlug("");
          setDescription("");
          setPriceUsd("");
          setIsActive(true);
          setSlugTouched(false);
          form.reset();
        }
      }
    });
  }

  const formId = product ? `product-edit-${product.id}` : "product-create";
  const headingId = `${formId}-heading`;

  return (
    <form
      aria-labelledby={headingId}
      aria-busy={isPending}
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h3 id={headingId} className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {product ? `Editar: ${product.name}` : "Nuevo producto"}
      </h3>

      <div>
        <label htmlFor={`${formId}-name`} className={labelClass}>Nombre <span aria-hidden="true">*</span></label>
        <input id={`${formId}-name`} required maxLength={160} value={name}
          onChange={(e) => onNameChange(e.target.value)} onBlur={syncFieldValidity} onInvalid={syncFieldValidity}
          aria-invalid={invalidFields[`${formId}-name`] ?? false} className={inputClass} />
      </div>

      <div>
        <label htmlFor={`${formId}-slug`} className={labelClass}>Slug <span aria-hidden="true">*</span></label>
        <p id={`${formId}-slug-hint`} className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
          Letras minúsculas, números y guiones. Define la URL /productos/slug.
        </p>
        <input id={`${formId}-slug`} required maxLength={120} pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
          value={slug} aria-describedby={`${formId}-slug-hint`}
          onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }}
          onBlur={syncFieldValidity} onInvalid={syncFieldValidity}
          aria-invalid={invalidFields[`${formId}-slug`] ?? false} className={inputClass} />
      </div>

      <div>
        <label htmlFor={`${formId}-description`} className={labelClass}>Descripción <span aria-hidden="true">*</span></label>
        <textarea id={`${formId}-description`} required maxLength={2000} rows={3} value={description}
          onChange={(e) => setDescription(e.target.value)} onBlur={syncFieldValidity} onInvalid={syncFieldValidity}
          aria-invalid={invalidFields[`${formId}-description`] ?? false} className={inputClass} />
      </div>

      <div>
        <label htmlFor={`${formId}-price`} className={labelClass}>Precio USD <span aria-hidden="true">*</span></label>
        <p id={`${formId}-price-hint`} className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
          Hasta dos decimales. Ejemplo: 12.50
        </p>
        <input id={`${formId}-price`} required inputMode="decimal" pattern="^\d+(\.\d{1,2})?$"
          value={priceUsd} aria-describedby={`${formId}-price-hint`}
          onChange={(e) => setPriceUsd(e.target.value)} onBlur={syncFieldValidity} onInvalid={syncFieldValidity}
          aria-invalid={invalidFields[`${formId}-price`] ?? false} className={inputClass} />
      </div>

      <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-zinc-800 dark:text-zinc-200">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)}
          className="size-5 rounded border-zinc-300 accent-zinc-900 dark:accent-zinc-100" />
        Producto activo en el catálogo público
      </label>

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={isPending} className={buttonClass}>
          {isPending ? "Guardando…" : product ? "Guardar cambios" : "Crear producto"}
        </button>
        {product && onCancelEdit ? (
          <button type="button" disabled={isPending} onClick={onCancelEdit} className={secondaryClass}>
            Cancelar edición
          </button>
        ) : null}
      </div>

      <p role="status" aria-live="polite" aria-atomic="true"
        className={`min-h-6 text-sm ${ok === false ? "text-red-700 dark:text-red-300" : "text-zinc-600 dark:text-zinc-400"}`}>
        {isPending ? "Guardando…" : (feedback ?? "")}
      </p>
    </form>
  );
}
