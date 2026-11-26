/**
 * Client-safe, pure helpers for the in-app Realtime notification toast.
 *
 * Only `payload.new` is inspected. These helpers never touch a database, a
 * browser permission, a service worker or any external delivery channel.
 */

export type NotificationToastSource = "general" | "sla";

export const GENERAL_NOTIFICATION_TOAST_MESSAGE = "Tienes una notificación nueva.";
export const SLA_NOTIFICATION_TOAST_MESSAGE =
  "Hay un aviso SLA de comprobante nuevo.";

const DEFAULT_DEDUPE_LIMIT = 100;

function readNewRow(newRow: unknown): Record<string, unknown> | null {
  if (typeof newRow !== "object" || newRow === null) return null;
  return newRow as Record<string, unknown>;
}

/** Static Spanish text; a validated general summary is already Spanish. */
export function notificationToastMessage(
  source: NotificationToastSource,
  newRow: unknown,
): string {
  if (source === "general") {
    const summary = readNewRow(newRow)?.summary;
    if (typeof summary === "string" && summary.trim().length > 0) {
      return summary.trim();
    }
    return GENERAL_NOTIFICATION_TOAST_MESSAGE;
  }
  return SLA_NOTIFICATION_TOAST_MESSAGE;
}

/** Stable key for a replayed INSERT of the same row, when a real id exists. */
export function notificationToastKey(
  source: NotificationToastSource,
  newRow: unknown,
): string | null {
  const id = readNewRow(newRow)?.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return null;
  return `${source}:${id}`;
}

/**
 * Suppresses repeated delivery of the same INSERT without hiding new rows.
 * Rows without a usable id always get a toast, and the memory stays bounded.
 */
export function createNotificationToastDeduplicator(limit = DEFAULT_DEDUPE_LIMIT) {
  const seen = new Set<string>();
  const maxEntries = Number.isSafeInteger(limit) && limit > 0 ? limit : DEFAULT_DEDUPE_LIMIT;

  return (source: NotificationToastSource, newRow: unknown): boolean => {
    const key = notificationToastKey(source, newRow);
    if (key === null) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > maxEntries) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    return true;
  };
}
