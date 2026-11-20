# ROADMAP

Phased plan for Pastelería Online. Everything in this document is **documented
future intent** unless the phase status says *done*. Nothing here is implemented
before its phase starts.

Status legend: ✅ done · 🚧 in progress · ⬜ not started

---

## Phase 0 — Project initialization ✅

- Next.js (App Router) + TypeScript strict + Tailwind CSS + ESLint configured.
- Supabase packages installed; client modules prepared behind
  `src/infrastructure/supabase` (browser, server, service-role) — **not
  connected to any remote project**.
- Layered folder structure (`app` / `components` / `features` / `domain` /
  `infrastructure` / `validation` / `test`).
- Vitest configured with a working test suite; `.env.example`, `README.md`,
  documentation and `TASKS.md` created.
- Explicitly out of scope: business features, database schema, migrations,
  authentication, checkout, payments, inventory, Figma screens.

## Phase 1 — Foundation: database, catalog and admin access 🚧

**Progress:** M1 (the first migration — catalog, settings, zones,
administrators, audit + RLS/storage policies) is written in
`supabase/migrations/001_catalog_and_admin_foundation.sql`, validated locally
and **applied to the production Supabase project**. The catalog pages, admin
auth and admin CRUD items below are not started.

- Create the Supabase project; provision environment variables (no credentials
  in source code).
- First migration: products, images, store settings; RLS policies on every
  table; generate TypeScript database types and wire them into the Supabase
  clients.
- Public catalog: product list and detail with photographs (public Storage
  bucket), active/inactive state, USD prices.
- Supabase Auth for exactly two administrators; admin authorization validated
  **in the database** (never from `user_metadata`); protected `/admin` shell.
- Admin product management (CRUD) and private receipts bucket preparation.

## Phase 2 — Inventory 🚧

