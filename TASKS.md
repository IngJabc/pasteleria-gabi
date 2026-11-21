# TASKS

Living checklist. Update the status when a task is actually completed and
verified — never mark a task done without running its validation.

> **Payments Module naming:** migration `006_payments_and_verification.sql` is
> the Payments Module backend. Some historical task sections call it
> **Phase 4**; the roadmap/tasking label for the same scope is **Phase 5**.
> Both labels refer to the same work; historical headings are kept as written.

---

## Phase 0 — Project initialization ✅ (complete)

Setup:

- [x] Initialize the Next.js application in the current directory (Next.js
      16.4.6, App Router, `src/` directory) — `create-next-app` with TypeScript,
      Tailwind CSS, ESLint.
- [x] Configure TypeScript strict mode (`tsconfig.json` → `"strict": true`).
- [x] Configure Tailwind CSS (v4, Turbopack loader in `next.config.ts`).
- [x] Configure ESLint (flat config, `eslint-config-next` core-web-vitals +
      TypeScript).
- [x] Install Supabase packages: `@supabase/supabase-js`, `@supabase/ssr` —
      client modules prepared, **no remote project connected**.
- [x] Install `zod` (validation) and `server-only` (service-role guard).

Structure:

- [x] Application routes: `src/app` with `(storefront)` and `(admin)/admin`
      route groups (placeholder pages only, no business features).
- [x] Shared components: `src/components` (+ README).
- [x] Features/modules: `src/features` (+ README listing planned modules).
- [x] Domain types and business rules: `src/domain` (+ README; no rules
      invented yet).
- [x] Infrastructure and external services: `src/infrastructure` (Supabase
      browser/server/service-role clients, Zod-validated environment).
- [x] Validation schemas: `src/validation` (+ README).
- [x] Testing utilities: `src/test` (+ README).

Testing and tooling:

- [x] Configure Vitest (`vitest.config.mts`, `@` alias, node environment,
      `npm test` / `npm run test:watch`, `npm run typecheck` script).
- [x] Create a basic working test: `src/infrastructure/env.test.ts`
      (6 assertions: valid input, missing variable, invalid URL, empty key,
      fail-fast in `process.env`, read-back).

Documentation and configuration:

- [x] Add `.env.example` with documented variable names (placeholders only, no
      credentials) and un-ignore it in `.gitignore`.
- [x] Add `README.md` (installation, development, testing, deployment).
- [x] Add `docs/ROADMAP.md`.
- [x] Add `docs/ARCHITECTURE.md`.
- [x] Add `docs/DECISIONS.md`.
- [x] Add this `TASKS.md`.

Validation (Phase 0):

- [x] `npm test` — **1 test file, 6 tests passed**.
- [x] `npm run lint` — **clean (exit 0)**; verified the script really discovers
      files using a temporary file with a deliberate parsing error (flagged,
      exit 1), then re-ran clean after removal.
- [x] `npx tsc --noEmit` — **clean (exit 0)** (run after `npm run build` so the
      generated route types exist).
- [x] `npm run build` — **successful**; routes `/` and `/admin` prerendered as
      static, TypeScript passed inside the build.
- [x] Inspected final project structure and configuration.

Explicitly NOT done in Phase 0 (per instructions):

- [ ] Business features (catalog, cart, checkout, payments, inventory, order
      management, authentication flows).
- [ ] Database migrations or any invented schema.
- [ ] Connection to a remote Supabase project.
- [ ] Recreating Figma screens.
- [ ] Any commit or push.

---

## Phase 1A — Database architecture & security design ✅ (complete)

Design only — no SQL was written to any database (none exists yet):

- [x] Re-read `SPEC.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`,
      `docs/DECISIONS.md` and inspected the current source tree before designing.
- [x] Add `docs/DATABASE_DESIGN.md`: 15 proposed tables across catalog,
      configuration, identity, inventory, checkout/orders, payments,
      cancellations, exchange rates and audit — with columns, types,
      constraints, indexes, relationships, derived-data/function inventory, the
      status-value mapping, an ER diagram (Mermaid), whole-cake extensibility
      notes and open questions OQ-1…OQ-12.
- [x] Add `docs/SECURITY_DESIGN.md`: Postgres roles, the `administrators`
      authorization model (never `user_metadata`), full RLS access matrix with
      proposed policies, function `EXECUTE` grants, both storage buckets and
      their proposed policies, private tracking-link design, server-side
      validation invariants, the SPEC §16 → design mapping and a verification
      plan.
- [x] Update `docs/DECISIONS.md` with decisions #12–#23 (schema conventions,
      authorization source, no customers table, client-side cart, unified
      orders channel, hashed tracking tokens, inventory/lazy expiry, inline
      financial snapshots, storage flows, append-only audit, settings
      singleton, domain-layer state machines).
- [x] Update `TASKS.md` (this section) and the README documentation table.

Validation (Phase 1A):

- [x] `npm test` — **1 test file, 6 tests passed**.
- [x] `npm run lint` — **clean (exit 0)**.
- [x] `npx tsc --noEmit` — **clean (exit 0)**.
- [x] `npm run build` — **successful**; `/` and `/admin` static.

Explicitly NOT done in Phase 1A (per instructions):

- [ ] SQL migrations or any applied schema/policies.
- [ ] Connecting to Supabase (nothing remote exists or was modified).
- [ ] Application features, dependency installs, commits or pushes.

---

## Phase 1A.1 — Inventory reservation lifecycle correction ✅ (complete)

Documentation-only correction against the business rules known at that time:
initial reservation **20 minutes**; rejected receipt → **one additional
15-minute** correction window; the **24-hour** figure is the administrators'
operational processing deadline, **not** a reservation duration.

> **Amendment (M3 reservation/payment-attempt correction, 2026-11-20):** the
> confirmed rules supersede the 15-minute figure above — the single correction
> window is now **20 minutes**, at most **two receipts** are allowed, and a
> **second rejection auto-cancels** the order. See the M3 correction entry
> below and `docs/DATABASE_DESIGN.md` §6.2/§14.

