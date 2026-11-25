"use server";

import { createSupabaseServerClient } from "@/infrastructure/supabase/server";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import {
  bcvPublicError,
  currentBcvRateSchema,
  invalidRateInputError,
  rateSnapshotResultSchema,
  trackedSnapshotSchema,
} from "./schemas";

/**
 * Read-only current rate and the guest-triggered snapshot used by checkout.
 * The rate read uses the RLS-visible, request-bound server client; the guest
 * snapshot stays privileged. Guests are authorised only by the private
 * tracking token; no order id or administrator id is accepted from the client.
 */

const genericError = "No se pudo consultar la tasa. Inténtalo de nuevo.";

export interface CurrentBcvRate {
  rateVesPerUsd: string | number;
  observedAt: string;
  source: string | null;
  isStale: boolean;
  ageSeconds: number;
  asOf: string;
}

export type CurrentRateResult =
  | { ok: true; rate: CurrentBcvRate | null }
  | { ok: false; error: string };

export type TrackedSnapshotResult =
  | {
      ok: true;
      orderId: number;
      rateVesPerUsd: string | number;
      rateAt: string;
      totalVes: string | number;
      roundingRule: string;
      applied: boolean;
      ageSeconds?: number;
    }
  | { ok: false; error: string };

export async function getCurrentBcvRate(): Promise<CurrentRateResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_bcv_rate");
  if (error) {
    return { ok: false, error: bcvPublicError(error.message, genericError) };
  }
  const rate = currentBcvRateSchema.safeParse(data);
  if (!rate.success) {
    return { ok: false, error: genericError };
  }
  if (rate.data === null) {
    return { ok: true, rate: null };
  }
  return {
    ok: true,
    rate: {
      rateVesPerUsd: rate.data.rate_ves_per_usd,
      observedAt: rate.data.observed_at,
      source: rate.data.source,
      isStale: rate.data.is_stale,
      ageSeconds: rate.data.age_seconds,
      asOf: rate.data.as_of,
    },
  };
}

export async function applyBcvRateForTracking(input: {
  trackingToken: string;
}): Promise<TrackedSnapshotResult> {
  const parsed = trackedSnapshotSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: String(parsed.error.issues[0]?.message ?? invalidRateInputError) };
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("apply_bcv_rate_for_tracking", {
    p_token: parsed.data.trackingToken,
  });
  if (error) {
    return { ok: false, error: bcvPublicError(error.message, genericError) };
  }
  const result = rateSnapshotResultSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, error: genericError };
  }
  return {
    ok: true,
    orderId: result.data.order_id,
    rateVesPerUsd: result.data.bcv_rate_ves,
    rateAt: result.data.bcv_rate_at,
    totalVes: result.data.total_ves,
    roundingRule: result.data.rounding_rule,
    applied: result.data.applied,
    ...(result.data.age_seconds !== undefined ? { ageSeconds: result.data.age_seconds } : {}),
  };
}