**Progress:** M2 — database foundation only — is implemented in
`supabase/migrations/002_inventory_foundation.sql`: `inventory_batches`,
`inventory_movements` (append-only, `order_id` added by M3 together with `orders`),
RLS, and the `create_inventory_batch` / `adjust_inventory` / `get_product_stock`
RPCs, validated on a local PostgreSQL cluster (36 tests). **Not applied
remotely yet.** Reservations (§6.2), checkout-time stock deduction, sale
movements and the 20-minute timing (initial deadline + single correction
window) arrived with **M3** (migration 002 itself is unchanged); the 24-hour
administrative review SLA remains notification-only and is deliberately not a
column on `orders`/`inventory_reservations` (DECISIONS #24/#25) — its dedicated
history/inbox tables arrive later in migration 005. The admin screens below
remain to do.

- Batches (product, initial/remaining quantity, production date, responsible
  admin), FIFO allocation, stock movements (entries, sales, adjustments) with
  audit fields.
- Online orders reserve stock atomically (20-minute initial expiry plus ONE
  20-minute receipt-correction window, at most two receipts, second rejection
  auto-cancels — DECISIONS #24 as amended by the M3 correction; idempotent
  operations, PostgreSQL functions/RPC for critical paths).
- Admin screens for batches, movements and adjustments (production date is
  administrative only and never shown in the store).

## Phase 3 — Checkout, orders and tracking 🚧

**Progress:** M3 — database foundation only — is implemented in
`supabase/migrations/003_orders_and_reservations.sql`: `orders`,
`order_items`, `inventory_reservations`, `cancellation_requests`,
`exchange_rates`, the `inventory_movements.order_id` FK/index, RLS and the
eight service-role-only RPCs (checkout with server-side recompute and
deadlock-free FIFO reservation, receipt hold with a two-receipt counter, single
20-minute correction window, automatic cancel + release on the second rejection,
lazy expiry, consume → `sale` movement, release, PII-free tracking, guest
cancellation requests), validated on a local PostgreSQL cluster (73 tests total
at that point, 109 after Phase 4/M4 incl. M1/M2). **Not applied remotely yet.**
The guest checkout / tracking / cancellation **UI** and the Phase 4 payment
workflow remain to do. OQ-13 (quote case), OQ-14, OQ-15, **OQ-16 and OQ-17 are
all resolved in documentation** (DECISIONS #24–#26). OQ-17 is **implemented in
Phase 4** (`supabase/migrations/004_quote_acceptance.sql`, local only): a new
fixed 20-minute acceptance window in `quote_acceptance_expires_at`, with
`initial_expires_at` immutable. OQ-16 is **implemented in Phase 6** by migration
005 and the dedicated SLA worker (also local only). Neither changes M1/M2/M3 or
their migrations.

- Guest checkout (no mandatory registration): customer name, WhatsApp phone,
  delivery/pickup, address and references, optional instructions.
- **Server-side** recalculation of subtotal, delivery fee and total; inventory
  re-check; client prices are never trusted.
- Delivery zones per SPEC §6 (north zone free, rest of city $5, outside the city
  manual quote). While the quote is pending the reservation is held with no
  automatic expiry (OQ-13); the customer's explicit acceptance of the quoted fee
  starts a new fixed 20-minute initial reservation window (OQ-17 / DECISIONS
  #26) — implemented in Phase 4 by migration 004 (local only), with `initial_expires_at`
   left immutable.
- Order entity with private tracking link (random token, hash stored) so
  customers can follow their order without an account; cancellation request from
  the tracking page.

## Phase 4 — Payments 🚧

**Progress:** the OQ-17 quote-acceptance transition is implemented in
`supabase/migrations/004_quote_acceptance.sql` and validated locally (109 tests
total); **not applied to any remote Supabase project**. The payment workflow
below remains to do.

- Pago Móvil (VES) with receipt upload to a **private** Storage bucket; receipts
  are evidence, never automatic confirmation.
- Manual verification workflow (pending → in review → approved/rejected) with
  the verifying administrator recorded.
- **Implemented (OQ-17 / DECISIONS #26):** server-side quote-acceptance
  transition. The customer's explicit acceptance through the private tracking
  token is hashed (SHA-256) and resolved on the server; a service-role RPC
  writes a new fixed 20-minute deadline **once** in
  `inventory_reservations.quote_acceptance_expires_at` and copies it to the
  operative `expires_at`. The historical `initial_expires_at` stays immutable;
  administrative retries never extend the window, the correction window and
  24-hour SLA are untouched, and the operation is idempotent and audited
  (`order.quote_accept`, no PII/token in the payload). No client write path.
- Cash in USD (including "amount given" for change) and combined payments; every
  component registered individually; idempotency against duplicate payments.
- USD pricing snapshots per order: prices, subtotal, delivery, total, applied
  BCV rate, rate timestamp, VES total and rounding rule (SPEC §4).
- Out of scope for this phase: Binance Pay / Binance transfers (SPEC §5.3–5.4).

## Phase 5 — Admin panel and point of sale ⬜

- Dashboard: pending orders, receipts to review, available inventory, sales and
  recent activity.
- Walk-in sales (POS) with immediate inventory deduction; external payments
  recorded against an existing online order without duplicating the sale.
- Order and payment state transitions validated on the server (SPEC §10);
  cancellations, partial/total refunds without mutating the original payment
  record (SPEC §11–12).
- Sales history, operation history and administrative audit trail.

## Phase 6 — Realtime, communication and settings ⬜

- Supabase Realtime notifications for both administrators (new order, new
  receipt, relevant order/payment updates); database remains the source of
  truth.
- [x] **OQ-16 / DECISIONS #25 — implemented locally:** recurring receipt-review
  SLA notifications via `supabase/migrations/005_receipt_sla_notifications.sql`
  and the dedicated `supabase/worker/sla-worker.mjs`. Each receipt submission
  starts its own 24-hour clock; every active administrator gets a durable
  in-app notification on the first run after the deadline, repeated every
  15 minutes until that submission is approved/rejected. Database-level dedupe
  `(receipt_submission_id, admin_id, interval_bucket)` covers overlapping
  executions; delayed runs create only the current bucket. No order/payment/
  reservation/inventory state is written; no external provider/outbox. The one
  background worker is authorized by the OQ-16-only amendment to DECISIONS #1.
  Validated locally, not applied remotely or deployed.
- Prepared WhatsApp deep links (no WhatsApp Business API in this release).
- Store settings: business address for pickup, attention/preparation hours
  (informative, orders accepted 24/7).
- Automated BCV rate lookup with stored history and last-known-rate fallback,
  reporting its age when the service is unavailable.

## Later / not scheduled

- Whole cakes made to order (requires production on demand — the current model
  is ready-made portions only).
- Binance Pay and user-to-user transfers in USDT.
- Additional payment methods or integrations beyond those listed in SPEC.
- Public customer accounts (SPEC explicitly keeps guest checkout).

## Pending discovery (blocks specific flows, not the architecture)

From SPEC §19 — must be resolved before implementing the affected flow:

- Commercial name and visual identity.
- Final catalog, prices and photographs.
- Real Pago Móvil data; Binance identifier and modality.
- Pickup address, WhatsApp number, concrete schedules.
- How the BCV rate is queried and stored.
- Exact geographic limits of the "north zone" delivery classification.
- Operating policy for cash-on-delivery and combined payments.
- Commercial policy for orders requiring a delivery quote (reservation timing
  after fee acceptance is resolved in SPEC §6/§8 and DECISIONS #26; the
  commercial terms themselves remain open).
