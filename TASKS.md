# TASKS

Living checklist. Update the status when a task is actually completed and
verified — never mark a task done without running its validation.

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
explicit acceptance of the quoted fee). OQ-17 is now **implemented and validated
locally in Phase 4** (`supabase/migrations/004_quote_acceptance.sql`); OQ-16
remains pending in Phase 6.

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
(Phase 4), OQ-6 Pago Móvil data (Phase 4), OQ-7 refund methods (Phase 5),
OQ-8 schedules (Phase 6), OQ-9…OQ-12 confirmations at their phase,
the implementation of OQ-16 (Phase 6 SLA notifications); OQ-17 is implemented
locally in Phase 4. OQ-13 (quote case), OQ-14, OQ-15, OQ-16 and OQ-17 are
resolved as rules (see `docs/DATABASE_DESIGN.md` §14).

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
      `payment.verify`), no 24-hour SLA in the schema (DECISIONS #24; OQ-16 is
      now resolved as notification-only by DECISIONS #25 — implementation
      pending, no schema change). OQ-9 is exercised by `sale` movements
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
- [ ] **M4 (Phase 4) remaining:** `payments`, `payment_refunds` +
      `payment-receipts` bucket + verification invariants wired to the M3 RPCs
      (receipt rejection opens the bounded 20-minute window; second rejection
      auto-cancels — OQ-14 confirmed).
- [ ] **M5 (Phase 5):** POS channel validation data (OQ-7/OQ-11 confirmations)
      and any status-CHECK widenings.
- [ ] **M6 (Phase 6):** Realtime publication + `store_settings` shape for
      schedules (OQ-8) **plus the OQ-16 recurring SLA notifications** (24 h
      after receipt submission, every 15 min until approve/reject, deduplicated
      across overlapping executions, no auto-cancel/release).

---

## Phase 1A.2 — Final OQ resolution ✅ (complete)

Confirmed business rules recorded in `docs/DECISIONS.md` **#25** and **#26**;
`SPEC.md` §6/§8/§13/§14/§19, `docs/DATABASE_DESIGN.md` §6.2/§7.1/§11/§14,
`docs/SECURITY_DESIGN.md` §8, `docs/ROADMAP.md`, `TASKS.md` and `README.md`
updated accordingly. **At that time** no SQL, migration, application code or
remote resource was touched; M1/M2/M3 behavior and migration history are
unchanged. The later M4 entry above supersedes this documentation-only status
for OQ-17 (migration 004); OQ-16 is still documentation-only.

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

**Implementation status (Phase 4 OQ-17 done in M4; OQ-16 still PENDING):**

- [x] **Phase 4 — OQ-17 quote-acceptance transition:** implemented in migration
      004 and validated locally (not applied remotely). The customer's explicit
      acceptance via the private tracking token writes a new fixed 20-minute
      window in `quote_acceptance_expires_at` and copies it to `expires_at`;
      `initial_expires_at` remains immutable with its creation-time value. The
      service-role RPCs are idempotent, ignore admin retries, leave the
      correction window and SLA untouched, audit `order.quote_accept` in the
      same transaction and expose no client write path.
- [ ] **Phase 6 — OQ-16 recurring SLA notifications:** scheduled detection of
      receipts past their 24-hour review deadline; notify the responsible
      administrator, repeat every 15 minutes until approve/reject, deduplicate
      with a stable key (receipt/submission + due interval + recipient) across
      overlapping worker executions; no order/status/reservation/inventory
      writes; tests for dedupe, stop-on-decision and no-auto-cancel. Requires
      deciding the scheduler mechanism (revisit DECISIONS #1's
      no-background-workers scope) and how the responsible administrator is
      identified.

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
      `bcv_rate_*`/`total_ves`/`rounding_rule` NULL (OQ-4/OQ-5).
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
remote Supabase project**; no OQ-16 notifications/scheduler, payments, receipt
storage or tracking UI; no remote deployment.

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
- [ ] **Phase 6 (OQ-16):** deduplicated recurring SLA notifications to the
      responsible administrator (24 h + 15 min repeats until approve/reject);
      no automatic cancel or inventory release; scheduler decision pending.

Later phases: see `docs/ROADMAP.md` (inventory → checkout/orders → payments →
admin panel/POS → realtime/communication/settings).