- [x] Review `SPEC.md`, `docs/DATABASE_DESIGN.md`, `docs/SECURITY_DESIGN.md`,
      `docs/DECISIONS.md`, `TASKS.md` and grep the whole tree for stale
      24-hour reservation claims.
- [x] Correct `SPEC.md`: §5 quote-pending orders no longer claim a 24-hour
      reservation; §8 "Reservas" now states the 20-minute initial expiry, the
      15-minute correction window, that a rejection does **not** release
      inventory, and that release happens on cancel/expire; §14 labels the
      24-hour figure explicitly as an operational (non-reservation) deadline.
- [x] Rewrite `docs/DATABASE_DESIGN.md` §6.2: `initial_expires_at`
      (immutable, +20 min) + `correction_window_ends_at` (set once, +15 min
      after rejection) + nullable operative `expires_at` (`NULL` = held);
      availability rule for held/expired reservations; lazy expiry that never
      touches `remaining_quantity`; rejection-never-releases rule; bounded
      single correction window; event → reservation → payment → order
      consistency table; `status` CHECK gains `expired`.
- [x] Update the Mermaid ER diagram (`inventory_reservations` attributes) —
      re-rendered and verified: `RENDER_OK nodes=15`, no console errors.
- [x] Update `docs/DATABASE_DESIGN.md` §7.1 (`pending → expired` tied to the
      reservation deadline; 24 h documented as a dashboard SLA, not a column),
      §11 (`create_online_order`/`release_expired_reservations` descriptions)
      and §14 (new open questions **OQ-13…OQ-16**).
- [x] Update `docs/SECURITY_DESIGN.md` §8: reservation timing windows are
      written only by server-side RPCs; availability wording matches §6.2.
- [x] Update `docs/ROADMAP.md` Phase 2 and Phase 3 (both 24-hour claims
      removed).
- [x] Update `docs/DECISIONS.md`: intro credits #24 to Phase 1A.1, #18
      context corrected, new decision **#24** (20 min + one 15 min window,
      hold semantics, bounded rejections, SLA out of the schema).
- [x] Update `TASKS.md` (this section, Phase 1B open-question list, and
      migration order): `inventory_reservations` moved from **M2 → M3** —
      its FK references `orders`, which only exists from M3 (pre-existing
      ordering bug found during this review).

Validation (Phase 1A.1):

- [x] `npm test` — **1 test file, 6 tests passed**.
- [x] `npm run lint` — **clean (exit 0)**.
- [x] `npm run build` — **successful**; `/` and `/admin` static.
- [x] `npx tsc --noEmit` — **clean (exit 0)** (run after the build).
- [x] Diff reviewed: only `SPEC.md`, `TASKS.md`, `docs/DECISIONS.md`,
      `docs/ROADMAP.md`, `docs/DATABASE_DESIGN.md`, `docs/SECURITY_DESIGN.md`
      changed (README.md's +2 lines are the still-uncommitted Phase 1A table
      rows); no source, config or dependency changes.

Explicitly NOT done in Phase 1A.1 (per instructions):

- [ ] SQL migrations or SQL files of any kind.
- [ ] Connecting to Supabase.
- [ ] Application features, dependency installs, commits or pushes.

Open questions introduced by this correction (see `docs/DATABASE_DESIGN.md`
§14): OQ-13 clock behavior for cash/quote orders · OQ-14 confirm the
single-window repeat-rejection policy · OQ-15 confirm hold-while-under-review ·
OQ-16 how (or whether) the 24-hour admin SLA is enforced.

**Later status:** OQ-13 (quote case), OQ-14, OQ-15, OQ-16 and OQ-17 are all
**resolved in documentation** — OQ-16 by DECISIONS #25 (notification-only 24 h
review SLA) and OQ-17 by DECISIONS #26 (new 20-minute reservation window on
explicit acceptance of the quoted fee). OQ-17 is **implemented and validated
locally in Phase 4** (`supabase/migrations/004_quote_acceptance.sql`); OQ-16 is
**implemented and validated locally in Phase 6** (`005_receipt_sla_notifications.sql`
plus `supabase/worker/sla-worker.mjs`). Neither is applied remotely.

---

## Phase 1B — Migrations, catalog and admin access 🚧

**Progress:** M1 is implemented, validated and applied to production (see the
implementation order below); the catalog pages, admin auth and admin CRUD
items further down have not started.

**Genuine blockers** (cannot be resolved by engineering work alone):

| # | Blocker | Needed for | Owner |
| --- | --- | --- | --- |
| B1 | ~~A Supabase project must exist and `.env.local` must be filled (account + credentials)~~ — **resolved: the project exists and M1 has been applied to it**; `.env.local` still needs filling for type generation/auth | Applying *any* migration, generating types, auth | User / project owner |
| B2 | E-mail addresses of the two administrators (OQ-1 — not covered by SPEC) | Seeding `administrators` + creating auth accounts | Business owner |
| B3 | Final catalog: product names, descriptions, prices, photographs (OQ-2, SPEC §19) | Seeding `products` (schema itself is *not* blocked) | Business owner |
| B4 | Visual identity decision (SPEC §19) — only for final UI copy/branding, not for schema | Storefront presentation | Business owner |

Not blocking Phase 1B (tracked for later phases): OQ-3 delivery-zone boundaries
(affects zone *content*), OQ-4/OQ-5 BCV rate source and rounding rule
(Phase 5b), OQ-6 Pago Móvil data (Phase 4), OQ-8 schedules (Phase 6) and
OQ-9/OQ-10 confirmations at their phase. OQ-7 was resolved by migration
006 (non-empty free-text refund method; no value domain invented), OQ-11 by
confirmed decision #36 (anonymous in-person POS sales; no schema change), and
OQ-12 by decisions #37/#38 (token-only guest receipt re-view, all receipts,
300-second URLs and approved/rejected eligibility).
OQ-13 (quote case), OQ-14, OQ-15, OQ-16 and OQ-17 are resolved as rules
(see `docs/DATABASE_DESIGN.md` §14); OQ-16 and OQ-17 are also implemented
locally in Phases 6 and 4 respectively. **OQ-4 and OQ-5 were subsequently
resolved and implemented locally in Phase 5b (migration 007).**

