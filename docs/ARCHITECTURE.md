# ARCHITECTURE

Pastelería Online is a **modular monolith**: a single Next.js application
(App Router) deployed on Vercel, backed by Supabase (PostgreSQL, Auth, Storage,
Realtime). There is no separate backend service, no Express/Strapi, and no
background workers — SPEC §17 requires no additional infrastructure without a
concrete need.

The functional source of truth is [`SPEC.md`](../SPEC.md). This document covers
technical structure and invariants.

## 1. Layers

Dependency direction: **routes → features → domain ← infrastructure**, with
validation applied at the boundary before anything reaches the domain or the
database.

| Layer | Folder | May import | Must never import |
| --- | --- | --- | --- |
| Routes | `src/app/` | features, components, validation | — (thin: parse params, call one use case, render) |
| Shared UI | `src/components/` | other components, props | features, infrastructure, Supabase |
| Features | `src/features/` | domain, validation, infrastructure, components | other features' internals |
| Domain | `src/domain/` | nothing external | React, Next.js, Supabase, Zod, UI code |
| Infrastructure | `src/infrastructure/` | domain types | React components/UI |
| Validation | `src/validation/` | Zod | UI code |
| Testing utilities | `src/test/` | anything (test-only) | — (never imported by production code) |

Business rules live in `src/domain` (and `src/features` use cases), never inside
components. Every folder contains a README with its specific rules.

## 2. Route structure and customer/admin separation

```
src/app/
├── layout.tsx                 # Root layout: <html lang="es">, fonts, metadata
├── globals.css                # Tailwind CSS entry
├── favicon.ico
├── (storefront)/page.tsx      # /            customer-facing
└── (admin)/admin/page.tsx     # /admin       private panel (placeholder, no data)
```

- The `(storefront)` route group will hold all customer routes:
  catalog, cart, checkout, private order tracking.
- The `(admin)/admin` segment holds the private panel for the two administrators
  (dashboard, orders, products, inventory, sales, payments, refunds, settings —
  SPEC §15). Authorization will be enforced server-side from the database, not
  from `user_metadata`.
- The same separation is mirrored in code: customer features and admin modules
  are separate folders under `src/features/`, so an admin-only capability can
  never be mounted into the storefront by accident.
- **Phase 0 note:** both pages are placeholders that render no data; `/admin` has
  no auth guard yet because no authentication flow exists in this phase.

Planned route map (documented, not implemented):

| Route | Purpose | Phase |
| --- | --- | --- |
| `/` | Storefront home / catalog | 1 |
| `/productos/[slug]` | Product detail | 1 |
| `/carrito`, `/checkout` | Cart and guest checkout | 3 |
| `/seguimiento/[token]` | Private order tracking link | 3 |
| `/admin` | Panel dashboard | 1 (shell), 5 (full) |
| `/admin/pedidos`, `/admin/productos`, `/admin/inventario`, `/admin/pagos`, `/admin/ventas`, `/admin/configuracion` | Admin modules | 1–5 |

## 3. Supabase access

All Supabase access goes through `src/infrastructure/supabase`; features never
construct clients themselves.

| Module | Runtime | Credential | Purpose |
| --- | --- | --- | --- |
| `client.ts` | Browser (Client Components) | `NEXT_PUBLIC_*` anon key | Reads limited by RLS |
| `server.ts` | Server Components, Server Actions, Route Handlers | anon key + session cookies | Authenticated server work, one client per request |
| `admin.ts` | Server only (`server-only` marker) | `SUPABASE_SERVICE_ROLE_KEY` | Privileged operations that RLS cannot express |

Rules:

- The service-role key is **never** read from client code: `env.server.ts` and
  `admin.ts` import the `server-only` marker, so a client-side import fails at
  build time, and the key is a non-`NEXT_PUBLIC_` variable (never inlined).
- Database TypeScript types (generated from migrations) will be added to these
  clients in Phase 1; Phase 0 invents no schema.
- Critical operations (stock reservation, FIFO allocation, payment registration)
  will be implemented as PostgreSQL functions/RPC so they are atomic and
  idempotent (SPEC §8), executed from the server.
- Supabase Realtime (admin notifications) and Storage (public product photos,
  private receipts) plug into the same layer in later phases.

## 4. Data flow of a business operation (design target)

1. UI (storefront or admin) submits a form/server action.
2. `src/validation` parses the payload with Zod — the client is untrusted.
3. Authorization is checked server-side (session + database-backed admin role).
4. The domain (`src/domain`) applies business rules: prices, totals and BCV
   conversion are **recalculated on the server**; inventory quantities and
   payment status from the client are ignored.
5. Infrastructure persists through Supabase (RPC/transaction where atomicity
   matters).
6. Errors are mapped to user-facing messages; the database remains the source
   of truth.

## 5. Security invariants (SPEC §16)

These are non-negotiable and apply from Phase 1 onward:

- RLS on every exposed table; admin authorization validated from the database.
- Never trust roles from `user_metadata`; service-role key server-side only.
- Receipts in a private bucket; product photographs in a public bucket.
- Prices, delivery fees and totals recalculated in server code.
- Inventory mutated only through atomic, idempotent operations.
- State transitions validated on the server (orders and payments are separate
  state machines — SPEC §10).
- Tracking links use random tokens; only hashes are stored.
- Duplicates (payments, reservations, sales) are prevented; administrative
  operations are audited.
- No secrets in source code; `.env.local` is git-ignored, `.env.example` carries
  documented names only.

## 6. Configuration and environment

Documented in `.env.example`:

| Variable | Scope | Used by |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Public (inlined at build) | `infrastructure/env.ts` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public (inlined at build) | `infrastructure/env.ts` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | `infrastructure/env.server.ts` |

All variables are validated with Zod when read, so misconfiguration fails fast
with a message naming the variable.

## 7. Quality gates

- **TypeScript strict mode** (`tsconfig.json` → `"strict": true`).
- **ESLint** flat config (`eslint.config.mjs`) via `eslint-config-next`
  (core-web-vitals + TypeScript rules).
- **Vitest** for unit tests, colocated as `*.test.ts(x)` under `src/`; tests
  must run without network access or real credentials.
- CI/deploy parity: `npm test`, `npm run lint`, `npm run build`, and
  `npm run typecheck` (after a build so generated route types exist).

## 8. Extension points (why this structure scales)

- **Whole cakes made to order:** a new feature module (`src/features/production/`
  or similar) plus domain rules for production-on-demand; the existing inventory
  model (ready-made portions) stays untouched until then.
- **New payment methods:** each method is a registered payment component; the
  order/ payment state machines and the "fully paid when all components are
  verified" rule already accommodate them.
- **More products:** catalog is data-driven from day one — three initial
  varieties require no code change to expand.
- **More administrators:** authentication is table/RLS-driven, not hard-coded;
  two administrators now, more later without restructuring.
