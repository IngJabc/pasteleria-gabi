"use server";

import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import { requireActiveAdminId } from "@/features/payments/admin-session";
import type { Database } from "@/infrastructure/database/database.types";
import {
  storeSettingsRowSchema,
  updateStoreSettingsSchema,
  type StoreSettingsRow,
  type UpdateStoreSettingsInput,
} from "./schemas";

/**
 * OQ-8 — administrator-only store configuration. The admin id is always
 * session-derived; clients never supply it. Writes go through the existing
 * cookie-bound client so the unchanged `store_settings_admin_all` RLS policy
 * is the final authorization boundary (no service-role bypass). No schedule
 * value can block an order: this action only writes customer-facing metadata
 * on the singleton.
 */

const invalidSessionError = "La sesión del administrador no es válida.";
const invalidInputError = "Los horarios o la dirección no son válidos.";
const genericError = "No se pudo guardar la configuración. Inténtalo de nuevo.";

type StoreSettingsUpdate = Database["public"]["Tables"]["store_settings"]["Update"];

export type UpdateStoreSettingsResult =
  | { ok: true; settings: StoreSettingsRow }
  | { ok: false; error: string };

export async function updateStoreSettings(input: UpdateStoreSettingsInput): Promise<UpdateStoreSettingsResult> {
  const parsed = updateStoreSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: invalidInputError };
  }

  let adminId: string;
  try {
    adminId = await requireActiveAdminId();
  } catch {
    return { ok: false, error: invalidSessionError };
  }

  const patch: StoreSettingsUpdate = { updated_by: adminId };
  if (parsed.data.pickupAddress !== undefined) {
    patch.pickup_address = parsed.data.pickupAddress;
  }
  if (parsed.data.businessHours !== undefined) {
    patch.business_hours = parsed.data.businessHours;
  }

  const { data, error } = await (await createSupabaseServerClient())
    .from("store_settings")
    .update(patch)
    .eq("id", 1)
    .select()
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: genericError };
  }

  const result = storeSettingsRowSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, error: genericError };
  }

  return { ok: true, settings: result.data };
}

export async function getStoreSettings(): Promise<StoreSettingsRow | null> {
  const { data, error } = await (await createSupabaseServerClient())
    .from("store_settings")
    .select()
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) return null;
  const parsed = storeSettingsRowSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
