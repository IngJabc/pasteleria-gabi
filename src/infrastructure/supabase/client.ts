import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "@/infrastructure/env";
import type { Database } from "@/infrastructure/database/database.client.types";

/**
 * Supabase client for Client Components (browser).
 *
 * It uses only public variables and is safe because every table will be behind
 * Row Level Security (see docs/ARCHITECTURE.md). `createBrowserClient` reuses a
 * single instance across calls, so it is safe to call it from any client
 * component.
 */
export function createSupabaseBrowserClient() {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = getPublicEnv();

  return createBrowserClient<Database>(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
