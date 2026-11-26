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
**only for OQ-16** as recorded below. #40 records the Phase 6 planning blockers;
#41 records the accepted local implementation that resolves them without
rewriting #40 or changing the OQ-16 track.

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

**Implementation note (manual-registration diagnostics):** server actions map
PostgREST/service-role failures to actionable Spanish messages by SQLSTATE and
stable message fragments, and log only a category plus nullable code. This does
not alter rate rules, grants, idempotency, the `observed_at` uniqueness rule or
any snapshot behavior; a duplicate observation timestamp still requires a human
choice and is never retried automatically.

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

---

## 41. General Admin Notifications — local implementation resolving #40 blockers — status: accepted (local implementation; remote validation pending)

**Context:** SPEC §13 asks for in-panel notifications for both administrators when an online order is created, a receipt is submitted, relevant order/payment events occur, or the OQ-16 review SLA is exceeded. #40 separated the OQ-16 SLA inbox (migration 005 plus the dedicated worker) from the Phase 6 general feature and recorded six blocking architecture decisions. #40 is left unchanged as the historical planning record; this decision accepts the local implementation that resolves all six blockers. OQ-16 tables/RPC/worker semantics, BCV workers, other migrations and every earlier decision stay isolated and unchanged. No external notification channel (e-mail, WhatsApp API, outbox) is introduced.

**Decision:**

1. **Separate data model.** Migration `supabase/migrations/016_general_admin_notifications.sql` creates `public.admin_general_notifications`; `public.admin_notifications` is **not** extended and remains the OQ-16 SLA inbox. Four event families are accepted: `new_order` (online orders only — POS orders emit no customer-inbox event), `payment_receipt`, `receipt_correction` and `product_review`. Receipt rows keep their `payment_id` under `ON DELETE RESTRICT` so immutable history cannot be silently orphaned. All user-facing summaries and inbox labels are Spanish.
2. **Deterministic event identity.** Keys carry the event-type prefix and the originating row id: `new_order:<order_id>`, `payment_receipt:<receipt_submission_id>`, `receipt_correction:<receipt_submission_id>`, `product_review:<review_id>`. `UNIQUE (event_key, admin_id)` with `ON CONFLICT DO NOTHING` gives per-recipient idempotency across retries, reconnects and multi-tab use; a CHECK ties each key shape to its event type.
3. **Transactional write path.** `AFTER INSERT` triggers on `orders` (guarded by `channel = 'online'`) and `product_reviews`; `AFTER UPDATE OF payment_id` on `receipt_submissions` guarded by `OLD.payment_id IS NULL AND NEW.payment_id IS NOT NULL`. That guard is required because migration 006 introduced the link and migration 011's `submit_payment_evidence` fills `payment_id` **after** `hold_order_reservations` created the row with NULL evidence; a plain INSERT trigger would emit the receipt event too early. Private `SECURITY DEFINER` triggers call a private `SECURITY DEFINER` fanout helper with `SET search_path = ''`, inserting one row per currently **active** administrator in the originating transaction. No new worker, polling loop, external channel or rewrite of existing RPC bodies is added.
4. **Read state.** `read_at` is nullable (`NULL` = unread). Direct `UPDATE` is RLS-scoped to the caller's own rows and column-granted only for `read_at`; a `BEFORE UPDATE` trigger rejects changes to every other column and to a `read_at` earlier than `created_at`. Mark-all updates only the caller's own rows where `read_at IS NULL`. Clients have no INSERT or DELETE privilege and no trusted client-supplied admin id: all reads and mutations resolve the administrator from the session (`requireActiveAdminId`) and filter by that id.
5. **Realtime.** The table is added to `supabase_realtime` with a catalog-checked membership guard (repeatable, no-op when the publication is absent), retaining the **default replica identity** — no `REPLICA IDENTITY FULL`. INSERT events carry the full new row and are the source of truth; the client does not rely on `payload.old` or on UPDATE delivery. The browser subscriber applies one delayed reconnect, ignores repeated failures, and debounces `router.refresh()`; there is no polling. Rationale: RLS, not the old-row image, authorizes the payload; full replica identity would only widen WAL records under RLS and would not improve authorization. Revisit only if Staging runtime validation proves that UPDATE delivery is required for correctness.
6. **Navigation contract.** `new_order` → `/admin/pedidos/<order_id>`; both receipt families → `/admin/comprobantes?orderId=<order_id>`; `product_review` → `/admin/resenas?productId=<product_id>`. Targets are derived only from validated ids already present in the notification row; a missing target renders no link / an unavailable state, with no token or PII in the URL.

