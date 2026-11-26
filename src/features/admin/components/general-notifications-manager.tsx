"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  AdminStatusChip,
  AdminSurface,
  AdminTable,
} from "@/components/admin/admin-ui";
import { Button, LiveRegion } from "@/components/ui/ui";
import { formatDateTime } from "@/features/admin/format";
import {
  markAllAdminGeneralNotificationsReadAction,
  setAdminGeneralNotificationReadAction,
} from "@/features/admin/general-notifications";
import {
  markAdminNotificationAsRead,
  markAllAdminNotificationsReadAction,
} from "@/features/admin/sla-notification-actions";
import {
  type UnifiedNotificationItem,
  type UnifiedNotificationSource,
} from "@/features/admin/unified-notifications-helpers";

const sourceTone: Record<UnifiedNotificationSource, "lavender" | "yellow"> = {
  general: "lavender",
  sla: "yellow",
};

/** A failed background read update never blocks or rewrites navigation feedback. */
function markReadWithoutBlocking(
  action: () => Promise<{ ok: boolean }>,
  onSuccess?: () => void,
) {
  try {
    void Promise.resolve(action())
      .then((result) => {
        if (result.ok) onSuccess?.();
      })
      .catch(() => {
        // The destination page owns the user's attention; existing feedback stands.
      });
  } catch {
    // An unavailable action is not a navigation error.
  }
}

/**
 * Single inbox for both durable sources. General rows can toggle read/unread;
 * SLA rows keep their existing mark-read-only rule. The summary and the target
 * are real links whenever a trustworthy destination exists.
 */
