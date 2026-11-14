import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicEnv } from "@/infrastructure/env";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * One client must be created per request: it reads and writes the auth session
 * cookies of the current request. This module is intentionally the only place
 * that knows how Supabase sessions map to Next.js cookies.
 *
 * Phase 0 note: nothing calls this yet — there is no remote project and no
 * authentication flow. It exists so that every future feature talks to Supabase
 * through a single, well-defined infrastructure entry point.
 */
export async function createSupabaseServerClient() {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = getPublicEnv();
  const cookieStore = await cookies();

  return createServerClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // `setAll` can be called from a Server Component where `cookies()` is
          // read-only. That is expected: session refresh is handled by the
          // request proxy (`proxy.ts`) once authentication lands in a later phase.
        }
      },
    },
  });
}
