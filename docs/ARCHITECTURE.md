# ARCHITECTURE

Pastelería Online is a **modular monolith**: a single Next.js application
(App Router) deployed on Vercel, backed by Supabase (PostgreSQL, Auth, Storage,
Realtime). There is no separate backend service and no Express/Strapi — SPEC
§17 requires no additional infrastructure without a concrete need. The one
exception is the narrow OQ-16 receipt-SLA worker
(`supabase/worker/sla-worker.mjs`): a scheduled Node process authorized only by
the amendment to DECISIONS #1, calling one service-role RPC with no business
state writes. It is not a second deployable/service.

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
├── layout.tsx                       # Root layout: <html lang="es">, fonts, metadata
├── globals.css                      # Tailwind CSS entry + storefront/admin tokens
├── favicon.ico
├── (storefront)/page.tsx            # /                    public product list
├── (storefront)/productos/[slug]/
│   ├── page.tsx                     # /productos/[slug]    public product detail
│   └── not-found.tsx                # Spanish fallback for unknown/inactive slugs
└── (admin)/admin/
    ├── layout.tsx                   # fail-closed session gate, noindex, instant = false
    ├── page.tsx                     # /admin               Resumen dashboard
    ├── pedidos/page.tsx             # /admin/pedidos       orders list
    ├── pedidos/[id]/page.tsx        # /admin/pedidos/[id]  order detail
    ├── pedidos/detalle/page.tsx     # /admin/pedidos/detalle  sidebar helper
    ├── comprobantes/page.tsx        # /admin/comprobantes  receipt review
    ├── pagos/externo/page.tsx       # /admin/pagos/externo external payment
    ├── productos/page.tsx           # /admin/productos     product CRUD
    ├── inventario/page.tsx          # /admin/inventario    inventory
    ├── punto-de-venta/page.tsx      # /admin/punto-de-venta  POS
    ├── cancelaciones/page.tsx       # /admin/cancelaciones cancellations
    └── configuracion/page.tsx       # /admin/configuracion settings
