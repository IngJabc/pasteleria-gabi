import "server-only";

import { z } from "zod";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import { requireActiveAdminId } from "@/features/payments/admin-session";
import { getCurrentBcvRate } from "@/features/exchange-rates/checkout-rates";
import {
  businessHoursSchema,
  type BusinessHours,
} from "@/features/settings/schemas";

/**
 * Administrative read models for the singleton settings row, every delivery
 * zone (active or not), the current BCV rate and the admin's own notification
 * inbox. Unset columns stay `null`; nothing is defaulted or invented.
 */

const unavailableError =
  "La configuración de la tienda no está disponible en este momento.";
const invalidSessionError = "La sesión del administrador no es válida.";
const invalidInputError = "La notificación no es válida.";
const capabilityUnavailable =
  "La capacidad de consultar las notificaciones no está disponible en este momento.";

const MAX_ZONES = 200;
const MAX_NOTIFICATIONS = 50;

const storeSettingsRowSchema = z.object({
  pickup_address: z.string().nullable(),
  business_hours: z.unknown().nullable(),
  whatsapp_phone: z.string().nullable().optional(),
  payment_instructions: z.json().nullable().optional(),
});

const deliveryZoneRowSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().nullable(),
  fee_usd: z.coerce.number().nonnegative(),
  requires_quote: z.boolean(),
  is_active: z.boolean(),
  sort_order: z.number().int(),
});

const notificationRowSchema = z.object({
  id: z.number().int().positive(),
  created_at: z.string().min(1),
  read_at: z.string().nullable(),
  receipt_submission_id: z.number().int().positive(),
});

const notificationIdSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]*$/, "El identificador no es válido.")
  .transform((value) => Number(value));

export type AdminDeliveryZoneView = {
  id: number;
  name: string;
  description: string | null;
  feeUsd: number;
  requiresQuote: boolean;
  isActive: boolean;
  sortOrder: number;
};

export type AdminBcvRateView = {
  rateVesPerUsd: string | number;
  observedAt: string;
  source: string | null;
  isStale: boolean;
  ageSeconds: number;
  asOf: string;
};

/** Explicit serializable shape for the JSONB configuration columns. */
export type AdminJsonValue =
  | string
  | number
  | boolean
  | null
  | AdminJsonValue[]
  | { [key: string]: AdminJsonValue | undefined };

export type AdminSettingsView = {
  pickupAddress: string | null;
  businessHours: BusinessHours | null;
  whatsappPhone: string | null;
  paymentInstructions: AdminJsonValue | null;
};

export type AdminSettingsSnapshotResult = {
  unavailable: boolean;
  message: string;
  settings: AdminSettingsView;
  /** All zones, including inactive ones, in `sort_order` order. */
  deliveryZones: AdminDeliveryZoneView[];
  /** `null` when there is no active rate or the rate read failed. */
  bcvRate: AdminBcvRateView | null;
};

export type AdminNotificationItem = {
  id: number;
  createdAt: string;
  readAt: string | null;
  receiptSubmissionId: number;
};

export type AdminNotificationsResult = {
  unavailable: boolean;
  message: string;
  items: AdminNotificationItem[];
};

export type AdminMutationResult = {
  ok: boolean;
  message: string;
};

function emptySettingsView(): AdminSettingsView {
  return {
    pickupAddress: null,
    businessHours: null,
    whatsappPhone: null,
    paymentInstructions: null,
  };
}

function unavailableSnapshot(message: string): AdminSettingsSnapshotResult {
  return {
    unavailable: true,
    message,
    settings: emptySettingsView(),
    deliveryZones: [],
    bcvRate: null,
  };
}

function unavailableNotifications(message: string): AdminNotificationsResult {
  return { unavailable: true, message, items: [] };
}

