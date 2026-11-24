"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";

export function ReviewFormDisclosure({
  title,
  children,
  defaultOpen = false,
  openOnHashId,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  openOnHashId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevOpen = useRef(open);

  useEffect(() => {
    if (!openOnHashId) return;
    const sync = () => {
      if (window.location.hash === `#${openOnHashId}`) setOpen(true);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [openOnHashId]);

  useEffect(() => {
    if (open && !prevOpen.current) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const behavior: ScrollBehavior = reduceMotion ? "auto" : "smooth";
      containerRef.current?.scrollIntoView({ block: "nearest", behavior });
      const timer = window.setTimeout(() => {
        panelRef.current?.scrollIntoView({ block: "nearest", behavior });
        const first = panelRef.current?.querySelector<HTMLElement>(
          'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
        );
        first?.focus({ preventScroll: true });
      }, reduceMotion ? 0 : 320);
      prevOpen.current = open;
      return () => window.clearTimeout(timer);
    }
    prevOpen.current = open;
  }, [open]);

  return (
    <div ref={containerRef} className="scroll-mt-24 rounded-section border border-rose/50 bg-white shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-14 w-full items-center justify-between gap-4 px-6 py-4 text-left hover:bg-rose/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lavender"
      >
        <span className="font-display text-xl font-extrabold text-plum">{title}</span>
        <ChevronDownIcon
          className={`size-5 shrink-0 text-plum transition-transform duration-300 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        id={contentId}
        aria-hidden={!open}
        inert={!open ? true : undefined}
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="overflow-hidden">
          <div ref={panelRef} className="border-t border-rose/30 px-6 pb-6 pt-4">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
