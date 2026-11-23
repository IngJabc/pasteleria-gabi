"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { Button, LiveRegion, buttonSecondaryClass } from "@/components/ui/ui";
import { useToast } from "@/components/ui/toast";
import {
  reviewPayment,
  type ReviewPaymentResult,
} from "@/features/payments/admin-payments";
import { paymentStatusLabel } from "./payment-display";

type Decision = "approve" | "reject";

const unexpectedError = "No se pudo completar la operación. Inténtalo de nuevo.";
const invalidDecision = "Selecciona una decisión válida.";

/** Feedback is built only from the real result of the existing action. */
function feedbackFor(result: ReviewPaymentResult): string {
  if (!result.ok) return result.error;
  const prefix = result.idempotent
    ? "Revisión ya registrada con la clave actual"
    : "Revisión registrada";
  return `${prefix}: pago #${result.paymentId} en estado ${paymentStatusLabel(result.status)}.`;
}

/**
 * Approve/reject controls for one real payment in the receipt queue.
 * Only the server-derived payment id and order reference cross into the client;
 * the private receipt path and its signed URL never do.
 */
export function ReceiptDecision({
  paymentId,
  orderId,
  orderReference,
}: {
  paymentId: number;
  orderId: number;
  orderReference: string;
}) {
  const [feedback, setFeedback] = useState("");
  const [isError, setIsError] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [resolved, setResolved] = useState<"approved" | "rejected" | "">("");
  const { showToast } = useToast();

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (isPending) return;

    // `new FormData(form)` does not consistently include the clicked submit
    // button, so prefer the native submitter and fall back to form data.
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const fromSubmitter =
      submitter instanceof HTMLButtonElement ? submitter.value : null;
    const rawDecision = fromSubmitter ?? new FormData(event.currentTarget).get("decision");
    const decision: Decision | null =
      rawDecision === "approve" || rawDecision === "reject" ? rawDecision : null;

    if (decision === null) {
      setIsError(true);
      setFeedback(invalidDecision);
      return;
    }

    setFeedback("");
    startTransition(async () => {
      try {
        const result = await reviewPayment({ paymentId, decision });
        const message = feedbackFor(result);
        setIsError(!result.ok);
        setFeedback(message);
        if (result.ok) {
          setResolved(decision === "approve" ? "approved" : "rejected");
          showToast(message, "success");
        } else {
          showToast(message, "error");
        }
      } catch {
        setIsError(true);
        setFeedback(unexpectedError);
        showToast(unexpectedError, "error");
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={isPending}
      aria-label={`Decisión de administración para el pedido ${orderReference}`}
      className="space-y-4"
    >
      <p className="text-sm leading-6 text-muted">
        Pedido {orderReference} · pago #{paymentId}. La decisión se registra con
        la revisión de pagos existente; el servidor valida el resultado.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" name="decision" value="approve" disabled={isPending || resolved !== ""}>
          {resolved === "approved" ? "Pago aprobado" : isPending ? "Registrando…" : "Aprobar pago"}
        </Button>
        <Button
          type="submit"
          name="decision"
          value="reject"
          variant="secondary"
          disabled={isPending || resolved !== ""}
        >
          {resolved === "rejected" ? "Pago rechazado" : isPending ? "Registrando…" : "Rechazar pago"}
        </Button>
        <Link href={`/admin/pedidos/${orderId}`} className={buttonSecondaryClass}>
          Volver al pedido
        </Link>
      </div>
      <LiveRegion className={isError ? "text-pink" : "text-muted"}>
        {isPending ? "Registrando decisión…" : feedback}
      </LiveRegion>
    </form>
  );
}
