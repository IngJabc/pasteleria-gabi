"use server";

import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin";
import { requireActiveAdminId } from "@/features/payments/admin-session";
import {
  bcvPublicError,
  classifyBcvFailure,
  deactivatedRateResultSchema,
  deactivateRateSchema,
  invalidRateInputError,
  orderSnapshotSchema,
  rateRowSchema,
  type RateRow,
  rateSnapshotResultSchema,
  registeredRateResultSchema,
  registerRateSchema,
  type BcvFailureCategory,
  type BcvRpcFailure,
} from "./schemas";

/** Administrator-only BCV rate management. No client supplies an admin id. */

const invalidSessionError = "La sesión del administrador no es válida.";
const genericError = "No se pudo completar la operación. Inténtalo de nuevo.";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type Failure = { ok: false; error: string };

function asFailure(error: unknown): BcvRpcFailure {
  if (error instanceof Error) {
    return { message: error.message, code: null };
  }
  return { message: String(error), code: null };
}

/** Logs only a stable category and nullable SQLSTATE, never SQL or credentials. */
function logFailure(operation: string, failure: BcvRpcFailure, category: BcvFailureCategory): void {
  console.error(`[${operation}] bcv failure`, {
    category,
    code: failure.code ?? null,
  });
}

function rpcFailure(operation: string, failure: BcvRpcFailure): Failure {
  const category = classifyBcvFailure(failure);
  logFailure(operation, failure, category);
  return { ok: false, error: bcvPublicError(failure.message, genericError, failure.code) };
}

async function withAdmin<T>(
  action: (adminId: string, supabase: AdminClient) => Promise<T>,
): Promise<T | Failure> {
  let adminId: string;
  try {
    adminId = await requireActiveAdminId();
  } catch {
    return { ok: false, error: invalidSessionError };
  }

  let supabase: AdminClient;
  try {
    supabase = createSupabaseAdminClient();
  } catch (caught) {
    return rpcFailure("admin-client", asFailure(caught));
  }

  try {
    return await action(adminId, supabase);
  } catch (caught) {
    return rpcFailure("admin-action", asFailure(caught));
  }
}

export type RegisterRateResult =
  | { ok: true; rateId: number; idempotent: boolean }
  | { ok: false; error: string };

export type DeactivateRateResult =
  | { ok: true; rateId: number; idempotent: boolean }
  | { ok: false; error: string };

export type RateHistoryResult =
  | { ok: true; rates: RateRow[] }
  | { ok: false; error: string };

export type AdminSnapshotResult =
  | {
      ok: true;
      orderId: number;
      rateVesPerUsd: string | number;
      rateAt: string;
      totalVes: string | number;
      roundingRule: string;
      applied: boolean;
    }
  | { ok: false; error: string };

export async function registerBcvRate(input: {
  rate: string;
  source: string;
  observedAt?: string;
  supersedesId?: number | null;
  note?: string;
  idempotencyKey: string;
}): Promise<RegisterRateResult> {
  const parsed = registerRateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: String(parsed.error.issues[0]?.message ?? invalidRateInputError) };
  }

  return withAdmin(async (adminId, supabase) => {
    const { rate, source, observedAt, supersedesId, note, idempotencyKey } = parsed.data;
    const { data, error } = await supabase.rpc("register_bcv_rate", {
      p_rate_ves_per_usd: rate,
      p_source: source,
      p_admin_id: adminId,
      p_observed_at: observedAt ?? null,
      p_supersedes_id: supersedesId ?? null,
      p_note: note ?? null,
      p_idempotency_key: idempotencyKey,
    });
    if (error) {
      return rpcFailure("register_bcv_rate", { message: error.message, code: error.code });
    }
    const result = registeredRateResultSchema.safeParse(data);
    if (!result.success) {
      logFailure("register_bcv_rate", { message: "unexpected rpc payload" }, "unknown");
      return { ok: false, error: genericError };
    }
    return { ok: true, rateId: result.data.rate_id, idempotent: result.data.idempotent };
  });
}

export async function deactivateBcvRate(input: { rateId: number }): Promise<DeactivateRateResult> {
  const parsed = deactivateRateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: String(parsed.error.issues[0]?.message ?? invalidRateInputError) };
  }

  return withAdmin(async (adminId, supabase) => {
    const { data, error } = await supabase.rpc("deactivate_bcv_rate", {
      p_rate_id: parsed.data.rateId,
      p_admin_id: adminId,
    });
    if (error) {
      return rpcFailure("deactivate_bcv_rate", { message: error.message, code: error.code });
    }
    const result = deactivatedRateResultSchema.safeParse(data);
    if (!result.success) {
      logFailure("deactivate_bcv_rate", { message: "unexpected rpc payload" }, "unknown");
      return { ok: false, error: genericError };
    }
    return { ok: true, rateId: result.data.rate_id, idempotent: result.data.idempotent };
  });
}

export async function listBcvRates(): Promise<RateHistoryResult> {
  return withAdmin(async (_adminId, supabase) => {
    const { data, error } = await supabase
      .from("exchange_rates")
      .select("id, rate_ves_per_usd, observed_at, source, is_active, note, registered_by, supersedes_id, created_at")
      .order("observed_at", { ascending: false })
      .limit(200);
    if (error) {
      return { ok: false, error: genericError };
    }
    const result = rateRowSchema.array().safeParse(data ?? []);
    if (!result.success) {
      return { ok: false, error: genericError };
    }
    return { ok: true, rates: result.data };
  });
}

export async function applyBcvRateToOrder(input: { orderId: number }): Promise<AdminSnapshotResult> {
  const parsed = orderSnapshotSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: String(parsed.error.issues[0]?.message ?? invalidRateInputError) };
  }

  return withAdmin(async (adminId, supabase) => {
    const { data, error } = await supabase.rpc("apply_bcv_rate_to_order", {
      p_order_id: parsed.data.orderId,
      p_admin_id: adminId,
    });
    if (error) {
      return rpcFailure("apply_bcv_rate_to_order", { message: error.message, code: error.code });
    }
    const result = rateSnapshotResultSchema.safeParse(data);
    if (!result.success) {
      logFailure("apply_bcv_rate_to_order", { message: "unexpected rpc payload" }, "unknown");
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
    };
  });
}
