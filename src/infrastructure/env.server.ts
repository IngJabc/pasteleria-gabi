import "server-only";
import { z } from "zod";
import { formatEnvIssues, parsePublicEnv, type PublicEnv } from "./env";

/**
 * Server-only environment variables.
 *
 * This module is guarded by the `server-only` marker: importing it from a Client
 * Component fails at build time, which protects privileged credentials such as
 * the Supabase service-role key from ever reaching the browser.
 */

const serverOnlyEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export type ServerOnlyEnv = z.infer<typeof serverOnlyEnvSchema>;

export type ServerEnv = PublicEnv & ServerOnlyEnv;

/**
 * Validates the full server-side environment (public + server-only).
 *
 * @throws {Error} listing every missing or malformed variable.
 */
export function parseServerEnv(input: unknown): ServerEnv {
  const publicEnv = parsePublicEnv(input);
  const serverOnly = serverOnlyEnvSchema.safeParse(input);
  if (!serverOnly.success) {
    throw new Error(
      `Invalid server-only environment variables → ${formatEnvIssues(serverOnly.error)}`,
    );
  }
  return { ...publicEnv, ...serverOnly.data };
}

/** Reads and validates server-only environment variables from `process.env`. */
export function getServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}
