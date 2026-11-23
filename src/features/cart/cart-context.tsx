"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * Client-side shopping bag.
 *
 * The bag is intentionally local: it holds no inventory claim and no price
 * authority. Quantities and prices are re-validated by the server when the
 * order is created (`create_online_order_with_bcv`). Persisting to
 * localStorage keeps the bag across the catalog, the detail page and checkout
 * without inventing a server session.
 */

export type CartItem = {
  productId: number;
  slug: string;
  name: string;
  priceUsd: number;
  imageUrl: string | null;
  quantity: number;
};

type CartContextValue = {
  items: CartItem[];
  count: number;
  subtotalUsd: number;
  hydrated: boolean;
  addItem: (item: Omit<CartItem, "quantity">, quantity?: number) => void;
  setQuantity: (productId: number, quantity: number) => void;
  removeItem: (productId: number) => void;
  clear: () => void;
};

const STORAGE_KEY = "dulce-atelier-cart-v1";
const EMPTY_CART: CartItem[] = [];

const CartContext = createContext<CartContextValue | null>(null);

let cartItems: CartItem[] = EMPTY_CART;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function readStoredCart(): CartItem[] {
  if (typeof window === "undefined") return EMPTY_CART;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_CART;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY_CART;
    return parsed.filter(
      (item): item is CartItem =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as CartItem).productId === "number" &&
        typeof (item as CartItem).slug === "string" &&
        typeof (item as CartItem).name === "string" &&
        typeof (item as CartItem).priceUsd === "number" &&
        typeof (item as CartItem).quantity === "number",
    );
  } catch {
    return EMPTY_CART;
  }
}

function writeStoredCart(items: CartItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage can be unavailable (private mode); the bag still works in-memory.
  }
}

function setCart(next: CartItem[]) {
  cartItems = next.length === 0 ? EMPTY_CART : next;
  writeStoredCart(cartItems);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  if (typeof window !== "undefined" && cartItems === EMPTY_CART) {
    const stored = readStoredCart();
    if (stored.length > 0) cartItems = stored;
  }
  return cartItems;
}

function getServerSnapshot() {
  return EMPTY_CART;
}

function subscribeHydration() {
  return () => {};
}

export function CartProvider({ children }: { children: ReactNode }) {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);

  const addItem = useCallback(
    (item: Omit<CartItem, "quantity">, quantity = 1) => {
      const current = getSnapshot();
      const existing = current.find((entry) => entry.productId === item.productId);
      if (existing) {
        setCart(
          current.map((entry) =>
            entry.productId === item.productId
              ? { ...entry, quantity: entry.quantity + quantity }
              : entry,
          ),
        );
        return;
      }
      setCart([...current, { ...item, quantity }]);
    },
    [],
  );

  const setQuantity = useCallback((productId: number, quantity: number) => {
    setCart(
      getSnapshot()
        .map((entry) =>
          entry.productId === productId
            ? { ...entry, quantity: Math.max(0, quantity) }
            : entry,
        )
        .filter((entry) => entry.quantity > 0),
    );
  }, []);

  const removeItem = useCallback((productId: number) => {
    setCart(getSnapshot().filter((entry) => entry.productId !== productId));
  }, []);

  const clear = useCallback(() => setCart([]), []);

  const value = useMemo<CartContextValue>(() => {
    const count = items.reduce((total, item) => total + item.quantity, 0);
    const subtotalUsd = items.reduce(
      (total, item) => total + item.priceUsd * item.quantity,
      0,
    );
    return {
      items,
      count,
      subtotalUsd,
      hydrated,
      addItem,
      setQuantity,
      removeItem,
      clear,
    };
  }, [items, hydrated, addItem, setQuantity, removeItem, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart debe usarse dentro de <CartProvider>.");
  }
  return context;
}
