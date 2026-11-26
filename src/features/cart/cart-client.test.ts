/**
 * Static contracts for the /carrito stock guard. The client only receives a
 * serializable stock map; the server loader and the server checkout remain the
 * authorities. Runtime capacity rules live in the environment-neutral helper.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cartClient = readFileSync(
  fileURLToPath(new URL("./components/cart-client.tsx", import.meta.url)),
  "utf8",
);
const cartPage = readFileSync(
  fileURLToPath(
    new URL("../../app/(storefront)/carrito/page.tsx", import.meta.url),
  ),
  "utf8",
);
const publicData = readFileSync(
  fileURLToPath(new URL("../catalog/public-data.ts", import.meta.url)),
  "utf8",
);
const capacityHelper = readFileSync(
  fileURLToPath(
    new URL("../catalog/add-to-cart-capacity.ts", import.meta.url),
  ),
  "utf8",
);

function plusButtonSource(source: string): string {
  const label = source.indexOf("? `Aumentar cantidad de ${item.name}`");
  if (label < 0) return "";
  return source.slice(
    source.lastIndexOf("<Button", label),
    source.indexOf("/>", label) + 2,
  );
}

describe("cart quantity stock guard (static)", () => {
  it("uses the pure capacity helper for every displayed item", () => {
    expect(cartClient).toContain(
      'import { canIncreaseCartItemQuantity } from "@/features/catalog/add-to-cart-capacity";',
    );
    expect(capacityHelper).toContain(
      "export function canIncreaseCartItemQuantity(",
    );
    expect(cartClient).toContain("stockByProductId = {},");
    expect(cartClient).toContain("stockByProductId?: Record<number, number>;");
    expect(cartClient).toContain(
      "const available = stockByProductId[item.productId] ?? null;",
    );
    expect(cartClient).toContain(
      "const canIncrease = canIncreaseCartItemQuantity(available, item.quantity);",
    );
  });

  it("disables the plus control and changes its accessible name when blocked", () => {
    const plus = plusButtonSource(cartClient);
    expect(plus).not.toBe("");
    expect(plus).toContain("disabled={!canIncrease}");
    expect(plus).toContain("? `Aumentar cantidad de ${item.name}`");
    expect(plus).toContain(
      ": `No hay más unidades disponibles de ${item.name}`",
    );
    expect(plus).not.toContain("title=");

    // Decrease and removal stay available so a stale bag can always be fixed.
    expect(cartClient).toContain('aria-label={`Disminuir cantidad de ${item.name}`}');
    expect(cartClient).toContain(
      "onClick={() => setQuantity(item.productId, item.quantity - 1)}",
    );
    expect(cartClient).toContain("onClick={() => removeItem(item.productId)}");
  });

  it("explains the cap in a visible LiveRegion instead of a tooltip", () => {
    expect(cartClient).toContain(
      'import { Button, LiveRegion } from "@/components/ui/ui";',
    );
    const liveRegion =
      cartClient.match(/<LiveRegion[\s\S]*?<\/LiveRegion>/)?.[0] ?? "";
    expect(liveRegion).toContain("{capacityMessage}");
    expect(liveRegion).toContain('? "sr-only"');
    expect(liveRegion).toContain(
      ': "col-span-2 text-pink sm:col-span-1 sm:col-start-2"',
    );
    expect(liveRegion).not.toContain("aria-hidden");
    expect(cartClient).toContain('"No hay unidades disponibles."');
    expect(cartClient).toContain("`Máximo disponible: ${available} unidades.`");
    expect(cartClient).not.toMatch(/\btitle=/);
  });

  it("fetches active-product stock on the server and passes it to the cart", () => {
    expect(cartPage).toContain("getActiveProductStockMap");
    expect(cartPage).toMatch(
      /const \[zones, stock\] = await Promise\.all\(\[/,
    );
    expect(cartPage).toContain("getActiveDeliveryZones().catch(() => [])");
    expect(cartPage).toContain("getActiveProductStockMap().catch(() => ({}))");
    expect(cartPage).toContain(
      "<CartClient zones={zones} stockByProductId={stock} />",
    );
    expect(cartPage).toContain("export const instant = false;");
  });

  it("resolves stock through the request client and the existing RPC wrapper", () => {
    expect(publicData).toContain(
      "export async function getActiveProductStockMap(): Promise<PublicStockMap> {",
    );
    const stockLoader =
      publicData.match(
        /export async function getActiveProductStockMap\(\)[\s\S]*?\n\}/,
      )?.[0] ?? "";
    expect(stockLoader).toContain("await createSupabaseServerClient()");
    expect(stockLoader).toContain('.from("products")');
    expect(stockLoader).toContain('.select("id")');
    expect(stockLoader).toContain('.eq("is_active", true)');
    expect(stockLoader).toContain("Number.isSafeInteger(id) && id > 0");
    expect(stockLoader).toContain("return await getProductStockMap(ids);");
    expect(stockLoader).toContain("return {};");
    expect(stockLoader).not.toContain("createSupabaseAdminClient");

    for (const table of [
      "inventory",
      "stock",
      "product_stock",
      "product_inventory",
      "reservations",
    ]) {
      expect(publicData).not.toContain(`.from("${table}")`);
    }
  });

  it("does not leak server-only stock access into the client bundle", () => {
    expect(cartClient).not.toContain("server-only");
    expect(cartClient).not.toContain("createSupabaseServerClient");
    expect(cartClient).not.toContain("createSupabaseAdminClient");
    expect(cartClient).not.toContain("getActiveProductStockMap");
    expect(cartClient).not.toContain("getProductStockMap");
    expect(cartClient).not.toContain("PublicStockMap");
    expect(cartClient).toContain(
      'import type { DeliveryZone } from "@/features/catalog/public-data";',
    );
    expect(cartClient).not.toMatch(
      /import\s+\{[^}]*DeliveryZone[^}]*\}\s+from\s+"@\/features\/catalog\/public-data"/,
    );
  });

  it("keeps the existing cart context and checkout wiring intact", () => {
    expect(cartClient).toContain(
      "const { items, subtotalUsd, setQuantity, removeItem, hydrated } = useCart();",
    );
    expect(cartClient).toContain(
      'subtotalUsd + (draft.fulfillmentType === "delivery" ? deliveryFee : 0)',
    );
    expect(cartClient).toContain('href="/checkout/entrega"');
    expect(cartClient).toContain('href="/productos"');
    expect(cartPage).toContain("<CheckoutSteps />");
  });
});
