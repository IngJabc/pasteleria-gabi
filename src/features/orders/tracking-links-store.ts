"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

export type SavedTrackingLink = {
  token: string;
  orderId: number;
  savedAt: string;
};

const STORAGE_KEY = "dulce-atelier-tracking-links-v1";
const EMPTY: SavedTrackingLink[] = [];
const TOKEN_RE = /^[0-9a-f]{64}$/;

let links: SavedTrackingLink[] = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function readStored(): SavedTrackingLink[] {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    return parsed
      .filter(
        (item): item is SavedTrackingLink =>
          typeof item === "object" &&
          item !== null &&
          TOKEN_RE.test(String((item as SavedTrackingLink).token ?? "")) &&
          Number.isInteger((item as SavedTrackingLink).orderId) &&
          (item as SavedTrackingLink).orderId > 0 &&
          typeof (item as SavedTrackingLink).savedAt === "string",
      )
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch {
    return EMPTY;
  }
}

function writeStored(next: SavedTrackingLink[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable; keep in-memory only.
  }
}

function setLinks(next: SavedTrackingLink[]) {
  links = next.length === 0 ? EMPTY : next;
  writeStored(links);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  if (typeof window !== "undefined" && links === EMPTY) {
    const stored = readStored();
    if (stored.length > 0) links = stored;
  }
  return links;
}

function getServerSnapshot() {
  return EMPTY;
}

function subscribeHydration() {
  return () => {};
}

export function saveTrackingLink(link: { token: string; orderId: number }) {
  if (!TOKEN_RE.test(link.token) || !Number.isInteger(link.orderId) || link.orderId <= 0) {
    return;
  }
  const current = getSnapshot();
  const existing = current.find((entry) => entry.token === link.token);
  if (existing) {
    // Keep original savedAt; refresh orderId if needed.
    if (existing.orderId !== link.orderId) {
      setLinks(
        current.map((entry) =>
          entry.token === link.token ? { ...entry, orderId: link.orderId } : entry,
        ),
      );
    }
    return;
  }
  setLinks([{ token: link.token, orderId: link.orderId, savedAt: new Date().toISOString() }, ...current]);
}

export function removeTrackingLink(token: string) {
  setLinks(getSnapshot().filter((entry) => entry.token !== token));
}

export function useTrackingLinks() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);

  const save = useCallback((link: { token: string; orderId: number }) => {
    saveTrackingLink(link);
  }, []);
  const remove = useCallback((token: string) => {
    removeTrackingLink(token);
  }, []);

  return useMemo(() => ({ items, hydrated, save, remove }), [items, hydrated, save, remove]);
}
