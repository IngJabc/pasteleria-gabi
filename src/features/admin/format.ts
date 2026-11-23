/**
 * Client-safe formatting helpers for the admin UI.
 *
 * Pure functions only: no network, no auth, no server-only imports, so these can
 * be imported by both Server and Client Components. All human-facing values are
 * formatted for Venezuela (es-VE / America/Caracas) without a new dependency.
 */

import { formatUsd } from "@/features/catalog/components/price-format";

const EM_DASH = "—";
const TIME_ZONE = "America/Caracas";

const dateTimeFormatter = new Intl.DateTimeFormat("es-VE", {
  timeZone: TIME_ZONE,
  dateStyle: "medium",
  timeStyle: "short",
});

const dateFormatter = new Intl.DateTimeFormat("es-VE", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const countFormatter = new Intl.NumberFormat("es-VE");

function parseDate(value: string | null): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Full date and time in Caracas; `—` for a missing or invalid timestamp. */
export function formatDateTime(value: string | null): string {
  const date = parseDate(value);
  return date ? dateTimeFormatter.format(date) : EM_DASH;
}

/** Calendar date in Caracas; `—` for a missing or invalid timestamp. */
export function formatDate(value: string | null): string {
  const date = parseDate(value);
  return date ? dateFormatter.format(date) : EM_DASH;
}

/**
 * Human-friendly label derived deterministically from a REAL order id.
 * It is not a sequence number: the same id always produces the same label.
 */
export function formatOrderReference(id: string): string {
  if (typeof id !== "string") return EM_DASH;
  const reference = id.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return reference.length > 0 ? reference : EM_DASH;
}

/** Locale-formatted count; non-finite values are shown as zero. */
export function formatCount(value: number): string {
  const safe = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return countFormatter.format(safe);
}

/** Reuses the catalog USD formatter; a missing/invalid amount renders as `—`. */
export function formatMoneyUsd(value: number | string | null): string {
  if (value === null || value === undefined) return EM_DASH;
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? formatUsd(amount) : EM_DASH;
}
