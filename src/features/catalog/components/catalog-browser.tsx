"use client";

import { useMemo, useState } from "react";
import type { CatalogProduct } from "../schemas";
import type { PublicStockMap } from "../public-data";
import { ProductGrid } from "./product-grid";
import { Input } from "@/components/ui/ui";
import { SearchIcon } from "@/components/ui/icons";

const TABS = ["Todas", "Porciones"] as const;
type Tab = (typeof TABS)[number];

/**
 * Catalog search and category tabs over the server-provided active products.
 *
 * The catalog schema has no category column yet, so the non-"Todas" tabs are
 * rendered exactly as designed but resolve to an honest empty state until the
 * business adds categories (no schema change is invented here).
 */
export function CatalogBrowser({
  products,
  stock,
}: {
  products: CatalogProduct[];
  stock?: PublicStockMap;
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("Todas");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((product) => {
      const matchesQuery =
        needle === "" ||
        product.name.toLowerCase().includes(needle) ||
        product.description.toLowerCase().includes(needle);
      const category =
        (product as { category?: string | null }).category?.toLowerCase() ??
        null;
      const matchesTab = tab === "Todas" || category === tab.toLowerCase();
      return matchesQuery && matchesTab;
    });
  }, [products, query, tab]);

  return (
    <div className="flex flex-col gap-6">
      <div className="relative max-w-2xl">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar tortas, sabores y alegrías..."
          aria-label="Buscar en el catálogo"
          className="pl-12"
        />
      </div>

      <div
        role="tablist"
        aria-label="Categorías del catálogo"
        className="flex flex-wrap gap-2"
      >
        {TABS.map((name) => {
          const selected = tab === name;
          return (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(name)}
              className={`min-h-11 cursor-pointer rounded-full px-4 py-2 font-display text-base font-bold transition-colors ${
                selected
                  ? "border-[3px] border-white bg-pink-soft text-ink shadow-sticker transition-all active:translate-y-[2px] active:shadow-none"
                  : "border-[3px] border-transparent text-pink hover:bg-rose"
              }`}
            >
              {name}
            </button>
          );
        })}
      </div>

      <p className="text-sm text-muted">
        {filtered.length} producto(s) · Disponibilidad en tiempo real
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-card border border-white bg-white p-10 text-center text-muted shadow-sm">
          {tab === "Todas"
            ? "No encontramos productos con esa búsqueda."
            : `Aún no hay productos en la categoría “${tab}”.`}
        </p>
      ) : (
        <ProductGrid products={filtered} stock={stock} />
      )}
    </div>
  );
}
