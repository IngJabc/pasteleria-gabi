# `src/features` — Feature modules

One folder per application capability. A feature owns its use cases (server
actions / route-handler logic), its UI components and its Zod input schemas, and
it may freely use `src/domain` and `src/infrastructure`. Features must not reach
into each other's internals — shared behavior belongs in `src/domain`,
`src/components` or `src/infrastructure`.

Planned modules (documented in `docs/ROADMAP.md`). Backend-only server actions
exist today in `orders/`, `payments/` and `exchange-rates/`; no feature UI exists
yet:

| Folder | Capability |
| --- | --- |
| `catalog/` | Product listing, product detail, admin product management. |
| `cart/` | Client-side cart state for the storefront. |
| `checkout/` | Guest checkout: customer data, delivery/pickup, server-side recalculation. |
| `orders/` | **Partial:** quote acceptance by private tracking token (OQ-17); full online-order/tracking UI still planned (SPEC §7). |
| `payments/` | **Partial backend:** Pago Móvil receipts, manual verification, combined payments, POS cash and refunds (SPEC §5); UI planned. |
| `exchange-rates/` | **Backend:** manual BCV rate registration/deactivation/history, atomic per-order snapshots via `create_online_order_with_bcv`, and legacy manual snapshot actions (OQ-4/OQ-5, migration 007); UI planned. |
| `inventory/` | Batches, movements, reservations, FIFO allocation (SPEC §8). |
| `pos/` | Walk-in sales and external payments registered from the panel (SPEC §9). |
| `admin/` | Dashboard, settings, administrators, activity history (SPEC §15). |
| `notifications/` | Supabase Realtime alerts and prepared WhatsApp links (SPEC §13). |

Customer-facing and administrative capabilities stay clearly separated: admin
modules are only mounted under `src/app/(admin)/admin`.
