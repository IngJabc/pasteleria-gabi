import { Suspense, type ReactNode } from "react";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { BellIcon } from "@/components/ui/icons";
import { logoutAdmin } from "@/features/admin/auth/actions";

/** Neutral, truthful note shown at the bottom of every admin screen. */
export function AdminFooterNote() {
  return (
    <footer className="admin-footer">
      <p>Dulce Atelier · Panel administrativo</p>
    </footer>
  );
}

/**
 * Fail-closed state for visitors without an active administrator session.
 * Intentionally renders neither the shell nor the navigation.
 */
export function AdminAccessMessage({ message }: { message: string }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-6 py-12">
      <div className="w-full rounded-card border border-rose bg-white p-8 shadow-sm">
        <p className="text-eyebrow">EL ATELIER / ADMIN</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold text-plum">
          Panel administrativo
        </h1>
        <p className="mt-4 leading-7 text-muted">{message}</p>
      </div>
    </main>
  );
}

/**
 * Shared admin frame: skip link, sidebar, session-neutral top bar and the
 * rounded content panel. No administrator identity or alert count is baked in.
 */
export function AdminShell({
  children,
  alertsLabel,
}: {
  children: ReactNode;
  alertsLabel?: string;
}) {
  return (
    <div className="admin-shell">
      <a href="#admin-main" className="admin-skip-link">
        Saltar al contenido principal
      </a>

      {/* usePathname may suspend below dynamic segments under Cache Components. */}
      <Suspense fallback={<div className="admin-sidebar" aria-hidden="true" />}>
        <AdminSidebar />
      </Suspense>

      <div className="admin-content">
        <header className="admin-topbar">
          <p className="text-eyebrow">EL ATELIER / ADMIN</p>
          <div className="admin-topbar-actions">
            {alertsLabel ? (
              <p className="admin-alerts-pill">
                <BellIcon className="size-4" />
                {alertsLabel}
              </p>
            ) : null}
            <form action={logoutAdmin}>
              <button type="submit" className="admin-user-chip">
                <span className="admin-user-avatar" aria-hidden="true">
                  AD
                </span>
                <span>Cerrar sesión</span>
              </button>
            </form>
          </div>
        </header>

        <div className="admin-panel">
          <main id="admin-main" tabIndex={-1} className="admin-main">
            {children}
          </main>
          <AdminFooterNote />
        </div>
      </div>
    </div>
  );
}
