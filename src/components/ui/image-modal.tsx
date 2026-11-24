"use client";

import { useEffect, useState } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/ui";

type ImageItem = { url: string; alt: string };

export function ImageModal({
  images,
  initialIndex,
  open,
  onClose,
}: {
  images: ImageItem[];
  initialIndex: number;
  open: boolean;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);

  useEffect(() => {
    if (open) setIndex(initialIndex);
  }, [open, initialIndex]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") setIndex((i) => Math.min(images.length - 1, i + 1));
      if (event.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, images.length]);

  if (!open || images.length === 0) return null;
  const current = images[Math.min(index, images.length - 1)];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-plum/50 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Imagen del producto"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-section bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-rose px-4 py-3">
          <p className="min-w-0 truncate font-display text-sm font-bold text-plum sm:text-base">
            {current.alt || "Imagen del producto"}
            {images.length > 1 ? <span className="text-muted"> · {index + 1}/{images.length}</span> : null}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {images.length > 1 ? (
              <>
                <Button variant="secondary" className="min-h-10 px-3" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} aria-label="Imagen anterior">
                  <ChevronDownIcon className="size-4 rotate-90" />
                </Button>
                <Button variant="secondary" className="min-h-10 px-3" onClick={() => setIndex((i) => Math.min(images.length - 1, i + 1))} disabled={index === images.length - 1} aria-label="Imagen siguiente">
                  <ChevronDownIcon className="size-4 -rotate-90" />
                </Button>
              </>
            ) : null}
            <Button variant="ghost" className="min-h-10 px-3" onClick={onClose}>Cerrar</Button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-cream p-3 sm:p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- modal uses dynamic/remote catalog image URL already allowed by app config; img keeps simple fit behavior */}
          <img src={current.url} alt={current.alt} className="max-h-[75vh] w-auto max-w-full rounded-card bg-white object-contain" />
        </div>
      </div>
    </div>
  );
}

export function ImageModalTrigger({
  images,
  index = 0,
  className = "",
  children,
  label = "Ver imagen en grande",
}: {
  images: ImageItem[];
  index?: number;
  className?: string;
  children: React.ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  if (images.length === 0) return <>{children}</>;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className} aria-label={label}>
        {children}
      </button>
      <ImageModal images={images} initialIndex={index} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
