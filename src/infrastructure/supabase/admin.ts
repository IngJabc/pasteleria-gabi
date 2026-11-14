import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/infrastructure/env.server";

/**
 * Supabase client with the service-role key (bypasses Row Level Security).
 *
 * HARD RULE: server-side only. The `server-only` marker makes any import from a
 * Client Component fail at build time, and `env.server.ts` reads the credential
 * from a non-public environment variable. Use it only for privileged operations
 * that RLS cannot express (for example, inventory RPCs executed by the server
 * after validating an order).
 *
 * Phase 0 note: not connected to any remote project.
 */
export function createSupabaseAdminClient() {
  const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();

  return createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
