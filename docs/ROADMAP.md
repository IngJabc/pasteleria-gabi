# ROADMAP

Phased plan for Pastelería Online. Everything in this document is **documented
future intent** unless the phase status says *done*. Nothing here is implemented
before its phase starts.

Status legend: ✅ done · 🚧 in progress · ⬜ not started

> **Payments Module naming:** `supabase/migrations/006_payments_and_verification.sql`
> is the Payments Module backend. Historical roadmap headings call this scope
> **Phase 4**; tasking calls it **Phase 5**. Both labels refer to the same
> scope — the old headings are kept for history and are not renamed.

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
total); **not applied to any remote Supabase project**. The Payments Module
backend is implemented additively in
`supabase/migrations/006_payments_and_verification.sql` (local-only; behaviorally
validated on a disposable local PostgreSQL cluster — validation details are in
the final implementation report). No payment/receipt UI is included; migrations
001–005 are untouched. **Not applied remotely, deployed, committed or pushed.**

**Supported methods: exactly** `pago_movil` → VES, `cash_usd` → USD,
`binance_pay` → USDT and `binance_transfer` → USDT (the two Binance modalities
of SPEC §5). No other method or currency exists. A payment is one component of
an order; an order may have several components and currencies. The
`get_order_payment_summary` RPC reports per-currency approved/pending/in_review/
rejected/refunded amounts and payment counts; raw amounts are **never** summed
across currencies. There is no authoritative conversion, cross-currency
"fully paid" decision or auto-fulfillment. Payment amounts are declared
component values that administrators verify — this is a documented gap, not a
business rule. OQ-4, OQ-5 and the Binance receipt/identifier discovery remain
OPEN.

- **Implemented in migration 006 (backend only):** Pago Móvil (VES) with
  server-validated receipt upload to the **private** `payment-receipts` bucket
  (`{order_id}/{uuid}.{ext}`); receipts are evidence, never automatic
  confirmation.
- **Implemented in migration 006:** manual verification workflow
  (pending → in review → approved/rejected) with the verifying administrator
  derived from the verified session and rechecked in every mutating RPC.
- **Implemented (OQ-17 / DECISIONS #26):** server-side quote-acceptance
  transition. The customer's explicit acceptance through the private tracking
  token is hashed (SHA-256) and resolved on the server; a service-role RPC
  writes a new fixed 20-minute deadline **once** in
  `inventory_reservations.quote_acceptance_expires_at` and copies it to the
  operative `expires_at`. The historical `initial_expires_at` stays immutable;
  administrative retries never extend the window, the correction window and
  24-hour SLA are untouched, and the operation is idempotent and audited
  (`order.quote_accept`, no PII/token in the payload). No client write path.
- **Implemented in migration 006:** cash in USD (including "amount given" for
  change) and combined payments; every component registered individually, with
  database-level UNIQUE idempotency keys against duplicate payments. Cash
  creates no receipt submission, requires no receipt and never increments
  `orders.receipt_attempts`.
- USD pricing snapshots per order: prices, subtotal, delivery, total, applied
  BCV rate, rate timestamp, VES total and rounding rule (SPEC §4) — snapshot
  columns remain from M3; the rate write path (OQ-4) and rounding rule (OQ-5)
  are still OPEN and are not defined by migration 006.
- **Implemented in migration 006:** both Binance modalities — Binance Pay and
  user-to-user transfers — each in USDT. The specific Binance identifier and
  receipt data remain an open discovery item (SPEC §19). Only two digital
  evidence submissions can exist per order because the existing order-level
  two-receipt cap still applies.
- **Implemented in migration 006:** payment verification is separate from
  order fulfillment; approving/rejecting a payment does not advance
  `orders.status`, write inventory movements, consume/release reservations or
  change `receipt_attempts`. The unchanged M3/M5 RPCs remain the only
  implementation of the two-receipt cap, the single 20-minute correction window
  and second-rejection cancellation; migration 006 calls them.

## Phase 5 — Admin panel and point of sale 🚧

**Progress:** the POS cash-sale, external-cash-registration, verification and
refund **backend** is implemented in migration 006 (local-only; no UI, no remote
apply). The admin panel/history UI remains to do. OQ-7 and OQ-11 stay OPEN.

- Dashboard: pending orders, receipts to review, available inventory, sales and
  recent activity (UI still to do).
- **Backend implemented in migration 006 (no UI):** walk-in POS cash sales as
  one `orders` row with `channel = 'pos'`, server-recomputed prices, immediate
  FIFO allocation and inventory consumption via the existing
  `consume_order_reservations` RPC, one approved cash payment component and
  idempotency by key — no duplicate inventory deduction. Admin cash
  registration against an existing online order is also implemented.
- **Backend implemented in migration 006 (no UI):** payment verification and
  append-only refund recording with idempotency by key, currency copied from
  the payment, over-refund blocked and payment status becoming
  `refunded_partial`/`refunded_full`. OQ-7 (refund method value domain) remains
  OPEN: the method is non-empty free text, no domain invented. Order state
  transitions stay in their own domain flow (SPEC §10–12).
- Sales history, operation history and administrative audit trail (UI still to
  do).

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
- Additional payment methods or integrations beyond the four already listed in
  SPEC §5 and implemented in migration 006.
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
- Still open after migration 006: OQ-7 (refund method value domain), OQ-11 (POS
  customer identity), OQ-12 (guest receipt re-view), OQ-4 (BCV rate write path)
  and OQ-5 (rounding rule), in addition to the Binance identifier/modality and
  cash-on-delivery items above. None is resolved by the payments module; no
  conversion or cross-currency "fully paid" rule was invented.