**Implementation at the time of #41 (superseded in presentation by #42):** migration 016 exists locally and has **NOT** been applied to any remote project; `src/infrastructure/database/database.types.ts` was updated manually to reflect the new table (regeneration from the migration should be verified before delivery). The implementation adds the Spanish `/admin/notificaciones` inbox manager, a server-only data/action module (`src/features/admin/general-notifications.ts`), client-safe event/key/navigation helpers, a Realtime refresh subscriber, a sidebar **Notificaciones** badge sourced from the general unread count, and static contract plus mocked tests. Behavioral SQL tests were written but **skipped** because local PostgreSQL binaries were unavailable in that environment. The OQ-16 topbar alerts pill still reads `admin_notifications`; the two unread sources remain separate.

**Validation status (implementer-reported, independently rechecked locally only):** focused tests **26 passed / 7 skipped** (the skipped cases are the behavioral SQL tests); full `npm test` **321 passed / 127 skipped**; receipt/payment/SLA/inventory regression subset **112 passed / 74 skipped**; `npm run typecheck` passed; `npx eslint` on all **22 changed `.ts`/`.tsx` files** passed; `npm run build` passed with `/admin/notificaciones` in the route table; `git diff --check` passed with a CRLF normalization notice for `layout.tsx`. Repository-wide `npm run lint` is still red on pre-existing unmodified files and was not changed here. These are local results only — no remote migration, deployment, Realtime delivery or Staging/Production runtime validation succeeded or is claimed here. Phase 6 as a whole remains open: migration 016 application and runtime validation are human/remote actions, and OQ-16 worker deployment/activation remains on its separate track.

