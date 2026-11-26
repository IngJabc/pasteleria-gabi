import type { Metadata } from "next";
import {
  AdminBanner,
  AdminEmptyState,
  AdminPageHeader,
} from "@/components/admin/admin-ui";
import { GeneralNotificationsManager } from "@/features/admin/components/general-notifications-manager";
import {
  getAdminGeneralUnreadCount,
  listAdminGeneralNotifications,
} from "@/features/admin/general-notifications";
import {
  getUnreadAdminNotificationCount,
} from "@/features/admin/notifications";
import { listAdminNotifications } from "@/features/admin/settings-read";
import {
  combineUnreadCounts,
  mergeUnifiedNotifications,
} from "@/features/admin/unified-notifications-helpers";

export const metadata: Metadata = {
  title: "Notificaciones | Panel administrativo",
  robots: { index: false, follow: false },
};

// The session gate reads request cookies; keep the panel blocking so no static
// shell can expose controls before authorization resolves.
export const instant = false;

export default async function AdminNotificationsPage() {
  const [general, sla, generalUnread, slaUnread] = await Promise.all([
    listAdminGeneralNotifications(),
    listAdminNotifications(),
    getAdminGeneralUnreadCount(),
    getUnreadAdminNotificationCount(),
  ]);

  const items = mergeUnifiedNotifications(general.items, sla.items);
  const exactUnread = combineUnreadCounts(generalUnread, slaUnread);
  const shownUnread = items.filter((item) => item.readAt === null).length;
  const unreadCount = exactUnread ?? shownUnread;
  const unavailable = general.unavailable && sla.unavailable;
  const messages = [
    general.unavailable ? general.message : null,
    sla.unavailable ? sla.message : null,
  ].filter((message): message is string => message !== null);

  return (
    <>
      <AdminPageHeader
        title="Notificaciones"
        subtitle="Avisos generales y recordatorios SLA de comprobantes en una sola bandeja."
      />

      {unavailable ? (
        <div className="space-y-6">
          <AdminBanner tone="pink">{messages[0] ?? "No fue posible consultar las notificaciones."}</AdminBanner>
          <AdminEmptyState
            title="Bandeja no disponible"
            description="No fue posible consultar las notificaciones. Vuelve a intentarlo en unos minutos."
          />
        </div>
      ) : (
        <>
          {messages.length > 0 ? (
            <div className="mb-4">
              <AdminBanner tone="pink">
                {messages.join(" ")} Los avisos disponibles se muestran a continuación.
              </AdminBanner>
            </div>
          ) : null}
          {items.length === 0 ? (
            messages.length > 0 ? (
              <AdminEmptyState
                title="Consulta incompleta"
                description="No fue posible consultar todas las notificaciones. Vuelve a intentarlo en unos minutos."
              />
            ) : (
              <AdminEmptyState
                title="Todo al día"
                description="Todavía no hay notificaciones. Los avisos nuevos aparecerán aquí automáticamente."
              />
            )
          ) : (
            <GeneralNotificationsManager
              items={items}
              unreadCount={unreadCount}
              truncatedGeneral={general.truncated}
              truncatedSla={sla.truncated}
            />
          )}
        </>
      )}
    </>
  );
}
