"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AdminStatusChip, AdminSurface, AdminTable } from "@/components/admin/admin-ui";
import { Button, Input, LiveRegion } from "@/components/ui/ui";
import { formatDateTime } from "@/features/admin/format";
import { setReviewHiddenAction } from "../admin-actions";
import { AdminReviewsRealtime } from "./reviews-realtime";
import type { AdminReviewFilter } from "../schemas";

type Row = {
  id: number;
  product_id: number;
  order_id: number | null;
  reviewer_name: string | null;
  rating: number;
  comment: string;
  is_verified_purchase: boolean;
  is_hidden: boolean;
  created_at: string;
  productName: string | null;
};

export function AdminReviewsManager({
  rows,
  products,
  filter,
}: {
  rows: Row[];
  products: Array<{ id: number; name: string }>;
  filter: AdminReviewFilter;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function updateFilter(next: Partial<AdminReviewFilter>) {
    const params = new URLSearchParams();
    const merged = { ...filter, ...next, page: next.page ?? 1 };
    if (merged.status !== "all") params.set("status", merged.status);
    if (merged.productId) params.set("productId", String(merged.productId));
    if (merged.rating) params.set("rating", String(merged.rating));
    if (merged.search) params.set("search", merged.search);
    if (merged.page > 1) params.set("page", String(merged.page));
    const qs = params.toString();
    router.push(qs ? `/admin/resenas?${qs}` : "/admin/resenas");
  }

  function onToggle(row: Row) {
    setFeedback(null);
    setError(null);
    startTransition(async () => {
      const result = await setReviewHiddenAction({ reviewId: row.id, hidden: !row.is_hidden });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFeedback(row.is_hidden ? "Reseña restaurada." : "Reseña ocultada.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <AdminReviewsRealtime />
      <AdminSurface className="p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-sm font-bold text-ink">
            Estado
            <select className="mt-1 min-h-11 w-full rounded-field border border-rose bg-white px-3" value={filter.status} onChange={(e) => updateFilter({ status: e.target.value as AdminReviewFilter["status"] })}>
              <option value="all">Todas</option>
              <option value="published">Publicadas</option>
              <option value="hidden">Ocultas</option>
            </select>
          </label>
          <label className="text-sm font-bold text-ink">
            Producto
            <select className="mt-1 min-h-11 w-full rounded-field border border-rose bg-white px-3" value={filter.productId ?? ""} onChange={(e) => updateFilter({ productId: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">Todos</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-bold text-ink">
            Calificación
            <select className="mt-1 min-h-11 w-full rounded-field border border-rose bg-white px-3" value={filter.rating ?? ""} onChange={(e) => updateFilter({ rating: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">Todas</option>
              {[5,4,3,2,1].map((r) => <option key={r} value={r}>{r} estrellas</option>)}
            </select>
          </label>
          <label className="text-sm font-bold text-ink">
            Buscar
            <Input value={filter.search ?? ""} onChange={(e) => updateFilter({ search: e.target.value || undefined })} placeholder="Nombre o comentario" />
          </label>
        </div>
      </AdminSurface>

      <LiveRegion className={error ? "text-pink" : "text-muted"}>{error ?? feedback ?? ""}</LiveRegion>

      <AdminSurface className="p-0 overflow-hidden">
        <AdminTable caption="Rese?as de productos" headers={["Fecha", "Producto", "Cliente", "Calificación", "Comentario", "Compra", "Estado", "Acción"]}>
          {rows.length === 0 ? (
            <tr><td colSpan={8} className="px-4 py-8 text-center text-muted">No hay reseñas para este filtro.</td></tr>
          ) : rows.map((row) => (
            <tr key={row.id} className="border-t border-rose/40 align-top">
              <td className="px-4 py-3 text-sm text-muted whitespace-nowrap">{formatDateTime(row.created_at)}</td>
              <td className="px-4 py-3 text-sm font-bold text-plum">{row.productName ?? `#${row.product_id}`}</td>
              <td className="px-4 py-3 text-sm text-ink">{row.reviewer_name?.trim() || "Cliente anónimo"}</td>
              <td className="px-4 py-3 text-sm text-ink">{"★".repeat(row.rating)}<span className="sr-only">{row.rating} de 5</span></td>
              <td className="px-4 py-3 text-sm text-ink max-w-md"><p className="whitespace-pre-wrap">{row.comment}</p></td>
              <td className="px-4 py-3">{row.is_verified_purchase ? <AdminStatusChip tone="mint">Verificada</AdminStatusChip> : <span className="text-xs text-muted">Pública</span>}</td>
              <td className="px-4 py-3">{row.is_hidden ? <AdminStatusChip tone="rose">Oculta</AdminStatusChip> : <AdminStatusChip tone="mint">Publicada</AdminStatusChip>}</td>
              <td className="px-4 py-3">
                <Button variant="secondary" disabled={isPending} onClick={() => onToggle(row)} className="min-h-10 px-3 py-2 text-xs">
                  {row.is_hidden ? "Restaurar" : "Ocultar"}
                </Button>
              </td>
            </tr>
          ))}
        </AdminTable>
      </AdminSurface>
    </div>
  );
}
