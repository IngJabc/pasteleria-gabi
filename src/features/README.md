# `src/features` — Feature modules

One folder per application capability. A feature owns its use cases (server
actions / route-handler logic), its UI components and its Zod input schemas, and
it may freely use `src/domain` and `src/infrastructure`. Features must not reach
into each other's internals — shared behavior belongs in `src/domain`,
`src/components` or `src/infrastructure`.

Planned modules (documented in `docs/ROADMAP.md`). Server actions exist in
`orders/`, `payments/` and `exchange-rates/`. `catalog/` renders the public
product list and detail UI, `payments/components/` renders the POS and refund
forms, and `admin/` holds the server-side reads that back the administrative
screens; other feature UI remains planned:

| Folder | Capability |
| --- | --- |
| `catalog/` | **Public UI + admin CRUD implemented locally:** active list/detail reads, `/admin/productos` session-gated create/edit/activate-deactivate and image upload/remove/reorder with `audit_log` writes; seed remains pending (B3). |
| `cart/` | Client-side cart state for the storefront. |
| `checkout/` | Guest checkout: customer data, delivery/pickup, server-side recalculation. |
| `orders/` | **Partial:** quote acceptance by private tracking token (OQ-17); full online-order/tracking UI still planned (SPEC §7). |
| `payments/` | **Partial backend + local admin UI:** Pago Móvil receipts, manual verification, combined payments, POS cash and refunds (SPEC §5); POS/refund forms render in `/admin` behind a fail-closed session gate, while verification/list UI remains planned. |
| `exchange-rates/` | **Backend:** manual BCV rate registration/deactivation/history, atomic per-order snapshots via `create_online_order_with_bcv`, and legacy manual snapshot actions (OQ-4/OQ-5, migration 007); UI planned. |
| `inventory/` | Batches, movements, reservations, FIFO allocation (SPEC §8). |
| `pos/` | Walk-in sales use the `payments/` POS form at `/admin/punto-de-venta` (SPEC §9); combined payments remain unavailable. Cash-only external payment registration lives at `/admin/pagos/externo`. |
| `admin/` | **Admin UI read layer:** nine gated server modules (`format`, `overview`, `orders`, `notifications`, `cancellations`, `receipts`, `inventory`, `settings-read`, `refunds-read`) plus `components/payments/` and `components/ops/`. Every helper calls `requireActiveAdminId()`; RLS tables use the session client and only `get_product_stock` uses the service-role client. Missing local-only relations degrade to fixed Spanish `unavailable` results — never fabricated data. Cancellation approval, delivery-zone CRUD, payment-method toggles, reserve policy and admin-team CRUD remain unavailable (no backend rule). |
| `notifications/` | Supabase Realtime alerts and prepared WhatsApp links (SPEC §13). |

Customer-facing and administrative capabilities stay clearly separated: admin
modules are only mounted under `src/app/(admin)/admin`.
