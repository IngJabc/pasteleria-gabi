# ROADMAP

Phased plan for Pastelería Online. Everything in this document is **documented
future intent** unless the phase status says *done*. Nothing here is implemented
before its phase starts.

Status legend: ✅ done · 🚧 in progress · ⬜ not started

> **Current migration status:** all repository migrations are applied in both
> Supabase Staging and Supabase Production, including migration 005 and migration
> 015. Branch notes that say a branch did not apply migrations describe that
> branch only.

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
and **applied to the production Supabase project**. The public catalog list and
detail pages now use request-time anon reads through
`createSupabaseServerClient()` from the existing `products` and `product_images`
tables and the public `product-images` Storage bucket. This work adds no seed
data, migration, RLS or Storage policy change, and makes no remote Supabase
change. Admin auth, admin CRUD and the catalog/product seed remain pending.

- Create the Supabase project; provision environment variables (no credentials
  in source code).
- First migration: products, images, store settings; RLS policies on every
  table. ✅ `node scripts/generate-database-types.mjs` builds TypeScript types
  from all nine local migrations (plain PostgreSQL 17, no Docker or remote
  project); all three Supabase clients use a generated-derived `Database` with
  a narrow five-RPC decimal/null adapter.
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
RPCs, validated on a local PostgreSQL cluster (36 tests). That branch did not
apply migrations; current confirmed status is all migrations applied in Staging
and Production. Reservations (§6.2), checkout-time stock deduction, sale
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
at that point, 109 after Phase 4/M4 incl. M1/M2). That branch did not apply
migrations; current confirmed status is all migrations applied in Staging and
Production. The guest checkout / tracking / cancellation **UI** and the Phase 4
payment workflow remain to do. OQ-13 (quote case), OQ-14, OQ-15, **OQ-16 and
OQ-17 are all resolved in documentation** (DECISIONS #24–#26). OQ-17 is
**implemented in Phase 4** (`supabase/migrations/004_quote_acceptance.sql`): a
new fixed 20-minute acceptance window in `quote_acceptance_expires_at`, with
`initial_expires_at` immutable. OQ-16 is **implemented in Phase 6** by migration
005 and the dedicated SLA worker. Both migrations are applied in Staging and
Production. Neither changes M1/M2/M3 or their migrations.

- Guest checkout (no mandatory registration): customer name, WhatsApp phone,
  delivery/pickup, address and references, optional instructions.
- **Server-side** recalculation of subtotal, delivery fee and total; inventory
  re-check; client prices are never trusted.
- Delivery zones per SPEC §6 (north zone free, rest of city $5, outside the city
  manual quote). While the quote is pending the reservation is held with no
  automatic expiry (OQ-13); the customer's explicit acceptance of the quoted fee
  starts a new fixed 20-minute initial reservation window (OQ-17 / DECISIONS
  #26), implemented in Phase 4 by migration 004, which is applied in Staging and
  Production, with `initial_expires_at` left immutable.
- Order entity with private tracking link (random token, hash stored) so
  customers can follow their order without an account; cancellation request from
  the tracking page.

## Phase 4 — Payments 🚧

**Progress:** the OQ-17 quote-acceptance transition is implemented in
`supabase/migrations/004_quote_acceptance.sql` and validated locally (109 tests
total). The Payments Module backend is implemented additively in
`supabase/migrations/006_payments_and_verification.sql` and behaviorally validated
on a disposable local PostgreSQL cluster; validation details are in the final
implementation report. No payment/receipt UI is included; migrations 001–005 are
untouched by migration 006. Migrations 004 and 006 are applied in Staging and
Production; deployment remains pending. OQ-4/OQ-5 are implemented additively in
migration 007 (Phase 5b below).

**Supported methods: exactly** `pago_movil` → VES, `cash_usd` → USD,
`binance_pay` → USDT and `binance_transfer` → USDT (the two Binance modalities
of SPEC §5). No other method or currency exists. A payment is one component of
an order; an order may have several components and currencies. The
`get_order_payment_summary` RPC reports per-currency approved/pending/in_review/
rejected/refunded amounts and payment counts; raw amounts are **never** summed
across currencies. There is no authoritative conversion, cross-currency
"fully paid" decision or auto-fulfillment. Payment amounts are declared
component values that administrators verify — this is a documented gap, not a
business rule. OQ-4 and OQ-5 are now implemented additively in migration 007
(see the dedicated section below); the Binance receipt/identifier discovery
remains OPEN.

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
  BCV rate, rate timestamp, VES total and rounding rule (SPEC §4) — the snapshot
  columns originate in M3 and migration 006 leaves them NULL; **migration 007
  now fills them** (see the OQ-4/OQ-5 section below).
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
refund **backend** is implemented in migration 006, which is applied in Staging
and Production. The `/admin` panel now renders a POS cash-sale form and a refund
form behind a server-side active-admin session check that fails closed before any
catalog read or form renders. These forms are local code and are not deployed.
Full protected admin
shell and provisioning of the two administrators remain pending. OQ-7 was
resolved by migration 006; OQ-11 was resolved by confirmed decision #36
(anonymous in-person POS sales, no customer fields and no schema change). OQ-12
was resolved by decisions #37/#38 and implemented with a token-only server action
on the new private `/seguimiento/[token]` route: all submitted receipts, exact
300-second signed URLs, and approved/rejected payment eligibility.

- Dashboard: pending orders, receipts to review, available inventory, sales and
  recent activity (UI still to do).
- **Backend implemented in migration 006; POS UI implemented locally:** walk-in
  POS cash sales as one `orders` row with `channel = 'pos'`, server-recomputed
  prices, immediate FIFO allocation and inventory consumption via the existing
  `consume_order_reservations` RPC, one approved cash payment component and
  idempotency by key, with no duplicate inventory deduction and no customer
  name/phone/email collected (OQ-11/#36). Admin cash registration against an
  existing online order remains backend-only.
- **Backend implemented in migration 006; refund UI implemented locally in
  `/admin`:** payment verification remains backend-only. The form submits through
  a server action to the refund RPC, which records append-only rows with
  idempotency by key, currency copied from the payment and over-refund blocking.
  The RPC sets payment status to `refunded_partial`/`refunded_full`. OQ-7 was
  resolved in migration 006: SPEC §12 requires a refund-method field, but not its
  value domain. `payment_refunds.method` is non-empty free text with no
  value-domain CHECK or invented value list. By contrast, `payments.method` is
  constrained to `pago_movil`, `cash_usd`, `binance_pay` and `binance_transfer`.
  Order state transitions stay in their own domain flow (SPEC §10–12).
- Sales history, operation history and administrative audit trail (UI still to
  do).

## Phase 5b — BCV rates and monetary rounding (OQ-4 / OQ-5) ✅ (backend)

**Progress:** implemented additively in `supabase/migrations/007_bcv_rates_and_rounding.sql`
with no UI. Migration 007 is applied in Staging and Production; deployment
remains pending. Migration 006 is the local validation baseline; 007 is the next
migration and rewrites nothing earlier.

- **Backend implemented in migration 007 (no UI):** manual BCV rate
  administration through service-role RPCs (`register_bcv_rate`,
  `deactivate_bcv_rate`) fed by server actions. Rates are append-only history
  with `is_active`; a correction deactivates the old row and inserts a new one
  referencing it via `supersedes_id`. Registration validates a positive rate
  (≤ 4 decimals), a non-empty source, an active session-derived administrator,
  and an idempotency key; all mutations write `audit_log` rows and use
  `private.require_active_admin` — clients never send an admin id.
- **Backend implemented in migration 007:** rate reads (`get_bcv_rate`,
  `get_last_ves_per_usd`) return the latest **active** rate at or before a point
  in time with its source, timestamp, `age_seconds` and `is_stale`. If no active
  rate exists, snapshotting **fails explicitly** — no unknown or invented rate,
  no last-known fallback that pretends to be current.
- **Backend implemented in migration 007:** per-order snapshot
  (`apply_bcv_rate_for_tracking` for the guest via the hashed tracking token,
  `apply_bcv_rate_to_order` for an administrator). These remain service-role-only
  manual/legacy tools for orders that predate 007; the exact rate and its own
  `observed_at` are stored on the order and an existing snapshot is never
  overwritten, so later corrections cannot rewrite history.
- **Canonical atomic checkout (focused integration audit):** `create_online_order_with_bcv`
  invokes the unchanged `create_online_order` and resolves/writes the BCV snapshot
  in the **same PostgreSQL transaction**. No client-supplied rate or timestamp is
  accepted. With no active rate the order is still created with all four BCV
  fields NULL (USD-only flow); a snapshot failure rolls back the order and its
  reservations. The legacy wrappers are never used by this path.
- **Pago Móvil enforcement (database trigger):** a VES payment cannot be registered
  unless the order has a complete BCV snapshot (`bcv_rate_ves`, `bcv_rate_at`,
  `total_ves`, `rounding_rule = 'round_half_up'`). Covers guest, admin, direct-RPC
  and POS entry points; USD/USDT flows are unaffected. A table-level immutability
  trigger also blocks even privileged direct updates to an existing snapshot.
- **OQ-5 rounding:** `round_half_up` (half away from zero) applied **once** to
  the final VES total; recorded on each snapped order via
  `orders.rounding_rule`. No intermediate per-item rounding; declared payment
  amounts keep at most 2 decimals; the BCV rate keeps 4. No cross-currency sum,
  cross-currency "fully paid" state or automatic fulfillment is introduced.
- Automatic BCV API ingestion / worker is **not** implemented or assumed; it is
  a separate future path that can reuse `register_bcv_rate` with a machine
  `source`. No network call, credential, cron or secret was added.
- Validated locally (disposable local PostgreSQL 001–007, static contract and
  server-action suites). Migration 007 is applied in Staging and Production;
  deployment remains pending.
- The stale-rate maximum age remains an **unresolved business decision**:
  `is_stale` is informational only, no threshold is invented or enforced.

## Phase 9 — Public product reviews 🔜

- Local implementation on `features/product-reviews` (no PR/merge). Migration `014_product_reviews.sql` is additive and applied in Staging and Production.
- Public reviews: no registration/login, optional name, required product/rating/comment, published immediately; admin hide/restore with audit log.
- Verified reviews: tracking-token contextual path only; DB enforces one verified review per product per order.
- Ranking: Bayesian weighted rating `WR=(v/(v+m))*R+(m/(v+m))*C`, `C=4.0`, `m=5`; no fabricated ratings.
- Realtime: review tables added to publication; client subscriptions refresh/reconcile with RLS as authorization boundary.
- Blocked: PR creation (`gh` unavailable) and production Realtime validation. The migration 014 prerequisite is complete.

## Phase 6 — Realtime, communication and settings ⬜

### OQ-16 — SLA receipt-review notifications (migration prerequisite complete, activation pending)

- [x] **Implemented locally; migration applied in Staging and Production:**
  migration `005_receipt_sla_notifications.sql` + `supabase/worker/sla-worker.mjs`
  (DECISIONS #25, amendment to #1). Each receipt submission starts its own 24-hour
  clock; every active administrator gets a durable in-app notification on the first
  run after the deadline, repeated every 15 minutes until that submission is
  approved/rejected. DB dedupe `(receipt_submission_id, admin_id, interval_bucket)`.
  SLA processing writes no order/payment/reservation/inventory state.
  Implementation report (local): 39 files / 396 tests PASS; typecheck PASS;
  build PASS; `git diff --check` PASS.
- [ ] **Operationalization / activation pending (documentation only; no remote
  action performed):** OQ-16 migration prerequisite complete: migration 005
  applied in Staging and Production. Use the
  **existing `pasteleria-bcv-worker` Render Web Service** with unified runtime
  (no new Render service/Background Worker); configure required env vars
  (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; optional
  `SLA_POLL_MS`, `SLA_SHUTDOWN_TIMEOUT_MS`, `BCV_SYNC_FETCH_TIMEOUT_MS`,
  `BCV_SYNC_SHUTDOWN_TIMEOUT_MS`); verify startup + 15-min cycle and
  `process_sla_notifications` RPC metrics; validate both active admins receive rows,
  unread counter, and mark-as-read behavior; document logs/monitoring/failure
  handling/operational verification. Deployment, production activation and runtime
  validation remain pending.

### Phase 6 — General Admin Notifications (architecture defined/planned, implementation pending)

- [ ] **Independent general notification feature (separate from OQ-16 SLA):**
  in-panel notifications for both active administrators, DB as source of truth,
  Supabase Realtime updates. OQ-16 table/RPC/worker/behavior remain isolated;
  general events must not be forced into SLA schema.
- **Events:** new order; new payment receipt; corrected/resubmitted payment
  receipt; new customer review.
- **Behavior:** unread counter; notifications list/history; navigate to related
  order/payment/review; mark one as read; mark all as read; dedupe/idempotency;
  both active admins receive relevant notifications; realtime updates without
  refresh.
- **Exclusions:** no customer-facing notifications; no email; no WhatsApp; no BCV
  worker changes; no OQ-16 behavior changes.
- **Unresolved before implementation:** data model (extend/generalize
  `admin_notifications` vs separate table), per-event dedupe keys, write path
  (trigger/RPC/server action, atomicity), Realtime publication/RLS/replica
  identity impact, mark-all-read authorization boundary, navigation contract. See
  DECISIONS #40 and TASKS “Phase 6 — General Admin Notifications”.
- [x] **Supabase Realtime publication — backend implemented locally:** additive
  migration `008_realtime_publication.sql` adds the existing `orders`, `payments`
  and `cancellation_requests` tables to the managed `supabase_realtime`
  publication, repeating safely without duplicate membership. RLS, grants and
  replica identity are unchanged: these tables stay force-RLS with an
  admin-only `authenticated` policy, so anon/non-admin clients receive no
  protected rows; `REPLICA IDENTITY FULL` is not used because the policies do
  not depend on row values. No frontend subscriptions were added.
- [x] **OQ-16 / DECISIONS #25 — implemented locally:** recurring receipt-review
  SLA notifications via `supabase/migrations/005_receipt_sla_notifications.sql`
  and the dedicated `supabase/worker/sla-worker.mjs`. Each receipt submission
  starts its own 24-hour clock; every active administrator gets a durable
  in-app notification on the first run after the deadline, repeated every
  15 minutes until that submission is approved/rejected. Database-level dedupe
  `(receipt_submission_id, admin_id, interval_bucket)` covers overlapping
  executions; delayed runs create only the current bucket. No order/payment/
  reservation/inventory state is written; no external provider/outbox. The
  OQ-16 scheduled worker is authorized by the OQ-16-only amendment to DECISIONS
  #1 and now runs in the unified runtime.
  Validated locally; migration 005 is applied in Staging and Production. Integrated
  into the unified local runtime for the existing Render Web Service;
  deployment/activation remains pending.
- Prepared WhatsApp deep links (no WhatsApp Business API in this release).
- [x] **OQ-8 — store settings schedule structure — backend implemented locally:**
      additive migration `009_store_settings_schedule.sql` defines and validates
      the `store_settings.business_hours` JSONB contract without creating a new
      table or seeding data. It stores `timezone: "America/Caracas"`, weekly
      `attention` and `pickup` schedules with closed days (`[]`) and multiple
      non-overlapping intervals per day, all HH24:MI. The existing
      `pickup_address` text column is reused unchanged. Schedules are
      **informational only**: orders stay 24/7 and nothing in checkout, payment,
      inventory or reservations reads them. An admin server action with Zod
      validation writes the singleton; RLS, grants and policies are unchanged.
      No real address or hours were invented.
- [ ] **BCV automatic synchronization (audit/hardening completed, local, not deployed)**
  on branch `features/bcv-exchange-rate`. Additive migration
  `015_bcv_sync_attempts.sql` records durable sync attempts/status for admin
  visibility. Independent worker `supabase/worker/bcv-rate-worker.mjs` runs
  Mon–Fri 09:00/13:00 `America/Caracas`, fetches BCV Today server-side, validates
  defensively, registers through existing `register_bcv_rate`, and never
  replaces/deactivates last valid rate on failure. Manual registration remains
  intact.
  - **Audit fixes applied locally:** slot-scoped attempt idempotency
    (`buildAttemptIdempotencyKey = bcv-sync:<source>:<slot>:<effectiveDate>`)
    keeps attempts independently recorded while rate idempotency
    (`buildRateIdempotencyKey = bcv-rate:<source>:<effectiveDate>:<rate>`)
    prevents duplicate `exchange_rates` history rows for same effective date+rate
    across slots; attempt-persist-after-register failure is reported as
    `manual_overridden` without re-registering; automatic null-admin RPC path is
    restricted to `service_role` + `automatic:%` source + `p_supersedes_id IS NULL`.
    Manual admin path fully preserved via `private.require_active_admin`. Remaining
    audit: restart/host-TZ deep check.
  - **Render Free Web Service adaptation (local, branch `features/bcv-render-web-service`):**
    worker can bind `0.0.0.0:$PORT` and expose `GET /healthz` (minimal
    non-sensitive JSON) for Render Free Web Service health checks. HTTP requests
    never trigger sync. Scheduler and health server run concurrently; shutdown
    closes HTTP server and worker resources cleanly.
  - **Unified runtime (local, this branch):** `supabase/worker/runtime.mjs`
    (`npm run worker:unified`) hosts BCV + OQ-16 in the same Render Web Service
    process with one health server. Migrations 015 and 005 are applied in Staging
    and Production. Start command to use on the existing service:
    `node supabase/worker/runtime.mjs`. One service/process/port/endpoint; workers
    start independently with failure isolation and idempotent shutdown. **Free
    limitation:** sleeping instances can miss fixed Caracas slots and 15-min SLA
    cycles; missed cycles are intentionally not replayed. No Render
    resources/deploy performed.

## Developer automation: autonomous OpenCode workflow (complete)

Reusable `/autopilot` orchestration is implemented as project-local OpenCode V2
configuration: a primary `project-orchestrator`, six specialized subagents,
a documented skill catalog and an operational manual. One invocation inspects
Git/GitHub state, protects user work, verifies the previous PR is merged (or
recovers interrupted work), syncs `main`, creates a scoped `features/...`
branch, selects the next eligible `TASKS.md`/roadmap item, routes relevant
installed skills, delegates implementation and independent review, validates,
documents, commits, pushes the feature branch to the verified remote and opens a
PR against canonical `main`. It stops at the human merge checkpoint. See
`docs/AUTONOMOUS_WORKFLOW.md` and `docs/skills-catalog.md`. No bakery feature
task, migration, deployment or remote environment change is part of this work.

Delivery: branch `features/autonomous-opencode-workflow`, commit
`ff2f9840f83c58b90c48873f2e04543df557272b`, [PR #10](https://github.com/IngJabc/pasteleria-gabi/pull/10)
merged into `main` as `ca4357163c954afeea1e0fe288232f3936d7f4db` on
`2026-11-21T05:13:59Z`.

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
- Concrete pickup address, WhatsApp number and actual business hours (the
  `business_hours` JSONB structure is resolved by migration 009 / DECISIONS #35;
  only the real values remain business data to configure).
- How the BCV rate is queried and stored (manual administration implemented in
  migration 007; the automatic provider lookup remains a future item).
- Exact geographic limits of the "north zone" delivery classification.
- Operating policy for cash-on-delivery and combined payments.
- Commercial policy for orders requiring a delivery quote (reservation timing
  after fee acceptance is resolved in SPEC §6/§8 and DECISIONS #26; the
  commercial terms themselves remain open).
- Still open after the payments module: the Binance identifier/modality and
  cash-on-delivery items above. OQ-11 was resolved by confirmed decision #36:
  in-person POS sales paid at the time of sale are anonymous, with no customer
  name, phone or email and no schema change. OQ-12 was resolved by #37/#38 and
  implemented on the private `/seguimiento/[token]` route: all receipts, exact
  300-second signed URLs and approved/rejected payment eligibility. OQ-7 was
  resolved by migration 006: SPEC §12 requires a refund-method field, not a
  value domain, so `payment_refunds.method` is non-empty free text with no
  invented value-domain CHECK; `payments.method` remains separately constrained.
  No conversion or cross-currency "fully paid" rule was invented. OQ-4 (BCV rate
  write path) and OQ-5 (rounding rule) were resolved by migration 007 (Phase 5b);
  OQ-8 (schedule structure) was resolved by migration 009 (Phase 6).


## Frontend UX/UI — Storefront implementation 🚧

**Progress:** implemented locally on `features/frontend-ux-ui` (from `4f3849ac`, PR #15 merge). No commit, push, merge, remote migration, deployment, or secret change performed.

- **Storefront UI implemented from supplied PNG references:** Design System + 9 desktop + 9 mobile storefront screens were analyzed. Sampled design tokens were documented in `src/app/globals.css` (Dulce Atelier, Nunito + DM Sans, spacing/radius/shadow/focus/reduced-motion). Shared primitives/layout/components were added under `src/components/ui`, `src/components/layout`, and storefront routes.
- **Routes/screens:** `/`, `/productos`, `/productos/[slug]`, `/carrito`, `/checkout/entrega`, `/checkout/pago`, `/seguimiento`, `/seguimiento/[token]`.
- **Backend wiring:** existing catalog queries, service-role `get_product_stock` read path, active delivery zones/store settings, `create_online_order_with_bcv`, `registerDigitalPaymentWithReceipt`, payment summary/BCV rate reads, quote acceptance, cancellation, and token-authorized receipt review. No mock backend substitutions.
- **Boundaries:** cart is local (`localStorage` + `useSyncExternalStore`) and has no price/inventory authority; server paths revalidate. Checkout tracking token is kept only in an `httpOnly` short-lived cookie during payment handoff, never exposed in URL/client-readable field; successful payment clears cookie and redirects to private tracking. Category tabs are visual only where schema lacks categories; non-“Todas” shows honest empty state.
- **Admin phase delivered locally:** the 10 admin PNG references were received (delivered twice) and treated as the visual source of truth, clearing the earlier design blocker. The admin UI follows those mockups: sidebar "dulce atelier" with 10 nav items, topbar "EL ATELIER / ADMIN" with alerts pill and neutral user chip, cream rounded content panel, pastel stat cards, white surfaces, status chips, semantic tables, receipt/dropzone-styled forms and a neutral footer. Fictional mockup values were not hardcoded; real backend data and honest unavailable/empty states are used. The alerts pill count comes from real `admin_notifications` rows via `getUnreadAdminNotificationCount()` and is omitted when unavailable or zero.
- **Admin routes (11, all implemented locally):** `/admin` (Resumen dashboard), `/admin/pedidos`, `/admin/pedidos/[id]`, `/admin/pedidos/detalle` (sidebar helper), `/admin/comprobantes`, `/admin/pagos/externo`, `/admin/productos` (existing CRUD restyled), `/admin/inventario`, `/admin/punto-de-venta`, `/admin/cancelaciones` and `/admin/configuracion`.
- **Admin foundation and layers:** `src/components/admin/` (`admin-shell`, `admin-sidebar`, `admin-ui`), the `src/app/(admin)/admin/layout.tsx` fail-closed gate (`instant = false`, `noindex`, real alert count), additive `admin-*` CSS in `src/app/globals.css`, 14 admin SVG icons, and a server read/helper layer in `src/features/admin/` (`format`, `overview`, `orders`, `notifications`, `cancellations`, `receipts`, `inventory`, `settings-read`, `refunds-read`). Every helper gates with `requireActiveAdminId()`; it uses the session client for RLS tables and service-role only for `get_product_stock`, with graceful Spanish `unavailable` results and no raw database errors. New client components live under `src/features/admin/components/payments/` and `src/features/admin/components/ops/`.
- **Real wiring, no mock substitutions:** receipt approve/reject reuses `reviewPayment`; external cash payment reuses `registerCashPayment`; inventory create/adjust wraps the existing inventory RPCs through the session client; POS reuses `registerPosCashSale`; refunds reuse `recordPaymentRefund`; products reuse existing CRUD; settings reads real zones/settings/BCV. Receipt images use 300-second server-minted signed URLs (`RECEIPT_REVIEW_URL_LIFETIME_SECONDS`); the receipt path never crosses to the client.
- **Honest-unavailable scope (no fake or mock data):** admin orders list, dashboard KPI reads, receipt pending queue read, admin cancellation approval (no RPC/business rule), Binance/external digital payments with receipt in admin, combined POS payments, delivery-zone CRUD, payment-method toggles, reserve policy, admin-team CRUD, settings editing, and notification mark-as-read (wired but not exposed as a control). Inventory reservation expiry dates are unavailable in the read model.
- **Validation (2026-11-22, after the final admin edits):** `npm.cmd run typecheck` PASS; `npm.cmd run lint` PASS (0 errors, 2 pre-existing warnings in `src/infrastructure/database/quote-acceptance-migration.test.ts`); `npm.cmd run build` PASS (Next 16.4.6 Turbopack, 22 pages; 11 admin routes dynamic); `npm.cmd run test` PASS (32 files, 341 tests, up from 29 files / 331 tests); `git diff --check` clean. No commit, push, merge or PR was created.

**Blocked / pending:**

- **B2** — administrator emails/Auth provisioning external dependency; no accounts/credentials invented.
- **B3** — final catalog/seed/photographs/business content external dependency; realistic empty states used where unavailable.

Current confirmed status: all repository migrations, including 014 and 015, are
applied in Staging and Production. Admin reads still show honest unavailable
states where runtime or business data is missing. No Render deployment was
performed.
