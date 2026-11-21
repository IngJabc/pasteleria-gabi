# Pastelería Online

Independent e-commerce platform for a Venezuelan bakery selling individual cake
portions, with a private administrative panel for two administrators.

**Status: Phase 1 complete and applied to production — M2 (inventory
foundation), M3 (orders & inventory reservations, including the in-place
reservation/payment-attempt correction), the Phase 4 OQ-17 quote-acceptance
transition and the Phase 6 OQ-16 receipt-review SLA implemented in
`supabase/migrations/002_inventory_foundation.sql`,
`supabase/migrations/003_orders_and_reservations.sql`,
`supabase/migrations/004_quote_acceptance.sql` and
`supabase/migrations/005_receipt_sla_notifications.sql` and validated locally
(143 tests), not yet applied to any remote Supabase project** (see
[`TASKS.md`](./TASKS.md)). The Payments Module backend is migration
`006_payments_and_verification.sql` (the current applied baseline); the OQ-4/OQ-5
BCV-rate and rounding backend is the additive migration
`007_bcv_rates_and_rounding.sql` (local-only; not applied remotely or deployed;
migrations 001–006 untouched). M3 reserves stock for 20 minutes, holds it while a
submitted receipt is reviewed, allows at most two receipts with one 20-minute
correction window, and auto-cancels on the second rejection. The final open
questions are resolved in [`docs/DECISIONS.md`](./docs/DECISIONS.md) (#25/#26):
the 24-hour review SLA now triggers deduplicated in-app notifications for every
active administrator every 15 minutes until that receipt is approved/rejected
(no auto-cancel/release), through migration 005 and the dedicated
`supabase/worker/sla-worker.mjs`; explicit acceptance of a manual delivery
quote **is implemented in Phase 4**: a private-token, service-role RPC writes
one fixed 20-minute window in `quote_acceptance_expires_at` and copies it to
`expires_at`, leaving the historical `initial_expires_at` immutable. Migrations
004 and 005 have not been applied remotely and the worker is not deployed. No
business features are running; the pages are still placeholders.
The functional specification is [`SPEC.md`](./SPEC.md) (Spanish).

## Tech stack

- Next.js 16 (App Router) + React 19 + TypeScript (strict mode)
- Tailwind CSS 4
- Supabase: PostgreSQL, Auth, Storage, Realtime via `@supabase/ssr` (project not
  provisioned yet)
- Zod (validation), Vitest (tests), ESLint (flat config)
- Deployed on Vercel

Architecture: **modular monolith** — no Express, Strapi or microservices. The
only scheduled backend component is the narrow OQ-16 receipt-SLA worker
(`supabase/worker/sla-worker.mjs`), authorized by the OQ-16-only amendment to
DECISIONS #1; it calls one service-role RPC and has no business-state write
path. See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Prerequisites

- Node.js 22+ (developed on v22.17)
- npm 10+

## Installation

```bash
git clone <repo-url> && cd pasteleria-online
npm install
```

Configure environment variables:

```bash
cp .env.example .env.local
```

Then fill `.env.local` with the values from the Supabase dashboard (the project
is created in a later phase — see [`docs/ROADMAP.md`](./docs/ROADMAP.md)).
**Never commit real credentials**; `.env.local` is git-ignored and only
[`.env.example`](./.env.example) (placeholders, no secrets) is tracked.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server (http://localhost:3000) |
| `npm run build` | Production build (type-checks and lints as part of Next.js) |
| `npm start` | Serve the production build |
| `npm run lint` | Run ESLint over the project |
| `npm run typecheck` | Run `tsc --noEmit` (requires a prior `npm run build`/`next typegen` so generated route types exist) |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run worker:sla` | Run the OQ-16 SLA worker once installed as a scheduled process (needs `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; optional `SLA_POLL_MS`/`SLA_SHUTDOWN_TIMEOUT_MS`) |

## Testing

Tests are written with Vitest and colocated with the code they cover as
`*.test.ts(x)` under `src/`:

```
src/infrastructure/env.ts
src/infrastructure/env.test.ts
```

The suite runs in a `node` environment and never requires network access, a
remote Supabase project or real credentials. Shared helpers belong in
`src/test/`. See [`docs/DECISIONS.md`](./docs/DECISIONS.md) for why React
Testing Library is not installed yet.

## Project structure

```
pasteleria-online/
├── docs/                  # ROADMAP, ARCHITECTURE, DECISIONS
├── src/
│   ├── app/               # Routes only (App Router)
│   │   ├── (storefront)/  #   customer-facing routes: /
│   │   └── (admin)/admin/ #   private admin routes: /admin (no data yet)
│   ├── components/        # Shared presentational components (no logic)
│   ├── features/          # One folder per capability (catalog, checkout, …)
│   ├── domain/            # Framework-free business types and rules
│   ├── infrastructure/    # External services: Supabase clients, env validation
│   ├── validation/        # Zod input schemas (server-side authoritative)
│   └── test/              # Shared testing utilities
├── public/                # Static assets
├── supabase/
│   └── migrations/        # SQL migrations (M1 applied remotely; M2 + M3 + M4/OQ-17 local only)
├── .env.example           # Documented variable names, no real credentials
├── TASKS.md               # Phase checklist (done + next)
└── SPEC.md                # Functional specification (Spanish)
```

Each folder inside `src/` contains a README with its rules and planned contents.

## Deployment (Vercel)

1. Import the repository into Vercel (framework auto-detected: Next.js).
2. Add the environment variables from `.env.example` in the project settings —
   the two `NEXT_PUBLIC_*` values are public, `SUPABASE_SERVICE_ROLE_KEY` must
   only ever be set server-side.
3. Deploy the production branch.

Note: the Supabase project does not exist yet, so a deployment in Phase 0 will
build and render placeholder pages only — no database calls are made.

## Documentation

| Document | Contents |
| --- | --- |
| [`SPEC.md`](./SPEC.md) | Functional specification (source of truth, Spanish) |
| [`docs/ROADMAP.md`](./docs/ROADMAP.md) | Phases and future requirements (OQ-17 implemented locally in Phase 4; OQ-16 implemented locally in Phase 6) |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Layers, folder responsibilities, security invariants |
| [`docs/DATABASE_DESIGN.md`](./docs/DATABASE_DESIGN.md) | Tables, columns, relationships, indexes, ER diagram (design; M1–M4 + OQ-16 implemented locally) |
| [`docs/SECURITY_DESIGN.md`](./docs/SECURITY_DESIGN.md) | Roles, access boundaries, RLS/storage policies, OQ-17 token authorization and OQ-16 SLA boundaries (design; M1–M4 + OQ-16 implemented locally) |
| [`docs/DECISIONS.md`](./docs/DECISIONS.md) | Key architectural decisions and their rationale |
| [`TASKS.md`](./TASKS.md) | Checklist of completed and upcoming tasks |
