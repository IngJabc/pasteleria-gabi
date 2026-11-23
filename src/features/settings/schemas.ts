import { z } from "zod";

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
    { message: "Los intervalos de un día no pueden solaparse ni estar desordenados." }
  );

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
  pickup: weekSchema,
});

export type BusinessHours = z.infer<typeof businessHoursSchema>;

export const pickupAddressSchema = z
  .string()
  .trim()
  .max(500, "La dirección de retiro es demasiado larga.");

const optionalTrimmed = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(max).optional(),
  );

/** Admin-configured payment destination details. No real data is invented;
 * fields are optional and only stored values are shown to customers. */
export const paymentMethodInstructionSchema = z.strictObject({
  enabled: z.boolean().optional(),
  label: optionalTrimmed(120),
  account: optionalTrimmed(300),
  holder: optionalTrimmed(200),
  bank: optionalTrimmed(200),
  phone: optionalTrimmed(50),
  document: optionalTrimmed(50),
  email: optionalTrimmed(200),
  network: optionalTrimmed(120),
  note: optionalTrimmed(500),
});

export type PaymentMethodInstruction = z.infer<typeof paymentMethodInstructionSchema>;

export const paymentInstructionsSchema = z
  .strictObject({
    pago_movil: paymentMethodInstructionSchema.optional(),
    cash_usd: paymentMethodInstructionSchema.optional(),
    binance_pay: paymentMethodInstructionSchema.optional(),
    binance_transfer: paymentMethodInstructionSchema.optional(),
  })
  .strict();

export type PaymentInstructions = z.infer<typeof paymentInstructionsSchema>;

export const updateStoreSettingsSchema = z
  .strictObject({
    pickupAddress: pickupAddressSchema.nullable().optional(),
    whatsappPhone: z.string().trim().max(50).nullable().optional(),
    businessHours: businessHoursSchema.nullable().optional(),
    paymentInstructions: paymentInstructionsSchema.nullable().optional(),
  })
  .refine(
    (input) =>
      input.pickupAddress !== undefined ||
      input.whatsappPhone !== undefined ||
      input.businessHours !== undefined ||
      input.paymentInstructions !== undefined,
    {
      message: "Debe enviarse al menos un campo de configuración.",
    },
  );

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
