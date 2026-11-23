/**
 * Pure presentation helpers for the payments/POS admin screens.
 *
 * No network, no auth and no backend value is invented here. Every label is
 * derived from a real value supplied by a server-rendered query or by the
 * existing server actions; unknown values are shown verbatim.
 */

const amountFormatter = new Intl.NumberFormat("es-VE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const methodLabels: Record<string, string> = {
  pago_movil: "Pago móvil",
  binance_pay: "Binance Pay",
  binance_transfer: "Transferencia Binance",
  cash_usd: "Efectivo USD",
};

const statusLabels: Record<string, string> = {
  pending: "pendiente",
  in_review: "en revisión",
  approved: "aprobado",
  rejected: "rechazado",
  refunded: "reembolsado",
};

/** Basename of a REAL storage path, e.g. `42/<uuid>.png` → `<uuid>.png`. */
export function receiptFileName(path: string): string {
  const basename = (typeof path === "string" ? path : "").split("/").pop() ?? "";
  return basename.trim() === "" ? "comprobante" : basename;
}

/** Locale-formatted amount with its REAL reported currency code appended. */
export function formatReportedAmount(amount: number, currency: string): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "—";
  const code = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  const formatted = amountFormatter.format(amount);
  return code ? `${formatted} ${code}` : formatted;
}

/** Spanish label for known stored methods; unknown methods stay verbatim. */
export function paymentMethodLabel(method: string): string {
  return methodLabels[method] ?? method;
}

/** Spanish label for a REAL status returned by the review action. */
export function paymentStatusLabel(status: string): string {
  return statusLabels[status] ?? status;
}

/** Label for a REAL order id, adding the stored customer name when present. */
export function orderPickerLabel(id: number, customerName: string | null): string {
  if (!Number.isSafeInteger(id) || id <= 0) return "—";
  const name = typeof customerName === "string" ? customerName.trim() : "";
  return name ? `#${id} · ${name}` : `#${id}`;
}
