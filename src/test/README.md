# `src/test` — Testing utilities

Shared helpers for Vitest: fixtures, factories and fakes that keep tests short.

Current state (Phase 0): the test suite is small and lives next to the code it
covers as `*.test.ts(x)` files under `src/`. This folder stays reserved for the
moment helpers are needed by more than one module.

Conventions:

- Test files are colocated: `src/infrastructure/env.test.ts` tests
  `src/infrastructure/env.ts`.
- Tests must not require network access, a remote Supabase project or real
  credentials. External services get fakes in this folder.
- Vitest runs in the `node` environment (`vitest.config.mts`). jsdom + React
  Testing Library will be added only when there is UI worth testing
  (see `docs/DECISIONS.md`).
- Run once with `npm test`; watch mode with `npm run test:watch`.