Implementation order (each migration ships with its RLS policies; design source:
`docs/DATABASE_DESIGN.md`, policies: `docs/SECURITY_DESIGN.md`):

- [x] **M1 (Phase 1):** extensions + `products`, `product_images`,
      `store_settings`, `delivery_zones`, `administrators`, `audit_log` +
      RLS/forces + seeds (settings row + the three SPEC §6 zones, fees
      confirmed: free / $5 / manual quote) + `product-images` public bucket
      and its three admin write policies — implemented in
      `supabase/migrations/001_catalog_and_admin_foundation.sql` (renamed from
      `20261114023000_m1_…` when the PR merged).
      **Applied to the production Supabase project (local ↔ remote
      synchronized).** Products and administrators are deliberately not
      seeded (B2/B3 — no confirmed data).
- [x] **M2 (Phase 2):** `inventory_batches`, `inventory_movements` + RLS +
      entry/adjustment RPCs (`create_inventory_batch`, `adjust_inventory`,
      `get_product_stock`) — implemented in
      `supabase/migrations/002_inventory_foundation.sql`, validated on a
      disposable local PostgreSQL cluster (behavioral + contract tests).
      **Not applied to any remote project.** Scope notes: `order_id` and sale
      movements are deferred to M3 (no `orders` table yet);
      `inventory_reservations` and all timing logic (20 min initial / 20 min correction / 24 h admin SLA)
      are **not** here — the reservations FK references `orders`.
      OQ-9 stays open — `inventory_movements.admin_id` is nullable per design
      §6.3 but migration 002 always writes it (null = system semantics not
      confirmed); no admin UI in M2.
