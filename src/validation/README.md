# `src/validation` — Zod schemas

Input schemas validated at the application boundary — before anything reaches
the domain or the database.

Rules:

- **Validate on the server.** Client-side validation is only for feedback; the
  authoritative parse happens in server actions and route handlers.
- Never trust client-provided prices, inventory quantities, delivery fees or
  payment status: schemas must reject or ignore them, and the server recomputes
  every amount (SPEC §16).
- One schema per input shape; infer TypeScript types with `z.infer` instead of
  duplicating them by hand.

Planned schemas (documented in `docs/ROADMAP.md`, **not implemented yet**):
`checkout-input`, `payment-receipt`, `inventory-adjustment`, `walk-in-sale`,
`product-input`, `store-settings`.

Environment variables are validated with Zod as well, in
`src/infrastructure/env.ts` (they are configuration, not user input, so they
live with the infrastructure they configure).
