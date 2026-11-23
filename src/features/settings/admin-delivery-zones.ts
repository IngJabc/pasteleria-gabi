"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import { requireActiveAdminId } from "@/features/payments/admin-session";

const invalidSessionError = "La sesión del administrador no es válida.";
const invalidInputError = "Los datos de la zona de entrega no son válidos.";
const genericError = "No se pudo guardar la zona de entrega. Inténtalo de nuevo.";

const moneyPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

const updateDeliveryZoneSchema = z.strictObject({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  feeUsd: z.string().trim().regex(moneyPattern, "La tarifa debe ser un monto USD válido."),
  requiresQuote: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(9999),
});

export type UpdateDeliveryZoneInput = z.infer<typeof updateDeliveryZoneSchema>;

export type UpdateDeliveryZoneResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateDeliveryZone(
  input: UpdateDeliveryZoneInput,
): Promise<UpdateDeliveryZoneResult> {
  const parsed = updateDeliveryZoneSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: invalidInputError };
  }

  try {
    await requireActiveAdminId();
  } catch {
    return { ok: false, error: invalidSessionError };
  }

  const requiresQuote = parsed.data.requiresQuote;
  const feeUsd = requiresQuote ? 0 : Number(parsed.data.feeUsd);
  if (!Number.isFinite(feeUsd) || feeUsd < 0) {
    return { ok: false, error: invalidInputError };
  }

  const { error } = await (await createSupabaseServerClient())
    .from("delivery_zones")
    .update({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      fee_usd: feeUsd,
      requires_quote: requiresQuote,
      is_active: parsed.data.isActive,
      sort_order: parsed.data.sortOrder,
    })
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: genericError };
  }

  return { ok: true };
}
