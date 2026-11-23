"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, LiveRegion } from "@/components/ui/ui";
import { useToast } from "@/components/ui/toast";
import { updateAdminOrderStatus } from "@/features/admin/order-status";

type Status = "pending" | "confirmed" | "ready" | "completed" | "canceled" | "expired";

const LABELS: Record<Status, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  ready: "Listo",
  completed: "Completado",
  canceled: "Cancelado",
  expired: "Vencido",
};

function nextTarget(status: Status): "confirmed" | "ready" | "completed" | null {
  if (status === "pending") return "confirmed";
  if (status === "confirmed") return "ready";
  if (status === "ready") return "completed";
  return null;
}

export function OrderStatusAction({
  orderId,
  status,
  confirmationBlockedReason,
}: {
  orderId: number;
  status: Status;
  confirmationBlockedReason?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");
  const [isError, setIsError] = useState(false);
  const { showToast } = useToast();

  const target = nextTarget(status);
  const confirmationBlocked =
    target === "confirmed" && typeof confirmationBlockedReason === "string" && confirmationBlockedReason.trim() !== "";

  function handleClick() {
    if (!target || isPending) return;
    setFeedback("");
    startTransition(async () => {
      const result = await updateAdminOrderStatus({ orderId, status: target });
      if (!result.ok) {
        setIsError(true);
        setFeedback(result.error);
        showToast(result.error, "error");
        return;
      }
      const message = result.idempotent
        ? `El pedido ya estaba en estado ${LABELS[target]}.`
        : `Pedido actualizado a ${LABELS[target]}.`;
      setIsError(false);
      setFeedback(message);
      showToast(message, "success");
      router.refresh();
    });
  }

  if (!target) {
    const terminal = status === "completed" || status === "canceled" || status === "expired";
    return (
      <div className="space-y-2">
        <Button
          variant="secondary"
          className="w-full"
          disabled
          title="Este pedido no admite más cambios de estado desde este panel."
        >
          {terminal ? `Pedido ${LABELS[status].toLowerCase()}` : "Actualizar entrega"}
        </Button>
        <p className="text-sm leading-6 text-muted">
          {terminal
            ? "No hay más transiciones disponibles para este estado."
            : "No hay una transición disponible para este estado."}
        </p>
      </div>
    );
  }

  const actionLabel =
    target === "confirmed"
      ? "Confirmar pedido"
      : target === "ready"
        ? "Marcar como listo"
        : "Marcar como completado/entregado";

  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        className="w-full"
        onClick={handleClick}
        disabled={isPending || confirmationBlocked}
        title={confirmationBlocked ? confirmationBlockedReason ?? undefined : undefined}
      >
        {isPending ? "Actualizando…" : actionLabel}
      </Button>
      <p className="text-sm leading-6 text-muted">
        Estado actual: {LABELS[status]}. Próximo estado: {LABELS[target]}.
        {confirmationBlocked ? ` ${confirmationBlockedReason}` : ""}
        {target === "completed"
          ? " Al completar, se consumen las reservas activas del pedido."
          : ""}
      </p>
      <LiveRegion className={isError ? "text-pink" : "text-muted"}>{feedback}</LiveRegion>
    </div>
  );
}