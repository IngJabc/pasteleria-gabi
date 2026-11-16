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
`supabase/migrations/` and validated locally; **it has not been applied
anywhere** — applying it requires a Supabase project (TASKS B1). The remaining
items below are not started.

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

## Phase 2 — Inventory ⬜

- Batches (product, initial/remaining quantity, production date, responsible
  admin), FIFO allocation, stock movements (entries, sales, adjustments) with
  audit fields.
- Online orders reserve stock atomically (20-minute initial expiry plus a
  15-minute receipt-correction window — DECISIONS #24; idempotent operations,
  PostgreSQL functions/RPC for critical paths).
- Admin screens for batches, movements and adjustments (production date is
  administrative only and never shown in the store).

## Phase 3 — Checkout, orders and tracking ⬜

- Guest checkout (no mandatory registration): customer name, WhatsApp phone,
  delivery/pickup, address and references, optional instructions.
- **Server-side** recalculation of subtotal, delivery fee and total; inventory
  re-check; client prices are never trusted.
- Delivery zones per SPEC §6 (north zone free, rest of city $5, outside the city
  manual quote — reservation timing while a quote is pending is OQ-13).
- Order entity with private tracking link (random token, hash stored) so
  customers can follow their order without an account; cancellation request from
  the tracking page.

## Phase 4 — Payments ⬜

- Pago Móvil (VES) with receipt upload to a **private** Storage bucket; receipts
  are evidence, never automatic confirmation.
- Manual verification workflow (pending → in review → approved/rejected) with
  the verifying administrator recorded.
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
- Commercial policy for orders requiring a delivery quote.
