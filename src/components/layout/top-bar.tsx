import { HeartIcon } from "@/components/ui/icons";

/** Slim announcement bar shown at the very top of every storefront screen. */
export function TopBar() {
  return (
    <div className="bg-rose">
      <div className="container-page flex flex-wrap items-center justify-center gap-x-2 gap-y-1 py-2 text-center text-xs font-bold text-ink">
        <span>Hecho en Barquisimeto</span>
        <HeartIcon className="size-3.5 text-pink" />
        <span aria-hidden="true" className="text-muted">
          •
        </span>
        <span>Delivery GRATIS en la zona norte</span>
      </div>
    </div>
  );
}
