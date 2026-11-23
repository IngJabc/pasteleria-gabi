"use server";

import { z } from "zod";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";

const tokenSchema = z.string().regex(/^[0-9a-f]{64}$/);
const MAX_TOKENS = 20;

/** Token-only status lookup for locally saved tracking links. */
export async function getTrackingStatuses(
  tokens: string[],
): Promise<Record<string, string>> {
  const valid = Array.isArray(tokens)
    ? tokens.filter((t) => tokenSchema.safeParse(t).success).slice(0, MAX_TOKENS)
    : [];
  if (valid.length === 0) return {};

  const supabase = createSupabaseAdminClient();
  const entries = await Promise.all(
    valid.map(async (token) => {
      const { data, error } = await supabase.rpc("get_order_for_tracking", {
        p_token: token,
      });
      if (error || !data || typeof data !== "object" || Array.isArray(data)) {
        return [token, null] as const;
      }
      const status = (data as Record<string, unknown>).status;
      return [token, typeof status === "string" && status ? status : null] as const;
    }),
  );

  const out: Record<string, string> = {};
  for (const [token, status] of entries) {
    if (status) out[token] = status;
  }
  return out;
}