export async function getAdminSettingsSnapshot(): Promise<AdminSettingsSnapshotResult> {
  try {
    await requireActiveAdminId();
  } catch {
    return unavailableSnapshot(invalidSessionError);
  }

  try {
    const supabase = await createSupabaseServerClient();

    const settingsResult = await supabase
      .from("store_settings")
      .select("id, pickup_address, business_hours, whatsapp_phone, payment_instructions")
      .eq("id", 1)
      .maybeSingle();
    if (settingsResult.error) return unavailableSnapshot(unavailableError);

    const settings = emptySettingsView();
    const parsedSettings = storeSettingsRowSchema.safeParse(settingsResult.data);
    if (parsedSettings.success) {
      settings.pickupAddress = parsedSettings.data.pickup_address;
      settings.whatsappPhone = parsedSettings.data.whatsapp_phone ?? null;
      settings.paymentInstructions =
        parsedSettings.data.payment_instructions ?? null;
      const hours = businessHoursSchema.safeParse(parsedSettings.data.business_hours);
      settings.businessHours = hours.success ? hours.data : null;
    }

    const zonesResult = await supabase
      .from("delivery_zones")
      .select("id, name, description, fee_usd, requires_quote, is_active, sort_order")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
      .limit(MAX_ZONES);
    if (zonesResult.error) return unavailableSnapshot(unavailableError);

    const deliveryZones: AdminDeliveryZoneView[] = [];
    for (const row of zonesResult.data ?? []) {
      const parsed = deliveryZoneRowSchema.safeParse(row);
      if (!parsed.success) continue;
      deliveryZones.push({
        id: parsed.data.id,
        name: parsed.data.name,
        description: parsed.data.description,
        feeUsd: parsed.data.fee_usd,
        requiresQuote: parsed.data.requires_quote,
        isActive: parsed.data.is_active,
        sortOrder: parsed.data.sort_order,
      });
    }

    // The rate RPC lives in a later migration than the settings tables and may
    // not be deployed. A failure degrades to `null`, never to an invented rate.
    let bcvRate: AdminBcvRateView | null = null;
    try {
      const current = await getCurrentBcvRate();
      if (current.ok && current.rate) {
        bcvRate = {
          rateVesPerUsd: current.rate.rateVesPerUsd,
          observedAt: current.rate.observedAt,
          source: current.rate.source,
          isStale: current.rate.isStale,
          ageSeconds: current.rate.ageSeconds,
          asOf: current.rate.asOf,
        };
      }
    } catch {
      bcvRate = null;
    }

    return {
      unavailable: false,
      message: "",
      settings,
      deliveryZones,
      bcvRate,
    };
  } catch {
    return unavailableSnapshot(unavailableError);
  }
}

export async function listAdminNotifications(): Promise<AdminNotificationsResult> {
  let adminId: string;
  try {
    adminId = await requireActiveAdminId();
  } catch {
    return unavailableNotifications(invalidSessionError);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("admin_notifications")
      .select("id, created_at, read_at, receipt_submission_id")
      .eq("admin_id", adminId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAX_NOTIFICATIONS);
    if (error) return unavailableNotifications(unavailableError);

    const items: AdminNotificationItem[] = [];
    for (const row of data ?? []) {
      const parsed = notificationRowSchema.safeParse(row);
      if (!parsed.success) continue;
      items.push({
        id: parsed.data.id,
        createdAt: parsed.data.created_at,
        readAt: parsed.data.read_at,
        receiptSubmissionId: parsed.data.receipt_submission_id,
      });
    }

    return { unavailable: false, message: "", items };
  } catch {
    return unavailableNotifications(unavailableError);
  }
}

/** Marks one of the current admin's own notifications as read. */
export async function markAdminNotificationAsRead(input: {
  notificationId: string;
}): Promise<AdminMutationResult> {
  "use server";

  let adminId: string;
  try {
    adminId = await requireActiveAdminId();
  } catch {
    return { ok: false, message: invalidSessionError };
  }

  const parsed = notificationIdSchema.safeParse(input?.notificationId);
  if (!parsed.success) return { ok: false, message: invalidInputError };

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("admin_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", parsed.data)
      .eq("admin_id", adminId)
      .is("read_at", null);
    if (error) return { ok: false, message: capabilityUnavailable };
    return { ok: true, message: "La notificación se marcó como leída." };
  } catch {
    return { ok: false, message: capabilityUnavailable };
  }
}
