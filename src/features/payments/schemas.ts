import { z } from "zod";

/** Shared validation and error mapping for the backend payments module. */

export const trackingTokenSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{64}$/, "El enlace de seguimiento no es válido.");

export const digitalPaymentMethodSchema = z.enum([
  "pago_movil",
  "binance_pay",
  "binance_transfer",
]);

export const positiveMoneySchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, "El importe no es válido.")
  .refine((value) => Number(value) > 0, "El importe debe ser mayor que cero.");

export const nonNegativeMoneySchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, "El importe no es válido.");

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8, "La clave de idempotencia es demasiado corta.")
  .max(120, "La clave de idempotencia es demasiado larga.")
  .regex(/^[A-Za-z0-9._:-]+$/, "La clave de idempotencia contiene caracteres no válidos.");

export const referenceSchema = z
  .string()
  .trim()
  .min(1, "La referencia del pago es obligatoria.")
  .max(120, "La referencia del pago es demasiado larga.");

export const RECEIPT_BUCKET = "payment-receipts";
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
/** OQ-12: approved signed-URL lifetime. Business-approved; never overridden. */
export const RECEIPT_REVIEW_URL_LIFETIME_SECONDS = 300;
export const receiptReviewUnavailableError = "No se pudieron consultar los comprobantes.";

/** OQ-12 returns only signed URLs and a generic failure; never database rows. */
export type ReceiptReviewResult =
  | { ok: true; urls: string[] }
  | { ok: false; error: string };

export const RECEIPT_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/**
 * Minimal server-side view of an uploaded file. Callers may pass a Web `File`
 * or a test double; MIME type and size are always read from this object, never
 * from a separate client-supplied field.
 */
export interface ReceiptFile {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export const receiptFileSchema = z.custom<ReceiptFile>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as ReceiptFile).name === "string" &&
    typeof (value as ReceiptFile).type === "string" &&
    typeof (value as ReceiptFile).size === "number" &&
    typeof (value as ReceiptFile).arrayBuffer === "function",
  "El comprobante no es válido.",
);

export const trackedOrderSchema = z
  .object({
    order_id: z.number().int().positive(),
    status: z.string().min(1),
    fulfillment_type: z.string().min(1).optional(),
    subtotal_usd: z.coerce.number().nonnegative().optional(),
    delivery_fee_usd: z.coerce.number().nullable().optional(),
    total_usd: z.coerce.number().nonnegative().optional(),
    quote_accepted_at: z.string().nullable().optional(),
    delivery_requires_quote: z.boolean().optional(),
  })
  .nullable();

export const registeredPaymentSchema = z.object({
  payment_id: z.number().int().positive(),
  order_id: z.number().int().positive(),
  status: z.string().min(1),
  idempotent: z.boolean(),
  change_usd: z.union([z.number(), z.string(), z.null()]).optional(),
});

export const evidenceResultSchema = z.object({
  payment_id: z.number().int().positive(),
  order_id: z.number().int().positive(),
  submission_id: z.number().int().positive(),
  attempt_number: z.number().int().positive(),
  idempotent: z.boolean(),
  reservations_held: z.number().int().nonnegative().optional(),
});

export const reviewResultSchema = z.object({
  payment_id: z.number().int().positive(),
  order_id: z.number().int().positive(),
  status: z.string().min(1),
  idempotent: z.boolean(),
  order_status: z.string().min(1).optional(),
  submissions_closed: z.number().int().nonnegative().optional(),
  reservations_affected: z.number().int().nonnegative().optional(),
});

export const posSaleResultSchema = z.object({
  order_id: z.number().int().positive(),
  payment_id: z.number().int().positive(),
  status: z.string().min(1),
  change_usd: z.union([z.number(), z.string()]),
  idempotent: z.boolean(),
});

export const refundResultSchema = z.object({
  refund_id: z.number().int().positive(),
  payment_id: z.number().int().positive(),
  status: z.string().min(1),
  total_refunded: z.union([z.number(), z.string()]).optional(),
  idempotent: z.boolean(),
});

export const posItemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive(),
});

/** Database messages are mapped to stable Spanish text; SQL never leaks. */
export function paymentsPublicError(message: string, fallback: string): string {
  return paymentsPublicErrorMapped(message) ?? fallback;
}

function paymentsPublicErrorMapped(message: string): string | null {
  if (message.includes("no order matches the tracking token")) {
    return "El enlace de seguimiento no es válido.";
  }
  if (
    message.includes("unsupported guest payment method") ||
    message.includes("unsupported method/currency pair") ||
    message.includes("supported guest payment method")
  ) {
    return "El método de pago no es válido para este pedido.";
  }
  if (message.includes("already used its two receipt attempts") ||
      message.includes("already has pending evidence")) {
    return "El pedido ya agotó los comprobantes permitidos.";
  }
  if (message.includes("correction window") && message.includes("closed")) {
    return "El plazo para corregir el comprobante ya venció.";
  }
  if (message.includes("delivery quote is pending")) {
    return "El delivery de este pedido a?n est? pendiente por cotizar.";
  }
  if (message.includes("delivery quote must be accepted")) {
    return "Debes aceptar la cotizaci?n de delivery antes de registrar el pago.";
  }
  if (message.includes("is canceled") || message.includes("is expired")) {
    return "El pedido ya no admite pagos.";
  }
  if (message.includes("not active") || message.includes("administrator")) {
    return "La sesión del administrador no es válida.";
  }
  if (message.includes("insufficient stock") || message.includes("insufficient available stock")) {
    return "No hay stock suficiente para registrar la venta.";
  }
  if (message.includes("refunds would exceed") || message.includes("was not approved")) {
    return "El reembolso no es válido para este pago.";
  }
  if (message.includes("pago_movil requires a BCV snapshot")) {
    return "Este pedido no tiene una tasa BCV válida para pagos en bolívares.";
  }
  if (message.includes("does not exist") || message.includes("does not require a receipt")) {
    return "La operación de pago ya no está disponible.";
  }
  return null;
}

export const invalidPaymentInputError = "Revisa los datos del pago e inténtalo de nuevo.";
export const invalidReceiptError = "El comprobante debe ser JPG, PNG, WebP o PDF de hasta 5 MB.";
