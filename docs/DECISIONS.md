# DECISIONS

Key architectural decisions, in lightweight ADR form: *Context → Decision →
Consequences*. Superseding a decision should be done by adding a new entry here
(status: accepted, replaces #N). Entries #1–#11 were made in Phase 0; entries
#12–#23 were made in Phase 1A (database & security design); entry #24 was made
in Phase 1A.1 (reservation lifecycle correction); entries #25–#26 resolve the
final M3 open questions OQ-16 and OQ-17. #25 is implemented by
`supabase/migrations/005_receipt_sla_notifications.sql` plus the narrow
service-role worker in `supabase/worker/sla-worker.mjs` (validated locally,
not applied remotely or deployed); #26 is implemented in Phase 4 by
`supabase/migrations/004_quote_acceptance.sql` (validated locally, not applied
remotely). The no-worker scope of #1 is amended **only for OQ-16** as recorded
below.

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
Component fails at build time. The `Database` generic is deliberately omitted
until real migrations exist (no invented schema).

**Consequences:** One seam to audit; credentials cannot silently leak to the
client. `server-only` adds one tiny dependency, justified by the service-role
rule in SPEC §16.

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

**Decision:** Rate/total columns are copied onto `orders` at creation;
`exchange_rates` stores fetched rates for lookup/fallback but is deliberately
**not** referenced by FK from orders.

**Consequences:** Order history survives any edit/pruning of rate rows (true
snapshot semantics); queries need no join. Trade-off: rate rows and orders can
diverge — irrelevant, since the snapshot is authoritative.

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
the shape is defined — acceptable for two fields nothing reads yet. The table
never stores secrets (it is publicly readable by design).

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
provider/outbox is introduced — the in-app inbox is the delivery. Migration
005 and `supabase/worker/sla-worker.mjs` are validated locally only; they have
**not** been applied remotely or deployed.

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
migration 004 has **not** been applied remotely. OQ-16 is implemented
separately by migration 005 and the narrow worker described in #25.
