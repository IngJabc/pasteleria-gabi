import Link from "next/link";
import { AdminEmptyState, AdminPageHeader } from "@/components/admin/admin-ui";
import { buttonPrimaryClass } from "@/components/ui/ui";

// No data access here, but the layout still reads cookies for the gate.
export const instant = false;

/** Sidebar landing for "Detalle de pedido": directs admins to the real queue. */
export default function AdminOrderDetailIndexPage() {
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Detalle de pedido"
        subtitle="Consulta la información completa de cada pedido."
      />
      <AdminEmptyState
        title="Selecciona un pedido"
        description="Abre un pedido desde la lista para ver su detalle."
        action={
          <Link href="/admin/pedidos" className={buttonPrimaryClass}>
            Ver lista de pedidos
          </Link>
        }
      />
    </div>
  );
}
