"use client";

import { useState, useTransition } from "react";
import { getReceiptUrlsForTracking } from "./receipt-review";

type Feedback = { tone: "neutral" | "error"; message: string };

const unavailableMessage = "No se pudieron consultar los comprobantes.";

/** OQ-12: an explicit control that reveals signed links only after server authorization. */
export function ReceiptReviewControl({ trackingToken }: { trackingToken: string }) {
  const [urls, setUrls] = useState<string[] | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleReview(): void {
    if (isPending) return;

    setUrls(null);
    setFeedback(null);

    startTransition(async () => {
      try {
        const result = await getReceiptUrlsForTracking({ trackingToken });
        if (result.ok) {
          setUrls(result.urls);
          setFeedback({ tone: "neutral", message: "Comprobantes disponibles." });
        } else {
          setFeedback({ tone: "error", message: result.error });
        }
      } catch {
        setFeedback({ tone: "error", message: unavailableMessage });
      }
    });
  }

  return (
    <section aria-labelledby="receipt-review-heading" className="space-y-3" aria-busy={isPending}>
      <h2
        id="receipt-review-heading"
        className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
      >
        Comprobantes de pago
      </h2>

      <button
        type="button"
        onClick={handleReview}
        aria-disabled={isPending}
        aria-describedby="receipt-review-status"
        className={`rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-800 ${
          isPending ? "cursor-not-allowed opacity-60" : ""
        }`}
      >
        {isPending ? "Consultando comprobantes…" : "Ver comprobantes"}
      </button>

      <p
        id="receipt-review-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={`text-sm ${
          feedback?.tone === "error"
            ? "text-red-700 dark:text-red-300"
            : "text-zinc-600 dark:text-zinc-400"
        }`}
      >
        {isPending ? "Consultando comprobantes…" : (feedback?.message ?? "")}
      </p>

      {urls !== null && urls.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {urls.map((url, index) => (
            <li key={`${url}-${index}`}>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-blue-700 underline underline-offset-4 dark:text-blue-300"
              >
                Ver comprobante {index + 1} (se abre en una pestaña nueva)
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
