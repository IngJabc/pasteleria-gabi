"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArchiveIcon,
  BellIcon,
  BoxIcon,
  CardIcon,
  DashboardIcon,
  ExternalLinkIcon,
  FlowerIcon,
  HeartIcon,
  OrdersIcon,
  RotateIcon,
  SettingsIcon,
  StoreIcon,
} from "@/components/ui/icons";

/**
 * Static section map for the admin navigation. Links point at the canonical
 * section routes; pages that are not built yet will be added by their owners.
 */
const navItems = [
  { label: "Resumen", href: "/admin", icon: DashboardIcon },
  { label: "Pedidos", href: "/admin/pedidos", icon: OrdersIcon },
  { label: "Notificaciones", href: "/admin/notificaciones", icon: BellIcon },
  { label: "Pago externo", href: "/admin/pagos/externo", icon: CardIcon },
  { label: "Productos", href: "/admin/productos", icon: BoxIcon },
  { label: "Reseñas", href: "/admin/resenas", icon: HeartIcon },
  { label: "Inventario FIFO", href: "/admin/inventario", icon: ArchiveIcon },
  { label: "Punto de venta", href: "/admin/punto-de-venta", icon: StoreIcon },
  {
    label: "Cancelaciones y reembolsos",
    href: "/admin/cancelaciones",
    icon: RotateIcon,
  },
  { label: "Configuración", href: "/admin/configuracion", icon: SettingsIcon },
] as const;

function isActive(pathname: string, href: string) {
  // Resumen is exact-match only, so it does not stay active on child screens.
  if (href === "/admin") return pathname === "/admin";

  // "Pedidos" owns the list and detail routes; comprobantes opens from orders.
  if (href === "/admin/pedidos") {
    return pathname === "/admin/pedidos" || /^\/admin\/pedidos\/[^/]+$/.test(pathname);
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function unreadBadgeText(count?: number | null): string | null {
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

function unreadAriaLabel(label: string, count?: number | null): string | undefined {
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return undefined;
  const unread =
    count === 1 ? "1 notificación sin leer" : `${count} notificaciones sin leer`;
  return `${label}, ${unread}`;
}

/** Admin navigation: one semantic tree at every viewport width. */
export function AdminSidebar({ unreadCount }: { unreadCount?: number | null }) {
  const pathname = usePathname();

  return (
    <aside className="admin-sidebar">
      <div className="admin-brand">
        <Link
          href="/admin"
          className="inline-flex items-center gap-2 font-display text-2xl font-extrabold text-plum"
        >
          dulce atelier
          <FlowerIcon className="size-5 text-pink" />
        </Link>
        <p className="text-eyebrow mt-1">ADMINISTRACIÓN</p>
      </div>

      <nav aria-label="Administración" className="admin-nav">
        <ul className="admin-nav-list">
          {navItems.map(({ label, href, icon: Icon }) => {
            const active = isActive(pathname, href);
            const showBadge = href === "/admin/notificaciones";
            const badge = showBadge ? unreadBadgeText(unreadCount) : null;
            const badgeLabel = showBadge ? unreadAriaLabel(label, unreadCount) : undefined;

            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  aria-label={badgeLabel}
                  className="admin-nav-link"
                >
                  <Icon className="size-5 shrink-0" />
                  <span>{label}</span>
                  {badge ? (
                    <span
                      aria-hidden="true"
                      className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full bg-pink px-2 py-0.5 text-xs font-bold text-white"
                    >
                      {badge}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="admin-sidebar-bottom">
        <div className="rounded-card bg-lavender p-4">
          <p className="flex items-center gap-2 font-display font-bold text-plum">
            Hecho con orden <HeartIcon className="size-4" />
          </p>
          <p className="mt-2 text-sm leading-6 text-muted">
            Pedidos abiertos 24/7. Dos administradoras, un mismo atelier.
          </p>
        </div>
        <Link href="/" className="admin-store-link">
          Ver tienda
          <ExternalLinkIcon className="size-4" />
        </Link>
      </div>
    </aside>
  );
}
