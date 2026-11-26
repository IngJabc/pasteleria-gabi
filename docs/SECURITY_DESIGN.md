# SECURITY DESIGN

Roles, access boundaries and proposed RLS policies for Pastelería Online
(Phase 1A design).

**Status:** the M1 subset (§3 authorization helper, §4 policies for the six M1
tables, §7 `product-images` bucket) is implemented in
`supabase/migrations/001_catalog_and_admin_foundation.sql` (renamed from
`20261114023000_m1_…` when the PR merged) and was verified behaviorally on a
local PostgreSQL cluster with a Supabase stub (anon/authenticated/service_role,
`auth.uid()`, `storage.objects`) — including the non-admin, self-attribution,
append-only and no-self-granting cases. **M1 has been applied to the production
Supabase project (local ↔ remote synchronized).** The M2 subset (§4.1
`inventory_batches`/`inventory_movements` rows, §4.2 append-only inventory
policies, §5 `create_inventory_batch`/`adjust_inventory`/`get_product_stock`
grants) is implemented in `supabase/migrations/002_inventory_foundation.sql`
with the same local verification (including anon/non-admin/service-role
boundaries and the concurrency lock). The M3 subset (§4.1
`orders`/`order_items`/`inventory_reservations`/
`cancellation_requests`/`exchange_rates` rows, §4.2 admin-ALL policies with
the anon SELECT on `exchange_rates`, §5's eight service-role-only order RPCs,
§6 hashed tracking) is implemented in
`supabase/migrations/003_orders_and_reservations.sql` with the same local
verification (PII-free tracking, duplicate-cancellation 23505, RLS and grant
boundaries, concurrent checkout/consume). The Phase 4 / M4 subset (§5 service-role
RPCs, §6 token-based quote acceptance and extended PII-free tracking projection,
§8 invariant) is implemented in
`supabase/migrations/004_quote_acceptance.sql` with local validation. The Phase 6
/ M6 OQ-16 subset is implemented in
`supabase/migrations/005_receipt_sla_notifications.sql` plus the narrow
`supabase/worker/sla-worker.mjs` and was validated locally with 143 tests. All
these migrations are applied in Staging and Production; worker deployment and
runtime validation remain pending.