```

- The `(storefront)` route group will hold all customer routes:
  catalog, cart, checkout, private order tracking.
- The `(admin)/admin` segment holds the private panel for the two administrators
  (SPEC §15). All 11 admin routes listed above are implemented locally. The
  shared `src/app/(admin)/admin/layout.tsx` gate resolves authorization before
  any frame renders: it uses the request-bound server client to check
  `auth.getUser()` and `administrators.is_active`, then fails closed. It never
  trusts `user_metadata`. The layout sets `robots: noindex, nofollow` and
  `instant = false`, and renders the alerts pill only from real
  `admin_notifications` rows via `getUnreadAdminNotificationCount()`.
- The same separation is mirrored in code: customer features and admin modules
  are separate folders under `src/features/`, so an admin-only capability can
  never be mounted into the storefront by accident. Admin work lives in
  `src/features/admin/` (server read/helper layer) and `src/components/admin/`
  (shell, sidebar and UI primitives). Every server helper gates with
  `requireActiveAdminId()`; it uses the session client for RLS tables and the
  service-role client only for `get_product_stock`, returning graceful Spanish
  `unavailable` results without raw database errors.
- Two-admin auth provisioning remains pending (B2). All repository migrations
  are applied in Staging and Production, including migration 005 and migration
  015; deployment of the unified worker is pending. Admin reads still show
  honest unavailable states where runtime or business data is missing.

Route map (the Phase column records the original roadmap phase):

| Route | Purpose | Phase | Status |
| --- | --- | --- | --- |
| `/` | Storefront home / catalog | 1 | Implemented |
| `/productos/[slug]` | Product detail | 1 | Implemented |
| `/carrito`, `/checkout` | Cart and guest checkout | 3 | Planned |
| `/seguimiento/[token]` | Private order tracking link | 3 | Implemented in code |
| `/admin` | Resumen dashboard | 1 (shell), 5 (full) | Implemented locally |
| `/admin/pedidos`, `/admin/pedidos/[id]`, `/admin/pedidos/detalle` | Orders list, detail, sidebar helper | 3–5 | Implemented locally |
| `/admin/comprobantes`, `/admin/pagos/externo` | Receipt review, external cash payment | 5 | Implemented locally |
| `/admin/productos` | Session-guarded product CRUD and image management | 1 | Implemented locally |
| `/admin/inventario`, `/admin/punto-de-venta` | Inventory, point of sale | 2, 5 | Implemented locally |
| `/admin/cancelaciones`, `/admin/configuracion` | Cancellations, settings | 3, 6 | Implemented locally |

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
- Read-only RPCs granted to `anon` or `authenticated` use `server.ts`. The read
  then uses the same Supabase project as the session that displays it, and it
  does not depend on a privileged credential. Use `admin.ts` only when the RPC
  or table requires privilege.
- Database TypeScript types are generated from migrations and all three clients
  use the generated-derived `Database` generic, with a narrow adapter for five
  decimal/null RPC `Args`. No schema is invented.
- Critical operations (stock reservation, FIFO allocation, payment registration)
  will be implemented as PostgreSQL functions/RPC so they are atomic and
  idempotent (SPEC §8), executed from the server.
- Supabase Realtime (admin notifications) and Storage (public product photos,
  private receipts) plug into the same layer in later phases.
- **Unified worker runtime (implemented locally, deployment pending):**
  `supabase/worker/runtime.mjs` (`npm run worker:unified`) starts the BCV
  exchange-rate worker and the OQ-16 receipt-SLA worker in the **same**
  Render Web Service process. The runtime owns the single `node:http` health
  server and `/healthz`; each worker keeps its own schedule and lifecycle.
  A supervisor restarts an unexpectedly failed worker without stopping the other.
  Shutdown is idempotent and coordinates both workers and the HTTP server.
  Deployment/activation is pending; manual Render steps are documented in
  `docs/WORKER_DEPLOYMENT.md`.
- **Admin BCV write errors:** privileged rate actions classify RPC failures by
  SQLSTATE and stable message fragments. Callers receive Spanish guidance;
  server logs receive only the operation, category and nullable code, never SQL,
  raw messages or credential values. Grants and rate rules are unchanged.
- **OQ-16 SLA inbox:** `admin_notifications` + `receipt_submissions` (migration
  005) and `supabase/worker/sla-worker.mjs` provide overdue receipt-review
  notifications. Runtime integration does not change SLA semantics. OQ-16
  migration prerequisite complete: migration 005 applied in Staging and
  Production. Deployment and runtime validation remain pending;
  `admin_notifications` Realtime publication is not part of this task.
- **Phase 6 General Admin Notifications (planned, separate):** independent
  in-panel event notifications (new order, new/corrected receipt, new review) with
  history/navigation/read/read-all/realtime. Must keep OQ-16 SLA table/RPC/worker
  isolated; do not force general events into SLA schema. See DECISIONS #40.

### Public catalog reads

`/` and `/productos/[slug]` call `createSupabaseServerClient()` inside their data
components. The request-bound anon client reads only active rows from `products`
and their `product_images` through existing row-level security (RLS) policies.
The work uses no service-role client; the shared server client now carries the
generated-derived `Database` generic like the other two clients.
`src/features/catalog/schemas.ts` validates PostgREST rows and the rendered
product shape with Zod. `queries.ts` accepts a narrow injected client, orders
products by `id`, batches image reads, orders images by `position` then `id`, and
maps errors to Spanish messages.

Both routes render a static shell with the data fetch inside `<Suspense>`, so
Next.js 16 treats them as Partial Prerender (PPR) routes. Unknown or inactive
slugs call `notFound()` after the shell starts streaming. The response keeps HTTP
status 200 and includes `<meta name="robots" content="noindex">`. Returning a
literal 404 requires `generateStaticParams` and data access before streaming,
which needs real catalog data at build time and is out of scope.

Image URLs come from the public `product-images` bucket. `next.config.ts` allows
only exact HTTPS hosts on `/storage/v1/object/public/**`: it derives a pattern
from `NEXT_PUBLIC_SUPABASE_URL` when parseable and always retains the known
project host `hqemhwhwwjdfzpwqbory.supabase.co` as a fallback because the
affected build did not expose the variable when the config was evaluated. No
wildcard hosts, query strings or image-security relaxations are used. Set a
valid URL at build time for Supabase client calls.

Follow-up: the public SELECT policies grant access `TO anon`. An authenticated
non-admin needs a policy update once auth exists.

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
