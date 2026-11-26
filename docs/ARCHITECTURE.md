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
    ├── resenas/page.tsx             # /admin/resenas       review moderation
    ├── notificaciones/page.tsx      # /admin/notificaciones unified inbox
    ├── inventario/page.tsx          # /admin/inventario    inventory
    ├── punto-de-venta/page.tsx      # /admin/punto-de-venta  POS
    ├── cancelaciones/page.tsx       # /admin/cancelaciones cancellations
    └── configuracion/page.tsx       # /admin/configuracion settings
```

- The `(storefront)` route group will hold all customer routes:
  catalog, cart, checkout, private order tracking.
- The `(admin)/admin` segment holds the private panel for the two administrators
  (SPEC §15). All admin routes listed above are implemented locally. The
  shared `src/app/(admin)/admin/layout.tsx` gate resolves authorization before
  any frame renders: it uses the request-bound server client to check
  `auth.getUser()` and `administrators.is_active`, then fails closed. It never
  trusts `user_metadata`. The layout sets `robots: noindex, nofollow` and
  `instant = false`. There are still **two durable unread sources** in the
  database, but one presentation: the layout sums the real counts from
  `getAdminGeneralUnreadCount()` and `getUnreadAdminNotificationCount()` via
  `combineUnreadCounts()`. A single accessible **Notificaciones** sidebar badge
  is the only unread indicator; the old topbar alerts pill was removed
  (DECISIONS #42).
- The same separation is mirrored in code: customer features and admin modules
  are separate folders under `src/features/`, so an admin-only capability can
  never be mounted into the storefront by accident. Admin work lives in
  `src/features/admin/` (server read/helper layer) and `src/components/admin/`
  (shell, sidebar and UI primitives). Every server helper gates with
  `requireActiveAdminId()`; it uses the session client for RLS tables and the
  service-role client only for `get_product_stock`, returning graceful Spanish
  `unavailable` results without raw database errors.
- Two-admin auth provisioning remains pending (B2). All repository migrations
  **except migrations 016, 017 and 018** are applied in Staging and Production,
  including migration 005 and migration 015; all three new migrations are
  local-only and deployment of the unified worker is pending. Admin reads still
  show honest unavailable states where runtime or business data is missing.

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
| `/admin/resenas` | Product review moderation (target of review notifications) | 9 | Implemented locally |
| `/admin/notificaciones` | Unified general + SLA notification inbox | 6 | Implemented locally (migrations 016/017 not applied) |
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
  Production. Deployment and runtime validation remain pending; local-only
  migration 017 adds the table to `supabase_realtime` for the unified inbox
  without changing SLA behavior.
- **Phase 6 General Admin Notifications (implemented locally, separate):** the
  in-panel event inbox (new online order, new/corrected receipt, new review) has
  history/navigation/read/read-all/Realtime. The OQ-16 SLA table/RPC/worker remain
  isolated; general events are not forced into the SLA schema. Both sources now
  render in one unified inbox with a single badge. See DECISIONS #40/#41/#42 and
  §9 below. Migrations 016 and 017 are local-only.

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
exactly one bounded HTTPS remote pattern: `*.supabase.co` on
`/storage/v1/object/public/**`, with no port or query string. The wildcard
matches one Supabase project subdomain and is intentional so switching projects
needs no code or config change; it does not depend on `NEXT_PUBLIC_SUPABASE_URL`
at config evaluation time. No deprecated `images.domains`, unbounded wildcard,
`unoptimized` setting or other image-security relaxation is used. Set a valid
URL at build time for Supabase client calls.

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

## 9. Unified admin notifications (Phase 6, local implementation)

The two tables remain independent, but `/admin/notificaciones` is their single
presentation inbox; DECISIONS #41 records the six #40 blockers and #42 records
the unification, combined badge, clickable destinations and Realtime decision.

- **Storage/write path:** migration 016 originally wrote
  `public.admin_general_notifications` with `AFTER INSERT` triggers on online
  `orders` and `product_reviews` and an `AFTER UPDATE OF payment_id` trigger on
  `receipt_submissions` guarded by `OLD.payment_id IS NULL AND NEW.payment_id IS
  NOT NULL` (migrations 006/011 link evidence after `hold_order_reservations`
  created the row). Private `SECURITY DEFINER` triggers call one private fanout
  helper, inserting one row per active administrator inside the originating
  transaction; there is no worker, polling loop or rewrite of older RPCs.
- **New-order timing (local code, migration 018 unapplied):** local-only
  `018_formalized_order_notifications.sql` drops migration 016's `new_order`
  trigger on `AFTER INSERT ON public.orders` and its old function. Digital
  «Hacer pedido» emits through `AFTER UPDATE OF payment_id` on
  `receipt_submissions` when the evidence link is added; pay-in-store
  «Hacer pedido» calls the service-role-only
  `notify_online_order_formalized` RPC after validation. The event key stays
  `new_order:<order_id>` and the summary stays «Nuevo pedido online recibido.»;
  no order, stock, reservation, payment, RLS, policy, publication or
  replica-identity behavior changes. Runtime behavior changes only after someone
  applies 018 remotely.
- **Server layer:** `src/features/admin/general-notifications.ts` is a
  `"use server"` + `server-only` module. Every read/action resolves the admin via
  `requireActiveAdminId()`, uses the request-bound session client, filters by
  that admin id and validates rows with Zod. Only `read_at` is mutable; mark-all
  touches that admin's unread rows only. `general-notifications-helpers.ts` holds
  client-safe keys, Spanish labels and navigation targets; missing targets yield
  no link.
- **Read layer:** `settings-read.ts` resolves SLA `receipt_submissions.order_id`
  for real destinations (50-row cap, `truncated` flag); `general-notifications.ts`
  keeps the 200-row general cap. `unified-notifications-helpers.ts` combines the
  rows newest-first and derives `generalNotificationHref` or
  `/admin/comprobantes?orderId=<orderId>`; a missing target id yields no link.
- **Client layer:** `src/app/(admin)/admin/(panel)/notificaciones/page.tsx`
  renders one Spanish inbox manager for both sources with explicit 200/50-row
  truncation notes. Summary and destination are real accessible links. General
  rows keep mark-read/unread; SLA rows keep mark-read only; mark-all calls two
  narrowly scoped server actions sequentially. The sidebar shows one combined
  badge with an `aria-label` in Spanish and no non-clickable topbar pill.
- **Realtime boundary:** migrations 016 and local-only 017 add both tables to
  `supabase_realtime` through catalog-based membership checks and keep the
  **default replica identity** (no `REPLICA IDENTITY FULL`). The browser
  subscriber uses `event: "INSERT"` on both, filters by the session-derived
  `admin_id`, performs one delayed reconnect per channel on error/timeout, and
  debounces `router.refresh()`. `payload.old` and UPDATE delivery are not used;
  there is no polling. The database remains the source of truth.
- **Readiness:** local Realtime wiring is complete in code; remote delivery still
  depends on applying migrations 016/017 and confirming both tables belong to
  `supabase_realtime`.
- **State:** migrations 016 and 017 exist locally and have **not** been applied
  remotely; 017 only publishes `admin_notifications` to Realtime (no RLS, grant,
  trigger, RPC or replica-identity change). Behavioral SQL tests were skipped
  locally (no PostgreSQL binaries). Static/mocked tests, typecheck, ESLint and
  the build were run for this change; runtime and remote validation remain open
  phase gates. OQ-16 SLA worker activation is a separate track.

## 10. Local UI feedback and notification opening (ADR #43)

- **Cart flight boundary:** `src/features/cart/cart-flight.ts` is a client-safe
  pub/sub with no server imports. `announceCartFlight` reads the clicked button's
  rect immediately and broadcasts only `{ label, origin: { x, y } }`; no DOM node
  is stored in React state. `CartFlightLayer` is a small Client Component mounted
  in `SiteHeader`; it resolves `[data-cart-target]` at flight time, computes the
  target center, skips on reduced motion, a missing endpoint or an offscreen
  launch point, and renders `aria-hidden` chips in a `pointer-events-none fixed inset-0 z-[60]`
  overlay. The 36px chip stays at opacity `1` with high-contrast plum/white styling
  and `font-black` weight; it scales `1 → 1.08 → 1` only near the bag and never
  fades, blurs, glows or leaves trails. WAAPI drives pixel-only `translate()` and
  `scale()` keyframes; no custom CSS keyframes, filter, `calc()` transform or new
  dependency is used. Flight ids assign deterministic lane offsets and cap
  simultaneous flights at four, so rapid adds start at origin plus lane and end
  at cart center plus a reduced lane offset. A real animation finish triggers a
  transform-only WAAPI bag bounce (`scale 1 → 1.06 → 1`, `translateY 0 → -2px → 0`);
  another arrival cancels and restarts that bounce instead of stacking it.
  Reduced motion skips both effects. The chip never occupies header space, and
  toasts remain at `z-[80]`. The decorative chip does not change cart quantities,
  prices, stock, checkout, localStorage, server validation or the existing toast.
  The add action now derives remaining capacity from server-provided `available`
  minus the same product's quantity in the local bag, and the server stays the
  final authority.
- **Cart stock guard boundary (ADR #44):** the server renders an active-product
  stock map for `/carrito` through `getActiveProductStockMap()` in
  `src/features/catalog/public-data.ts`. The server-only helper selects active
  product ids, reuses `getProductStockMap` and the service-role-only
  `get_product_stock` RPC, reads no inventory tables directly, and fails closed
  to `{}`. The client `+` control uses the pure, environment-neutral
  `canIncreaseCartItemQuantity(available, quantity)` helper; it disables at known
  stock limits, gives an accurate accessible label, shows a Spanish `LiveRegion`
  explanation, and leaves unknown stock to the server-side fallback. The `-`
  control stays enabled so shoppers can correct stale over-stock carts. Browser
  code reads no inventory tables, and prices, totals, checkout links, the
  `localStorage` schema, cart context, server validation and reservations stay
  unchanged.
- **Mobile navigation:** `SiteHeader` derives `mobileNavOpen` from `usePathname()`
  so a route change closes the menu without a cascading state update in an
  effect; Escape closes it and returns focus to the SVG toggle. The panel is an
  `absolute inset-x-0 top-full z-40` overlay with 200 ms opacity/translate
  transitions and inert closed links, so opening it does not push page content
  down. The storefront layout wraps the header in `Suspense` because
  `usePathname()` is runtime-only on partially prerendered tracking routes.
  Desktop nav and bag behavior are not changed; the bag word/separator hide
  below `sm` while the accessible label remains.
- **Open-to-read:** the unified manager's shared click handler fires the existing
  server actions from `onClick` only for unread rows with a real href and a safe
  id. It is deliberately fire-and-forget; Next.js `Link` still owns navigation,
  modifier clicks and keyboard activation, and no local read state is invented.
- **Realtime toast:** `UnifiedNotificationsRealtime` calls the existing
  `useToast()` provider with Spanish text derived from `payload.new` and a pure
  dedupe helper keyed by real row id. The debounced refresh, one delayed
  reconnect per channel, cleanup and INSERT-only configs remain exactly as #42.
  There is no polling, permission prompt, service worker, VAPID, e-mail,
  WhatsApp or other external delivery path.

**Final local validation (ADR #44 cart stock guard and ADR #45 new-order
timing):** the combined focused Vitest run passed **16 files and 158 tests**,
including cart-only **4 files and 47 tests** and migration-018-focused **5 files
and 47 tests**. ESLint returned no output for all **22 changed or added
`.ts`/`.tsx` files**, `npm run typecheck` passed, `npm run build` passed with
Next.js 16.4.6 and **25 routes**, and `git diff --check` was clean. `npm test`
remains red for three unchanged unrelated pre-existing failures listed in
`TASKS.md`: **546 of 549 tests and 57 of 59 files passed**. Migrations 016, 017
and 018 remain local-only; remote application and runtime Realtime validation
remain human gates.
