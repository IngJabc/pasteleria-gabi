import { Suspense, type ReactNode } from "react";
import { CartProvider } from "@/features/cart/cart-context";
import { CheckoutDraftProvider } from "@/features/cart/checkout-draft";
import { TopBar } from "@/components/layout/top-bar";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { ToastProvider } from "@/components/ui/toast";

/**
 * Shared storefront chrome. Cart and checkout draft providers live here so
 * catalog/cart/checkout share client state without server authority.
 */
export default function StorefrontLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <CartProvider>
      <CheckoutDraftProvider>
        <ToastProvider>
          <TopBar />
          {/* usePathname() is runtime-only: stream the interactive header. */}
          <Suspense fallback={<div className="h-[4.75rem] bg-cream" aria-hidden="true" />}>
            <SiteHeader />
          </Suspense>
          <div className="flex flex-1 flex-col">{children}</div>
          <SiteFooter />
        </ToastProvider>
      </CheckoutDraftProvider>
    </CartProvider>
  );
}
