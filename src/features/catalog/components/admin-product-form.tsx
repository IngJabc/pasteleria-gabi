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
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  hintClass,
  inputClass,
  labelClass,
  LiveRegion,
  textareaClass,
} from "@/components/ui/ui";
import { useToast } from "@/components/ui/toast";

type Props = {
  product?: AdminProduct | null;
  onSaved: (product: AdminProduct) => void;
  onCancelEdit?: () => void;
};

export function AdminProductForm({ product, onSaved, onCancelEdit }: Props) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [invalidFields, setInvalidFields] = useState<Record<string, boolean>>({});
  const [slugTouched, setSlugTouched] = useState(Boolean(product));
  const { showToast } = useToast();
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
      const msg = parsed.error.issues[0]?.message ?? invalidProductInputError;
      setFeedback(msg);
      showToast(msg, "error");
      return;
    }

    startTransition(async () => {
      setFeedback(null);
      setOk(null);
      const result: ProductActionResult = product
        ? await updateProduct({ ...parsed.data, productId: product.id })
        : await createProduct(parsed.data);
      setOk(result.ok);
      const message = result.ok
        ? product
          ? "Producto actualizado."
          : "Producto creado."
        : result.error;
      setFeedback(message);
      showToast(message, result.ok ? "success" : "error");
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
      id={formId}
      aria-labelledby={headingId}
      aria-busy={isPending}
      onSubmit={onSubmit}
      className="space-y-4 rounded-card border border-rose/60 bg-cream p-5"
    >
      <h3 id={headingId} className="font-display text-lg font-extrabold text-plum">
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
        <p id={`${formId}-slug-hint`} className={hintClass}>
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
          aria-invalid={invalidFields[`${formId}-description`] ?? false} className={textareaClass} />
      </div>

      <div>
        <label htmlFor={`${formId}-price`} className={labelClass}>Precio USD <span aria-hidden="true">*</span></label>
        <p id={`${formId}-price-hint`} className={hintClass}>
          Hasta dos decimales. Ejemplo: 12.50
        </p>
        <input id={`${formId}-price`} required inputMode="decimal" pattern="^\d+(\.\d{1,2})?$"
          value={priceUsd} aria-describedby={`${formId}-price-hint`}
          onChange={(e) => setPriceUsd(e.target.value)} onBlur={syncFieldValidity} onInvalid={syncFieldValidity}
          aria-invalid={invalidFields[`${formId}-price`] ?? false} className={inputClass} />
      </div>

      <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-ink">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)}
          className="size-5 rounded-field border border-rose accent-pink" />
        Producto activo en el catálogo público
      </label>

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={isPending} className={buttonPrimaryClass}>
          {isPending ? "Guardando…" : product ? "Guardar cambios" : "Crear producto"}
        </button>
        {product && onCancelEdit ? (
          <button type="button" disabled={isPending} onClick={onCancelEdit} className={buttonSecondaryClass}>
            Cancelar edición
          </button>
        ) : null}
      </div>

      <LiveRegion className={ok === false ? "text-pink" : "text-muted"}>
        {isPending ? "Guardando…" : (feedback ?? "")}
      </LiveRegion>
    </form>
  );
}