The Payments Module subset (§4 payments/refunds and `payment-receipts` policies,
§5 service-role RPCs, §6/§7/§8 token, storage and validation invariants) is
implemented in `supabase/migrations/006_payments_and_verification.sql` and
behaviorally validated on a disposable local PostgreSQL cluster, with details in
the final implementation report. It is applied in Staging and Production.
Migrations 001–005 are untouched. Historical docs call this scope "Phase 4",
tasking calls it "Phase 5"; both names refer to the same backend. The
Phase 5b / OQ-4 + OQ-5 subset (§4 rate history RLS unchanged, §5 service-role
rate/snapshot RPCs, §6/§7/§8 admin attribution, idempotency and rounding
invariants) is implemented additively in
`supabase/migrations/007_bcv_rates_and_rounding.sql` and behaviorally validated on
a disposable local PostgreSQL cluster. It is applied in Staging and Production.
Migrations 001–006 are untouched and 006 remains the local validation baseline.
Policies for later migrations remain proposals, derived from
[`SPEC.md`](../SPEC.md) §16
and the invariants in
[`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) §5. Table/column definitions live in
[`DATABASE_DESIGN.md`](./DATABASE_DESIGN.md).

---

## 1. Threat model and principles

The client is hostile by default. Concretely:

1. **Prices, totals, stock quantities and payment statuses are never accepted
   from the client.** The server re-reads prices from `products`, recomputes
   totals and checks availability. The strongest structural guarantee: anonymous
   clients have **no write access to any business table** — every mutation flows
   through server code (service role) or admin-only policies.
2. **Authorization comes from database rows** (`administrators`), evaluated per
   request by RLS. Never from `user_metadata` (editable by the user), never
   from `app_metadata` claims alone (stale until token refresh).
3. **Least privilege per Postgres role** (§2); the service-role key exists only
   in server code (already enforced in Phase 0 via `server-only` imports).
4. **Guests touch nothing directly.** Order tracking and cancellation requests
   go through server-side functions that validate the private token; there is no
   anonymous access to `orders`, `payments` or `inventory` tables.
5. **Defense in depth:** RLS on every table (force-enabled), storage policies
   on both buckets, explicit `EXECUTE` grants on functions, append-only audit.

## 2. Postgres roles

| Role | Capabilities | Reaches the API via |
| --- | --- | --- |
| `anon` | Public catalog reads only (`products`, `product_images`, `delivery_zones`, `store_settings`, `exchange_rates`). **Zero writes anywhere. No access to orders/payments/inventory/customers.** | Supabase key in the browser |
| `authenticated` | Everything `anon` can do, plus administrator powers — but only for users with an active `administrators` row (RLS predicate). No self-signup path. | Session cookie via `@supabase/ssr` |
| `service_role` | Bypasses RLS (server-only credential). Used for guest checkout, receipt uploads, rate ingestion, seeded/privileged RPCs. | `SUPABASE_SERVICE_ROLE_KEY` in server actions |
| `postgres` (owner) | Migration/owner DDL. | Supabase dashboard / SQL editor |

Notes:

- Tables are exposed through PostgREST only where needed; RLS — not table
  privileges — is the row-level boundary. `FORCE ROW LEVEL SECURITY` is applied
  to every table as defense in depth (the owner/`postgres` bypasses it anyway;
  `service_role` has `bypassrls` — both are intentional paths).
- With **no policy** for a role, that role sees zero rows even if it holds the
  table `SELECT`/`INSERT` privilege (Supabase default grants). RLS enabled +
  no policy = no access.

## 3. Authorization model (administrators)

### 3.1 Source of truth

```
auth.users (credentials, e-mail)          ← Supabase Auth
        │ 1:1
administrators (id uuid PK, display_name, is_active)   ← authorization truth
```

- A user is authorized **iff** an `administrators` row with `is_active = true`
  exists for `auth.uid()`.
- `user_metadata` / `app_metadata` are **never** read for authorization
  (SPEC §16). Consequences: a deactivated admin loses access on the very next
  query (the policy reads the table live); roles cannot be forged by the user.
- **Provisioning:** no public signups. The two accounts are created by an
  administrator in the Supabase dashboard (or via migration seed once e-mail
  addresses are known — OQ-1), and the `administrators` row is inserted with
  the service role. Clients have **no INSERT/UPDATE/DELETE policy** on
  `administrators`, so no authenticated user can grant themselves anything.
- **No role hierarchy:** SPEC §2 gives both admins identical permissions, so a
  single "membership = full access" predicate is used. Granular roles would be
  a future `role` column + helper change, not a redesign.

### 3.2 The policy helper `private.is_admin()`

RLS policies on `administrators` itself cannot `SELECT administrators`
(recursive policy evaluation → Postgres "infinite recursion" error). The
standard fix: a `SECURITY DEFINER` helper that reads the table as its owner:

- Lives in the **`private` schema**, which is not exposed by PostgREST — not
  callable as an RPC by clients.
- `SET search_path = ''` with fully qualified calls; returns a boolean only.
- Body checks `(select auth.uid())` **inside** the function (explicit identity
  check, per Supabase guidance) and requires `is_active`.
- `EXECUTE` is granted to the roles that need it for policies (`authenticated`,
  and `anon` — it simply returns false for anonymous callers; there is no other
  callable surface outside the exposed schema).
- Used **wrapped in a scalar subquery** in policies (`(select private.is_admin())`)
  so it executes once per statement, not once per row.

## 4. RLS policies (proposed)

> **Status:** the M1 policies (six catalog/settings/zone tables, storage) are
> applied in migration `001`, the M2 inventory policies in `002`, and the M3
> order/reservation/cancellation/exchange-rate policies in `003`; the
> payments/refunds and private receipt-bucket policies in `006`; other rows
> marked M4+ remain proposals for a later migration. Convention: policies specify
> `TO anon` / `TO authenticated` explicitly (never the deprecated
> `auth.role()`), wrap identity lookups as `(select …)`, and every `UPDATE`
> policy carries both `USING` and `WITH CHECK`.

### 4.1 Access matrix

Table cells: allowed operations. `—` = no policy ⇒ no access.

| Table | anon | authenticated (admin) | service_role |
| --- | --- | --- | --- |
| `products` | SELECT (`is_active`) | ALL | bypass |
| `product_images` | SELECT (active product only) | ALL | bypass |
| `delivery_zones` | SELECT (`is_active`) | ALL | bypass |
| `store_settings` | SELECT (no write policy) | ALL (admin-only via `private.is_admin()`) | bypass |
| `exchange_rates` | SELECT | ALL | bypass |
| `administrators` | — | SELECT | write only |
| `orders` | — (tracking via server function) | ALL | bypass |
| `order_items` | — | ALL | bypass |
| `payments` | — (no anon read) | SELECT (RLS via `private.is_admin()`; no table writes) | bypass |
| `payment_refunds` | — (no anon read) | SELECT (RLS via `private.is_admin()`; no table writes) | bypass |
| `receipt_submissions` | — | SELECT (review/SLA history) | bypass |
| `cancellation_requests` | — | ALL | bypass |
| `inventory_batches` | — (stock via server function) | ALL | bypass |
| `inventory_reservations` | — | ALL | bypass |
| `inventory_movements` | — | SELECT, INSERT (no UPDATE/DELETE) | bypass |
| `audit_log` | — | SELECT, INSERT as self (no UPDATE/DELETE) | bypass |

`inventory_movements` and `audit_log` are append-only for client roles: an
admin can add rows (entries, adjustments, audit events) but no policy lets
anyone rewrite history. (Service role, by design, still bypasses RLS — the
operational rule "never UPDATE these tables" is documented for server code.)

Migration 006 implements the `payments`/`payment_refunds` rows above with RLS
enabled **and forced**, admin-only ALL policies and least-privilege grants:
`anon` cannot read payment tables, authenticated admins can read via RLS, and
**no client role has a table write path** — every mutation is a service-role
RPC. `payment_refunds` is append-only in practice (no client UPDATE/DELETE
path); `payments.status` changes only through the review/refund RPCs.

### 4.2 Representative policies

```sql
-- helpers (proposed)
create schema if not exists private;
create or replace function private.is_admin()
returns boolean language sql security definer set search_path = ''
as $$
  select exists (
    select 1 from public.administrators
    where id = (select auth.uid()) and is_active
  );
$$;
revoke execute on function private.is_admin() from public, anon, authenticated;
grant  execute on function private.is_admin() to authenticated, anon;
-- (execute needed by policies; function exposes only a boolean about the caller)
```

```sql
-- public catalog
create policy products_public_select on public.products
  for select to anon using (is_active);

create policy product_images_public_select on public.product_images
  for select to anon
  using (exists (
    select 1 from public.products p
    where p.id = product_id and p.is_active
  ));

create policy delivery_zones_public_select on public.delivery_zones
  for select to anon using (is_active);

create policy store_settings_public_select on public.store_settings
  for select to anon using (true);   -- single row, customer-facing content only

create policy exchange_rates_public_select on public.exchange_rates
  for select to anon using (true);   -- public BCV data, read-only
```

```sql
-- administrator powers (one ALL policy per table, is_admin wrapped in a subquery)
create policy orders_admin_all on public.orders
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- identical policy shape for: order_items, payments, payment_refunds (both
-- implemented in migration 006, with table writes additionally revoked from
-- anon/authenticated and only SELECT granted to authenticated),
-- cancellation_requests, inventory_batches, inventory_reservations, products,
-- product_images, delivery_zones, store_settings, exchange_rates
```

```sql
-- administrators: read-only for admins; writes only via service role
create policy administrators_select on public.administrators
  for select to authenticated using ((select private.is_admin()));

-- inventory_movements: append-only
create policy inventory_movements_select on public.inventory_movements
  for select to authenticated using ((select private.is_admin()));
create policy inventory_movements_insert on public.inventory_movements
  for insert to authenticated with check ((select private.is_admin()));

-- audit_log: append-only, attributed to the acting admin
create policy audit_log_select on public.audit_log
  for select to authenticated using ((select private.is_admin()));
create policy audit_log_insert_as_self on public.audit_log
  for insert to authenticated
  with check ((select private.is_admin()) and admin_id = (select auth.uid()));
```

Anti-patterns deliberately avoided:

- No `using (true)` policy on any business table for `anon`.
- No `auth.role()` checks (deprecated; breaks under anonymous sign-in).
- No policy that lets a client set `admin_id`/`verified_by`/`status` to an
  arbitrary value: `UPDATE` policies require `is_admin()` (the *server* domain
  code still validates which state transitions are legal — SPEC §10).
- No reliance on `user_metadata` anywhere.

## 5. Function (RPC) surface and `EXECUTE` grants

| Function | `EXECUTE` grant | Why |
| --- | --- | --- |
| `private.is_admin()` | `authenticated`, `anon` (policy evaluation only; not in an exposed schema) | boolean about the caller only |
| `create_online_order`, `hold_order_reservations`, `open_order_correction_window`, `release_expired_reservations`, `consume_order_reservations`, `release_order_reservations`, `get_order_for_tracking`, `request_order_cancellation` (Phase 3 — implemented in migration 003), plus `get_product_stock` | **service role only** (`revoke … from public, anon, authenticated`) | called from Next.js server code; guests never call PostgREST directly |
| `accept_quote_fee`, `accept_quote_fee_for_tracking`, and the replaced `get_order_for_tracking` (Phase 4 — implemented in migration 004) | **service role only** (explicit `revoke … from public, anon, authenticated`; `SECURITY INVOKER`, `search_path = ''`) | quote acceptance is dispatched only from the server action after token validation; `accept_quote_fee` is an internal primitive (no customer authorization by order id) |
| `adjust_inventory`, `create_inventory_batch` (Phase 2 — implemented in migration 002) | `authenticated` only (`revoke … from public, anon, service_role`), with an internal `is_admin()` check in the body | admin panel needs them with the caller's `auth.uid()` for attribution |
| `process_sla_notifications`, `approve_receipt_submission` and `private.close_pending_receipt_submission` (Phase 6 — implemented in migration 005) | **service role only** (explicit `revoke … from public, anon, authenticated`; `VOLATILE`, `SECURITY INVOKER`, `search_path = ''`) | only the dedicated SLA worker or server-side review flow may close SLA state; clients have no RPC path |
| `register_payment`, `register_payment_for_tracking`, `submit_payment_evidence`, `approve_payment`, `reject_payment`, `register_pos_cash_sale`, `record_refund` (Payments Module — implemented in migration 006) | **service role only** (explicit `revoke … from public, anon, authenticated`; `SECURITY INVOKER`, pinned `search_path`, `VOLATILE` where mutating) | every payment mutation runs from server code; the admin id is checked via `private.require_active_admin`, and guest flows use only the private tracking token |
| `private.require_active_admin(p_admin_id uuid)` (migration 006) | `service_role` only (revoked from `public`, `anon`, `authenticated`) | rechecks that the session-derived administrator is active inside every mutating RPC; never reads `auth.uid()` |
| `get_order_payment_summary(p_order_id)` (migration 006, read-only) | `authenticated` + `service_role`, revoked from `anon` and `public` | per-currency dashboard aggregation under RLS; replaces the earlier `order_payment_summary` view sketch (no view is created) |
| `private.create_admin_general_notification`, `private.enforce_admin_general_notification_immutability`, `private.general_notification_order_trigger`, `private.general_notification_receipt_trigger`, `private.general_notification_review_trigger` (migration 016, **local only**) | `service_role` only (explicit revoke from `public`, `anon`, `authenticated`); all `SECURITY DEFINER` with `search_path = ''` | private fanout/immutability/trigger helpers for general notifications; clients cannot choose a recipient or mutate event identity, and no public RPC is added |

Rules for every function (design-level):

- `SECURITY INVOKER` by default. `SECURITY DEFINER` only where required
  (policy helper, atomic multi-table operations) — and then: `SET search_path = ''`,
  schema-qualified calls, explicit identity validation inside the body
  (`is_admin()` or token hash match), explicit `EXECUTE` revokes from `PUBLIC`.
- Public-schema `SECURITY DEFINER` functions are callable by every role by
  default — that is why guest-facing functions are **not** exposed to `anon` at
  all (§6) and admin ones revoke from `anon`.
- Mutating functions validate their inputs against the database (prices from
  `products`, availability from batches), never from arguments the client
  supplies for money/status fields.

**OQ-16 worker credential:** `supabase/worker/sla-worker.mjs` reads the same
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as
`src/infrastructure/supabase/admin.ts` and uses the same `@supabase/supabase-js`
client options (`persistSession: false`, `autoRefreshToken: false`). It does
**not** import `server-only`/`env.server.ts` (they throw outside Next.js) and
does **not** construct a PostgreSQL connection string: the service-role key is
used only as an HTTP API credential for the single allow-listed RPC. Structure
logs never include recipient/customer PII.

## 6. Guest order tracking (private links)

SPEC §7/§16: a random token link lets a customer follow an order without an
account, without exposing customer information, and without allowing
unauthorized modifications.

**Token lifecycle**

1. At order creation the server generates ≥128 bits of randomness (e.g. 32
   random bytes, base64url) and stores **only** `sha256(token)` in
   `orders.tracking_token_hash` (UNIQUE, indexed).
2. The plaintext token is returned **once**, in the creation response, and
   becomes the URL `/seguimiento/[token]`. It is never persisted in logs,
   `orders`, or analytics.
3. Lookups hash the presented token and match the digest — a leaked database
   dump cannot reconstruct a working link.

**Access path — no direct table access**

- `anon` has **no policy at all** on `orders`/`order_items`/`payments`. An RLS
  policy cannot compare against a query parameter supplied by the client, so
  the only safe pattern is a lookup function — and even that is executed **only
  by the service role inside Next.js server code** on the tracking page. There
  is no anonymous RPC surface, so PostgREST enumeration is impossible.
- `get_order_for_tracking(p_token)` (implemented in migration `003`, extended
  in `004`) returns a **PII-free
  projection**: order status, item names/quantities/prices, totals, timestamps,
  fulfillment type, cancellation-request state, and (from 004)
  `quote_accepted_at`, `quote_acceptance_expires_at` and
  `quote_acceptance_available`. It does **not** return
  `customer_name`, `customer_phone`, `address_*`, instructions, the token hash
  or any payment reference — so even a leaked link exposes no customer
  information (task requirement; also limits blast radius of a forwarded link).
- **No direct table mutations through the link.** A guest can cause two writes,
  both through service-role RPCs reached from server code:
  `request_order_cancellation(p_token, p_reason)` inserts a *pending*
  `cancellation_requests` row and changes nothing else before an administrator
  resolves it (SPEC §11), and (from 004) explicit quote acceptance as described
  below. No client role has write access to `orders` or
  `inventory_reservations`.
- **Quote acceptance through the link (OQ-17, implemented in migration 004).**
  `accept_quote_fee_for_tracking(p_token)` is the **only** customer entry point:
  it validates the token, hashes it with SHA-256 and resolves the order on the
  server before delegating to `accept_quote_fee`. An order id, name or phone is
  **never** accepted as customer authorization. Both RPCs are service-role-only
  and `SECURITY INVOKER` with pinned `search_path`; the acceptance flow locks
  reservations → orders, is idempotent (repeats return the original values
  without writing or reviving closed reservations), and inserts exactly one
  `order.quote_accept` audit row with `admin_id = NULL` and no token/PII in
  `data` in the **same transaction** as the deadline write. The server action
  `src/features/orders/accept-quote.ts` validates that the token is 64 hex
  characters and calls only this RPC; it never writes a table directly.
- **Guest digital payment registration (migration 006):** the server action
  validates the private tracking token, the method and the uploaded file, then
  calls the service-role-only `register_payment_for_tracking`, which resolves
  `sha256(token)` to an order and derives the currency from the method. The
  client supplies neither an order id nor an administrator id, and no payment
  table is writable through the link. `submit_payment_evidence` links the
  server-uploaded receipt to the single pending submission, calling the
  unchanged `hold_order_reservations` for the attempt counter and two-receipt
  cap. Cash payments create no submission. Guest receipt re-view is implemented
  (OQ-12/#37-#38) through this same token-validation boundary: the signed URLs
  are created server-side only, cover all submitted receipts and last exactly
  300 seconds.
- Brute force is infeasible (high-entropy token, unique-indexed digest); no
  rate limiting dependency is added for the MVP.

## 7. Storage access

| Bucket | Visibility | Contents | Path convention |
| --- | --- | --- | --- |
| `product-images` | **public** read | product photographs (SPEC §16: public bucket) | `{product_id}/{uuid}.{ext}` |
| `payment-receipts` | **private** | Pago Móvil / payment receipts (SPEC §16: private bucket) | `{order_id}/{uuid}.{ext}` |

**`storage.objects` policies** (bucket-scoped; `product-images` from 001, the
`payment-receipts` admin SELECT policy implemented in migration 006):

```sql
-- product-images: only administrators write; public read via bucket visibility
create policy product_images_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and (select private.is_admin()));
create policy product_images_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and (select private.is_admin()))
  with check (bucket_id = 'product-images' and (select private.is_admin()));
