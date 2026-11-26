import { z } from "zod";

/** Shared validation, result shapes and error mapping for OQ-4/OQ-5. */

export const bcvRateSchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/, "La tasa BCV no es válida.")
  .refine((value) => Number(value) > 0, "La tasa BCV debe ser mayor que cero.");

export const rateSourceSchema = z
  .string()
  .trim()
  .min(1, "El origen de la tasa es obligatorio.")
  .max(120, "El origen de la tasa es demasiado largo.");

export const rateNoteSchema = z
  .string()
  .trim()
  .max(500, "La nota es demasiado larga.")
  .optional();

export const observedAtSchema = z
  .string()
  .trim()
  .refine(
    (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      && Number.isFinite(Date.parse(value)),
    "La fecha y hora de la tasa no son válidas.",
  )
  .optional();

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8, "La clave de idempotencia es demasiado corta.")
  .max(120, "La clave de idempotencia es demasiado larga.")
  .regex(/^[A-Za-z0-9._:-]+$/, "La clave de idempotencia contiene caracteres no válidos.");

export const trackingTokenSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{64}$/, "El enlace de seguimiento no es válido.");

export const registerRateSchema = z.object({
  rate: bcvRateSchema,
  source: rateSourceSchema,
  observedAt: observedAtSchema,
  supersedesId: z.number().int().positive().nullable().optional(),
  note: rateNoteSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const deactivateRateSchema = z.object({
  rateId: z.number().int().positive(),
});

export const orderSnapshotSchema = z.object({
  orderId: z.number().int().positive(),
});

export const trackedSnapshotSchema = z.object({
  trackingToken: trackingTokenSchema,
});

const moneyValue = z.union([z.number(), z.string()]);

export const registeredRateResultSchema = z.object({
  rate_id: z.number().int().positive(),
  idempotent: z.boolean(),
});

export const deactivatedRateResultSchema = z.object({
  rate_id: z.number().int().positive(),
  idempotent: z.boolean(),
});

export const rateSnapshotResultSchema = z.object({
  order_id: z.number().int().positive(),
  bcv_rate_ves: moneyValue,
  bcv_rate_at: z.string(),
  total_ves: moneyValue,
  rounding_rule: z.string(),
  applied: z.boolean(),
  age_seconds: z.number().int().optional(),
});

export const currentBcvRateSchema = z
  .object({
    rate_ves_per_usd: moneyValue,
    observed_at: z.string(),
    source: z.string().nullable(),
    is_stale: z.boolean(),
    age_seconds: z.number().int(),
    as_of: z.string(),
  })
  .nullable();

export const rateRowSchema = z.object({
  id: z.number().int().positive(),
  rate_ves_per_usd: moneyValue,
  observed_at: z.string(),
  source: z.string().nullable(),
  is_active: z.boolean(),
  note: z.string().nullable(),
  registered_by: z.string().nullable(),
  supersedes_id: z.number().int().nullable(),
  created_at: z.string(),
});

export type RateRow = z.infer<typeof rateRowSchema>;

/**
 * Failed RPCs are classified by code and stable message fragments. Only the
 * category and code are logged; raw SQL or credential details never reach a
 * caller or the server log from this mapper.
 */
export type BcvRpcFailure = { message: string; code?: string | null };
export type BcvFailureCategory =
  | "server_configuration"
  | "service_unavailable"
  | "duplicate_observed_at"
  | "domain"
  | "unknown";

export const bcvConfigurationError =
  "El servidor no puede completar la operación. Revisa la configuración de Supabase e inténtalo de nuevo.";
export const bcvUnavailableError =
  "No se pudo conectar con el servicio de tasas. Inténtalo de nuevo.";
export const bcvDuplicateObservedAtError =
  "Ya existe una tasa con esa fecha y hora. Usa otra fecha/hora o deja el campo vacío.";

export function classifyBcvFailure({ message, code }: BcvRpcFailure): BcvFailureCategory {
  const normalizedMessage = message.toLowerCase();
  const normalizedCode = code?.toUpperCase() ?? "";

  if (
    normalizedCode === "42501"
    || normalizedMessage.includes("invalid api key")
    || normalizedMessage.includes("jwt expired")
    || normalizedMessage.includes("invalid jwt")
    || normalizedCode === "PGRST202"
    || normalizedMessage.includes("could not find the function")
    || normalizedMessage.includes("schema cache")
    || normalizedMessage.includes("invalid server-only environment variables")
    || normalizedMessage.includes("invalid public environment variables")
    || normalizedMessage.includes("invalid url")
  ) {
    return "server_configuration";
  }
  if (
    normalizedCode === "23505"
    && normalizedMessage.includes("exchange_rates_observed_at_key")
  ) {
    return "duplicate_observed_at";
  }
  if (
    normalizedCode === "PGRST503"
    || normalizedMessage.includes("fetch failed")
    || normalizedMessage.includes("timeout")
    || normalizedMessage.includes("network")
  ) {
    return "service_unavailable";
  }
  if (
    normalizedMessage.includes("no active BCV rate")
    || normalizedMessage.includes("tracking token")
    || normalizedMessage.includes("is canceled")
    || normalizedMessage.includes("is expired")
    || normalizedMessage.includes("does not exist")
    || normalizedMessage.includes("rate must be positive")
    || normalizedMessage.includes("four decimals")
    || normalizedMessage.includes("source is required")
    || normalizedMessage.includes("note is too long")
    || normalizedMessage.includes("rate to correct")
    || normalizedMessage.includes("does not exist or is inactive")
    || normalizedMessage.includes("not active")
    || normalizedMessage.includes("administrator")
  ) {
    return "domain";
  }
  return "unknown";
}

/** Database messages become stable Spanish text; SQL never reaches a caller. */
export function bcvPublicError(message: string, fallback: string, code?: string | null): string {
  const category = classifyBcvFailure({ message, code });
  if (category === "server_configuration") return bcvConfigurationError;
  if (category === "service_unavailable") return bcvUnavailableError;
  if (category === "duplicate_observed_at") return bcvDuplicateObservedAtError;

  if (message.includes("no active BCV rate")) {
    return "No hay una tasa BCV activa disponible. El pedido conserva su total en USD.";
  }
  if (message.includes("tracking token")) {
    return "El enlace de seguimiento no es válido.";
  }
  if (message.includes("is canceled") || message.includes("is expired")) {
    return "El pedido ya no admite cotización.";
  }
  if (message.includes("rate to correct") || message.includes("does not exist or is inactive")) {
    return "La tasa que se desea corregir ya no está activa.";
  }
  if (message.includes("does not exist")) {
    return "El pedido o la tasa ya no están disponibles.";
  }
  if (message.includes("rate must be positive") || message.includes("four decimals")) {
    return "La tasa BCV no es válida.";
  }
  if (message.includes("source is required") || message.includes("note is too long")) {
    return "Los datos de la tasa no son válidos.";
  }
  if (message.includes("not active") || message.includes("administrator")) {
    return "La sesión del administrador no es válida.";
  }
  return fallback;
}

export const invalidRateInputError = "Revisa los datos de la tasa e inténtalo de nuevo.";
