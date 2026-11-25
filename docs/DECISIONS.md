# DECISIONS

Key architectural decisions, in lightweight ADR form: *Context → Decision →
Consequences*. Superseding a decision should be done by adding a new entry here
(status: accepted, replaces #N). Entries #1–#11 were made in Phase 0; entries
#12–#23 were made in Phase 1A (database & security design); entry #24 was made
in Phase 1A.1 (reservation lifecycle correction); entries #25–#26 resolve the
final M3 open questions OQ-16 and OQ-17. #25 is implemented by
`supabase/migrations/005_receipt_sla_notifications.sql` plus the narrow
service-role worker in `supabase/worker/sla-worker.mjs` (validated locally;
migration applied in Staging and Production; worker deployment pending); #26 is
implemented in Phase 4 by `supabase/migrations/004_quote_acceptance.sql`
(validated locally; migration applied in Staging and Production). Decisions
#27–#32 record the Payments Module backend added in
`supabase/migrations/006_payments_and_verification.sql` (behaviorally validated on
a disposable local PostgreSQL cluster, with details in the final implementation
report; migration applied in Staging and Production). Historical docs call this
scope "Phase 4", tasking calls it "Phase 5". Decisions #33–#34 resolve OQ-4/OQ-5
and are implemented additively in
`supabase/migrations/007_bcv_rates_and_rounding.sql` (validated locally; migration
applied in Staging and Production). #35 resolves OQ-8
with `supabase/migrations/009_store_settings_schedule.sql`. #36 records the
confirmed OQ-11 rule that in-person POS sales paid at the time of sale are
anonymous; it required no schema change. #37 approves the OQ-12 capability for
guest receipt re-view through the private tracking link, and #38 confirms the
approved values and implementation that close OQ-12. The no-worker scope of #1 is amended
**only for OQ-16** as recorded below.

---

## 1. Modular monolith on Next.js App Router — status: accepted

**Context:** SPEC §17 calls for Next.js + Supabase + Vercel and explicitly no
extra infrastructure without need; the team is two administrators and one
codebase.

**Decision:** A single Next.js application with server actions/route handlers as
the server side. No Express, Strapi, microservices or background workers in
this phase.

**Consequences:** One deployable, one type system, minimal ops. Heavy async work
later (e.g. rate refresh jobs) would force a re-evaluation — recorded as a
future decision, not pre-built.

**Amendment (OQ-16 only, 2026-11-20):** The "no background workers" rule is
narrowly revised to authorize **one dedicated, lightweight Node.js scheduled
worker** whose sole responsibility is the 24-hour receipt-review SLA of #25.
It calls exactly one service-role RPC, has no business-state write path, uses
the existing Supabase service-role environment, and runs on a 15-minute poll
with an immediate first cycle. It is a backend scheduling component, not a new
service/microservice, and this amendment does **not** authorize workers for BC
rates, e-mail digesting, outbox delivery, inventory expiry or any other
feature. All other work listed under "Later / not scheduled" in the roadmap is
unchanged.

**Amendment (BCV automatic sync only, 2026-11-24):** DECISIONS #1 is narrowly
amended again to authorize **one dedicated, lightweight Node.js worker** for BCV
rate synchronization, independent from the OQ-16 SLA worker. Scope: fetch
`https://bcv.today/api/v1/rate.json` server-side, validate the payload, register
rates through the existing `register_bcv_rate` service-role RPC, and record
durable sync attempts for admin visibility. Schedule is fixed to Monday–Friday
09:00 and 13:00 `America/Caracas` (no 30-minute polling, no host-timezone
dependency). It has no public trigger, no business-state writes outside
`exchange_rates`/`bcv_sync_attempts`/audit behavior already covered by RPCs, and
no impact on OQ-16. This amendment does **not** authorize workers for other
features.

## 2. Scaffold with `create-next-app` (Next.js 16.4.6) — status: accepted

**Context:** Phase 0 requires a production-ready baseline.

**Decision:** Use the official generator with App Router, `src/`, TypeScript,
Tailwind CSS and ESLint, then adapt it. This brought: TypeScript `strict: true`,
Tailwind 4 with the Turbopack loader, ESLint flat config (`eslint-config-next`),
and `cacheComponents`/partial prefetching enabled in `next.config.ts`.

**Consequences:** Standard, upgradeable baseline. Turbopack is the default
toolchain; no webpack-specific configuration is used.

## 3. Layered folders under `src/` — status: accepted

**Context:** Business logic must stay independent of UI, and Supabase access
must sit behind infrastructure modules, while avoiding premature abstraction.

**Decision:** `app` (routes only) / `components` (shared UI) / `features` (one
folder per capability) / `domain` (framework-free rules) / `infrastructure`
(external services) / `validation` (Zod) / `test` (shared helpers). Each folder
has a README with its rules; layers are directories, not packages — no
workspace/tooling overhead.

**Consequences:** Clear ownership and import direction, trivially enforceable in
review. Overly granular splitting is avoided until a folder actually grows.

## 4. Route groups `(storefront)` and `(admin)` — status: accepted

**Context:** Customer-facing and administrative functionality must be clearly
separated.

**Decision:** Organize routes in two groups (`/(storefront)`, `/(admin)/admin`)
so each can gain its own layout (storefront chrome vs. admin shell) without
affecting URLs, mirroring the feature-folder separation.

**Consequences:** `/admin` is isolated; future auth guard and admin layout slot
in without touching storefront routes. Slightly deeper folder paths.

## 5. Three Supabase clients behind one infrastructure module — status: accepted

**Context:** Anon (browser), session (server) and service-role (privileged)
access have different trust levels; `@supabase/ssr` is the required integration.

**Decision:** `src/infrastructure/supabase/{client,server,admin}.ts` are the only
places that construct Supabase clients. The admin module and the server-only env
module import the `server-only` marker, so importing them from a Client
Component fails at build time. All three clients now use the explicit `Database`
generic derived from CLI-generated types, which come from the real migrations,
never an invented schema. Run `node scripts/generate-database-types.mjs` to
regenerate them locally. `database.client.types.ts` overrides five RPC `Args` to
keep decimal strings and explicit nulls in the validated wire contract; the
generated PostgreSQL `numeric` to `number` mapping would otherwise change it.

**Consequences:** One seam to audit; credentials cannot silently leak to the
client. `server-only` adds one tiny dependency, justified by the service-role
rule in SPEC §16. The adapter changes types only: runtime payloads, credential
boundaries and `server-only` are unchanged.

## 6. Zod as the single validation library — status: accepted

**Context:** The stack mandates Zod; server-side validation is required for
every future business operation.

**Decision:** Zod validates environment variables today
(`src/infrastructure/env.ts`) and will validate every user input at the server
boundary (`src/validation/`). Types are inferred with `z.infer`, never duplicated
manually.

**Consequences:** One validation vocabulary across the app; no additional schema
library (no Yup, no Valibot).

## 7. Vitest with `node` environment; component-testing libs deferred — status: accepted

**Context:** Phase 0 needs a working test suite; the spec forbids unnecessary
dependencies.

**Decision:** Install only `vitest`. Tests are colocated as `*.test.ts(x)` under
`src/`, config lives in `vitest.config.mts` with a manual `@` alias (no
`vite-tsconfig-paths`). jsdom, React Testing Library and `@vitejs/plugin-react`
are **not** installed yet — they arrive with the first UI worth testing.

**Consequences:** Fast, dependency-light suite covering domain/infrastructure
code now; adding RTL later is a dev-dependency change, no config rework.

## 8. `@types/node` bumped from `^20` to `^22` — status: accepted

**Context:** Vitest 5 declares a peer requirement of `@types/node ^22 || >=24`,
while the template pinned `^20`; the runtime is Node 22.17.

**Decision:** Align `@types/node` with the actual Node major (22).

**Consequences:** Clean peer resolution for Vitest; types match the runtime.
No application behavior change.

## 9. Environment variable policy — status: accepted

**Context:** No secrets may live in source code; the browser must never see the
service-role key.

**Decision:** Track only `.env.example` (documented names, empty/placeholder
values, explicitly un-ignored in `.gitignore`); ignore every other `.env*`.
Public variables are prefixed `NEXT_PUBLIC_`; `SUPABASE_SERVICE_ROLE_KEY` is
not, and is read only through `env.server.ts` (Zod-validated, `server-only`).

**Consequences:** Onboarding via `cp .env.example .env.local`; build fails fast
with a named-variable error if configuration is missing when Supabase is first
used.

## 10. Documentation layout and languages — status: accepted

**Context:** SPEC §19 pending items and phase scope must be recorded without
being implemented.

**Decision:** `SPEC.md` stays the canonical functional specification (Spanish).
Engineering docs live in `docs/` (`ROADMAP`, `ARCHITECTURE`, `DECISIONS`) plus a
root `TASKS.md` checklist, written in English; user-facing UI copy is Spanish
(`lang="es"`).

**Consequences:** Spec and roadmap never drift into code; contributors read one
place for status.

## 11. No database schema, migrations or remote project in Phase 0 — status: accepted

**Context:** Inventing tables now would bake in assumptions the pending
discovery items (SPEC §19) may invalidate.

**Decision:** Phase 0 writes zero migrations and connects to no remote Supabase
project. Schema work starts in Phase 1 alongside RLS.

**Consequences:** Infrastructure modules exist as tested seams (env + clients)
but perform no I/O yet; catalog/inventory/payment tables are documented in
`docs/ROADMAP.md` only.

---

## Phase 1A — database & security design decisions

## 12. Schema conventions: identity columns, `text` + `CHECK` statuses, `numeric` money — status: accepted

**Context:** First full schema proposal; conventions must be uniform and easy
to evolve for an MVP with two administrators.

**Decision:** `bigint generated always as identity` PKs (`uuid` only for
`auth.users` links); statuses are `text` + `CHECK (col IN (…))` rather than
Postgres enum types (adding a state is an idempotent constraint swap, not an
`ALTER TYPE`); English `snake_case` stored values with UI translation to
Spanish; all money in `numeric` (USD `numeric(10,2)`, VES `numeric(14,2)`,
rate `numeric(12,4)`); `timestamptz` everywhere; every FK indexed; partial
indexes for the pending-order/payment/cancellation queues.

**Consequences:** Migration-friendly evolution; no float rounding bugs; status
vocabulary is documented in one place (`DATABASE_DESIGN.md` §12). Trade-off:
enum types would give stronger typing, at the cost of harder online changes —
rejected for this scale.

## 13. `administrators` table is the only authorization source; no role hierarchy — status: accepted

**Context:** SPEC §16 forbids trusting `user_metadata`; SPEC §2 gives both
admins identical permissions.

**Decision:** Authorization = existence of an active `administrators` row for
`auth.uid()`, checked per request by RLS through a `SECURITY DEFINER` helper
(`private.is_admin()`, needed to avoid policy recursion). No `role` column
(granular roles are not in the spec), no client-side writes to the table
(provisioning is service-role only).

**Consequences:** Deactivation takes effect immediately; forged metadata is
irrelevant; adding roles later is an additive migration. Trade-off: every
admin-gated table depends on one helper — acceptable, it is tiny and tested by
the verification plan.

## 14. No `customers` table — guest data is snapshotted on the order — status: accepted

**Context:** SPEC mandates guest checkout (no accounts, no e-mail, only name +
WhatsApp) and history that never drifts.

**Decision:** `orders.customer_name` / `customer_phone` (plus address fields)
hold exactly what the customer provided. No customer entity, no identity
resolution by phone.

**Consequences:** No CRM surface to secure, no PII table, order history is
self-contained. Trade-off: no cross-order customer profile — SPEC never asks
for one; a later feature can *derive* customers from orders without changing
them.

## 15. Cart is client state — no `carts` table — status: accepted

**Context:** Checkout must revalidate prices and stock on the server anyway;
SPEC defines no server-side cart.

**Decision:** The cart lives in the browser and is submitted as
`{product_id, quantity}[]`; the server reads prices from `products` and ignores
anything else. No anonymous-writable table exists for a cart.

**Consequences:** One less table + RLS surface + cleanup story; carts do not
survive device switches (acceptable — never a spec requirement). Revisit only
if abandoned-cart recovery becomes a requirement.

## 16. One `orders` table for both channels (`channel = online | pos`) — status: accepted

**Context:** SPEC §9 requires walk-in sales to be distinguishable from online
orders but to share payments, inventory deductions and audit; POS is Phase 5.

**Decision:** A `channel` column distinguishes them. POS rows have null
customer/tracking/fulfillment (enforced by same-row CHECKs); online rows
require customer data and a tracking token.

**Consequences:** Payments, movements, refunds and the dashboard have a single
spine — no duplicated `sales`/`sale_items` tables. Trade-off: some columns are
channel-nullable; mitigated by CHECK constraints that make invalid shapes
impossible.

## 17. Tracking tokens are hashed; guests never touch tables — status: accepted

**Context:** SPEC §7/§16: private tracking links, no customer exposure, no
unauthorized modifications.

**Decision:** Store `sha256(token)` only; the plaintext appears once in the
creation URL. `anon` has **no policy** on orders/payments; the tracking page
calls a server-side function (service role) that validates the token and
returns a PII-free projection. The only guest write is inserting a *pending*
cancellation request.

**Consequences:** Database leaks cannot yield working links; enumeration is
impossible; a leaked link exposes no customer PII. Trade-off: tracking is
server-rendered only (no client-side Supabase queries on orders) — fine for the
product.

## 18. Inventory = batches + reservations + movements, with lazy reservation expiry — status: accepted

**Context:** SPEC §8: FIFO, short customer-driven reservation deadlines
(durations corrected in #24), atomic/idempotent operations — and the
architecture forbids background workers (DECISIONS #1; the OQ-16-only
amendment does not authorize an inventory-expiry worker).

**Decision:** Physical stock in `inventory_batches.remaining_quantity`; orders
hold `inventory_reservations` per batch with `expires_at`; every change writes
an append-only `inventory_movements` row. Expiry is evaluated lazily in the
availability calculation (an expired reservation stops counting), with an
opportunistic cleanup function — no scheduler.

**Consequences:** Correct availability without workers or cron; FIFO and
reservation logic live in RPC transactions. Trade-off: expired reservation
rows linger until cleanup runs — harmless because they are excluded by query.

## 19. Financial snapshots live inline on the order — no FK to `exchange_rates` — status: accepted

**Context:** SPEC §4 requires each order to keep a historical photo of prices,
totals, applied rate, rate time, VES total and rounding rule.

**Decision:** Rate/total columns live inline on `orders`; `exchange_rates` stores
rates for lookup/fallback but is deliberately **not** referenced by FK from
orders. Migration 003 leaves those columns NULL at checkout; migration 007
(#33/#34) fills them from the exact active rate, using the rate's own timestamp.

**Consequences:** Order history survives any edit/pruning of rate rows (true
snapshot semantics); queries need no join. Trade-off: rate rows and orders can
diverge — irrelevant, since the snapshot is authoritative and never overwritten.

## 20. Storage: public product images, service-role-only receipt uploads — status: accepted

**Context:** SPEC §16 bucket visibility rules; guests have no auth identity to
attribute an upload to.

**Decision:** `product-images` (public read) written only by admins via
policies; `payment-receipts` (private) is **never** writable by clients — the
checkout server action validates the file and uploads with the service role,
storing the path on `payments`. Admins read receipts through an `is_admin()`
storage policy.

**Consequences:** No unattributable anonymous writes to storage; receipt
privacy holds under a private bucket. Trade-off: uploads for checkout must pass
through server code (they already do — checkout is a server action).

## 21. Append-only `audit_log` and `inventory_movements` at the policy level — status: accepted

**Context:** SPEC §16 requires administrative audit trails that stay
trustworthy.

**Decision:** RLS grants these tables SELECT + INSERT (attributed to
`auth.uid()` for audit) but **no UPDATE/DELETE policy** for any client role;
the operational rule extends to the service role (server code never rewrites
them).

**Consequences:** A compromised admin session can add rows but not erase
history. Trade-off: legitimate corrections must be new rows (compensating
entries) — that is exactly what an audit trail should look like.

## 22. `store_settings` singleton with `jsonb` placeholders for undefined shapes — status: accepted

**Context:** SPEC needs pickup address, WhatsApp, hours and payment
instructions, but three of those four structures are pending discovery
(OQ-6, OQ-8, §19).

**Decision:** One row (`CHECK (id = 1)`) with typed columns for what is defined
(`pickup_address`, `whatsapp_phone`) and nullable `jsonb` columns
(`business_hours`, `payment_instructions`) whose shape is explicitly deferred
to the phase that implements them.

**Consequences:** No invented structures to migrate away from later; the table
is ready on day one. Trade-off: `jsonb` gives up column-level validation until
the shape is defined — acceptable for two fields nothing reads yet (OQ-8 is now
resolved by #35 without adding a column). The table never stores secrets (it is
publicly readable by design).

## 23. State machines in the domain layer; the database constrains value domains only — status: accepted

**Context:** SPEC §10/§16 requires server-validated transitions; two
administrators and an MVP scale argue against heavyweight mechanisms.

**Decision:** DB `CHECK` constraints fix the allowed status *values*; the
allowed *transitions* (e.g. `pending → confirmed`, no jump to `completed`) are
enforced by the server-side domain state machine — the only write paths that
exist. No transition triggers or trigger-based validation tables.

**Consequences:** One place to read and change transition rules (the domain),
schema stays declarative. Trade-off: a future non-app writer (SQL console) could
bypass transitions — acceptable because admins already have full data access,
and every change still lands in the append-only audit log. Revisit if
constraints-on-transitions become a compliance need.

## 24. Reservation deadlines: 20-minute initial window + one 15-minute receipt-correction window — status: accepted (refines #18)

**Context:** Phase 1A.1 corrected the reservation lifecycle against the
confirmed business rules: (a) the initial inventory reservation expires after
**20 minutes**; (b) if an administrator rejects a submitted payment receipt,
the customer gets **one additional 15 minutes** to correct and resubmit it;
(c) the **24-hour** figure (SPEC §14) is the administrators' operational
deadline for managing incoming orders, **not** a reservation duration. Earlier
documentation had repeated "24 h reservation" from an early SPEC reading, and
the original SPEC text tied reservation release to "rejection", which would
have released inventory before the correction window elapsed.

**Decision:** `inventory_reservations` carries three time columns:
`initial_expires_at` (`created_at + 20 min`, immutable),
`correction_window_ends_at` (set **once** at rejection:
`rejected_at + 15 min`), and a materialized nullable `expires_at` — the
operative deadline, `NULL` meaning *held* (receipt awaiting verification, or
secured after approval). Availability excludes only active reservations whose
`expires_at` has passed (lazy expiry, as in #18 — still no workers). A
rejected receipt never releases inventory: it only opens the bounded
correction window; release happens solely on authorized cancellation,
consumption on completion, expiry on deadline lapse. The window is granted at
most once per reservation, so repeated rejection/resubmission cannot extend it
indefinitely. The 24-hour admin deadline stays out of the schema entirely —
it is a dashboard SLA (its clock is refined by #25 below: 24 hours from receipt
submission, not from order creation).

**Consequences:** The schema distinguishes initial expiry from the correction
window and the held state keeps the correction window meaningful when
verification is slow. Open questions were recorded before Phase 3/4
implementation (DATABASE_DESIGN §14): OQ-13 clock behavior for cash/quote
orders, OQ-14 confirm the single-window repeat-rejection policy, OQ-15 confirm
the hold-while-under-review rule, OQ-16 how (or whether) the 24-hour SLA is
enforced. Trade-off: three deadline columns instead of one — accepted for
audit clarity and indexed queries; all are written only by server-side RPCs.
SPEC §8 and §14 were amended to match this decision (documentation-only
correction, Phase 1A.1).

**Amendment (M3 reservation/payment-attempt correction, 2026-11-20):** the
confirmed business rules supersede the 15-minute figure above. The single
correction window is **20 minutes**; **at most two receipts** are allowed
(original + one correction, counted by `orders.receipt_attempts`); the first
rejection opens the window and keeps the inventory reserved; a **second
rejection automatically cancels the order and releases every reservation**
(no movement, no physical-stock change). A submitted receipt holds the deadline
for the whole admin review, and quote-pending deliveries stay reserved from
creation. Implemented **in place** in migration 003 (no new migration);
OQ-13 (quote case), OQ-14 and OQ-15 are resolved, and the countdown restart
after quote confirmation becomes OQ-17. SPEC §8 was updated accordingly.

**Amendment (final OQ resolution, same date):** OQ-16 and OQ-17 are now resolved
by confirmed business rules and recorded as decisions **#25** and **#26**
below. Neither changes this decision's reservation window or anything already
implemented in migrations 001–003: the 24-hour figure stays an administrative
review SLA with notifications only (never automatic cancellation or inventory
release), and the 20-minute window that starts after quote acceptance is a
*new initial inventory reservation* clock, distinct from both the review SLA
and the 20-minute receipt-correction window.

---

## 25. Administrative receipt-review SLA: notify only, never auto-cancel — status: accepted (resolves OQ-16)

**Context:** SPEC §14 gives administrators 24 hours to manage incoming orders;
OQ-16 asked how that deadline should be enforced. Automatic order expiry would
conflict with the reservation rules of #24 (a receipt is held during review,
and only a second rejection cancels) and with the "database is the source of
truth, notifications are informative" rule in SPEC §13.

**Decision:** Administrators have **24 hours from receipt submission** to
review a payment receipt. Once that deadline is exceeded, the **responsible
administrator is notified**; the notification is **repeated every 15 minutes**
until the receipt is **approved or rejected**. SLA expiration is **purely
informational**: it never cancels the order, expires the order, releases
inventory, changes a reservation deadline, or writes an inventory movement.
Overlapping executions of the notification worker must not produce duplicate
notifications for the same receipt and due interval (idempotency by dedupe
key). This decision does not select the scheduler mechanism.

**Consequences:** The review SLA is fully independent of the 20-minute
reservation clock and of the 20-minute correction window; all three can run
without interfering. The existing #24 schema does not gain an SLA column or an
automatic branch; #18's lazy expiry remains the only inventory-deadline
mechanism. **Final architecture (implemented in Phase 6):** a dedicated
scheduled worker (authorized by the amendment to #1) calls a single
service-role RPC that inserts durable in-app notifications. Because both
administrators are responsible for receipt review, the RPC fans out to every
**active** `administrators` row rather than guessing one owner. One immutable
`receipt_submissions` row is created by the real receipt-submission RPC for
each actual attempt (original and correction), and approval/rejection closes
the pending row in the same transaction as the review action. Idempotency is
enforced in the database by `UNIQUE (receipt_submission_id, admin_id,
interval_bucket)` with `ON CONFLICT DO NOTHING`; a delayed run creates only the
**current** 15-minute bucket and never replays missed intervals. No external
provider/outbox is introduced; the in-app inbox is the delivery. Migration 005
and `supabase/worker/sla-worker.mjs` were validated locally. Migration 005 is
applied in Staging and Production; worker deployment and runtime validation remain
pending.

## 26. Manual delivery quote: acceptance starts a new 20-minute reservation — status: accepted (resolves OQ-17)

**Context:** M3 creates reservations for manual-quote deliveries already HELD
(`expires_at = NULL`) so the pending quote cannot expire the inventory (OQ-13).
OQ-17 asked when the 20-minute countdown should start once the quote is
resolved. Counting from the quote decision or resuming the original creation
clock would punish the customer for administrator latency and blur three
different deadlines.

**Decision:** While the manual delivery quote is pending, the order **remains
reserved with no automatic expiration**. Only when the **customer explicitly
accepts the quoted delivery fee** does a **new, fixed 20-minute initial
reservation window** start. That window is an **inventory reservation**
deadline: it is **not** the 24-hour administrative review SLA (#25) and it
does **not** replace or modify the single 20-minute correction window granted
after a first receipt rejection (#24). Administrative retries must **not**
extend it.

**Consequences:** The existing M1/M2/M3 behavior and migration history are
unchanged; migration 003 deliberately encodes no acceptance transition. Phase 4
adds the transition in a **separate** migration without rewriting that history:
`initial_expires_at` stays immutable with its original creation-time value and
the fixed 20-minute acceptance window lives in the new
`inventory_reservations.quote_acceptance_expires_at` column, copied to
`expires_at`. Consumers must read that column for the new window — it is **not**
a re-arm or an admin extension of `initial_expires_at`. Manual-quote orders stay
held indefinitely until explicit customer acceptance, as in M3.

**Implementation (Phase 4):** `supabase/migrations/004_quote_acceptance.sql`
adds `orders.quote_accepted_at` and
`inventory_reservations.quote_acceptance_expires_at`, plus the four-case
`expires_at` invariant (NULL/held → correction window → quote-acceptance window
→ immutable `initial_expires_at`). Compared with the documentation-only draft
of this decision, the initial deadline is **no longer re-armed or rewritten**:
the new window uses its own column. Two service-role-only RPCs are added:
`accept_quote_fee` (internal primitive) and `accept_quote_fee_for_tracking`
(customer access exclusively through the SHA-256 hash of the private tracking
token; an order id is never authorization). The acceptance flow locks
reservations → orders, is idempotent, never revives closed reservations and
writes one PII-free `order.quote_accept` audit row in the same transaction. The server action
`src/features/orders/accept-quote.ts` validates a 64-hex token and calls only
that RPC. Validated locally (`npm test`, lint, `tsc`, build; 109 tests);
migration 004 is applied in Staging and Production. OQ-16 is implemented
separately by migration 005 and the narrow worker described in #25.

---

## Payments Module decisions (migration 006, applied in Staging and Production)

## 27. One payment spine with explicit evidence linkage — status: accepted

**Context:** SPEC §5/§10/§12 need several payment components per order,
receipts as evidence, and separate refund history; migration 005 already owns
receipt-review/SLA history (#25).

**Decision:** `public.payments` is the single financial history and
`public.payment_refunds` is its append-only refund trail.
`receipt_submissions.payment_id` (migration 006) explicitly links each OQ-16
review/SLA row to the **one** payment component it evidences. Partial unique
indexes allow at most one pending submission per order and per payment; there is
no competing payment ledger. Cash creates no submission and never increments
`orders.receipt_attempts`.

**Consequences:** Review status and financial status can be read independently
but stay joinable. The existing M3/M5 two-receipt cap still applies, so only two
digital evidence submissions can exist per order. Refines #20 and #25; no
behavioral change to those migrations.

## 28. Two Binance modalities, both USDT — status: accepted

**Context:** SPEC §5 names Binance Pay and user-to-user transfers; older notes
used a single `binance` shorthand. No third method or currency is defined.

**Decision:** Stored method/currency pairs are EXACTLY `pago_movil`→VES,
`cash_usd`→USD, `binance_pay`→USDT and `binance_transfer`→USDT, enforced by a
migration 006 CHECK. The two Binance values are the two modalities already in
SPEC §5 and DATABASE_DESIGN §8.1.

**Consequences:** No invented method or currency. The specific Binance
identifier/receipt data remains an open discovery item (SPEC §19); no format is
assumed. Adds no cross-currency meaning to USDT (see #29).

## 29. Declared amounts only; no invented conversion — status: accepted

**Context:** SPEC §4 requires an inline BCV snapshot; when this decision was
made OQ-4 (rate write path) and OQ-5 (rounding rule) were still open, and payment
components may be in VES, USD or USDT. OQ-4/OQ-5 are now resolved by #33/#34
without changing this decision.

**Decision:** `get_order_payment_summary` reports approved/pending/in_review/
rejected/refunded amounts and payment counts **per currency**. Raw amounts are
never summed across currencies; no conversion, cross-currency "fully paid"
decision or auto-fulfillment is implemented. Amounts are declared component
values that administrators verify.

**Consequences:** This is a documented gap, not a business rule. Order status
stays in its own domain flow (SPEC §10, #23). OQ-4 and OQ-5 were resolved by
#33/#34 (migration 007) for the **informational VES snapshot only** — no
conversion or cross-currency "fully paid" rule was introduced. Binance-receipt
discovery remains OPEN.

## 30. One pending evidence submission per order and per payment — status: accepted

**Context:** M3/M5 already enforce two receipts total, one bounded correction
window and second-rejection cancellation (#24, #25); parallel digital evidence
could otherwise create competing pending rows.

**Decision:** Migration 006 adds partial UNIQUE indexes on
`receipt_submissions(payment_id) WHERE review_status = 'pending'` and on
`(order_id) WHERE review_status = 'pending'`. It calls the unchanged
`hold_order_reservations` / `open_order_correction_window` RPCs rather than
reimplementing the counters, window or cancellation.

**Consequences:** At most one open review row per digital component and per
order; the two digital evidence submissions allowed per order are exactly the
original and one correction. Cash payments remain outside this mechanism, and
`receipt_attempts` is only written by the existing RPCs.

## 31. Session-derived admin identity for payment verification — status: accepted

**Context:** Mutating payment RPCs need an administrator id for attribution, but
service role has no meaningful `auth.uid()` and a client-supplied id would be
forgeable (#13, SPEC §16).

**Decision:** The server action verifies the session with `auth.getUser()` and
the active `administrators` row through the existing RLS pattern, then passes
that id to service-role RPCs. Every mutating RPC rechecks active status via
`private.require_active_admin`; no RPC reads `auth.uid()`. Guest flows use only
the private tracking token (#17).

**Consequences:** A deactivated administrator cannot mutate payments even with
a stale session; clients cannot attribute an action to another admin. Extends
#13/#17/#20 without changing the authorization source. Public errors do not
leak SQL details.

## 32. POS and refund boundaries stay outside verification — status: accepted

**Context:** SPEC §9/§12 require immediate POS inventory deduction and separate
refund records, while payment approval must not become fulfillment (#23).

**Decision:** Migration 006's POS RPC creates one `orders` row with
`channel = 'pos'`, re-computes prices, allocates FIFO and consumes inventory via
the existing `consume_order_reservations` RPC, writes one approved cash
component, and is idempotent by key. Refunds are append-only, idempotent by key,
copy currency from the payment, block over-refund and set
`refunded_partial`/`refunded_full`. The approve/reject RPCs themselves do not
advance `orders.status`, write movements, consume/release reservations or change
`receipt_attempts`.

**Consequences:** No duplicate inventory deduction or double refund; row locks,
deterministic lock order and advisory locks serialise these paths. Verification
remains separate from fulfillment, with only the unchanged M3/M5 RPCs owning
second-rejection cancellation. OQ-7 is **resolved by migration 006 itself**:
SPEC §12 requires a refund-method field but not its value domain, so
`payment_refunds.method` is `text` guarded only by
`payment_refunds_method_check` (`length(trim(method)) > 0`); no value-domain
CHECK or value list is invented. This is a different domain from
`payments.method`, whose CHECK allows exactly `pago_movil`, `cash_usd`,
`binance_pay` and `binance_transfer`. OQ-11 is resolved by the confirmed
business decision in #36 (anonymous in-person POS sales, no customer fields);
OQ-12 is resolved by #37/#38 (token-only re-view of all receipts, 300-second
signed URLs and approved/rejected eligibility). OQ-4 and OQ-5 were resolved
later by #33/#34 (migration 007).

## 33. Manual BCV rate administration, append-only history and exact snapshots — status: accepted (resolves OQ-4)

**Context:** SPEC §4 requires each order to keep the applied BCV rate and its
timestamp; migration 003 created `exchange_rates` and the order snapshot columns
but no write path. OQ-4 was open. No automatic provider API, credential or worker
is authorised by the approved scope.

**Decision:** Rates are registered **manually** by an active administrator via
`register_bcv_rate` / `deactivate_bcv_rate` (service-role RPCs behind server
actions that derive the admin id from the verified session and recheck with
`private.require_active_admin`). `exchange_rates` is append-only: a correction
sets `is_active = false` on the old row and inserts a new row pointing to it via
`supersedes_id`; `idempotency_key` is unique. The authoritative rate is the
latest **active** row at or before the relevant instant; `get_bcv_rate` reports
its source, `observed_at`, `age_seconds` and `is_stale`. When no active rate
exists, snapshotting **fails explicitly** — no last-known rate is silently
substituted, no unknown rate is invented, and the order simply keeps its USD
total. Each order snapshot (`apply_bcv_rate_for_tracking` for a guest with only
the hashed tracking token, `apply_bcv_rate_to_order` for an admin) locks the
order row, stores the exact rate and `bcv_rate_at = rate.observed_at` (the rate's
own time), and **never overwrites** an existing snapshot. Rate reads remain
public/least-privilege; all mutating RPCs are `service_role`-only,
`SECURITY INVOKER` with `search_path = ''`, and audited (guest applies are not
administrative actions and write no audit row).

**Consequences:** Rate corrections cannot rewrite sold orders or silently change
their VES snapshot. Automatic provider ingestion is a separate future path that
can reuse `register_bcv_rate` with a machine `source` without a schema change.
No network call, secret, cron or worker was added. Implemented additively in
migration 007, which is applied in Staging and Production.

**Integration follow-up (same migration 007):** the canonical checkout path is
`create_online_order_with_bcv`, which invokes the unchanged `create_online_order`
and resolves/writes the snapshot in the same transaction (no client rate or
timestamp). With no active rate it creates a USD-only order with all BCV fields
NULL; a snapshot failure rolls back the order and reservations. The two wrappers
remain service-role-only manual/legacy tools and are no-op replays on an existing
snapshot; a table-level `BEFORE UPDATE` trigger blocks even privileged direct
rewrites. A `BEFORE INSERT` trigger on `payments` rejects `pago_movil`/VES rows
without a complete snapshot on every entry point (guest, admin, direct RPC, POS);
USD/USDT are unaffected. **The maximum acceptable rate age is an unresolved
business decision:** `is_stale` is informational only, and no threshold is
invented or enforced.

## 34. Round half-up once on the final VES total — status: accepted (resolves OQ-5)

**Context:** SPEC §4 requires a rounding-rule snapshot but never defined the
rule; OQ-5 was open. Payment components remain declared, administrator-verified
amounts in VES/USD/USDT (see #29).

**Decision:** The only rule is `round_half_up` (half away from zero), implemented
as PostgreSQL `round(numeric, 2)` applied **once** to `total_usd * rate` for the
informational `orders.total_ves`. It is recorded per order in
`orders.rounding_rule`, constrained to `'round_half_up'`. No per-item or
per-line rounding; declared payment components keep at most 2 decimals and the
BCV rate keeps 4. No cross-currency sum, conversion, "fully paid" decision or
automatic fulfillment is derived from the VES snapshot.

**Consequences:** A boundary such as 10.25 × 36.5 = 374.125 becomes 374.13 (not
374.12 as banker's rounding would give); two identical items are priced from
the single final total, never by doubling a rounded line. Existing money
precision is unchanged (USD 10,2 / VES 14,2 / rate 12,4). Implemented additively
in migration 007, which is applied in Staging and Production.

## 35. `store_settings.business_hours` weekly schedule contract — status: accepted (resolves OQ-8)

**Context:** SPEC §14 requires configurable customer-facing attention and
preparation hours while keeping orders available 24/7. Migration 001 created
the singleton `store_settings` row with `pickup_address text` and a nullable
`business_hours jsonb` placeholder explicitly deferred to OQ-8 (DECISIONS #22).
No real address or hours were supplied, and no operational rule may turn a
schedule into a checkout restriction.

**Decision:** Reuse the existing singleton and columns; add no settings table,
column or seed. `business_hours` is either `NULL` (the backward-compatible
placeholder) or exactly:

```json
{
  "timezone": "America/Caracas",
  "attention": { "monday": [{ "start": "09:00", "end": "13:00" }], "sunday": [] },
  "pickup": { "monday": [{ "start": "10:00", "end": "17:00" }], "sunday": [] }
}
```

All seven lowercase weekdays are required in both `attention` and `pickup`.
Each day is an array of zero or more intervals; `[]` means closed. Intervals
have exactly `start` and `end` in HH24:MI (`00:00 <= start < end <= 23:59`),
are ordered and non-overlapping; overnight intervals are not supported. The
timezone is fixed to Venezuela's `America/Caracas` and stored in the document
so clients never guess. The existing free-text `pickup_address` remains the
business/pickup address; no new address structure is invented.

**Enforcement:** Migration 009 adds two `IMMUTABLE`, pinned-`search_path`
private validators and a `CHECK` constraint on `business_hours`. `EXECUTE` is
granted only to `authenticated` and `service_role` so both RLS admin writes and
service-side writes can evaluate the constraint; no new table write permission
is created. `src/features/settings/schemas.ts` mirrors the contract with Zod,
and `src/features/settings/admin-settings.ts` validates input and derives the
admin id from the session (`requireActiveAdminId`) before writing through the
cookie-bound anon-key client, leaving the unchanged admin RLS policy as the
final check. No service-role bypass or client-supplied admin id is accepted.

**Consequences:** Actual hours and address stay unconfigured until the business
supplies them; nothing is seeded. Schedules are metadata only: no checkout,
order, payment, inventory, reservation or worker code reads them, so orders
remain accepted 24/7. RLS, policies and grants on `store_settings` are
unchanged (`anon` keeps public SELECT with no write policy; admins keep ALL).
The JSONB shape is strict, so future fields require an explicit additive
migration; this is preferable to silently accepting malformed schedules.
Implemented locally in migration 009; migration applied in Staging and Production.

## 36. Anonymous in-person POS sales — status: accepted (resolves OQ-11)

**Context:** SPEC §9 distinguishes walk-in sales from online orders. Migration
006's `register_pos_cash_sale` creates one `orders` row with `channel = 'pos'`
and inserts only channel, status and totals; its server action accepts only
items, amount tendered and an idempotency key. OQ-11 asked whether buyer identity
must be collected for these sales.

**Decision:** In-person POS sales paid at the time of sale are anonymous. Buyer
identity is not required: no customer name, phone or email is collected. No
customer field or required column is added. The existing nullable
`customer_name`/`customer_phone` columns remain null for POS rows (online rows
still require both), and `orders` has no customer-email column. The online guest
flow is unchanged.

**Consequences:** No schema or POS-flow change is needed: the confirmed rule
already matches migration 006 and the current server action. POS rows remain
distinguishable by `channel = 'pos'`, carry no tracking token and have
`fulfillment_type IS NULL`. This decision does not affect guest receipt re-view,
which is addressed separately in #37.

## 37. Guest receipt re-view through the private tracking link — status: accepted (capability approved; closes with #38)

**Context:** SPEC §12 requires private receipt storage; migration 006 stores
receipts in the private `payment-receipts` bucket with administrator SELECT only
and service-role-only uploads. The existing guest server actions validate a
64-hex tracking token and resolve it through the service-role
`get_order_for_tracking` SHA-256 lookup; no order id or customer identity is
accepted as authorization. OQ-12 asked whether a guest may re-view their own
submitted receipt.

**Decision:** Guest receipt re-view through the existing private order tracking
link is **approved**. The tracking token remains the only credential. Re-view is
delivered by server-created signed URLs for the private objects, using the
service-role client after token validation. The bucket stays private, its
current policies are unchanged, and no client table read, client storage listing
or direct object SELECT is added. This decision does not change any existing
security boundary.

**Implementation choices (confirmed in #38):** exact signed-URL lifetime of
**5 minutes / 300 seconds**; **all submitted receipts** for the order (original
and correction); eligibility after any payment is `approved` or `rejected`,
excluding `canceled`/`expired` orders and requiring at least one submitted
receipt. No alternative lifetime, narrower scope or wider eligibility is used.

**Consequences:** OQ-12 is fully closed by #38. The implementation uses one
narrow server-side read path and one `"use server"` action that validates the
token, resolves only the approved receipt scope, applies the approved
eligibility window, creates the signed URLs with the approved lifetime and
returns only the URLs. The existing admin client performs the receipt lookup, so
this decision implies no migration, schema column, storage policy or RLS change.
Any future service-role-only read RPC must not grant `anon`/`authenticated`
EXECUTE.

## 38. OQ-12 implementation values and closure — status: accepted (resolves OQ-12)

**Context:** #37 approved the capability but deliberately deferred three
business choices. The user subsequently confirmed all three values; no default
or inferred value is used.

**Decision:** The approved implementation values are:

- **Signed-URL lifetime:** exactly **5 minutes / 300 seconds** on every URL.
- **Receipt scope:** **all receipts submitted for the order**, including the
  original and any correction. The server returns one URL per receipt-bearing
  payment row, ordered by creation time.
- **Eligibility:** re-view is available once a payment for the order is
  `approved` or `rejected`; `canceled` and `expired` orders are excluded, and at
  least one submitted receipt is required. Any non-canceled/non-expired order
  status is otherwise allowed. The tracking token remains the only credential;
  no order id, customer identity, admin id, token hash or storage path is
  accepted from the client.

**Implementation:** `src/features/payments/receipt-review.ts` is a `"use server"`
action that validates the existing 64-character lowercase-hex
`trackingTokenSchema`, resolves the order only through the service-role
`get_order_for_tracking` RPC and reads only receipt metadata for that resolved
order through `createSupabaseAdminClient()`. It returns
`{ ok: true, urls: string[] }` or one generic Spanish error. No database row,
`receipt_path`, token, hash or PII is returned. Signed URLs are minted with
`createSignedUrl(path, 300)`. `src/features/payments/receipt-review-control.tsx`
hosts an explicit native button, a single polite live region for loading and
errors, and a semantic list with disambiguated links. The private route
`src/app/(storefront)/seguimiento/[token]/page.tsx` hosts the control and is not
indexed.

**Consequences:** OQ-12 is **closed**. `payment-receipts` remains private with
administrator SELECT only; no storage policy, RLS grant, migration, client
storage listing or client table read was added. Upload, correction, approval,
rejection, SLA, reservation and two-attempt behavior are unchanged. Validation
covers invalid tokens, canceled/expired and eligible statuses, approval and
rejection, all receipts including an unreviewed correction, exact 300-second
lifetime, generic errors, cross-order isolation, ignored client-supplied
identifiers and absence of sensitive data. No remote project was contacted.


## 40. Admin Notifications — OQ-16 operationalization and Phase 6 general feature — status: proposed (documentation/planning)

**Context:** SPEC §13 requires Supabase Realtime notifications for both admins
for new orders, receipts, and relevant order/payment updates. Two related but
distinct objectives exist and must remain clearly separated:

1. **OQ-16 SLA inbox (migration prerequisite complete, activation pending):**
   migration `005_receipt_sla_notifications.sql` and
   `supabase/worker/sla-worker.mjs` implement overdue receipt-review notifications.
   Validated locally; migration applied in Staging and Production; deployment and
   runtime validation pending.
2. **Phase 6 General Admin Notifications (architecture defined/planned,
   implementation pending):** independent in-panel notifications for business
   events (new order, new/corrected receipt, new review) with Realtime,
   history, navigation, and read-state controls.

**Amendment (2026-11-24, unified worker hosting):** OQ-16 SLA processing is
integrated locally into `supabase/worker/runtime.mjs`, which hosts the BCV and SLA
workers in the **same existing Render Web Service** process. This changes hosting
topology only: one process/HTTP server/`/healthz`, independent scheduling and
failure isolation, idempotent shutdown. No new Render service or Background Worker
is authorized. SLA semantics (24h threshold, 15-min buckets, dedupe key, admin
fanout, service-role-only RPC, no business-state mutation) and BCV behavior are
unchanged. Deployment/activation remains pending and is documented in
`docs/WORKER_DEPLOYMENT.md`.

### Audit findings (repository evidence, 2026-11-24, branch `features/admin-notifications-docs`)

**Implemented (OQ-16):**
- **Schema/RPC/RLS:** migration 005 creates `receipt_submissions` and
  `admin_notifications`, immutability trigger, `private.close_pending_receipt_submission`,
  `approve_receipt_submission`, `process_sla_notifications(p_now timestamptz default null)`,
  admin SELECT on receipt history, admin SELECT/UPDATE-own on `admin_notifications`;
  service-role-only EXECUTE grants; dedupe UNIQUE
  `(receipt_submission_id, admin_id, interval_bucket)` with `ON CONFLICT DO NOTHING`.
- **Worker:** `supabase/worker/sla-worker.mjs` runs one cycle on startup then every
  `SLA_POLL_MS` (default 900000 / 15 min), calls only
  `rpc("process_sla_notifications", { p_now: null })`, avoids overlapping cycles,
  has structured JSON logs, graceful shutdown, env validation
  (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; optional
  `SLA_POLL_MS`, `SLA_SHUTDOWN_TIMEOUT_MS`). `package.json` exposes `worker:sla`.
- **Admin UI read path:** `src/features/admin/notifications.ts`
  `getUnreadAdminNotificationCount()` (own unread rows, `null` on error);
  `src/app/(admin)/admin/(panel)/layout.tsx` renders alerts pill only when count > 0.
- **Settings inbox:** `src/features/admin/settings-read.ts` provides
  `listAdminNotifications()` and `markAdminNotificationAsRead()`; settings page
  displays inbox items. Mark-as-read is wired but not exposed as an end-user control
  (ROADMAP/TASKS honest-unavailable scope).
- **Tests:** `receipt-sla-contract.test.ts`, `receipt-sla-migration.test.ts`,
  `sla-worker.test.ts` cover schema/RLS/dedupe/worker behavior.

**Missing/incomplete for observed notifications:**
- **Not deployed/activated:** migration 005 is applied in Staging and Production;
  the worker was validated locally. A standalone SLA worker exists; the local
  unified runtime now hosts it with the BCV worker in one Render Web Service
  process, but there is still no deployment or runtime evidence in the repo.
- **24-hour SLA delay:** `process_sla_notifications` only creates rows for
  `submitted_at <= v_now - interval '24 hours'`; recent receipts produce no rows.
- **No Realtime on `admin_notifications`:** migration 008 publishes
  `orders`, `payments`, `cancellation_requests` only; `admin_notifications` not
  published. UI has no Realtime subscription for notifications.
- **UI exposure limited:** alerts pill is count-only in layout; settings page has
  read-only inbox; mark-as-read action exists but no control exposed; no navigation
  to related order/payment/review from notification rows; no mark-all-read.
- **Both-admin visibility depends on runtime data:** RPC fans out to
  `administrators WHERE is_active`; both admins must be active and have valid
  sessions. Cannot verify runtime admin rows from repository.

**Root cause (from repository evidence and confirmed migration status):** OQ-16
notifications have not been observed because the system is **not operationalized**:
migration 005 is applied in Staging and Production, but `sla-worker.mjs` is not
deployed or running on a schedule. Secondary code-level limits also prevent a
full notification experience: 24-hour threshold, no `admin_notifications` Realtime
publication/subscription, and no exposed mark-as-read/mark-all/read navigation UI.
Runtime validation still requires worker deployment/logs, active admin rows, and
overdue pending `receipt_submissions`.

### Decision

- **Keep OQ-16 isolated.** Do not force general business events into the SLA
  schema/RPC/worker. Preserve migration 005 table/RLS/RPC semantics, dedupe key,
  24h+15min behavior, service-role-only execution, and "no business state mutation"
  invariant.
- **Operationalize OQ-16 as a dedicated track** before/alongside Phase 6. See
  TASKS "OQ-16 — Operationalization (activation pending)".
- **Implement Phase 6 General Admin Notifications as a separate feature** with its
  own data model/event lifecycle, while reusing proven security patterns (admin-only
  RLS, deterministic dedupe, DB as source of truth, server-side writes).
- **Do not reuse OQ-16 SLA worker for general events.** A separate write path is
  required for Phase 6 business events; any worker reuse decision must be explicit
  and preserve SLA isolation.

### Phase 6 proposed scope (no implementation yet)

- **Recipients:** both active administrators (`administrators.is_active = true`).
- **Events:** new order, new payment receipt, corrected/resubmitted payment
  receipt, new customer review.
- **Behavior:** unread counter, notifications list/history, navigate to related
  order/payment/review, mark one as read, mark all as read, dedupe/idempotency,
  realtime updates without page refresh.
- **Exclusions:** no customer-facing notifications, no email, no WhatsApp, no
  BCV worker changes, no OQ-16 SLA behavior changes.

### Unresolved decisions (block Phase 6 implementation)

1. **Data model:** extend `admin_notifications` for general events or create a
   separate general notification table/module while preserving SLA behavior and
   avoiding ambiguous mixed semantics.
2. **Event identity/dedupe:** deterministic dedupe key per event type/transition;
   corrected receipt must not duplicate original-receipt notification semantics;
   define keys for order creation, payment receipt submission, corrected receipt,
   and review creation.
3. **Write path:** DB trigger/RPC/server action consistent with existing domain
   boundaries; atomic with originating business action where required; no BCV
   coupling; no SLA RPC overload.
4. **Realtime:** publication/RLS/replica identity impact for selected table(s);
   client subscription must reconcile with DB and remain RLS-authorized.
5. **Read-state model:** per-admin read state for mark-one/mark-all; define
   whether mark-all is direct RLS update or constrained RPC; define unread count
   query source.
6. **Navigation contract:** stable target shape for order/payment/review deep
   links; avoid leaking PII/tokens; define behavior for deleted/hidden/inaccessible
   targets.

**Consequences:** No schema/code/UI/config change in this pass. OQ-16 migration
is applied in Staging and Production; runtime activation and validation remain
pending. Phase 6 remains planned. Docs capture audit evidence, operationalization
prerequisites, and blocking decisions.

## 39. Public product reviews, moderation, and ranking — status: accepted (local implementation)

**Context:** The store needs public product reviews without registration, with optional tracking-token verified reviews, admin moderation, realtime updates, and product ranking.

**Decision:** Implement additive migration `014_product_reviews.sql` with `product_reviews`, `product_review_aggregates`, private rate-limit ledger, RLS/force RLS, and additive Realtime publication for review tables. Public reads expose only published non-hidden reviews/aggregates for active products. Direct public table writes are revoked; anon receives only safe public review columns, authenticated has table SELECT constrained by RLS (published rows for non-admins, all rows for active admins), and no direct table UPDATE is granted. Submission uses `public.submit_product_review(...)` (SECURITY DEFINER, service_role execute) with server-side validation, advisory-locked submitter-hash rate limiting, server-side tracking-token verification via `get_order_for_tracking`, and DB unique index for one verified review per product per order. Moderation uses `set_product_review_hidden(...)` only, requiring active admin and writing `audit_log` actions `product_review.hide/restore`; hidden reviews remain in DB/admin views but are excluded from public reads and aggregates. Ranking uses Bayesian weighted rating `WR=(v/(v+m))*R+(m/(v+m))*C` with `C=4.0`, `m=5`; products with no published reviews receive no fabricated score.

**Consequences:** Migration 014 is applied in Staging and Production. Public submission is anonymous and rate-limited but not strong identity-based abuse-proofing. Realtime authorization relies on RLS; clients subscribe/refresh and reconcile. PR/push was not performed in that session.
