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

Documentation-only correction against the confirmed business rules: initial
reservation **20 minutes**; rejected receipt → **one additional 15-minute**
correction window; the **24-hour** figure is the administrators' operational
processing deadline, **not** a reservation duration.

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

---

## Phase 1B — Migrations, catalog and admin access ⬜

**Genuine blockers** (cannot be resolved by engineering work alone):

| # | Blocker | Needed for | Owner |
| --- | --- | --- | --- |
| B1 | A Supabase project must exist and `.env.local` must be filled (account + credentials) | Applying *any* migration, generating types, auth | User / project owner |
| B2 | E-mail addresses of the two administrators (OQ-1 — not covered by SPEC) | Seeding `administrators` + creating auth accounts | Business owner |
| B3 | Final catalog: product names, descriptions, prices, photographs (OQ-2, SPEC §19) | Seeding `products` (schema itself is *not* blocked) | Business owner |
| B4 | Visual identity decision (SPEC §19) — only for final UI copy/branding, not for schema | Storefront presentation | Business owner |

Not blocking Phase 1B (tracked for later phases): OQ-3 delivery-zone boundaries
(affects zone *content*), OQ-4/OQ-5 BCV rate source and rounding rule
(Phase 4), OQ-6 Pago Móvil data (Phase 4), OQ-7 refund methods (Phase 5),
OQ-8 schedules (Phase 6), OQ-9…OQ-12 confirmations at their phase,
OQ-13…OQ-16 reservation-window confirmations (Phases 3–4, see
`docs/DATABASE_DESIGN.md` §14).

Implementation order (each migration ships with its RLS policies; design source:
`docs/DATABASE_DESIGN.md`, policies: `docs/SECURITY_DESIGN.md`):

- [x] **M1 (Phase 1):** extensions + `products`, `product_images`,
      `store_settings`, `delivery_zones`, `administrators`, `audit_log` +
      RLS/forces + seeds (settings row + the three SPEC §6 zones, fees
      confirmed: free / $5 / manual quote) + `product-images` public bucket
      and its three admin write policies — implemented in
      `supabase/migrations/20261114023000_m1_catalog_and_admin_foundation.sql`.
      **Written and validated locally; NOT applied to any remote project**
      (blocked on B1). Products and administrators are deliberately not
      seeded (B2/B3 — no confirmed data).
- [ ] **M2 (Phase 2):** `inventory_batches`, `inventory_movements` + RLS +
      allocation/adjustment RPCs (OQ-9 confirmation before merge).
      `inventory_reservations` is **not** here: its FK references `orders`.
- [ ] **M3 (Phase 3):** `orders`, `order_items`, `inventory_reservations`,
      `cancellation_requests`, `exchange_rates` + tracking-token hashing +
      checkout/tracking RPCs (reservations created with
      `expires_at = created_at + 20 min`; hold/expiry semantics per
      OQ-13/OQ-15).
- [ ] **M4 (Phase 4):** `payments`, `payment_refunds` + `payment-receipts`
      bucket + verification invariants (receipt rejection opens the bounded
      15-minute correction window — OQ-14 confirmation before merge).
- [ ] **M5 (Phase 5):** POS channel validation data (OQ-7/OQ-11 confirmations)
      and any status-CHECK widenings.
- [ ] **M6 (Phase 6):** Realtime publication + `store_settings` shape for
      schedules (OQ-8).

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
public-bucket read via the Storage API/CDN, PostgREST exposure behavior,
`auth.uid()` from real JWTs, and application of the migration to a remote
project (blocked on B1 — **no remote changes were made**).

npm suite (Phase 1B): `npm test` 6/6 passed · `npm run lint` exit 0 ·
`npm run build` success (`/`, `/admin` static) · `npx tsc --noEmit` exit 0.

Then, per roadmap phase:

- [ ] Generate TypeScript database types and add the `Database` generic to the
      three Supabase clients (after M1).
- [ ] Public catalog pages (list + detail) fed from the database; public
      `product-images` bucket.
- [ ] Supabase Auth for the two administrators; protected `/admin` shell
      (server-side check against `administrators`).
- [ ] Admin product CRUD (+ `audit_log` entries).
- [ ] Catalog/product seed once B3 resolves.

Later phases: see `docs/ROADMAP.md` (inventory → checkout/orders → payments →
admin panel/POS → realtime/communication/settings).
