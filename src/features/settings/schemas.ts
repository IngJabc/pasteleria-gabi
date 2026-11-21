import { z } from "zod";

/**
 * OQ-8 — server-side mirror of the `store_settings.business_hours` JSONB
 * contract defined in `supabase/migrations/009_store_settings_schedule.sql`.
 *
 * Schedules are informational only (SPEC §14): orders are accepted 24/7 and
 * nothing here can block checkout, payment, inventory or reservations.
 */

export const STORE_TIMEZONE = "America/Caracas" as const;

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const hhmm = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export const timeIntervalSchema = z
  .strictObject({
    start: z.string().regex(hhmm, "La hora de inicio no es válida (HH24:MI)."),
    end: z.string().regex(hhmm, "La hora de fin no es válida (HH24:MI)."),
  })
  .refine((interval) => interval.start < interval.end, {
    message: "La hora de inicio debe ser anterior a la hora de fin.",
  });

export type TimeInterval = z.infer<typeof timeIntervalSchema>;

export const dayScheduleSchema = z
  .array(timeIntervalSchema)
  .refine(
    (intervals) => intervals.every((interval, index) => index === 0 || interval.start >= intervals[index - 1].end),
    { message: "Los intervalos de un día no pueden solaparse ni estar desordenados." },
  );

/** Empty array means a closed day. Overnight intervals are not supported. */
export type DaySchedule = z.infer<typeof dayScheduleSchema>;

const weekSchema = z.strictObject({
  monday: dayScheduleSchema,
  tuesday: dayScheduleSchema,
  wednesday: dayScheduleSchema,
  thursday: dayScheduleSchema,
  friday: dayScheduleSchema,
  saturday: dayScheduleSchema,
  sunday: dayScheduleSchema,
});

export const businessHoursSchema = z.strictObject({
  timezone: z.literal(STORE_TIMEZONE),
  attention: weekSchema,
  /** Preparation / collection hours. */
  pickup: weekSchema,
});

export type BusinessHours = z.infer<typeof businessHoursSchema>;

export const pickupAddressSchema = z
  .string()
  .trim()
  .max(500, "La dirección de retiro es demasiado larga.");

export const updateStoreSettingsSchema = z
  .strictObject({
    pickupAddress: pickupAddressSchema.nullable().optional(),
    businessHours: businessHoursSchema.nullable().optional(),
  })
  .refine((input) => input.pickupAddress !== undefined || input.businessHours !== undefined, {
    message: "Debe enviarse al menos un campo de configuración.",
  });

export type UpdateStoreSettingsInput = z.infer<typeof updateStoreSettingsSchema>;

export const storeSettingsRowSchema = z.strictObject({
  id: z.literal(1),
  pickup_address: z.string().nullable(),
  whatsapp_phone: z.string().nullable(),
  business_hours: businessHoursSchema.nullable(),
  payment_instructions: z.unknown().nullable(),
  updated_at: z.string(),
  updated_by: z.string().nullable(),
});

export type StoreSettingsRow = z.infer<typeof storeSettingsRowSchema>;
