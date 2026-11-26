"use server";

import "server-only";

/**
 * Server-only data access layer for general administrator notifications.
 *
 * Every read and mutation resolves the administrator from the request session
 * and passes that id as an explicit RLS filter. No caller-supplied admin id is
 * ever accepted. Invalid rows produce an honest "unavailable" result instead
 * of invented data.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  GENERAL_NOTIFICATION_EVENT_TYPES,
  generalNotificationEventKey,
  type AdminGeneralNotificationItem,
} from "@/features/admin/general-notifications-helpers";
import {
  AdminSessionError,
  requireActiveAdminId,
} from "@/features/payments/admin-session";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";

const MAX_NOTIFICATIONS = 200;

const positiveIdSchema = z
  .number()
  .int("El identificador debe ser un número entero.")
  .positive("El identificador debe ser válido.")
  .safe();

const nullablePositiveIdSchema = positiveIdSchema.nullable();

const notificationRowSchema = z
  .object({
    id: positiveIdSchema,
    event_type: z.enum(GENERAL_NOTIFICATION_EVENT_TYPES),
    event_key: z.string().min(1),
    summary: z.string().min(1),
    created_at: z.string().min(1),
    read_at: z.string().nullable(),
    order_id: nullablePositiveIdSchema,
    receipt_submission_id: nullablePositiveIdSchema,
    payment_id: nullablePositiveIdSchema,
    review_id: nullablePositiveIdSchema,
    product_id: nullablePositiveIdSchema,
  })
  .refine((row) => {
    let targetId: number | null = null;
    if (row.event_type === "new_order") {
      targetId = row.order_id;
    } else if (row.event_type === "payment_receipt" || row.event_type === "receipt_correction") {
      targetId = row.receipt_submission_id;
    } else {
      targetId = row.review_id;
    }
    return targetId !== null && row.event_key === generalNotificationEventKey(row.event_type, targetId);
  }, { message: "La clave de la notificación no es válida." });

const notificationListSchema = z.array(notificationRowSchema);

const notificationIdInputSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d*$/, "El identificador de la notificación no es válido.")
  .transform(Number)
  .refine((value) => Number.isSafeInteger(value), {
    message: "El identificador de la notificación no es válido.",
  });

const notificationReadInputSchema = z.object({
  notificationId: notificationIdInputSchema,
  read: z.boolean(),
});

export type GeneralNotificationActionResult = {
  ok: boolean;
  message: string;
};

export type AdminGeneralNotificationsResult = {
  unavailable: boolean;
  message: string;
  items: AdminGeneralNotificationItem[];
  truncated: boolean;
};

const READ_FAILED = "No se pudo actualizar la notificación. Intenta nuevamente.";
const MARK_ALL_FAILED = "No se pudieron marcar las notificaciones. Intenta nuevamente.";
const LIST_FAILED = "No se pudieron cargar las notificaciones. Intenta nuevamente.";

function sessionMessage(error: unknown, fallback: string): string {
  return error instanceof AdminSessionError ? error.message : fallback;
}

function revalidateGeneralNotifications(): void {
  revalidatePath("/admin/notificaciones");
  revalidatePath("/admin");
}

function mapRow(row: z.infer<typeof notificationRowSchema>): AdminGeneralNotificationItem {
  return {
    id: row.id,
    eventType: row.event_type,
    eventKey: row.event_key,
    summary: row.summary,
    createdAt: row.created_at,
    readAt: row.read_at,
    orderId: row.order_id,
    receiptSubmissionId: row.receipt_submission_id,
    paymentId: row.payment_id,
    reviewId: row.review_id,
    productId: row.product_id,
  };
}

/** Unread general notifications for the current admin, or null if unavailable. */
export async function getAdminGeneralUnreadCount(): Promise<number | null> {
  try {
    const adminId = await requireActiveAdminId();
    const supabase = await createSupabaseServerClient();
    const { count, error } = await supabase
      .from("admin_general_notifications")
      .select("id", { count: "exact", head: true })
      .eq("admin_id", adminId)
      .is("read_at", null);

    if (error || count === null) return null;
    return count;
  } catch {
    return null;
  }
}

/** Validated, newest-first inbox for the current admin only. */
export async function listAdminGeneralNotifications(): Promise<AdminGeneralNotificationsResult> {
  try {
    const adminId = await requireActiveAdminId();
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("admin_general_notifications")
      .select(
        "id, event_type, event_key, summary, created_at, read_at, order_id, receipt_submission_id, payment_id, review_id, product_id",
      )
      .eq("admin_id", adminId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAX_NOTIFICATIONS);

    if (error) {
      return { unavailable: true, message: LIST_FAILED, items: [], truncated: false };
    }

    const parsed = notificationListSchema.safeParse(data ?? []);
    if (!parsed.success) {
      return { unavailable: true, message: LIST_FAILED, items: [], truncated: false };
    }

    return {
      unavailable: false,
      message: "",
      items: parsed.data.map(mapRow),
      truncated: parsed.data.length === MAX_NOTIFICATIONS,
    };
  } catch (error) {
    return {
      unavailable: true,
      message: sessionMessage(error, LIST_FAILED),
      items: [],
      truncated: false,
    };
  }
}

/** Mark one of the current admin's own notifications read or unread. */
export async function setAdminGeneralNotificationReadAction(input: {
  notificationId: string;
  read: boolean;
}): Promise<GeneralNotificationActionResult> {
  const parsed = notificationReadInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "El identificador de la notificación no es válido.",
    };
  }

  try {
    const adminId = await requireActiveAdminId();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("admin_general_notifications")
      .update({ read_at: parsed.data.read ? new Date().toISOString() : null })
      .eq("id", parsed.data.notificationId)
      .eq("admin_id", adminId);

    if (error) {
      return { ok: false, message: READ_FAILED };
    }

    revalidateGeneralNotifications();
    return {
      ok: true,
      message: parsed.data.read
        ? "Notificación marcada como leída."
        : "Notificación marcada como no leída.",
    };
  } catch (error) {
    return { ok: false, message: sessionMessage(error, READ_FAILED) };
  }
}

/** Mark only the current admin's still-unread notifications as read. */
export async function markAllAdminGeneralNotificationsReadAction(): Promise<GeneralNotificationActionResult> {
  try {
    const adminId = await requireActiveAdminId();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("admin_general_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("admin_id", adminId)
      .is("read_at", null);

    if (error) {
      return { ok: false, message: MARK_ALL_FAILED };
    }

    revalidateGeneralNotifications();
    return {
      ok: true,
      message: "Todas las notificaciones se marcaron como leídas.",
    };
  } catch (error) {
    return { ok: false, message: sessionMessage(error, MARK_ALL_FAILED) };
  }
}
