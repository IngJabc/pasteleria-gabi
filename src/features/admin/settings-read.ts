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

const receiptSubmissionRowSchema = z.object({
  id: z.number().int().positive(),
  order_id: z.number().int().positive(),
});

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

export type AdminBcvSyncView = {
  id: number;
  attemptedAt: string;
  status: "success" | "failure" | "skipped" | "manual_overridden";
  source: string;
  scheduleSlot: string;
  effectiveDate: string | null;
  providerUpdatedAt: string | null;
  retrievedAt: string | null;
  rateVesPerUsd: string | number | null;
  errorCode: string | null;
  errorDetail: string | null;
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
  /** Latest automatic sync attempt; `null` when unavailable or never run. */
  bcvSync: AdminBcvSyncView | null;
  /** Latest successful automatic retrieval timestamp; null if none. */
  bcvLastSuccessfulRetrievalAt: string | null;
};

export type AdminNotificationItem = {
  id: number;
  createdAt: string;
  readAt: string | null;
  receiptSubmissionId: number;
  /** Resolved from `receipt_submissions`; null means no trustworthy link. */
  orderId: number | null;
};

export type AdminNotificationsResult = {
  unavailable: boolean;
  message: string;
  items: AdminNotificationItem[];
  truncated: boolean;
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
    bcvSync: null,
    bcvLastSuccessfulRetrievalAt: null,
  };
}

function unavailableNotifications(message: string): AdminNotificationsResult {
  return { unavailable: true, message, items: [], truncated: false };
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

    let bcvSync: AdminBcvSyncView | null = null;
    let bcvLastSuccessfulRetrievalAt: string | null = null;
    try {
      const [latestResult, lastSuccessResult] = await Promise.all([
        supabase
          .from("bcv_sync_attempts")
          .select(
            "id, attempted_at, status, source, schedule_slot, effective_date, provider_updated_at, retrieved_at, rate_ves_per_usd, error_code, error_detail",
          )
          .order("attempted_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("bcv_sync_attempts")
          .select("retrieved_at")
          .eq("status", "success")
          .not("retrieved_at", "is", null)
          .order("attempted_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (!latestResult.error && latestResult.data) {
        const row = latestResult.data as {
          id: number;
          attempted_at: string;
          status: "success" | "failure" | "skipped" | "manual_overridden";
          source: string;
          schedule_slot: string;
          effective_date: string | null;
          provider_updated_at: string | null;
          retrieved_at: string | null;
          rate_ves_per_usd: string | number | null;
          error_code: string | null;
          error_detail: string | null;
        };
        bcvSync = {
          id: row.id,
          attemptedAt: row.attempted_at,
          status: row.status,
          source: row.source,
          scheduleSlot: row.schedule_slot,
          effectiveDate: row.effective_date,
          providerUpdatedAt: row.provider_updated_at,
          retrievedAt: row.retrieved_at,
          rateVesPerUsd: row.rate_ves_per_usd,
          errorCode: row.error_code,
          errorDetail: row.error_detail,
        };
      }
      if (!lastSuccessResult.error && lastSuccessResult.data) {
        bcvLastSuccessfulRetrievalAt = (lastSuccessResult.data as { retrieved_at: string | null }).retrieved_at;
      } else if (bcvSync?.status === "success") {
        bcvLastSuccessfulRetrievalAt = bcvSync.retrievedAt;
      }
    } catch {
      bcvSync = null;
      bcvLastSuccessfulRetrievalAt = null;
    }

    return {
      unavailable: false,
      message: "",
      settings,
      deliveryZones,
      bcvRate,
      bcvSync,
      bcvLastSuccessfulRetrievalAt,
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

    const rows = (data ?? []).flatMap((row) => {
      const parsed = notificationRowSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    });

    // Admins may read receipt submissions (migration 005 RLS). Resolve the real
    // order id only from validated rows; a failed lookup leaves orderId null so
    // the inbox renders no destination instead of inventing one.
    const orderIds = new Map<number, number>();
    if (rows.length > 0) {
      const submissions = await supabase
        .from("receipt_submissions")
        .select("id, order_id")
        .in(
          "id",
          rows.map((row) => row.receipt_submission_id),
        );
      if (!submissions.error) {
        for (const row of submissions.data ?? []) {
          const parsed = receiptSubmissionRowSchema.safeParse(row);
          if (parsed.success) orderIds.set(parsed.data.id, parsed.data.order_id);
        }
      }
    }

    const items: AdminNotificationItem[] = rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      readAt: row.read_at,
      receiptSubmissionId: row.receipt_submission_id,
      orderId: orderIds.get(row.receipt_submission_id) ?? null,
    }));

    return {
      unavailable: false,
      message: "",
      items,
      truncated: rows.length === MAX_NOTIFICATIONS,
    };
  } catch {
    return unavailableNotifications(unavailableError);
  }
}
