import { z } from "zod";

/**
 * Public environment variables — safe to expose to the browser because Next.js
 * only inlines variables prefixed with `NEXT_PUBLIC_`.
 *
 * Every variable documented in `.env.example` is validated here when it is read,
 * so misconfiguration fails fast with a clear message instead of a cryptic
 * runtime error. Server-only variables live in `env.server.ts`.
 */

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

/** Formats Zod issues into a single, human-readable line. */
export function formatEnvIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("; ");
}

/**
 * Validates public environment variables from any object (pure, testable).
 *
 * @throws {Error} listing every missing or malformed variable.
 */
export function parsePublicEnv(input: unknown): PublicEnv {
  const result = publicEnvSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid public environment variables → ${formatEnvIssues(result.error)}`);
  }
  return result.data;
}

/** Reads and validates public environment variables from `process.env`. */
export function getPublicEnv(): PublicEnv {
  return parsePublicEnv(process.env);
}