export function GeneralNotificationsManager({
  items,
  unreadCount,
  truncatedGeneral,
  truncatedSla,
}: {
  items: UnifiedNotificationItem[];
  unreadCount: number;
  truncatedGeneral: boolean;
  truncatedSla: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);

  function toggleRead(item: UnifiedNotificationItem) {
    if (item.source !== "general" || item.generalId === null) return;
    setFeedback(null);
    startTransition(async () => {
      const result = await setAdminGeneralNotificationReadAction({
        notificationId: String(item.generalId),
        read: item.readAt === null,
      });
      setFeedback({ message: result.message, error: !result.ok });
      if (result.ok) router.refresh();
    });
  }

  function markSlaRead(item: UnifiedNotificationItem) {
    if (item.source !== "sla" || item.slaId === null) return;
    setFeedback(null);
    startTransition(async () => {
      const result = await markAdminNotificationAsRead({
        notificationId: String(item.slaId),
      });
      setFeedback({ message: result.message, error: !result.ok });
      if (result.ok) router.refresh();
    });
  }

  // Opening a real destination marks an unread row read. The action is
  // fire-and-forget: Next.js Link keeps its normal click/keyboard behavior,
  // including modifier clicks, and a failed update never changes local state.
  function markReadOnOpen(item: UnifiedNotificationItem) {
    if (item.readAt !== null || !item.href || item.href.trim().length === 0) return;

    const validId = (id: number | null) =>
      id !== null && Number.isSafeInteger(id) && id > 0;

    if (item.source === "general" && validId(item.generalId)) {
      markReadWithoutBlocking(() =>
        setAdminGeneralNotificationReadAction({
          notificationId: String(item.generalId),
          read: true,
        }),
      );
      return;
    }

    if (item.source === "sla" && validId(item.slaId)) {
      markReadWithoutBlocking(
        () => markAdminNotificationAsRead({ notificationId: String(item.slaId) }),
        // The SLA action intentionally has no server revalidation; refresh the
        // shared layout so the unread badge matches the row just opened.
        () => router.refresh(),
      );
    }
  }

  function markAllRead() {
    setFeedback(null);
    startTransition(async () => {
      // Server Actions dispatch sequentially on the client; do not race them.
      const general = await markAllAdminGeneralNotificationsReadAction();
      const sla = await markAllAdminNotificationsReadAction();
      const ok = general.ok && sla.ok;
      setFeedback({
        message: ok
          ? "Todas las notificaciones se marcaron como leídas."
          : general.ok
            ? "No se pudieron marcar los avisos SLA. Intenta nuevamente."
            : sla.ok
              ? "No se pudieron marcar las notificaciones generales. Intenta nuevamente."
              : "No se pudieron marcar las notificaciones. Intenta nuevamente.",
        error: !ok,
      });
      if (ok || general.ok || sla.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <AdminSurface className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="font-display font-bold text-plum">
            {unreadCount === 1 ? "1 notificación sin leer" : `${unreadCount} notificaciones sin leer`}
          </p>
          <p className="mt-1 text-sm text-muted">
            Avisos generales y recordatorios SLA en una sola bandeja. Los avisos
            nuevos aparecen aquí automáticamente.
          </p>
          {truncatedGeneral ? (
            <p className="mt-1 text-sm text-muted">
              Se muestran las 200 notificaciones generales más recientes; puede haber historial anterior.
            </p>
          ) : null}
          {truncatedSla ? (
            <p className="mt-1 text-sm text-muted">
              Se muestran los 50 avisos SLA más recientes; puede haber historial anterior.
            </p>
          ) : null}
        </div>
        <Button
          variant="secondary"
          onClick={markAllRead}
          disabled={isPending || unreadCount === 0}
        >
          Marcar todo como leído
        </Button>
      </AdminSurface>

      <LiveRegion className={feedback?.error ? "text-pink" : "text-muted"}>
        {feedback?.message ?? ""}
      </LiveRegion>

      <AdminSurface className="overflow-hidden p-0">
        <AdminTable
          caption="Bandeja unificada de notificaciones del panel"
          headers={["Origen", "Resumen", "Fecha", "Estado", "Destino", "Acción"]}
        >
          {items.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-muted">
                No hay notificaciones registradas.
              </td>
            </tr>
          ) : (
            items.map((item) => {
              const unread = item.readAt === null;
              const linkClass =
                "font-display text-sm font-bold text-pink underline-offset-4 hover:underline";
              return (
                <tr key={item.key} className="border-t border-rose/40 align-top">
                  <td className="px-4 py-3">
                    <AdminStatusChip tone={sourceTone[item.source]}>
                      {item.sourceLabel}
                    </AdminStatusChip>
                  </td>
                  <td className="px-4 py-3 text-sm text-ink">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">
                      {item.eventLabel}
                    </p>
                    {item.href ? (
                      <Link
                        href={item.href}
                        aria-label={`Abrir aviso: ${item.summary}`}
                        className={linkClass}
                        onClick={() => markReadOnOpen(item)}
                      >
                        {item.summary}
                      </Link>
                    ) : (
                      <span>{item.summary}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap text-muted">
                    {formatDateTime(item.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    {unread ? (
                      <AdminStatusChip tone="yellow">Sin leer</AdminStatusChip>
                    ) : (
                      <AdminStatusChip tone="mint">Leída</AdminStatusChip>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-ink">
                    {item.href ? (
                      <Link
                        href={item.href}
                        aria-label={`Abrir destino: ${item.targetLabel}`}
                        className={linkClass}
                        onClick={() => markReadOnOpen(item)}
                      >
                        {item.targetLabel}
                      </Link>
                    ) : (
                      <span>{item.targetLabel}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {item.source === "general" ? (
                      <Button
                        variant="ghost"
                        className="min-h-9 text-sm"
                        onClick={() => toggleRead(item)}
                        disabled={isPending}
                      >
                        {unread ? "Marcar como leída" : "Marcar como no leída"}
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        className="min-h-9 text-sm"
                        onClick={() => markSlaRead(item)}
                        disabled={isPending || !unread}
                      >
                        {unread ? "Marcar como leída" : "Leída"}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </AdminTable>
      </AdminSurface>
    </div>
  );
}
