# Pastelería Online

Independent e-commerce platform for a Venezuelan bakery selling individual cake
portions, with a private administrative panel for two administrators.

**Status: Phase 1 complete and applied to production — M2 (inventory
foundation), M3 (orders & inventory reservations, including the in-place
reservation/payment-attempt correction) and the Phase 4 OQ-17 quote-acceptance
transition implemented in `supabase/migrations/002_inventory_foundation.sql`,
`supabase/migrations/003_orders_and_reservations.sql` and
`supabase/migrations/004_quote_acceptance.sql` and validated locally
(109 tests), not yet applied to any remote Supabase project** (see
[`TASKS.md`](./TASKS.md)). M3 reserves stock for 20 minutes, holds it while a
submitted receipt is reviewed, allows at most two receipts with one 20-minute
correction window, and auto-cancels on the second rejection. The final open
questions are resolved in [`docs/DECISIONS.md`](./docs/DECISIONS.md) (#25/#26):
the 24-hour review SLA only triggers deduplicated administrator notifications
(no auto-cancel/release) and remains **pending in Phase 6**, while explicit
acceptance of a manual delivery quote **is implemented in Phase 4**: a
private-token, service-role RPC writes one fixed 20-minute window in
`quote_acceptance_expires_at` and copies it to `expires_at`, leaving the
historical `initial_expires_at` immutable. Migration 004 has not been applied
remotely. No business features are running; the pages are still placeholders.
The functional specification is [`SPEC.md`](./SPEC.md) (Spanish).

## Tech stack

- Next.js 16 (App Router) + React 19 + TypeScript (strict mode)
- Tailwind CSS 4
- Supabase: PostgreSQL, Auth, Storage, Realtime via `@supabase/ssr` (project not
  provisioned yet)
- Zod (validation), Vitest (tests), ESLint (flat config)
- Deployed on Vercel

Architecture: **modular monolith** — no Express, Strapi, microservices or
background workers. The pending recurring SLA notifications will require a
future scheduler decision (see DECISIONS #25). See
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

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
| [`docs/ROADMAP.md`](./docs/ROADMAP.md) | Phases and future requirements (OQ-17 implemented locally in Phase 4; OQ-16 pending in Phase 6) |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Layers, folder responsibilities, security invariants |
| [`docs/DATABASE_DESIGN.md`](./docs/DATABASE_DESIGN.md) | Tables, columns, relationships, indexes, ER diagram (design; M1–M3 + M4/OQ-17 implemented) |
| [`docs/SECURITY_DESIGN.md`](./docs/SECURITY_DESIGN.md) | Roles, access boundaries, RLS/storage policies and OQ-17 token authorization (design; M1–M4 implemented) |
| [`docs/DECISIONS.md`](./docs/DECISIONS.md) | Key architectural decisions and their rationale |
| [`TASKS.md`](./TASKS.md) | Checklist of completed and upcoming tasks |
