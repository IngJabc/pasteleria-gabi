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

/** Database messages become stable Spanish text; SQL never reaches a caller. */
export function bcvPublicError(message: string, fallback: string): string {
  if (message.includes("no active BCV rate")) {
    return "No hay una tasa BCV activa disponible. El pedido conserva su total en USD.";
  }
  if (message.includes("tracking token")) {
    return "El enlace de seguimiento no es válido.";
  }
  if (message.includes("is canceled") || message.includes("is expired")) {
    return "El pedido ya no admite cotización.";
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
  if (message.includes("rate to correct") || message.includes("does not exist or is inactive")) {
    return "La tasa que se desea corregir ya no está activa.";
  }
  if (message.includes("not active") || message.includes("administrator")) {
    return "La sesión del administrador no es válida.";
  }
  return fallback;
}

export const invalidRateInputError = "Revisa los datos de la tasa e inténtalo de nuevo.";
