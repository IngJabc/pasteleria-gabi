import "server-only";

/**
 * Administrator notification badge READ.
 *
 * Gated by `requireActiveAdminId()` and constrained by the
 * `admin_notifications_admin_select` RLS policy (own rows only). Any error or
 * missing table returns `null` so the UI shows NO badge — never a fabricated
 * count.
 */

import { requireActiveAdminId } from "@/features/payments/admin-session";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";

/** Unread notifications for the current admin, or `null` when unavailable. */
export async function getUnreadAdminNotificationCount(): Promise<number | null> {
  try {
    const adminId = await requireActiveAdminId();
    const supabase = await createSupabaseServerClient();
    const { count, error } = await supabase
      .from("admin_notifications")
      .select("id", { count: "exact", head: true })
      .eq("admin_id", adminId)
      .is("read_at", null);

    if (error || count === null) return null;
    return count;
  } catch {
    return null;
  }
}
