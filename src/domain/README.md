# `src/domain` — Domain layer

Framework-free business types, invariants and rules.

Rules for this folder:

- **No imports** from React, Next.js, Supabase, Zod or any UI/infrastructure code.
- Pure functions and plain TypeScript types only, so they can be unit tested in
  isolation with Vitest (`node` environment).
- Business decisions are encoded here once and reused by every entry point
  (storefront, admin panel, server actions).

Planned contents (documented in `docs/ROADMAP.md`, **not implemented yet**):

| Module | Responsibility |
| --- | --- |
| `types/` | Core entities: product, inventory batch/movement, order, payment, refund… |
| `orders/` | Order and payment state machines and allowed transitions (SPEC §10). |
| `inventory/` | FIFO reservation/allocation rules, reservation expiry (SPEC §8). |
| `money/` | USD/VES amount handling, rounding rule snapshots (SPEC §4). |
| `delivery/` | Delivery zones and fee classification rules (SPEC §6). |

Nothing is invented before the business confirms the rules (see the pending
discovery items in `SPEC.md` section 19).
