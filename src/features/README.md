# `src/features` — Feature modules

One folder per application capability. A feature owns its use cases (server
actions / route-handler logic), its UI components and its Zod input schemas, and
it may freely use `src/domain` and `src/infrastructure`. Features must not reach
into each other's internals — shared behavior belongs in `src/domain`,
`src/components` or `src/infrastructure`.

Planned modules (documented in `docs/ROADMAP.md`, **not implemented yet**):

| Folder | Capability |
| --- | --- |
| `catalog/` | Product listing, product detail, admin product management. |
| `cart/` | Client-side cart state for the storefront. |
| `checkout/` | Guest checkout: customer data, delivery/pickup, server-side recalculation. |
| `orders/` | Online orders, private tracking links (SPEC §7). |
| `payments/` | Pago Móvil receipts, manual verification, combined payments (SPEC §5). |
| `inventory/` | Batches, movements, reservations, FIFO allocation (SPEC §8). |
| `pos/` | Walk-in sales and external payments registered from the panel (SPEC §9). |
| `admin/` | Dashboard, settings, administrators, activity history (SPEC §15). |
| `notifications/` | Supabase Realtime alerts and prepared WhatsApp links (SPEC §13). |

Customer-facing and administrative capabilities stay clearly separated: admin
modules are only mounted under `src/app/(admin)/admin`.
