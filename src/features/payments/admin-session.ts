import "server-only";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server";

/**
 * Session-derived administrator identity for the payments module.
 *
 * Server actions never accept an administrator id from the client. The cookie
 * bound client resolves the authenticated user, and the existing RLS policy on
 * `administrators` confirms that this same user is still active. Every mutating
 * RPC rechecks active status database-side through private.require_active_admin.
 */
export class AdminSessionError extends Error {}

export async function requireActiveAdminId(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new AdminSessionError("La sesión del administrador no es válida.");
  }

  const { data: admin, error: adminError } = await supabase
    .from("administrators")
    .select("id")
    .eq("id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (adminError || !admin) {
    throw new AdminSessionError("La sesión del administrador no es válida.");
  }

  return admin.id as string;
}
