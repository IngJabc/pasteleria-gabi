"use client";

import { useMemo, useState, useTransition } from "react";
import { Button, Input, LiveRegion, Textarea, labelClass } from "@/components/ui/ui";
import { submitProductReview } from "../actions";
import { REVIEW_COMMENT_MAX, REVIEW_NAME_MAX } from "../schemas";
import { RatingInput } from "./review-stars";

type ProductOption = { id: number; name: string };

export function ReviewForm({
  products,
  initialProductId,
  trackingToken,
  title = "Deja tu reseña",
  compact = false,
}: {
  products: ProductOption[];
  initialProductId?: number | null;
  trackingToken?: string | null;
  title?: string;
  compact?: boolean;
}) {
  const [productId, setProductId] = useState<number | "">(initialProductId ?? "");
  const [rating, setRating] = useState<number>(5);
  const [comment, setComment] = useState("");
  const [reviewerName, setReviewerName] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isPending, startTransition] = useTransition();

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === productId) ?? null,
    [products, productId],
  );
  const canSubmit = !isPending && productId !== "" && comment.trim().length > 0 && rating >= 1 && rating <= 5;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    setIsError(false);
    if (productId === "") {
      setIsError(true);
      setFeedback("Selecciona un producto para dejar tu reseña.");
      return;
    }
    startTransition(async () => {
      const result = await submitProductReview({
        productId,
        rating,
        comment,
        reviewerName,
        trackingToken: trackingToken ?? undefined,
      });
      if (!result.ok) {
        setIsError(true);
        setFeedback(result.error);
        return;
      }
      setIsError(false);
      setFeedback(result.message);
      setComment("");
      setReviewerName("");
      if (!initialProductId) setProductId("");
      setRating(5);
    });
  }

  if (products.length === 0) {
    return (
      <p className="text-sm text-muted">
        No hay productos disponibles para reseñar en este momento.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className={`space-y-4 ${compact ? "" : "rounded-section bg-white p-6 shadow-sm"}`}>
      <div className="space-y-1">
        <h3 className="font-display text-2xl font-extrabold text-plum">{title}</h3>
        <p className="text-sm leading-6 text-muted">
          Tu reseña se publica inmediatamente. No necesitas registrarte.
          {trackingToken ? " Esta reseña se asociará al pedido verificado cuando corresponda." : ""}
        </p>
      </div>

      <div>
        <label htmlFor={`review-product-${trackingToken ?? "public"}`} className={labelClass}>
          Producto <span className="text-pink">*</span>
        </label>
        <select
          id={`review-product-${trackingToken ?? "public"}`}
          className="min-h-12 w-full rounded-field border border-rose bg-white px-4 py-2 text-base text-ink shadow-sm focus-visible:border-lavender focus-visible:outline-none"
          value={productId}
          onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : "")}
          required
          disabled={Boolean(initialProductId) || isPending}
        >
          <option value="">Selecciona un producto</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`review-name-${trackingToken ?? "public"}`} className={labelClass}>
          Tu nombre <span className="font-normal text-muted">(opcional)</span>
        </label>
        <Input
          id={`review-name-${trackingToken ?? "public"}`}
          value={reviewerName}
          onChange={(e) => setReviewerName(e.target.value)}
          maxLength={REVIEW_NAME_MAX}
          autoComplete="name"
          placeholder="Como quieres que aparezca"
          disabled={isPending}
        />
      </div>

      <RatingInput name={`rating-${trackingToken ?? "public"}`} value={rating} onChange={setRating} />

      <div>
        <label htmlFor={`review-comment-${trackingToken ?? "public"}`} className={labelClass}>
          Comentario <span className="text-pink">*</span>
        </label>
        <Textarea
          id={`review-comment-${trackingToken ?? "public"}`}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={REVIEW_COMMENT_MAX}
          required
          disabled={isPending}
          placeholder="Cuéntanos qué te pareció el producto"
        />
        <p className="mt-1 text-xs text-muted">{comment.length}/{REVIEW_COMMENT_MAX}</p>
      </div>

      <Button type="submit" disabled={!canSubmit}>
        {isPending ? "Enviando..." : "Publicar reseña"}
      </Button>

      <LiveRegion className={isError ? "text-pink" : "text-muted"}>
        {feedback ?? (selectedProduct && trackingToken ? `Reseña para ${selectedProduct.name}.` : "")}
      </LiveRegion>
    </form>
  );
}
