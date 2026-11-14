import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "@/infrastructure/env";

/**
 * Supabase client for Client Components (browser).
 *
 * It uses only public variables and is safe because every table will be behind
 * Row Level Security (see docs/ARCHITECTURE.md). `createBrowserClient` reuses a
 * single instance across calls, so it is safe to call it from any client
 * component.
 *
 * Phase 0 note: no remote project is connected yet and no database types are
 * generated. The `Database` generic will be added together with the first
 * migration (see docs/ROADMAP.md).
 */
export function createSupabaseBrowserClient() {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = getPublicEnv();

  return createBrowserClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
