# Pastelería Online

Independent e-commerce platform for a Venezuelan bakery selling individual cake
portions, with a private administrative panel for two administrators.

**Status: Phase 1 complete. Migrations 001–015 are applied in both Supabase
Staging and Supabase Production; migrations 016 and 017 are local-only and not
applied.**
M2 (inventory foundation), M3 (orders and
inventory reservations, including the in-place reservation/payment-attempt
correction), the Phase 4 OQ-17 quote-acceptance transition and the Phase 6 OQ-16
receipt-review SLA are implemented in migrations 002 through 005 and validated
locally. The implementation report records 39 files / 396 tests PASS, typecheck
PASS, build PASS and `git diff --check` PASS (see [`TASKS.md`](./TASKS.md)). The
Payments Module backend is migration `006_payments_and_verification.sql`; the
admin POS cash-sale and refund UI is implemented locally in `/admin` behind a
fail-closed session gate. The OQ-4/OQ-5 BCV-rate and rounding backend is the
additive migration `007_bcv_rates_and_rounding.sql`; migrations 001–006 are
untouched by it. M3 reserves stock for 20 minutes, holds it while a submitted
receipt is reviewed, allows at most two receipts with one 20-minute correction
window, and auto-cancels on the second rejection. The final open questions are
resolved in [`docs/DECISIONS.md`](./docs/DECISIONS.md) (#25/#26): the 24-hour
review SLA triggers deduplicated in-app notifications for every active
administrator every 15 minutes until that receipt is approved/rejected, with no
auto-cancel or inventory release. Migration 005 is applied, and the SLA worker is
integrated locally with the BCV worker in `supabase/worker/runtime.mjs`;
deployment, production activation and runtime validation remain pending. Explicit
acceptance of a manual delivery quote writes one fixed 20-minute window in
`quote_acceptance_expires_at` and copies it to `expires_at`, leaving the
historical `initial_expires_at` immutable. The public catalog reads active
products at request time from the existing Supabase tables and renders `/` and
`/productos/[slug]`. The admin panel has 12 locally implemented sections behind
a fail-closed session gate: `/admin` (Resumen dashboard), orders, notifications,
receipts, external payments, products, reviews, inventory, POS, cancellations and
settings. The
storefront and admin UI work is uncommitted, with no PR. Two-admin auth
provisioning (B2) and final catalog/seed data (B3) remain pending; unavailable
admin reads show honest empty states. Other business flows remain backend work or
placeholders.
The functional specification is [`SPEC.md`](./SPEC.md) (Spanish).

## Tech stack

- Next.js 16 (App Router) + React 19 + TypeScript (strict mode)
- Tailwind CSS 4
- Supabase: PostgreSQL, Auth, Storage, Realtime via `@supabase/ssr` (project
  provisioned; migrations 001–015 applied in Staging and Production; migrations
  016–017 local-only)
- Zod (validation), Vitest (tests), ESLint (flat config)
- Deployed on Vercel

Architecture: **modular monolith** — no Express, Strapi or microservices.
Scheduled backend work is BCV exchange-rate sync and the narrow OQ-16
receipt-SLA worker (authorized by the OQ-16-only amendment to DECISIONS #1).
Both are implemented in `supabase/worker/` and hosted by one local unified
runtime (`supabase/worker/runtime.mjs`) for the existing Render Web Service;
deployment is pending. See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
and [`docs/WORKER_DEPLOYMENT.md`](./docs/WORKER_DEPLOYMENT.md).

## Prerequisites

- Node.js 22+ (developed on v22.17)
- npm worker scripts need Node.js >=22.9 for `--env-file-if-exists`; prefer 22.21+
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

Then fill `.env.local` with the values from the Supabase dashboard.
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
| `npm run worker:unified` | Start the unified BCV + receipt-SLA runtime; auto-loads `.env.local` when present |
| `npm run worker:sla` | Run the OQ-16 SLA worker on a schedule; both npm worker scripts auto-load `.env.local` when present (needs `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; optional `SLA_POLL_MS`/`SLA_SHUTDOWN_TIMEOUT_MS`) |

`npm run worker:unified` also reads `BCV_SYNC_TEST_INTERVAL_MS` from `.env.local`. Set it to `120000` for local 2-minute BCV sync tests, then unset it before deployment.

### Database types

To regenerate `src/infrastructure/database/database.types.ts` from all nine
local migrations, run `node scripts/generate-database-types.mjs` manually. The
command creates a disposable PostgreSQL 17 cluster on loopback, applies the
local stub and migrations, runs the installed Supabase CLI and cleans up. It
needs no Docker, remote project or `.env.local`. All three Supabase clients use
the generated-derived `Database` from `database.client.types.ts`, which
overrides five RPC `Args` to preserve decimal-string money and explicit nulls
in the validated wire contract.

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
│   │   ├── (storefront)/  #   customer routes: / and /productos/[slug]
│   │   └── (admin)/admin/ #   11 private admin routes: /admin (Resumen), pedidos
│   │                      #   (+/[id], /detalle), comprobantes, pagos/externo,
│   │                      #   productos, inventario, punto-de-venta,
│   │                      #   cancelaciones, configuracion
│   ├── components/        # Shared presentational components (no logic)
│   ├── features/          # One folder per capability (catalog, checkout, …)
│   ├── domain/            # Framework-free business types and rules
│   ├── infrastructure/    # External services: Supabase clients, env validation
│   ├── validation/        # Zod input schemas (server-side authoritative)
│   └── test/              # Shared testing utilities
├── public/                # Static assets
├── supabase/
│   └── migrations/        # SQL migrations (001–015 applied remotely; 016–017 local-only)
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

Note: the public catalog reads active products from Supabase at request time.
`next.config.ts` allows exactly one bounded HTTPS Supabase Storage pattern:
`*.supabase.co` on `/storage/v1/object/public/**`, with no port or query string.
The single-subdomain wildcard is intentional so switching Supabase projects
needs no code or config change. Set a valid `NEXT_PUBLIC_SUPABASE_URL` at build
time for Supabase client calls. Other business flows remain backend or
placeholder work.

## Documentation

| Document | Contents |
| --- | --- |
| [`SPEC.md`](./SPEC.md) | Functional specification (source of truth, Spanish) |
| [`docs/ROADMAP.md`](./docs/ROADMAP.md) | Phases and future requirements (OQ-17 implemented locally in Phase 4; OQ-16 implemented locally in Phase 6) |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Layers, folder responsibilities, security invariants |
| [`docs/DATABASE_DESIGN.md`](./docs/DATABASE_DESIGN.md) | Tables, columns, relationships, indexes, ER diagram (design; M1–M4 + OQ-16 implemented locally) |
| [`docs/SECURITY_DESIGN.md`](./docs/SECURITY_DESIGN.md) | Roles, access boundaries, RLS/storage policies, OQ-17 token authorization and OQ-16 SLA boundaries (design; M1–M4 + OQ-16 implemented locally) |
| [`docs/DECISIONS.md`](./docs/DECISIONS.md) | Key architectural decisions and their rationale |
| [`docs/AUTONOMOUS_WORKFLOW.md`](./docs/AUTONOMOUS_WORKFLOW.md) | `/autopilot` operation, Git lifecycle, permissions, recovery and checkpoints |
| [`docs/skills-catalog.md`](./docs/skills-catalog.md) | All 22 installed OpenCode skills and how the workflow routes them |
| [`TASKS.md`](./TASKS.md) | Checklist of completed and upcoming tasks |
