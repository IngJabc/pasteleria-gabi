"use server";

import "server-only";

/**
 * Server Actions for the OQ-16 SLA notification rows shown in the unified
 * administrator inbox. This is a dedicated top-level `"use server"` module so
 * Client Components can import action references without bundling server-only
 * read-model code. Every action derives the administrator from the session and
 * never accepts a client-supplied admin id.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AdminMutationResult } from "@/features/admin/settings-read";
import { requireActiveAdminId } from "@/features/payments/admin-session";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";

const invalidSessionError = "La sesión del administrador no es válida.";
const invalidInputError = "La notificación no es válida.";
const capabilityUnavailable =
  "La capacidad de consultar las notificaciones no está disponible en este momento.";

const notificationIdSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]*$/, "El identificador no es válido.")
  .transform((value) => Number(value))
  .refine((value) => Number.isSafeInteger(value), {
    message: "El identificador no es válido.",
  });

/** Marks one of the current admin's own SLA notifications as read. */
export async function markAdminNotificationAsRead(input: {
  notificationId: string;
}): Promise<AdminMutationResult> {
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

/** Marks only the current admin's own unread SLA notifications as read. */
export async function markAllAdminNotificationsReadAction(): Promise<AdminMutationResult> {
  let adminId: string;
  try {
    adminId = await requireActiveAdminId();
  } catch {
    return { ok: false, message: invalidSessionError };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("admin_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("admin_id", adminId)
      .is("read_at", null);
    if (error) return { ok: false, message: capabilityUnavailable };

    revalidatePath("/admin/notificaciones");
    revalidatePath("/admin");
    return {
      ok: true,
      message: "Todas las notificaciones se marcaron como leídas.",
    };
  } catch {
    return { ok: false, message: capabilityUnavailable };
  }
}
