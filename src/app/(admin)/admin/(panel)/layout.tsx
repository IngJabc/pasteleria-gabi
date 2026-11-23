import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  AdminAccessMessage,
  AdminShell,
} from "@/components/admin/admin-shell";
import { ToastProvider } from "@/components/ui/toast";
import { getUnreadAdminNotificationCount } from "@/features/admin/notifications";
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
  try {
    await requireActiveAdminId();
  } catch (error) {
    if (!(error instanceof AdminSessionError)) throw error;
    return <AdminAccessMessage message={error.message} />;
  }

  // Real unread rows only. A null result renders no badge at all.
  const unread = await getUnreadAdminNotificationCount();
  const alertsLabel = unread && unread > 0 ? `${unread} alertas nuevas` : undefined;

  return (
    <ToastProvider>
      <AdminShell alertsLabel={alertsLabel}>{children}</AdminShell>
    </ToastProvider>
  );
}
