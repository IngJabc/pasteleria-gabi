import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  AdminAccessMessage,
  AdminShell,
} from "@/components/admin/admin-shell";
import { ToastProvider } from "@/components/ui/toast";
import { getAdminGeneralUnreadCount } from "@/features/admin/general-notifications";
import { getUnreadAdminNotificationCount } from "@/features/admin/notifications";
import { UnifiedNotificationsRealtime } from "@/features/admin/components/general-notifications-realtime";
import { combineUnreadCounts } from "@/features/admin/unified-notifications-helpers";
import {
  AdminSessionError,
  requireActiveAdminId,
} from "@/features/payments/admin-session";

export const metadata: Metadata = {
  title: "Panel administrativo",
  robots: { index: false, follow: false },
};

// The gate reads request cookies; the shell must never be served statically.
export const instant = false;

/** Private admin layout: authorization resolves before any frame renders. */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  let adminId: string;
  try {
    adminId = await requireActiveAdminId();
  } catch (error) {
    if (!(error instanceof AdminSessionError)) throw error;
    return <AdminAccessMessage message={error.message} />;
  }

  // Real unread rows only. Each source degrades independently; if both are
  // unavailable the sidebar renders no badge at all.
  const [generalUnread, slaUnread] = await Promise.all([
    getAdminGeneralUnreadCount(),
    getUnreadAdminNotificationCount(),
  ]);
  const unreadCount = combineUnreadCounts(generalUnread, slaUnread);

  return (
    <ToastProvider>
      <UnifiedNotificationsRealtime adminId={adminId} />
      <AdminShell unreadCount={unreadCount}>
        {children}
      </AdminShell>
    </ToastProvider>
  );
}
