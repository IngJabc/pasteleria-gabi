"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type CheckoutDraft = {
  fulfillmentType: "delivery" | "pickup";
  deliveryZoneId: number | null;
};

const STORAGE_KEY = "dulce-atelier-checkout-draft-v1";
const EMPTY: CheckoutDraft = { fulfillmentType: "delivery", deliveryZoneId: null };

let draft: CheckoutDraft = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function readStored(): CheckoutDraft {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<CheckoutDraft>;
    const fulfillmentType =
      parsed.fulfillmentType === "pickup" ? "pickup" : "delivery";
    const deliveryZoneId =
      typeof parsed.deliveryZoneId === "number" &&
      Number.isInteger(parsed.deliveryZoneId) &&
      parsed.deliveryZoneId > 0
        ? parsed.deliveryZoneId
        : null;
    return { fulfillmentType, deliveryZoneId };
  } catch {
    return EMPTY;
  }
}

function writeStored(next: CheckoutDraft) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
}

function setDraft(next: CheckoutDraft) {
  draft =
    next.fulfillmentType === EMPTY.fulfillmentType &&
    next.deliveryZoneId === EMPTY.deliveryZoneId
      ? EMPTY
      : next;
  writeStored(draft);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  if (typeof window !== "undefined" && draft === EMPTY) {
    const stored = readStored();
    if (stored !== EMPTY) draft = stored;
  }
  return draft;
}

function getServerSnapshot() {
  return EMPTY;
}

function subscribeHydration() {
  return () => {};
}

type CheckoutDraftContextValue = {
  draft: CheckoutDraft;
  hydrated: boolean;
  setDraft: (next: Partial<CheckoutDraft>) => void;
  clearDraft: () => void;
};

const CheckoutDraftContext = createContext<CheckoutDraftContextValue | null>(null);

export function CheckoutDraftProvider({ children }: { children: ReactNode }) {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);

  const update = useCallback((next: Partial<CheckoutDraft>) => {
    const base = getSnapshot();
    setDraft({
      fulfillmentType: next.fulfillmentType ?? base.fulfillmentType,
      deliveryZoneId:
        next.deliveryZoneId === undefined ? base.deliveryZoneId : next.deliveryZoneId,
    });
  }, []);

  const clearDraft = useCallback(() => setDraft(EMPTY), []);

  const value = useMemo(
    () => ({ draft: current, hydrated, setDraft: update, clearDraft }),
    [current, hydrated, update, clearDraft],
  );

  return <CheckoutDraftContext.Provider value={value}>{children}</CheckoutDraftContext.Provider>;
}

export function useCheckoutDraft() {
  const context = useContext(CheckoutDraftContext);
  if (!context) {
    throw new Error("useCheckoutDraft debe usarse dentro de <CheckoutDraftProvider>.");
  }
  return context;
}