- [x] **M3 (Phase 3):** `orders`, `order_items`, `inventory_reservations`,
      `cancellation_requests`, `exchange_rates` + tracking-token hashing +
      checkout/tracking RPCs — implemented in
      `supabase/migrations/003_orders_and_reservations.sql`, validated on a
      disposable local PostgreSQL cluster (behavioral + contract tests).
      **Not applied to any remote project.** Scope notes: 8 service-role-only
      RPCs (`create_online_order`, `hold_order_reservations`,
      `open_order_correction_window`, `release_expired_reservations`,
      `consume_order_reservations`, `release_order_reservations`,
      `get_order_for_tracking`, `request_order_cancellation`) plus the
      documented §11 replacement of `get_product_stock` (availability now
      subtracts active, unexpired reservations). `inventory_movements.order_id`
      FK/index added with `orders`. No payments/receipts/tracking UI (M4+),
      no audit_log rows (no administrative action exists yet — M4 writes
      `payment.verify`), no 24-hour SLA in the M3 schema (DECISIONS #24); OQ-16 is
      resolved as notification-only by DECISIONS #25 and implemented later in
      migration 005 with dedicated history/inbox tables, without changing M3.
      OQ-9 is exercised by `sale` movements
      (`admin_id` NULL = system) but stays open; OQ-4/OQ-5 unchanged.
- [x] **M3 reservation/payment-attempt correction (in place within M3):** applied
      directly to `003_orders_and_reservations.sql` per the
      confirmed rules: 20-minute initial deadline; receipt submitted → held
      during admin review; at most **two receipts total** with **one 20-minute
      correction window**; second rejection auto-cancels the order and releases
      every active reservation (no movement, no physical-stock change);
      quote-pending deliveries stay reserved from creation. Implemented via
      `orders.receipt_attempts INTEGER NOT NULL DEFAULT 0 CHECK (0..2)`,
      guarded atomic increment in `hold_order_reservations` and the
      attempts-aware `open_order_correction_window`. Resolves OQ-13 (quote
      case), OQ-14 and OQ-15; OQ-17 was raised here, resolved by DECISIONS #26
      and implemented separately in Phase 4 by migration
      `004_quote_acceptance.sql`. Migrations 001/002/003 untouched by the M4
      work.
- [x] **M4 / Phase 4 — OQ-17 quote-acceptance transition:** implemented in
      `supabase/migrations/004_quote_acceptance.sql` (validated locally, **not
      applied remotely**): `orders.quote_accepted_at` and
      `inventory_reservations.quote_acceptance_expires_at` (new fixed
      20-minute window copied to the operative `expires_at`), with the
      historical `initial_expires_at` left **immutable**; service-role RPCs
      `accept_quote_fee` (internal) and `accept_quote_fee_for_tracking` (the
      customer's only entry point, resolving the SHA-256 hash of the private
      tracking token), reservations → orders locking, idempotent replay with no
      revival of closed reservations, one `order.quote_accept` audit row per
      first acceptance in the same transaction, and an extended PII-free
      tracking projection. The server action
      `src/features/orders/accept-quote.ts` only validates a 64-hex token and
      calls that RPC; it accepts no order id and writes no tables directly.
      No admin-retry extension, no change to the correction window or the
      24-hour SLA.
- [x] **M4 / Phase 4–5 — Payments Module backend:** implemented additively in
      `supabase/migrations/006_payments_and_verification.sql` (local-only;
      behaviorally validated on a disposable local PostgreSQL cluster — see the
      final implementation report for details; **not applied remotely,
      deployed, committed or pushed**). Adds `public.payments`,
      `public.payment_refunds`, `receipt_submissions.payment_id`, indexes, RLS
      and least-privilege grants, a private `payment-receipts` storage bucket
      with admin SELECT only, audit integration, a `private.require_active_admin`
      guard and service-role RPCs. Migrations 001–005 are untouched. Stored
      method/currency pairs are EXACTLY `pago_movil`→VES, `cash_usd`→USD,
      `binance_pay`→USDT, `binance_transfer`→USDT; verification invariants call
      the unchanged M3/M5 RPCs (single 20-minute correction window, two-receipt
      cap, second-rejection cancellation) instead of reimplementing them. No
      payment/receipt UI. OQ-4/OQ-5 followed in M7 / Phase 5b (migration 007).
- [ ] **M5 (Phase 5) remaining:** POS/refund **UI**, plus any separately
      justified status-CHECK widenings. The POS/refund **backend** is already in
      migration 006, which also resolved OQ-7 by keeping `payment_refunds.method`
      as non-empty free text (no invented value domain). OQ-11 is resolved by
      confirmed decision #36: anonymous in-person POS sales, no customer fields
      and no schema change.
- [x] **OQ-12 (guest receipt re-view) — resolved and implemented:** #37/#38
      approve token-only re-view through the existing private tracking link with
      exact values: **300-second signed URLs**, **all submitted receipts**
      (original and correction), and eligibility after `approved`/`rejected`
      payment, excluding `canceled`/`expired` orders and requiring at least one
      submitted receipt. No other lifetime, scope or eligibility window is used.
- [x] **OQ-12 implementation:** added `src/features/payments/receipt-review.ts`
      (one `"use server"` action using `trackingTokenSchema`, service-role
      `get_order_for_tracking`, service-role receipt metadata reads and
      `createSignedUrl(..., 300)`), `src/features/payments/receipt-review-control.tsx`
      (native button, single live region, semantic list), and
      `src/app/(storefront)/seguimiento/[token]/page.tsx`. No client-visible
      order id, storage policy, bucket change or direct table/storage access.
- [x] **OQ-12 acceptance criteria:** valid eligible tokens return only the
      signed URLs; invalid/ineligible requests return one generic error with no
      path or PII; a token reaches only its own order's receipts; lifetime, scope
      and eligibility match #38 exactly; `payment-receipts` remains private with
      administrator SELECT only; no new `anon`/`authenticated` policy or client
      direct read; existing upload/verification/SLA behavior is unchanged.
- [x] **M6 (Phase 6) — OQ-16 recurring SLA notifications:** implemented in
      `supabase/migrations/005_receipt_sla_notifications.sql` and
      `supabase/worker/sla-worker.mjs` (validated locally, **not applied
      remotely or deployed**). One immutable `receipt_submissions` row per
      actual receipt (original + correction), a durable `admin_notifications`
      inbox for every active administrator, 24 h + 15 min repeats until the
      specific receipt is approved/rejected, and database-enforced dedupe
      `(receipt_submission_id, admin_id, interval_bucket)` across overlapping
      executions. The worker runs once immediately then polls every 15 min with
      no overlapping cycles; SLA processing writes no order/payment/inventory/
      reservation state. Delayed runs create only the current bucket.
- [x] **M6 (Phase 6) — Realtime publication:** additive migration
      `008_realtime_publication.sql` publishes the existing `orders`, `payments`
      and `cancellation_requests` tables to `supabase_realtime` with a guarded,
      catalog-based membership check (safe to re-run). No RLS policy, grant,
      table, trigger, function or publication option was changed, and default
      replica identity is retained. Verified locally (static contract plus
      disposable PostgreSQL 001–008); no admin UI subscription was added.
- [x] **M6 (Phase 6) — OQ-8 store settings schedules:** additive migration
      `009_store_settings_schedule.sql` defines and validates the canonical
      `business_hours` JSONB shape on the existing M1 singleton (no new table,
      no column, no seed): `America/Caracas`, weekly `attention`/`pickup`
      schedules, closed days as `[]`, multiple non-overlapping HH24:MI
      intervals. Database CHECK + Zod server action (session-derived admin,
      cookie-bound client under the existing admin RLS policy, no service-role
      bypass or new write permission); RLS/policies/grants untouched and
      schedules never restrict 24/7 checkout. Verified locally (static,
      behavioral 001–009, server-action tests).

---

## Phase 1A.2 — Final OQ resolution ✅ (complete)

Confirmed business rules recorded in `docs/DECISIONS.md` **#25** and **#26**;
`SPEC.md` §6/§8/§13/§14/§19, `docs/DATABASE_DESIGN.md` §6.2/§7.1/§11/§14,
`docs/SECURITY_DESIGN.md` §8, `docs/ROADMAP.md`, `TASKS.md` and `README.md`
updated accordingly. **At that time** no SQL, migration, application code or
remote resource was touched; M1/M2/M3 behavior and migration history are
unchanged. The later M4 and M6 entries above supersede this documentation-only
status: migration 004 implements OQ-17 and migration 005 plus the narrow worker
implement OQ-16, both locally only.

- [x] **OQ-16 (DECISIONS #25) — resolved as a rule:** 24-hour administrative
      receipt-review SLA from receipt submission; notify the responsible
      administrator when exceeded, repeat every 15 minutes until approve or
      reject, suppress duplicates from overlapping worker executions; never
      auto-cancel the order or release inventory. Informational only, not a
      reservation duration and not a schema column.
- [x] **OQ-17 (DECISIONS #26) — resolved as a rule:** manual-quote orders stay
      reserved with no automatic expiration while the quote is pending; the
      customer's explicit acceptance of the quoted fee starts a new fixed
      20-minute initial reservation window. It is not the 24-hour review SLA
      and does not modify the 20-minute post-rejection correction window;
      administrative retries never extend it.
- [x] Documentation-only scope verified **at the time**: no migration 004, no
      changes to 001/002/003 or to `src/`, no remote apply. Migration 004 and
      the server action now implement OQ-17 as recorded in the M4 entry above.

**Implementation status (Phase 4 OQ-17 and Phase 6 OQ-16 done locally):**

- [x] **Phase 4 — OQ-17 quote-acceptance transition:** implemented in migration
      004 and validated locally (not applied remotely). The customer's explicit
      acceptance via the private tracking token writes a new fixed 20-minute
      window in `quote_acceptance_expires_at` and copies it to `expires_at`;
      `initial_expires_at` remains immutable with its creation-time value. The
      service-role RPCs are idempotent, ignore admin retries, leave the
      correction window and SLA untouched, audit `order.quote_accept` in the
      same transaction and expose no client write path.
- [x] **Phase 6 — OQ-16 recurring SLA notifications:** migration 005 adds
      `receipt_submissions` and `admin_notifications`, extends the real
      submission/rejection RPCs, and adds a service-role-only SLA cycle RPC;
      `supabase/worker/sla-worker.mjs` is the dedicated scheduled component
      authorized by the amendment to DECISIONS #1. Every active administrator
      is a recipient, repeats are every 15 minutes until that receipt is
      approved/rejected, and dedupe is enforced by the unique key
      `(receipt_submission_id, admin_id, interval_bucket)` with `ON CONFLICT DO
      NOTHING`. No order/status/payment/inventory/reservation writes and no
      external outbox. Validated locally (SQL contract, behavioral RLS/grant
      tests, worker unit tests); not applied remotely or deployed.

Validation (Phase 1B / M1 — executed locally, 2026-11-14):

The Supabase CLI/Docker are unavailable here, so the migration was validated by
creating a **throwaway local PostgreSQL 17 cluster** (temp directory, trust
auth, torn down afterwards) with a stub of the Supabase environment (roles
`anon`/`authenticated`/`service_role`, `auth.users` + `auth.uid()`,
`storage.buckets`/`storage.objects`, Supabase default grants):

- [x] Migration applies cleanly in a single transaction
      (`psql -1 -v ON_ERROR_STOP=1` → exit 0).
- [x] All 6 tables: RLS enabled **and** forced (verified via `pg_class`).
- [x] All 11 public policies + 3 `storage.objects` policies present with the
      exact roles/commands from `SECURITY_DESIGN.md` §4.
- [x] `private.is_admin()`: SECURITY DEFINER, `search_path = ''`, EXECUTE
      granted to `anon` + `authenticated`, revoked from `public` and
      `service_role`; evaluates to `false` without a JWT; an authenticated
      admin reads their own `administrators` row with **no policy recursion**.
- [x] Seeds: 3 zones with SPEC §6 fees, singleton settings row (all business
      fields NULL), 0 products, 0 administrators, `product-images` bucket
      public.
- [x] Behavioral matrix: anon = active-catalog reads only, every write denied;
      authenticated non-admin = 0 rows everywhere, all writes denied;
      authenticated admin = full access, self-attributed `audit_log` insert
      only, `audit_log` UPDATE/DELETE affect 0 rows (append-only), no
      `administrators` self-grant, storage write only to `product-images`;
      `service_role` = RLS bypass as designed.
- [x] Constraints/indexes/triggers verified (`pg_constraint`, `pg_indexes`,
      `pg_trigger`): FKs, CHECKs, partial indexes, 3 `updated_at` triggers
      (trigger observed firing during the admin update test).

Explicitly **not** verified locally (requires real Supabase infrastructure):
public-bucket read via the Storage API/CDN, PostgREST exposure behavior, and
`auth.uid()` from real JWTs. Remote application was deferred at the time (B1);
M1 has since been applied to the production project — **no remote changes were
made by this M2 task**.

npm suite (Phase 1B): `npm test` 6/6 passed · `npm run lint` exit 0 ·
`npm run build` success (`/`, `/admin` static) · `npx tsc --noEmit` exit 0.

Validation (Phase 2 / M2 — executed locally, 2026-11-19):

The Supabase CLI/Docker remain unavailable, so migration 002 was validated the
same way as M1: applied to a **throwaway local PostgreSQL 17 cluster** (temp
directory, ephemeral loopback port, trust auth, torn down afterwards) with the
Supabase stub, via `src/infrastructure/database/local-postgres.ts` (the suite
skips itself with `describe.skipIf` when no local PostgreSQL is found; set
`PGBIN` to override the binary path):

- [x] Migrations 001 + 002 apply cleanly in a single transaction each
      (`psql -1 -v ON_ERROR_STOP=1` → exit 0).
- [x] Both M2 tables: RLS enabled **and** forced; exactly 3 policies (admin
      ALL on batches, SELECT + INSERT on movements, no anon policy, append-only
      — no UPDATE/DELETE policy, DECISIONS #21).
- [x] Initial creation: batch + `entry` movement + `inventory.batch_create`
      audit row in one transaction; replenishment = second batch, FIFO order by
      (`production_date`, `id`).
- [x] Stock reduction: signed adjustment with mandatory reason, returns new
      remaining, writes movement + audit (`remaining_before/after` in jsonb).
- [x] Insufficient stock rejected atomically (no movement, no audit, remaining
      unchanged); negative and over-initial results blocked both by RPC guards
      and by the named CHECK constraints (backstop verified with direct SQL).
- [x] Invalid input (null ids, non-positive initial quantity, zero/null
      adjustment, blank reason) rejected before any write.
- [x] Authorization boundaries: anon = 0 rows, writes denied, RPCs "permission
      denied"; authenticated non-admin = 0 rows, RPC gate error 42501; both
      admins read/write, history never rewritable (UPDATE/DELETE affect 0
      rows); service role limited to its documented surface.
- [x] EXECUTE grants exactly per SECURITY_DESIGN §5 (`create`/`adjust` →
      `authenticated` only; `get_product_stock` → `service_role` only) and all
      functions are `SECURITY INVOKER` with `search_path = ''`.
- [x] Concurrency: two sessions racing the same batch — the second waits on
      the `FOR UPDATE` lock, then fails with "insufficient stock"; exactly one
      movement and one audit row result (no double-spend).
- [x] M3 leakage absent: no `inventory_reservations`, no `order_id`/FK/index,
      no `orders`, no `sale` rows, no timing expressions (`interval '15/20'`),
      no seeds; `admin_id` always written (OQ-9 stays open).
- [x] `get_product_stock` returns `available = remaining`, `reserved = 0`
      (placeholder until M3) and never exposes `production_date`.
- [x] Cross-table invariant sweep: signed movement sum per batch =
      `remaining_quantity` for every batch.

npm suite (Phase 2 / M2): `npm test` 36/36 passed (3 files: 20 behavioral +
16 static contract) · `npm run lint` exit 0 · `npm run build` success
(`/`, `/admin` static) · `npx tsc --noEmit` exit 0 (run after build).

Explicitly **not** verified locally (requires real Supabase infrastructure):
PostgREST exposure of the new RPCs, `auth.uid()` from real JWTs, and applying
migration 002 to the remote project (deliberately deferred — **no remote
changes were made**).

Validation (Phase 3 / M3 — executed locally, 2026-11-19):

Migration 003 was validated the same way as M1/M2: applied on top of 001 + 002
to a **throwaway local PostgreSQL 17 cluster** (Supabase stub, ephemeral
loopback port, torn down afterwards) via
`src/infrastructure/database/local-postgres.ts`:

- [x] Migrations 001 + 002 + 003 apply cleanly, each in a single transaction
      (`psql -1 -v ON_ERROR_STOP=1` → exit 0).
- [x] All five M3 tables: RLS enabled **and** forced; exactly 6 policies (5
      admin ALL via `(select private.is_admin())` + the documented anon SELECT
      on `exchange_rates` only — no anon policy on orders/order_items/
      reservations/cancellation_requests).
- [x] Checkout: server-side recompute (prices from `products`, fee from
      `delivery_zones`, `requires_quote` zones snapshot a NULL fee), line
      snapshots, 64-hex token returned once with only `sha256(token)` stored,
      `bcv_rate_*`/`total_ves`/`rounding_rule` NULL (OQ-4/OQ-5 at that point;
      now filled by migration 007, Phase 5b).
- [x] Atomicity: invalid input, unknown/inactive product, unknown zone and
      insufficient stock all roll back with no order, no items, no
      reservations (named SQLSTATEs: 22023 / P0002 / P0001).
- [x] FIFO allocation across batches (`production_date`, `id`) with the
      documented `available = remaining − active&unlapsed reservations` rule;
      `get_product_stock` now subtracts reservations (M2 placeholder replaced
      through the documented §11 `create or replace` path).
- [x] Lifecycle: initial `expires_at = initial_expires_at = created_at + 20
      min` (CHECK-enforced); `hold` counts receipt #1 (0 → 1) → `expires_at =
      NULL` (never lapses); rejection #1 opens the ONE 20-min window once
      (repeat call re-uses the same deadline — never extended) and **never**
      releases; receipt #2 (1 → 2) is held again; rejection #2 atomically
      cancels the order and releases every active reservation (`closed_at`
      set, availability restored once, zero movements, no physical-stock
      change) and is idempotent on repeats; quote-pending deliveries are
      created held and survive lazy expiry; lazy
      `release_expired_reservations` flips lapsed rows + pending orders to
      `expired` with no stock movement; `consume` → `sale` movement (negative,
      `order_id` set, `admin_id` NULL) + `remaining_quantity` decrement;
      `release` frees availability without touching physical stock.
- [x] Two-receipt cap: `receipt_attempts` starts at 0, is NOT NULL and
      CHECK-constrained 0..2; a third submission (forced attempts = 2, direct
      SQL attempt = 3 blocked by the named CHECK) raises P0001 before any write;
      a repeat hold on an already-held order consumes no attempt.
- [x] Idempotency and invalid transitions: repeat consume/release/hold/window
      are safe no-ops or documented re-assertions; rejecting a receipt that was
      never submitted (attempts = 0) raises P0001; hold after auto-cancel is a
      state violation; consume-after-release, release-after-consume,
      hold/window on a closed order, unknown order (P0002) and null arguments
      (22023) all rejected — verified via the SQLSTATE captured inside
      PL/pgSQL.
- [x] Concurrency: four parallel checkouts of 3 units against 5 — exactly one
      succeeds (3 reserved, 2 free, no oversell); two parallel consumes of the
      same order — one deducts once, the other returns the idempotent 0 (one
      movement only); two parallel final rejections — exactly one cancels and
      releases (returns 1), the other returns 0 (no double release, no
      movement).
- [x] Tracking: PII-free projection (no name/phone/address/token), wrong
      tokens return NULL, stored hash equals `sha256(token)` and never the
      token; cancellation requests are pending/source=`tracking`/trimmed and
      visible through tracking; duplicates → 23505, unknown token → P0002.
- [x] RLS/grant boundaries: anon and authenticated non-admin read 0 rows and
      fail every write with an RLS error; admin reads all rows and the
      `updated_at` trigger fires; `exchange_rates` is anon-readable but
      admin-writable; all 8 RPCs have EXECUTE for `service_role` only (0 for
      `anon`/`authenticated`, enforced even for administrators) and every
      function is `SECURITY INVOKER` with `search_path = ''`.
- [x] Schema objects verified (`pg_constraint`, `pg_indexes`, `pg_trigger`,
      `information_schema`): 21 named constraints (incl.
      `orders_receipt_attempts_check`), 15 indexes (incl. 3 partial
      + the partial unique pending-cancellation index),
      `inventory_movements.order_id` column with `ON DELETE SET NULL` FK and
      index, `orders_updated_at` trigger, `receipt_attempts` `NO|0`.
- [x] Static contract (`orders-contract.test.ts`): exact table/policy/function
     /grant/index scope, no M4+ leakage (no payment/receipt tables, uploads or
      verification; `receipt_attempts` is the only receipt identifier),
      only 20-minute intervals present, migration order 001 → 002 → 003.
- [x] SQL audit: all state changes stay inside the RPCs' single transaction;
      locks always taken reservations → orders (never the reverse), so
      submissions/rejections/consumptions/cleanups serialise; RLS, policies and
      EXECUTE grants unchanged from the original M3 scope; no sale movement or
      physical-stock write on rejection or release; no remote apply.

npm suite (Phase 3 / M3, incl. the in-place correction): `npm test` 73/73
passed at that point (5 files: 26 M3 behavioral + 11 M3 static contract +
36 M1/M2; **109/109 after the Phase 4 / M4 tests**) · `npm run lint` exit 0 ·
`npm run build` success (`/`, `/admin` static) · `npx tsc --noEmit` exit 0
(before and after build).

Explicitly **not** verified locally (requires real Supabase infrastructure):
PostgREST exposure of the new RPCs, `auth.uid()` from real JWTs, and applying
migration 003 to the remote project (deliberately deferred — **no remote
changes were made**; migration 001/002 files untouched, nothing committed).

Validation (Phase 4 / M4 — OQ-17, executed locally, 2026-11-20):

Migration 004 was validated on a throwaway local PostgreSQL cluster using the
same Supabase stub as M1/M2/M3; `npm test`, `npm run lint`, `npx tsc --noEmit`
and `npm run build` all passed locally.

- [x] Migration `004_quote_acceptance.sql` applies cleanly on top of 001–003;
      migrations 001–003 are untouched and no commit/push was made.
- [x] New nullable columns `orders.quote_accepted_at` and
      `inventory_reservations.quote_acceptance_expires_at`; the four-case
      `expires_at` CHECK (held NULL → correction window → quote-acceptance
      window → immutable `initial_expires_at`) verified. `initial_expires_at`
      keeps its historical `created_at + 20 min` value and is never re-armed or
      rewritten.
- [x] `accept_quote_fee` / `accept_quote_fee_for_tracking`: reservations →
      orders locking, token hash resolution on the server, pending quote-only
      guards, idempotent replay, no revival of closed reservations, and one
      PII-free `order.quote_accept` audit row in the same transaction; both RPCs
      are service-role-only, `SECURITY INVOKER` with pinned `search_path`.
- [x] `get_order_for_tracking` exposes `quote_accepted_at`,
      `quote_acceptance_expires_at` and `quote_acceptance_available` with no PII;
      the server action validates a 64-hex token and calls only the RPC.
- [x] `npm test` — **109/109 passed** (36 new tests vs. the 73-test M3 suite) ·
      `npm run lint` exit 0 · `npx tsc --noEmit` exit 0 · `npm run build` success.

Explicitly **not** done in Phase 4: migration 004 was **not applied to any
remote Supabase project**; payment/receipt/tracking **UI** (the payments and
receipt-storage **backend** is now migration 006, likewise local-only); no
remote deployment. OQ-16 notifications/scheduler are implemented separately in
Phase 6 and are likewise local-only.

**Phase 6 / OQ-16 local validation (final):** `npm test` — **143/143 passed**
(34 new static/behavioral/worker tests vs. the 109-test Phase 4 suite) ·
`npm run lint` exit 0 (only two pre-existing OQ-17 warnings) ·
`npx tsc --noEmit` exit 0 · `npm run build` success. No remote migration,
deployment, secret change, commit or push.

Validation (Phase 5 / Payments Module — migration 006, local only):

- [x] Migration 006 applies additively on top of 001–005 on a **disposable local
      PostgreSQL cluster**; migrations 001–005 are untouched. Behaviorally
      validated locally; validation details are in the final implementation
      report. **Not applied to any remote Supabase project, deployed, committed
      or pushed.**
- [x] Tables/columns: `payments`, `payment_refunds`,
      `receipt_submissions.payment_id`, indexes (including partial unique keys
      for one pending submission per order and per payment), RLS/forces/grants,
      private `payment-receipts` bucket with admin SELECT only and no client
      write policies, audit integration and service-role RPCs.
- [x] Backend flows covered: guest digital registration with private receipt
      upload, admin cash registration against an existing online order, admin
      approve/reject, offline POS cash sale, append-only refund recording and
      per-currency summary. No UI was added.
- [x] Boundaries verified locally: declared per-currency amounts only (no
      cross-currency sum, conversion, "fully paid" decision or auto-fulfillment);
      verification separate from fulfillment; admin id session-derived and
      rechecked by `private.require_active_admin` in every mutating RPC; no RPC
      reads `auth.uid()`; idempotency keys, row locks, deterministic lock order
      and advisory locks for POS/refund; public errors do not leak SQL details.
- [x] Open after this work: Binance identifier/modality details and the
      cash-on-delivery policy. OQ-7 was resolved by migration 006 itself (SPEC
      §12 requires the field, not the value domain; non-empty free text, no
      value-domain CHECK invented). OQ-11 was resolved later by confirmed
      decision #36 (anonymous in-person POS sales; no schema change). OQ-12 was
      later fully resolved by #37/#38 (token-only receipt re-view implemented
      with all receipts, 300-second URLs and approved/rejected eligibility).
      OQ-4 and OQ-5 were resolved later in Phase 5b (migration 007). No exact
      counts are recorded here; see the final implementation report.

Validation (Phase 5b / OQ-4 + OQ-5 — migration 007, local only):

- [x] Migration 007 applies additively on top of 001–006 on a **disposable local
      PostgreSQL cluster**; migrations 001–006 are untouched and 006 remains the
      applied baseline. **Not applied to any remote Supabase project, deployed,
      committed or pushed.**
- [x] Schema: `exchange_rates.is_active`, `registered_by`, `supersedes_id`,
      `note`, `idempotency_key`, the source/note checks, the unique idempotency
      key, the active-rate lookup index and the `orders.rounding_rule` domain
      check; no new tables and no seeds. RLS/forced RLS unchanged.
- [x] Rate administration: manual registration with positive/≤ 4-decimal rate,
      non-empty source, session-derived active admin, idempotency key and audit
      rows; correction deactivates the replaced row only after a successful
      insert; standalone deactivation is idempotent; invalid admin/rate/source
      rejected at the database boundary.
- [x] Rate reads: latest **active** rate at/before an instant with source,
      `observed_at`, `age_seconds` and `is_stale`; historical as-of lookups;
      explicit null when none exists — no invented fallback.
- [x] Snapshots: guest (hashed tracking token) and admin wrappers lock the order,
      store the exact rate and its own `observed_at`, never overwrite an existing
      snapshot and audit only administrative applies; concurrent applies are
      serialised; no active rate / invalid token / closed order fail explicitly.
- [x] OQ-5: `round_half_up` applied once to the final VES total (boundary case
      374.125 → 374.13 verified), recorded as `orders.rounding_rule`; no
      per-item rounding, no cross-currency sum, no "fully paid" rule, no
      automatic fulfillment; declared payment amounts keep 2 decimals.
- [x] Least privilege: all mutating RPCs and the private snapshot helper grant
      EXECUTE only to `service_role`; rate reads stay public; every function is
      `SECURITY INVOKER` with `search_path = ''` and no RPC uses `auth.uid()`;
      Spanish-facing errors never leak SQL details.
- [x] Backend server actions (`src/features/exchange-rates/`) with Zod
      validation and mocked tests; no UI was added.
- [x] **Focused integration audit fixes (migration 007):** canonical
      `create_online_order_with_bcv` calls unchanged `create_online_order` and
      snapshots the DB-resolved active rate in the same transaction; no rate
      means a NULL-field USD-only order; snapshot failure rolls back the order
      and reservations. Snapshots are immutable through guest/admin legacy
      wrappers and direct privileged updates. Pago Móvil requires a complete
      snapshot via a database trigger on every payment entry point; USD/USDT
      unaffected. Concurrent creation/rate-change and all boundary cases covered
      by behavioral tests. Stale-rate maximum age documented as unresolved.
- [x] Validated locally; final exact counts are in the implementation report.

Then, per roadmap phase:

- [ ] Generate TypeScript database types and add the `Database` generic to the
      three Supabase clients (after M1).
- [ ] Public catalog pages (list + detail) fed from the database; public
      `product-images` bucket.
- [ ] Supabase Auth for the two administrators; protected `/admin` shell
      (server-side check against `administrators`).
- [ ] Admin product CRUD (+ `audit_log` entries).
- [ ] Catalog/product seed once B3 resolves.
- [x] **Phase 4 (OQ-17):** quote-acceptance transition implemented in migration
      004: one fixed 20-minute acceptance window in
      `quote_acceptance_expires_at`, `initial_expires_at` immutable, no
      admin-retry extension, no impact on the SLA or correction window (details
      in the M4 entry above).
- [x] **Phase 6 (OQ-16):** migration 005 + `supabase/worker/sla-worker.mjs`
      implement deduplicated in-app SLA notifications for every active
      administrator (24 h + 15 min repeats until approve/reject); no automatic
      cancel or inventory release; narrow worker authorized by DECISIONS #1's
      amendment. Validated locally, not applied remotely or deployed.
- [x] **Phase 4/5 (Payments Module):** migration 006 implements the payments
      and verification backend described above (four method/currency pairs,
      per-currency summary, POS cash and refund RPCs, private receipts). Local
      only; no UI, remote apply, deployment, commit or push.
- [x] **Phase 5b (OQ-4 / OQ-5):** migration 007 adds manual BCV rate history and
      administration, rate lookups with age, atomic per-order snapshots via the
      unchanged `create_online_order`, the `round_half_up` final-total rule,
      Pago Móvil snapshot enforcement and snapshot immutability, with server
      actions and local tests. Local only; no UI, remote apply, deployment,
      commit or push.
- [x] **Phase 6 (Realtime publication):** migration 008 adds `orders`,
      `payments` and `cancellation_requests` to `supabase_realtime` idempotently;
      force-RLS, admin-only policies, grants and default replica identity are
      untouched, so Realtime exposes no row a role cannot already read.
      Validated locally (static + behavioral 001–008); no frontend, worker or
      remote apply.
- [x] **Phase 6 (OQ-8):** migration 009 defines the `store_settings.business_hours`
      schedule contract (America/Caracas, weekly attention/pickup, closed days,
      multiple intervals) with a CHECK constraint and admin-only Zod action;
      no new table/seed, no RLS/grant change, no order/payment coupling.
      Validated locally (static + behavioral 001–009 + server actions).

Later phases: see `docs/ROADMAP.md` (inventory → checkout/orders → payments →
admin panel/POS → realtime/communication/settings).

---

## Developer automation — reusable autonomous OpenCode workflow (implementation complete, delivery pending)

Objective:
`features/autonomous-opencode-workflow` (one branch/PR, no bakery roadmap task).

- [x] Inspected the installed environment before changing anything: active
      harness is OpenCode V2 2.3.2; the standalone `opencode-ai@1.17.15` CLI on
      `PATH` is stale and rejects the V2 global config. Definitions use native
      V2 fields verified against `https://opencode.ai/config.json`.
- [x] Verified Git/GitHub state: OQ-12 PR #9 merged into `main` before starting;
      clean `main`; single verified remote
      `https://github.com/IngJabc/pasteleria-gabi.git` (user-owned canonical,
      `fork: false`, no separate fork); `main` fast-forwarded; feature branch
      created from that base.
- [x] Added `opencode.jsonc` with `default_agent: project-orchestrator`, ordered
      V2 safety denials and hard `tool.use` policies for push-to-`main`, force
      pushes, branch deletion, PR merge/approval, hard reset/clean/stash/restore
      and remote Supabase push/reset (including `npx`/`npm exec` forms). No agent
      definition re-enables a denied command.
- [x] Added `/autopilot` in `.opencode/commands/autopilot.md` selecting
      `project-orchestrator` and enforcing one objective with a human merge
      checkpoint.
- [x] Added primary `project-orchestrator` plus six specialized subagents:
      planner, implementer, reviewer, QA, security and docs. Delivery actions
      are restricted to the orchestrator; review/QA/security/planner are
      read-only and docs is documentation-only.
- [x] Added persistent, recoverable state convention
      (`.opencode/autopilot-state.json`, runtime-owned and gitignored) with a
      tracked `.opencode/autopilot-state.example.json`, Git/GitHub/docs as the
      source of truth, and simulated recovery checks.
- [x] Discovered all 22 installed skills (19 global SKILL.md files plus 3
      built-ins) and catalogued them in `docs/skills-catalog.md` without copying
      full skill instructions. UI work routes to `ui-ux-pro-max` first.
- [x] Documented operation, permissions, recovery, checkpoints, troubleshooting
      and known limitations in `docs/AUTONOMOUS_WORKFLOW.md`; linked both docs
      from `README.md`.
- [x] Added `scripts/validate-autopilot.mjs` and `npm run validate:autopilot` to
      recheck definitions, hard policies, skill discovery, state recovery,
      fork/remote facts and Git safety without pushing or merging.
- [x] Validated definitions, skill discovery, task-selection and Git-safety
      matrices non-destructively; ran the repository test/lint/typecheck/build
      suite and reviewed the complete diff.
- [x] No bakery roadmap task was implemented; no migration, storage policy,
      remote SQL, deployment, secret change, PR merge or push to `main`.

Validation (autonomous workflow): `npm run validate:autopilot`, `npm test`,
`npm run lint`, `npm run typecheck` and `npm run build`; exact final commands,
exit codes, commit hash, pushed branch and PR URL are recorded in the delivery
report once the PR exists.