**Alternatives rejected:** extending the OQ-16 `admin_notifications` table (mixed semantics and dedupe keys); a dedicated worker or polling loop (the write is already atomic with the business event); trusted client-supplied admin ids (forgeable, #13/#31); `REPLICA IDENTITY FULL` (larger WAL without improving RLS authorization); client INSERT/DELETE or unrestricted UPDATE grants (bypass per-admin ownership and immutability); a mark-all RPC (the RLS-scoped direct UPDATE is sufficient).

**Consequences:** Two durable in-app inboxes now coexist with clear ownership: SLA (`admin_notifications`, migration 005, worker-driven) and general events (`admin_general_notifications`, migration 016, trigger-driven). The general inbox renders the newest 200 rows and states that older rows may exist, avoiding silent truncation. Both remain informational: the database is the source of truth (SPEC §13) and a Realtime event never mutates state. Event keys make retries safe, and the immutable columns plus column-level grant keep recipient and read state trustworthy. Cost: three additional triggers and private definer functions, one extra index pair, and a manual `database.types.ts` update that must be rechecked when migration 016 is applied. Runtime confirmation of Realtime INSERT delivery, RLS filtering and fanout in Staging/Production is still required before the phase gate can close.

---

## 42. Unified administrator notification inbox — status: accepted (local implementation; remote validation pending)

**Context:** Phase 6 created a separate general notification table while the OQ-16 SLA inbox remained on its own migration-005 table. The admin panel therefore exposed two unread indicators (a topbar pill for SLA rows and a sidebar badge for general rows) and a duplicated SLA card under Configuración → Operación y notificaciones. Users had to visit two places to see all activity, SLA rows had no exposed link or read action, and the SLA table was not published to Realtime. #40 and #41 remain the historical data-model decisions; this decision unifies the presentation without merging tables or changing SLA behavior.

**Decision:**

1. **One inbox, two durable sources.** `/admin/notificaciones` is the only notification surface. Its page reads both `admin_general_notifications` and `admin_notifications` through server-side, session-scoped reads and merges them newest-first. The general cap stays at 200 rows and the SLA cap at 50 rows; each cap has an explicit Spanish truncation notice. Configuración → Operación y notificaciones no longer renders the SLA list; it keeps the title “Dos manos, un mismo cuidado” and links to the unified inbox with “Abrir notificaciones”.
2. **Real destinations only.** Every summary and target is a Next.js `<Link>` when a validated id exists: general rows reuse `generalNotificationHref`; SLA rows resolve `receipt_submissions.order_id` and link to `/admin/comprobantes?orderId=<orderId>`. If the lookup fails or the id is missing, the row renders plain text and no link. No token or PII is placed in a URL. Summary and target links have Spanish `aria-label` values; mark-read controls remain separate buttons.
3. **Read-state rules preserved.** General rows keep mark-read and mark-unread. SLA rows stay mark-read-only. “Marcar todo como leído” calls both the existing general mark-all action and a new narrow SLA action sequentially; the SLA action derives the administrator from `requireActiveAdminId()`, rejects unsafe ids before any database write, and updates only that administrator's `read_at IS NULL` rows. There is no client INSERT/DELETE, no client-supplied admin id, and no change to `process_sla_notifications`, the worker, the 24 h/15 min cadence, dedupe keys, triggers or receipt rules.
4. **One badge.** The panel layout sums the two independently available unread counts. A single accessible sidebar **Notificaciones** badge shows the real total (visual cap `99+`) with a Spanish screen-reader label such as `Notificaciones, 3 notificaciones sin leer`; it renders nothing when both sources are unavailable and still shows the available count when only one is unavailable. The topbar `alertsLabel` / `admin-alerts-pill` props and markup were removed along with the now-unused CSS rule.
5. **Realtime for both tables.** Local-only migration `017_unified_notifications_realtime.sql` repeats migration 016's catalog guard: it adds `public.admin_notifications` to `supabase_realtime` only when the publication exists and the table is not already a member. It adds no grant, policy, function, trigger, RLS change or `REPLICA IDENTITY FULL`. The browser subscribes to `INSERT` on both tables, filters each channel by the server-resolved `admin_id`, ignores `payload.old`, debounces `router.refresh()`, attempts one delayed reconnect per channel, cleans up on unmount and never polls.

**Implementation (local, uncommitted):** the merge/read helpers, unified manager, two-channel Realtime component, settings link card, combined badge, SLA order-id read mapping, a dedicated top-level `"use server"` SLA actions module, migration 017 and focused static/mocked tests were added in the working tree. A partially unavailable source renders “Consulta incompleta” rather than an all-clear empty inbox, and the 200/50 cap notices say older history *may* exist instead of asserting it does. Migrations 016 and 017 both remain local-only; no remote project was contacted, no migration was applied and no database schema change accompanied this presentation-only unification.

**Validation status:** focused Vitest coverage includes combined unread counts, SLA order-id mapping and unsafe-id rejection, SLA mark-all scoping and revalidation, clickable unified hrefs, INSERT-only Realtime configuration, the full migration catalogs and the static migration-017 contract. Locally, the focused suite passed **143 tests / 7 skipped (21 files passed, 1 skipped)** with exit code 0; `npm test` passed **352 tests / 127 skipped (43 files passed, 9 skipped)** with exit code 0; `npm run typecheck`, `npx eslint` on all **34 changed `.ts`/`.tsx` files**, `npm run build` and `git diff --check` all exited 0 (the whitespace check only reported the pre-existing CRLF notice for `layout.tsx`). Independent read-only code and security reviews found no blocking findings; their low-severity items (SLA safe-integer guard, partial-failure empty state, cautious truncation wording, Realtime cleanup contract, README migration status) were repaired. Runtime Realtime delivery and Staging/Production behavior remain unverified.

**Alternatives rejected:** keeping two badges or two inboxes (user confusion and duplicate SLA card); merging the database tables or reusing general event keys for SLA rows (#40/#41 isolation); trusting a client-provided admin id or client-side writes (forgeable); `REPLICA IDENTITY FULL` (wider WAL without improving RLS authorization); UPDATE/DELETE subscriptions or polling (INSERT rows are sufficient and simpler); inventing a receipt link without an order id (unsafe navigation).

**Consequences:** Administrators now see one Spanish inbox and one unread count while the two tables, write paths and SLA semantics stay independent. The database remains the source of truth: Realtime only triggers a refresh. The 200/50 caps keep list work bounded and honest. Operational risk is limited to local presentation code plus a repeatable publication-membership migration; applying migrations 016/017 and validating Realtime, RLS and worker runtime behavior in Staging/Production remain human/remote phase gates.

**Finding note (admin Realtime report, investigation only):** Report: general notifications appear only after a reload in the admin panel. Local code mounts `UnifiedNotificationsRealtime` inside `ToastProvider` with INSERT-only subscriptions on both tables, a server-derived `admin_id` filter, a Spanish toast, a debounced `router.refresh()` and one delayed reconnect per channel.

Leading cause: migrations 016 and 017 are local-only and unapplied remotely; 016 publishes `admin_general_notifications` and 017 publishes `admin_notifications`. Without publication membership, Postgres Changes events never reach the browser, so only a reload runs the server read path. Installed `@supabase/supabase-js` 2.119.0 sets Realtime auth on `INITIAL_SESSION`/`SIGNED_IN`/`TOKEN_REFRESHED`, and `@supabase/realtime-js` calls `setAuth` on connect; no repo evidence supports an auth race.

Human gate: apply and confirm 016/017 in Staging, then Production; confirm both tables are published; trigger real general events for both active admins; verify INSERT delivery, toast, inbox/badge update without reload and RLS/filter behavior. Clarify whether the report covers general rows or the unified inbox including OQ-16 SLA rows; OQ-16 worker deployment stays a separate track. This note changes no decision, adds no polling and claims no fix.

---

## 43. Local UI feedback and notification opening — status: accepted (local implementation; local browser sampling done, remote validation pending)

**Context:** #41/#42 established the durable two-source notification model and one Spanish admin inbox, but opening a link did not clear the unread state, Realtime only refreshed the page silently, the storefront had no visible cue when an item entered the bag, and the primary navigation was unavailable below the `md` breakpoint. These are local presentation gaps; the data model, RLS, SLA cadence and cart authority must remain untouched.

**Decision:**

1. **Flying cart number.** `src/features/cart/cart-flight.ts` is a small client-safe pub/sub. The real «Agregar al carrito» button in `product-detail.tsx` passes its clicked element; `announceCartFlight` reads the rect at click time and broadcasts only a `+N` label plus numeric center coordinates. `CartFlightLayer` in `site-header.tsx` resolves the bag via `data-cart-target`, computes the target center with `getBoundingClientRect()`, and renders `aria-hidden` chips inside a `pointer-events-none fixed inset-0 z-[60]` overlay so they never occupy header space. The 32px chip is centered with negative margins and animated with the Web Animations API using pixel-only `translate()` and opacity keyframes (600 ms, `cubic-bezier(0.22, 0.8, 0.3, 1)`) and removed on finish; this avoids both custom CSS keyframes and the percentage `calc()` transforms that left the earlier animation `pending` in Chromium. Brand lavender/plum styling uses compiled Tailwind utilities. The launch point must be visible; the header bag may be scrolled out of view, in which case the chip flies toward its real coordinates and exits the viewport naturally. The chip is decorative: totals, prices, stock rules, localStorage schema, server validation and the existing success toast are unchanged. No chip is created when `prefers-reduced-motion: reduce` matches, the launch point is offscreen, or an endpoint is unavailable; the global reduced-motion rule stays intact.
2. **Mobile hamburger.** `site-header.tsx` adds a `md:hidden` 44×44 px button with SVG `MenuIcon`/`CloseIcon` in the shared 24×24 stroke style, `aria-controls="storefront-mobile-nav"`, toggling `aria-expanded` and Spanish labels «Abrir menú» / «Cerrar menú». A mobile-only `<nav id="storefront-mobile-nav" aria-label="Navegación móvil">` shows the same three real destinations as an `absolute inset-x-0 top-full z-40` overlay below the header, so opening it never pushes page content down. Opening and closing transition Tailwind's `translate` property and `opacity` in 200 ms with `ease-out`; `motion-reduce:transition-none`, `aria-hidden` and `tabIndex={-1}` keep the closed panel inert. It closes on link click, on Escape (returning focus to the toggle) and on any `usePathname()` change: the open state records the pathname and a render-time previous-pathname comparison resets it, including browser history navigation that did not use a header link. Query-only navigations do not reset it because the component deliberately does not subscribe to search params. This avoids a cascading state update in an effect. The storefront layout wraps the header in `Suspense` because that hook is runtime-only on partially prerendered tracking routes. The literal «Bolsa» text/separator collapse below `sm`, keeping the icon, count and Spanish `aria-label`; desktop nav and bag behavior remain as before.
3. **Auto-read on open.** In `general-notifications-manager.tsx`, both the summary and destination `<Link>`s call one shared handler. For an unread item with a real href and a safe id it calls `setAdminGeneralNotificationReadAction({ notificationId, read: true })` for general rows or `markAdminNotificationAsRead({ notificationId })` for SLA rows. The call is fire-and-forget (`onClick` only): no `preventDefault`, so normal Next.js navigation, modifier clicks and keyboard activation are preserved. Failures are swallowed without inventing local state; existing mark-read/mark-unread buttons and mark-all behavior are untouched. After a successful SLA update the client refreshes the route so the shared unread badge matches the row just opened; the SLA server action itself, RLS, tables and SLA rules stay unchanged.
4. **In-app Realtime toast.** `general-notifications-realtime.tsx` uses the existing `useToast()` provider. Each INSERT from either table shows Spanish text from `payload.new`; a valid non-empty general `summary` is displayed, otherwise the generic «Tienes una notificación nueva.» / «Hay un aviso SLA de comprobante nuevo.» is used. `payload.old` is never read. A bounded in-memory dedupe keyed by real row id avoids duplicate toasts from replayed deliveries of the same row. The debounced `router.refresh()`, one delayed reconnect per channel, cleanup and INSERT-only configs from #42 are preserved. There is no polling or new dependency.
5. **Explicit delivery boundaries.** Browser/system push, service workers, VAPID, permission prompts, e-mail, WhatsApp and any other external channel remain rejected. These changes are local-only UI code: no new migration or schema change, no remote project contact, no `.env.local` edit and no deployment.

**Implementation (local, uncommitted):** added `cart-flight.ts`, `cart-flight-layer.tsx`, `notification-realtime-toast.ts`, focused helper/static contract tests, the SVG menu icons, the header/menu changes, the Suspense mount, the shared link handler and the toast wiring. Independent review repairs made the menu reset on any pathname change (including browser history) and refresh the route after a successful SLA auto-read so the shared badge stays truthful. Migrations 016/017 and the image-host fix in `next.config.ts` were preserved unchanged by this work.

**Validation status (final local):** UI-focused suite **32 passed / 6 files (exit 0)**; broader notification/UI focused suite **90 passed / 7 skipped (17 files passed, 1 skipped; exit 0)**; `npm test` **379 passed / 127 skipped (47 files passed, 9 skipped; exit 0)**; `npm run typecheck` exit 0; `npx eslint` passed on all **47 changed `.ts`/`.tsx` files** before the visual repair and on the **6 final cart/menu files** after it; `npm run build` exit 0 with the full route table; `git diff --check` exit 0 with only CRLF normalization notices for the pre-existing admin layout and the rewritten `site-header.tsx`. After the visual defect report, the focused cart/menu suites passed **20 tests / 3 files**. Manual local browser sampling confirmed the `+1` chip moved from the add button toward the bag (`x=144,y=373` → `x≈884,y≈-853`, bag center `x≈884,y≈-852`), faded to zero and unmounted after the 600 ms animation, while the mobile nav faded/slid with `main` top unchanged; no console errors were observed. Independent reviews found no blocking findings; the accepted low-severity wildcard Supabase image host from the earlier fix remains unchanged. No Realtime delivery, Staging/Production behavior or remote migration is claimed.

**Alternatives rejected:** browser Notification API / system push, VAPID, service workers and permission prompts (unrequested OS-level channel); e-mail, WhatsApp or other external providers (excluded by #41/#42); client-side optimistic read state or forged ids (server actions and RLS stay authoritative); `preventDefault` or programmatic routing in the link handler (would break native Link semantics); polling or UPDATE/DELETE subscriptions (INSERT rows remain sufficient); moving `usePathname()` into server-only code or setting a blocking route (would weaken prerendering); animating layout properties or ignoring reduced motion (performance/accessibility regressions).

**Consequences:** Customers get a lightweight, accessible bag cue and usable mobile navigation; administrators get links that clear unread state and immediate in-panel feedback for new rows. All new state is ephemeral presentation state. Local browser sampling is complete, but formal 375 px appearance/timing review and actual Realtime delivery still need human/Staging validation; the database remains the source of truth and #40/#41/#42 remain intact.

**Local amendment note (visual repair):** The current local repair uses a 36px chip kept at opacity `1` in high-contrast plum/white with `font-black` weight and scales `1 → 1.08 → 1` only near the bag. Flight ids assign four deterministic lanes with a reduced destination offset. A real finish triggers a transform-only bag bounce (`scale 1 → 1.06 → 1`, `translateY 0 → -2px → 0`) that another arrival cancels and restarts. Reduced motion skips both effects; no fade, blur, glow, trails, filter, `calc()` transform, custom CSS keyframes, new dependency or cart-data change applies. The earlier browser sample noted an early fade to zero; validation of this repair remains pending. This note does not change the #43 decision.

---

## 44. Storefront quantity controls respect displayed stock — status: accepted (local implementation; focused suites passed, full suite red for 3 unrelated failures)

**Context:** On `/productos/[slug]`, «Agregar al carrito» accepted repeated clicks past displayed stock while the `+/-` selector respected it. The same gap appears on `/carrito`, where `+` can raise a line past displayed stock. Both are local presentation defects, not a new business rule. The server already checks stock at checkout, and adding an item never reserves inventory.

**Decision:** Add a pure `resolveAddToCartCapacity` helper and use it for both product-detail controls. Remaining capacity is the server-provided `available` value minus the same product's quantity already in the local bag. A single add cannot exceed displayed stock; repeated adds stop at remaining capacity, and the button disables with Spanish feedback at zero. Unknown stock (`available === null`) keeps the existing fallback with no client cap and leaves the final check to the server.

For `/carrito`, extend the environment-neutral capacity helper with `canIncreaseCartItemQuantity(available, quantity)`. The server renders an active-product stock map through `getActiveProductStockMap()` in `public-data.ts`. That server-only helper selects active product ids, reuses `getProductStockMap` and the service-role-only `get_product_stock` RPC, reads no inventory tables directly, and fails closed to `{}`. The `+` control disables at known stock limits, gives an accurate accessible label, and explains the limit in a Spanish `LiveRegion`. The `-` control stays enabled so shoppers can correct stale over-stock carts. Prices, totals, checkout links, the `localStorage` schema, cart context, server validation and reservations stay unchanged.

**Validation status (final local):** the combined focused Vitest run passed **16 files and 158 tests**, covering cart capacity, the new cart client contract, cart flight, migration 018 and related database contracts, and guest payments. Cart-only focused Vitest passed **4 files and 47 tests**; migration-018-focused Vitest passed **5 files and 47 tests**. ESLint returned no output for all **22 changed or added `.ts`/`.tsx` files**, `npm run typecheck` passed with no diagnostics, `npm run build` passed with Next.js 16.4.6 and **25 routes**, and `git diff --check` was clean. `npm test` is not green: **549 total tests, 546 passed, 3 failed; 59 files, 57 passed, 2 failed**. The three failures are unchanged pre-existing and unrelated: `general-notifications-migration.test.ts` local PostgreSQL query `operator is not unique: text || "char"`, `general-notifications-migration.test.ts` `pago_movil requires a BCV snapshot and VES total`, and `general-notifications-manager.test.ts` static expectation using `\n` against a CRLF source file. The three failing tests remain unchanged.

**Alternatives rejected:** trusting repeated clicks or a client counter detached from displayed stock; letting `/carrito` grow without a cap; reading inventory tables from the browser; reserving inventory on add; changing cart storage, prices, checkout or server validation.

**Consequences:** Shoppers get clearer feedback and fewer false rejections at checkout on both screens. The local guards prevent obvious over-adds but do not replace server authority. No inventory write, reservation, price, checkout or localStorage schema change occurs. Focused local validation passed; the full suite stays red only for the three unrelated pre-existing failures recorded in TASKS.md. No remote migration or deployment is part of this work.

---

## 45. New-order notification timing: accepted (local implementation; focused suites passed; full suite red for 3 unrelated failures; Staging application user-reported; Production and runtime Realtime gates open)

**Context:** The admin `new_order` alert fired when a shopper confirmed contact and delivery on `/checkout/entrega`. The confirmed rule treats «Hacer pedido» on `/checkout/pago` as order formalization, so the earlier alert reported abandoned drafts as new orders.

**Decision:** Emit `new_order` only at payment formalization. Digital checkout uses an `AFTER UPDATE OF payment_id` trigger on `receipt_submissions`, guarded by `OLD.payment_id IS NULL AND NEW.payment_id IS NOT NULL`; this is the evidence-link step reached by «Hacer pedido», not the earlier quote-acceptance submission INSERT. Pay-in-store «Hacer pedido» calls the service-role-only `notify_online_order_formalized(p_order_id bigint)` RPC after validation and before clearing the checkout cookie. Both paths act only for valid, non-canceled and non-expired online orders. The event key stays `new_order:<order_id>` and the summary stays «Nuevo pedido online recibido.». Local-only migration `018_formalized_order_notifications.sql` drops migration 016's old `AFTER INSERT ON public.orders` trigger and function. No order creation, price, stock, reservation, payment, RLS, policy, publication or replica-identity behavior changes.

**Alternatives rejected:** notifying on order draft creation; deleting or backfilling older rows; client-written notifications.

**Validation status (final local):** the combined focused Vitest run passed **16 files and 158 tests**, covering cart capacity, the new cart client contract, cart flight, migration 018 and related database contracts, and guest payments. Cart-only focused Vitest passed **4 files and 47 tests**; migration-018-focused Vitest passed **5 files and 47 tests**. ESLint returned no output for all **22 changed or added `.ts`/`.tsx` files**, `npm run typecheck` passed with no diagnostics, `npm run build` passed with Next.js 16.4.6 and **25 routes**, and `git diff --check` was clean. `npm test` is not green: **549 total tests, 546 passed, 3 failed; 59 files, 57 passed, 2 failed**. The three failures are unchanged pre-existing and unrelated: `general-notifications-migration.test.ts` local PostgreSQL query `operator is not unique: text || "char"`, `general-notifications-migration.test.ts` `pago_movil requires a BCV snapshot and VES total`, and `general-notifications-manager.test.ts` static expectation using `\n` against a CRLF source file. The three failing tests remain unchanged. This work performed no commit, push, PR, remote migration application, Supabase connection, deployment or secret change. You reported that a human applied migrations 016, 017 and 018 in Staging only. No agent contacted a remote or verified Staging here. Production application and runtime Realtime delivery verification remain human and pending.

**Consequences:** Administrators get alerted when checkout is actually formalized, and abandoned drafts no longer alert. Existing early rows remain history with no backfill or deletion. You reported a human applying migrations 016, 017 and 018 in Staging only; no agent verified Staging or runtime Realtime delivery. Production application and runtime Realtime validation remain human and pending.