create policy product_images_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and (select private.is_admin()));

-- payment-receipts: read-only for administrators; NO client writes at all
create policy payment_receipts_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'payment-receipts' and (select private.is_admin()));
```

**Upload flows (why no client write policies on receipts):** a guest has no
auth identity, so an `anon` INSERT policy on receipts would be unattributable
and unfalsifiable (anyone could post arbitrary objects for any order folder).
Migration 006 keeps this design: the private `payment-receipts` bucket has
administrator SELECT only and **no client INSERT/UPDATE/DELETE policies**. The
server action validates MIME type (jpeg/png/webp/PDF), size (≤ 5 MB — technical
limits, not business rules), token-derived ownership, order state and
submission eligibility — never trusting client-reported MIME, size or path —
then uploads with the **service role** under `{order_id}/{uuid}.{ext}`, stores
the returned path on the `payments` row and **removes the object if the RPC
fails**. `next.config.ts` raises the Server Action request body limit to `6mb`
(Next.js defaults to 1 MB) so a 5 MB receipt plus multipart overhead is not
rejected before validation. Admin panel uploads (product photos) use the session
client under the admin policies above.

**Receipt visibility (OQ-12, resolved and implemented):** administrators can
read every receipt (verification needs it). Guests can re-view **all** receipts
submitted for their own order (original and correction) through the existing
private tracking link (DECISIONS #37/#38). `getReceiptUrlsForTracking` is a
`"use server"` action that validates the 64-hex token, calls the service-role
`get_order_for_tracking` hash lookup, reads only receipt-bearing payment rows
for the resolved order through `createSupabaseAdminClient()`, requires at least
one submitted receipt, and mints one signed URL per receipt with an exact
**300-second** lifetime. It allows re-view once a payment is `approved` or
`rejected` and excludes `canceled`/`expired` orders. Every failure path returns
the same generic Spanish message. The response contains only `urls`, never a
database row, `receipt_path`, token, hash or PII. No `anon`/`authenticated`
SELECT policy is added, no `payments` table is exposed through PostgREST, and no
client storage listing or direct object read is granted.

The private route `src/app/(storefront)/seguimiento/[token]/page.tsx` validates
the URL token shape and renders `ReceiptReviewControl`. That client component
uses a native button, keeps a single polite live region for loading and error
announcements, and renders a semantic list of numbered links only after the
server action succeeds. Signed URLs are regenerated on each explicit request, so
a retry does not reuse an expired URL. The bucket, RLS policies, grants and all
upload/verification/SLA/RPC flows are unchanged; no migration was needed.

**Acceptance criteria (implemented):**

- A valid token for an eligible order returns every submitted receipt as a
  300-second signed URL; invalid, canceled/expired, unreviewed or receipt-less
  requests return the same generic error with no path or PII.
- No order id, customer identity, admin id, token hash or storage path is
  accepted from the client; extra client fields are ignored and a token reaches
  only its own order's receipts.
- Eligibility is exactly `approved`/`rejected` payment with at least one
  submitted receipt and a non-canceled/non-expired order; no earlier, broader or
  narrower state window mints a URL.
- `payment-receipts` remains private with administrator SELECT only; no new
  `anon`/`authenticated` storage policy, client write policy, direct object read
  or RPC EXECUTE grant is added.
- The action response and logs contain no token, token hash, `receipt_path` or
  customer PII.
- Existing upload, verification, SLA, reservation and two-receipt-cap behavior
  is unchanged.

## 8. Server-side validation invariants (application ↔ database)

| Invariant | Enforced by |
| --- | --- |
| Client-sent prices ignored; totals recalculated | Server reads `products.price_usd` inside `create_online_order`; anonymous clients cannot write `orders`/`order_items` at all |
| Client-sent stock quantities ignored | Availability computed from batches − active reservations that are held or unexpired (`expires_at IS NULL OR expires_at > now()`, DATABASE_DESIGN §6.2) inside the same function (atomic) |
| Reservation timing windows (20 min initial, ONE 20 min correction after the first rejection) | Only server-side reservation/payment RPCs write `expires_at` / `correction_window_ends_at`; `anon` and `authenticated` have no write policy on `inventory_reservations` (§4.1). A first rejection changes no inventory state by itself — it only opens the bounded window; a second rejection atomically cancels the order and releases every active reservation (no movement, no physical-stock change) |
| Two receipts total (original + one correction) | `orders.receipt_attempts INTEGER NOT NULL DEFAULT 0 CHECK (0..2)` is written only by the service-role `hold_order_reservations` (atomic guarded increment; a third submission raises P0001). Clients cannot write `orders`, and a repeated hold on an already-held order consumes no attempt |
| Quote-pending inventory stays reserved (OQ-13 / OQ-17 resolved and implemented in migration 004) | `create_online_order` creates manual-quote deliveries with `expires_at = NULL` (held), so no deadline can lapse while the quote is pending; clients cannot write a deadline. The customer's explicit acceptance of the quoted fee starts the new fixed 20-minute window (DECISIONS #26), written **once** in `inventory_reservations.quote_acceptance_expires_at` and copied to `expires_at`; the historical `initial_expires_at` is **immutable** and is never re-armed or rewritten. Administrative retries do not extend the new window, and neither the 24-hour SLA nor the correction window is modified (the correction window keeps precedence in the `expires_at` invariant) |
| Quote acceptance is authorized only by the private tracking token (OQ-17, migration 004) | The server action accepts only a 64-hex token and calls the service-role-only `accept_quote_fee_for_tracking`, which resolves `sha256(token)` to an order on the server; `accept_quote_fee(p_order_id)` is an internal primitive, **not** customer authorization by order id. Both RPCs lock reservations → orders, are idempotent, never revive closed reservations, and audit `order.quote_accept` in the same transaction with `admin_id = NULL` and no token/PII in the payload |
| 24-hour review SLA is informational (OQ-16 resolved and implemented) | Exceeding the deadline only creates durable in-app notification rows for **every active** administrator (every 15 min until that submission is approved/rejected). No client or worker path may cancel the order, expire it, release reservations, move `expires_at`, change payment state, or write an inventory movement because of the SLA. `process_sla_notifications` has exactly one write target: `admin_notifications` (DECISIONS #25, migration 005) |
| Recurring SLA notifications are idempotent | `UNIQUE (receipt_submission_id, admin_id, interval_bucket)` plus `ON CONFLICT DO NOTHING` deduplicates overlapping worker executions and prevents one administrator from suppressing another. `CROSS JOIN` fans out over active administrators; delayed runs insert only the current bucket (no historical burst). No client INSERT/DELETE policy exists; admins can only read and mark read their own rows. All SLA RPCs are `service_role`-only, `SECURITY INVOKER`, `VOLATILE` with pinned `search_path` |
| Client-sent payment status ignored | `payments` writable only by admins; checkout server code inserts `status = 'pending'` itself; verification transitions only through admin domain code |
| Legal order/payment state transitions | Domain-layer state machine (server-side) + DB `CHECK` on value domains; no client write path exists to bypass it |
| Duplicate payments / orders | `payments.idempotency_key` UNIQUE; `cancellation_requests` partial UNIQUE (one open request); reservation/allocation RPCs idempotent by design (SPEC §16) |
| Inventory atomicity | Multi-row mutations happen only inside RPC transactions (single UPDATE storms from the app are forbidden) |
| Refunds never rewrite history | New `payment_refunds` rows only; original payment row keeps amount/reference/receipt |
| Audit of admin operations | `audit_log` append-only, RLS INSERT attributed to `(select auth.uid())` |
| Supported payment pairs (migration 006) | DB CHECK allows EXACTLY `pago_movil`→VES, `cash_usd`→USD, `binance_pay`→USDT, `binance_transfer`→USDT; no other method/currency is stored. Binance's identifier/receipt details remain an open discovery item |
| Per-currency payment facts only | `get_order_payment_summary` groups by currency; no cross-currency sum, conversion, "fully paid" decision or auto-fulfillment. Declared component amounts are administrator-verified (documented gap, not a business rule). Migration 007 resolves OQ-4/OQ-5 only for the **informational VES order snapshot**; it never converts or sums declared payment components |
| BCV rate administration (migration 007) | `exchange_rates` rows are append-only; `is_active`, `supersedes_id`, unique `idempotency_key` and audit rows are enforced in the database. Mutating RPCs (`register_bcv_rate`, `deactivate_bcv_rate`, `apply_bcv_rate_to_order`, the private `snapshot_bcv_rate` helper and the guest `apply_bcv_rate_for_tracking`) are `service_role`-only, `SECURITY INVOKER`, pinned `search_path`, and recheck `private.require_active_admin` where an administrator is involved — no `auth.uid()` and no client-supplied admin id. Rate reads (`get_bcv_rate`, `get_last_ves_per_usd`) are read-only and least-privilege; anon can still only SELECT `exchange_rates` |
| Rate snapshot integrity (migration 007) | The canonical `create_online_order_with_bcv` calls the unchanged 003 creation logic and snapshots the DB-resolved rate in the **same transaction**; the order row is locked (`FOR UPDATE`) before writing. No client-supplied rate or timestamp is accepted. No active rate → a USD-only order with all four BCV fields NULL; a snapshot failure rolls back the order and its reservations. Existing snapshots are never overwritten: the legacy guest/admin wrappers are no-op replays and a `BEFORE UPDATE` trigger on `orders` blocks even privileged direct changes to a historical snapshot. `bcv_rate_at` is the rate's own `observed_at`, and `rounding_rule` is constrained to `round_half_up` applied once to the final VES total. `is_stale` is informational only; no maximum age is invented or enforced (unresolved business decision) |
| Pago Móvil snapshot precondition (migration 007) | A `BEFORE INSERT` trigger on `payments` rejects any `pago_movil`/VES row whose order lacks a complete BCV snapshot and VES total. It is database-level, so it covers direct RPC, guest, admin and POS entry points, not just Server Action validation; USD and USDT payments are unaffected. Idempotent replays still bypass the insert, preserving migration 006 idempotency. The stable SQL message is mapped to clear Spanish text without leaking SQL |
| Payment verification is not fulfillment | The migration 006 approve/reject RPCs do not advance `orders.status`, write inventory movements, consume/release reservations or change `receipt_attempts`. The unchanged M3/M5 RPCs are the only implementation of the two-receipt cap, single 20-minute correction window and second-rejection cancellation; migration 006 delegates to them |
| Evidence linkage and single pending submission | `receipt_submissions.payment_id` links the OQ-16 review/SLA history to ONE payment component; partial UNIQUE indexes allow at most one pending submission per order and per payment. Cash creates no submission, needs no receipt and never increments `receipt_attempts`; digital methods need a server-validated private path and reference, so the existing two-receipt cap permits only two digital evidence submissions per order |
| Admin id is session-derived, not client-supplied | The server action verifies the session with `auth.getUser()` and the active `administrators` row via the existing RLS pattern; every mutating RPC rechecks with `private.require_active_admin`. No RPC reads `auth.uid()`. Guest flows use only the private tracking token; public errors do not leak SQL details |
| Guest receipt re-view is token-only and read-only (OQ-12 resolved) | `getReceiptUrlsForTracking` accepts only the 64-hex token, resolves the order through service-role `get_order_for_tracking`, reads only that order's receipt metadata through the admin client, and mints 300-second signed URLs for all submitted receipts when a payment is `approved`/`rejected` and the order is not `canceled`/`expired`. Extra client fields are ignored; errors are generic; no storage object is listed, uploaded, removed or given a new policy |
| Payment/POS/refund concurrency | UNIQUE idempotency keys on `payments` and `payment_refunds`, partial unique pending-submission indexes, row locks with deterministic payment → order order (reservation locks stay in the M3 RPCs), and advisory locks for POS and refund; repeats are idempotent no-ops with no double inventory deduction or double refund |
| Refund boundaries | Append-only `payment_refunds` rows, currency copied from the payment, over-refund blocked, `refunded_partial`/`refunded_full` status; OQ-7 resolved by migration 006 — `payment_refunds.method` is non-empty free text with no invented domain, distinct from the constrained `payments.method` payment-method CHECK |
| Store schedules cannot restrict orders (OQ-8, migration 009) | `store_settings.business_hours` is publicly readable metadata only. A database `CHECK` plus a mirrored Zod schema enforce the exact `America/Caracas` weekly contract (closed days `[]`, ordered non-overlapping HH24:MI intervals); no checkout/order/payment/inventory/reservation path reads it. Writes still require the existing admin RLS path: the server action uses the cookie-bound anon-key client with a session-derived admin id, so the unchanged `store_settings_admin_all` policy remains the final check with no service-role bypass; the two pure validator functions are `IMMUTABLE`, `search_path = ''`, and executable only by `authenticated`/`service_role`. No grant, policy, RLS setting or seed was added, and no real hours/address were invented |

## 9. Secrets and configuration

- Exactly three variables (`.env.example`): `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` (both public by design — safe only because of
  RLS), and `SUPABASE_SERVICE_ROLE_KEY` (server-only, `server-only` import guard
  from Phase 0). No credentials anywhere in source; `.env.local` git-ignored.
- No service-role usage in Client Components is possible without failing the
  build (import guard), and nothing in `src/components` may import
  infrastructure (layer rule).
- Tracking tokens and receipt paths are the only sensitive values stored;
  passwords never touch this database (`auth.users`).

## 10. Realtime and future surfaces (Phase 6)

- Realtime is enabled per-table via the `supabase_realtime` publication and is
  **RLS-respecting**: administrators subscribed to `orders`/`payments`/
  `cancellation_requests` changes read through the same `is_admin()` policies.
  `anon` gets nothing because it has no policy, and non-admin `authenticated`
  clients are filtered out; `payments` additionally has no anon table grant.
  Migration 008 was verified behaviorally against those same grants/policies on
  a disposable cluster (no running Realtime server was contacted).
- Migration 008 is additive and repeatable: it checks publication membership in
  `pg_catalog` before each `ALTER PUBLICATION ... ADD TABLE`, adds no grant,
  policy, function or trigger, and leaves publication options unchanged.
- Replica identity stays at the default (PK only). The three policies depend on
  the caller's admin status rather than row values, so Realtime can authorize
  UPDATE/DELETE from the primary key alone; `REPLICA IDENTITY FULL` would widen
  the WAL payload without improving this boundary and is not used.
- Notifications are informational only — the database stays the source of
  truth (SPEC §13); a forged Realtime message cannot change state. Migration 008
  added no frontend subscription; the unified subscriber described in §10.3 is
  a later addition. Local-only migration 017 adds `admin_notifications` to the
  same publication with the same catalog guard and no authorization change.

### 10.2 OQ-16 SLA notifications — operationalization (activation pending)

- **Current state (repo evidence):** migration 005 implements
  `receipt_submissions`/`admin_notifications`, RLS/force RLS, service-role-only
  RPCs, and dedupe `(receipt_submission_id, admin_id, interval_bucket)`. It is
  applied in Staging and Production. `sla-worker.mjs` runs startup + 15-min cycles
  calling `process_sla_notifications`; the unified inbox reads the rows and
  resolves `receipt_submissions.order_id`, and mark-read is exposed there. There
  is no deployment or runtime evidence for the unified worker.
- **Activation prerequisites:** OQ-16 migration prerequisite complete: migration
  005 applied in Staging and Production. Update the
  **existing `pasteleria-bcv-worker` Render Web Service** to the unified runtime
  start command (`node supabase/worker/runtime.mjs`) with required env vars and
  service-role RPC access; do not create a new service or Background Worker;
  verify logs/metrics and no overlapping cycles; validate both active admins
  receive rows after the 24-hour threshold. Deployment, production activation and
  runtime validation remain pending.
- **Unified runtime invariants:** one process, one HTTP server and one
  `/healthz`; BCV and SLA workers start independently with failure isolation;
  SIGTERM/SIGINT shutdown is idempotent and coordinates both workers and the
  server; health requests never trigger worker cycles; startup errors name missing
  variables only and never log credentials.
- **Security/ops invariants:** worker keeps service-role key server-only; RPCs
  remain service-role-only; no business state mutation; no external delivery mark;
  admin UI continues to gate by `requireActiveAdminId()` and RLS. Monitor cycle
  failures and stalled runs.

### 10.3 Phase 6 Unified Admin Notifications (implemented locally)

All six blockers recorded in #40 are resolved by accepted DECISIONS #41; DECISIONS
#42 records the unified presentation, badge, destinations and Realtime decision.
The implementation is local and uncommitted: migrations 016 and 017 have **not**
been applied remotely, behavioral SQL tests were skipped locally (no PostgreSQL
binaries), and Staging/Production runtime validation remains pending.

- **Scope (implemented locally):** internal admin-panel notifications for both
  active administrators via `public.admin_general_notifications`, a table
  separate from the OQ-16 `admin_notifications` inbox. Events: new **online**
  order, new payment receipt, corrected/resubmitted receipt, new product review.
  The Spanish `/admin/notificaciones` unified inbox provides one combined unread
  count, merged history, accessible destinations, general mark-read/unread,
  SLA mark-read, mark-all on both sources and Realtime refresh.
- **Isolation from OQ-16:** the SLA table/RPC/worker/24 h + 15 min semantics and
  dedupe key are unchanged; general events are not forced into the SLA schema and
  `process_sla_notifications` is not overloaded. The two sources remain separate
  in the database, but the UI has one combined sidebar badge and no topbar pill
  (DECISIONS #42). SLA mark-all is a narrow direct `UPDATE` scoped by
  `requireActiveAdminId()`, `.eq("admin_id", adminId)` and `.is("read_at", null)`.
- **RLS and grants:** RLS is enabled **and** forced. Active administrators
  SELECT only rows where `admin_id = auth.uid()` and `private.is_admin()`, and
  UPDATE under the same predicates. Table privileges are revoked from
  `public`/`anon`/`authenticated`; `authenticated` receives `SELECT` and
  `UPDATE (read_at)` only, `service_role` receives ALL. There is **no client
  INSERT or DELETE** policy or grant and no trusted client-supplied admin id:
  server actions resolve the session through `requireActiveAdminId()` and filter
  by that id (mark-all also requires `read_at IS NULL`).
- **Immutability:** a `BEFORE UPDATE` trigger rejects any change to identity,
  event type/key, targets, summary or `created_at`, and forbids `read_at` earlier
  than `created_at`; the column grant is a second boundary. The database remains
  the source of truth (SPEC §13).
- **Definer functions:** the private fanout helper and three event triggers are
  `SECURITY DEFINER` with `search_path = ''` and `EXECUTE` only for `service_role`
  (or trigger context). They insert one row per **active** administrator with
  `ON CONFLICT (event_key, admin_id) DO NOTHING` in the originating transaction.
  No new worker, external channel or rewrite of older RPCs was introduced.
- **Realtime boundary:** migrations 016 and local-only 017 add both tables to
  `supabase_realtime` via catalog-based membership checks and keep the **default
  replica identity** (no `REPLICA IDENTITY FULL`). The browser subscribes to
  `event: "INSERT"` on both, filters each channel on the session-derived
  `admin_id`, uses INSERT rows as the source of truth, ignores `payload.old` and
  does not depend on UPDATE delivery; one delayed reconnect per channel and a
  debounced `router.refresh()` are used, with no polling. RLS — not the old record
  image — is the authorization boundary, so a forged event cannot mutate state.
  Revisit the replica identity only if Staging runtime validation proves UPDATE
  delivery is required.
- **Idempotency and navigation:** keys are `new_order:<order_id>`,
  `payment_receipt:<receipt_submission_id>`,
  `receipt_correction:<receipt_submission_id>` and `product_review:<review_id>`;
  they are safe across retries, reconnects and multi-tab use. Targets are
  `/admin/pedidos/<order_id>`, `/admin/comprobantes?orderId=<order_id>` (both
  receipt types) and `/admin/resenas?productId=<product_id>`; a missing target
  renders no link / an unavailable state, with no token or PII in the URL.
- **Local UI-only additions (ADR #43):** opening an unread link calls the same
  session-scoped, RLS-protected mark-read actions as the explicit buttons; the
  click handler adds no client write privilege, no client-supplied admin id and
  no optimistic/local read state. The Realtime toast is a browser-only
  presentation of `payload.new` rows already authorized by RLS; it does not
  mutate database state, read `payload.old`, request notification permission,
  register a service worker/VAPID, send e-mail/WhatsApp or open polling/external
  channels. Repeated delivery of the same real row id is deduplicated in memory
  only. The storefront flight and mobile menu are decorative/navigation-only and
  touch no cart validation, prices, stock or localStorage schema.
- **Residual Staging checks:** apply migration 016, confirm fanout to both active
  administrators, RLS isolation between admins, mark-one/mark-all behavior and
  Realtime INSERT delivery under RLS; verify the manually updated
  `database.types.ts` after regeneration. OQ-16 worker activation stays on its
  own track.
- **Exclusions:** no customer-facing notifications, no email, no WhatsApp, no BCV
  worker changes/integration, no OQ-16 behavior changes.

### 10.1 Store settings schedules (OQ-8)

- The existing `store_settings` singleton keeps its original M1 columns and
  force-RLS boundary. Migration 009 only adds a `CHECK` constraint on
  `business_hours` plus two pure private validators; it creates no table,
  column, trigger, policy, grant or seed.
- `anon` retains public SELECT with no write policy; non-admin `authenticated`
  users still have no matching write policy; admins retain the original ALL
  policy through `private.is_admin()`. The server action uses the cookie-bound
  anon-key client only after `requireActiveAdminId()` succeeds, so that policy
  is the final write check (deactivation between checks affects zero rows); no
  service-role bypass or client-supplied identity is used.
- Schedules are explicitly informational (SPEC §14): orders remain accepted
  24/7, and no worker, cron, Realtime publication, delivery-price, payment,
  inventory or reservation-expiry rule consumes the schedule.

## 11. SPEC §16 requirement → design mapping

| SPEC §16 requirement | Design element |
| --- | --- |
| RLS en todas las tablas expuestas | §4 matrix: RLS enabled (force) on every table; no-policy = no access |
| Autorización administrativa validada desde la base de datos | `administrators` table + `private.is_admin()` in every admin policy (§3) |
| No confiar en roles de `user_metadata` | Authorization never reads auth metadata; only `auth.uid()` → table lookup (§3.1) |
| Service Role exclusivamente en servidor | §2/§9: env-scoped, `server-only` import guard, used only in server actions |
| Comprobantes en bucket privado | §7: `payment-receipts` private, admin-read, service-role write only |
| Fotos de productos en bucket público | §7: `product-images` public read, admin-only writes |
| Precios, delivery y totales recalculados en servidor | §8 table row 1: server recomputation; anon has no write path |
| Inventario con operaciones transaccionales | §8 row 6: RPC-only mutations, atomic |
| Transiciones de estado validadas en servidor | §8 row 5: domain state machine on the server + value CHECKs |
| Seguimiento con tokens aleatorios y hashes | §6: ≥128-bit token, SHA-256 stored, plaintext shown once |
| Protección frente a duplicación | §8 row 4: idempotency key + partial unique constraints |
| Auditoría de operaciones administrativas | §4.2 `audit_log` append-only with self-attribution |
| Comprobantes en bucket privado (migration 006) | §7: admin-SELECT-only policy, no client writes, server-side MIME/size/ownership/state validation, service-role upload and cleanup on RPC failure |
| Protección frente a duplicación de pagos (migration 006) | §8: UNIQUE idempotency keys for payments/refunds, partial unique pending submissions, row/advisory locks; payment status only via server RPCs |
| Autorización en pagos (migration 006) | §5/§8: session-derived admin id checked by `private.require_active_admin` in every mutating RPC, no `auth.uid()` read, guest access only through the private tracking token |

## 12. Verification plan

Design-level checks that apply to the already-applied migrations:

1. `supabase db advisors` (security advisor) after every migration.
2. Policy tests: as `anon`, attempt `select * from orders` (expect 0 rows/error),
   `insert into products` (expect denial), storage upload to both buckets
   (expect denial).
3. As an authenticated non-admin (temp user without `administrators` row):
   every table returns 0 rows and all writes fail.
4. As an authenticated admin: full matrix in §4.1 verified, including that
   `UPDATE audit_log`/`inventory_movements` fails (append-only).
5. Function grants: `EXECUTE` on service-role functions fails for
   `anon`/`authenticated`.
6. Tracking: correct token returns the PII-free projection; wrong token returns
   nothing; the projection contains no `customer_*`/`address_*` fields.

Payments Module update: the migration 006 subset of this plan (RLS/grants,
private bucket, service-role RPCs, idempotency and concurrency boundaries) was
validated behaviorally on a disposable local PostgreSQL cluster; validation
details are in the final implementation report. Migration 006 is applied in
Staging and Production; deployment remains pending. OQ-7 was resolved by migration
006 itself (non-empty free-text refund method; no value domain invented), and
OQ-11 was later resolved by confirmed decision #36 (anonymous in-person POS
sales; no customer fields and no schema change). OQ-12 was resolved by #37/#38
and implemented as a token-only, read-only server action with all receipts,
exact 300-second signed URLs and approved/rejected payment eligibility. The other
open items are the Binance identifier/modality details and the cash-on-delivery
policy.

Phase 5b update: the migration 007 subset (rate history, service-role rate and
snapshot RPCs, session-derived admin attribution, idempotency, row locking,
single round-half-up rule and least-privilege grants) was validated behaviorally
and statically on a disposable local PostgreSQL cluster; validation details are
in the final implementation report. The focused integration follow-up added the
atomic `create_online_order_with_bcv` path, the Pago Móvil snapshot trigger and
the table-level snapshot immutability trigger to the same migration 007, with
behavioral coverage for rollback, concurrent creation/rate changes, every
payment entry point and all immutability paths. Migration 007 is applied in
Staging and Production; deployment remains pending. OQ-4 and OQ-5 are resolved by it;
the stale-rate threshold and all other open items above remain open.

Phase 6 Realtime update: migration 008 was validated statically and behaviorally
on a disposable local PostgreSQL cluster (001–008). The checks cover exact
publication membership, change-event flags, repeat application without duplicate
membership, unchanged force-RLS/policies/grants, zero rows for `anon` and
non-admin `authenticated` clients, retained admin reads, and unchanged
order/payment/cancellation flows. Migration 008 is applied in Staging and
Production.

Phase 6 OQ-8 update: migration 009 was validated statically and behaviorally on
a disposable local PostgreSQL cluster (001–009) plus unit tests for the Zod
contract and server action. The checks cover singleton preservation with a NULL
schedule, acceptance of closed days and multiple ordered intervals, rejection of
malformed documents at the database boundary, unchanged anon/non-admin/admin
write boundaries, and unchanged 24/7 order/reservation creation after setting or
clearing a schedule. Migration 009 is applied in Staging and Production;
deployment and runtime validation remain pending.

