import "server-only";

import { z } from "zod";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import {
  paymentInstructionsSchema,
  type PaymentInstructions,
} from "@/features/settings/schemas";

/**
 * Public, read-only data used by the storefront screens.
 *
 * Stock is served only through the existing `get_product_stock` RPC. That
 * function is service-role only (migration 002), so the public catalog never
 * reads inventory tables directly; the server resolves availability and returns
 * a single number per product. Delivery zones and store settings are read
 * through the request-bound anon client, whose RLS policies already restrict
 * them to active/public rows.
 */

const stockSchema = z.array(
  z.object({
    product_id: z.number().int().positive(),
    available_quantity: z.number().int().nonnegative(),
    remaining_quantity: z.number().int().nonnegative(),
    reserved_quantity: z.number().int().nonnegative(),
  }),
);

export type PublicStockMap = Record<number, number>;

export async function getProductStockMap(
  productIds: number[],
): Promise<PublicStockMap> {
  const unique = [...new Set(productIds)];
  if (unique.length === 0) return {};

  let supabase;
  try {
    supabase = createSupabaseAdminClient();
  } catch {
    // Missing server-only env (e.g. local dev without service-role key)
    // degrades availability display gracefully; never expose credentials/errors.
    return {};
  }

  const entries = await Promise.all(
    unique.map(async (productId) => {
      const { data, error } = await supabase.rpc("get_product_stock", {
        p_product_id: productId,
      });
      if (error) return null;
      const parsed = stockSchema.safeParse(data);
      if (!parsed.success || parsed.data.length === 0) return null;
      return [productId, parsed.data[0].available_quantity] as const;
    }),
  );

  return Object.fromEntries(
    entries.filter((entry): entry is readonly [number, number] => entry !== null),
  );
}

export async function getProductStock(productId: number): Promise<number | null> {
  const map = await getProductStockMap([productId]);
  return map[productId] ?? null;
}

const deliveryZoneSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().nullable(),
  fee_usd: z.coerce.number().nonnegative(),
  requires_quote: z.boolean(),
  sort_order: z.number().int(),
});

export type DeliveryZone = z.infer<typeof deliveryZoneSchema>;

export async function getActiveDeliveryZones(): Promise<DeliveryZone[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("delivery_zones")
    .select("id, name, description, fee_usd, requires_quote, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });

  if (error || !data) return [];

  const zones: DeliveryZone[] = [];
  for (const row of data) {
    const parsed = deliveryZoneSchema.safeParse(row);
    if (parsed.success) zones.push(parsed.data);
  }
  return zones;
}

export async function getPublicPaymentInstructions(): Promise<PaymentInstructions | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("store_settings")
      .select("payment_instructions")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) return null;
    const parsed = paymentInstructionsSchema.safeParse(data.payment_instructions);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
