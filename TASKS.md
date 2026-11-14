# TASKS

Living checklist. Update the status when a task is actually completed and
verified — never mark a task done without running its validation.

---

## Phase 0 — Project initialization ✅ (complete)

Setup:

- [x] Initialize the Next.js application in the current directory (Next.js
      16.4.6, App Router, `src/` directory) — `create-next-app` with TypeScript,
      Tailwind CSS, ESLint.
- [x] Configure TypeScript strict mode (`tsconfig.json` → `"strict": true`).
- [x] Configure Tailwind CSS (v4, Turbopack loader in `next.config.ts`).
- [x] Configure ESLint (flat config, `eslint-config-next` core-web-vitals +
      TypeScript).
- [x] Install Supabase packages: `@supabase/supabase-js`, `@supabase/ssr` —
      client modules prepared, **no remote project connected**.
- [x] Install `zod` (validation) and `server-only` (service-role guard).

Structure:

- [x] Application routes: `src/app` with `(storefront)` and `(admin)/admin`
      route groups (placeholder pages only, no business features).
- [x] Shared components: `src/components` (+ README).
- [x] Features/modules: `src/features` (+ README listing planned modules).
- [x] Domain types and business rules: `src/domain` (+ README; no rules
      invented yet).
- [x] Infrastructure and external services: `src/infrastructure` (Supabase
      browser/server/service-role clients, Zod-validated environment).
- [x] Validation schemas: `src/validation` (+ README).
- [x] Testing utilities: `src/test` (+ README).

Testing and tooling:

- [x] Configure Vitest (`vitest.config.mts`, `@` alias, node environment,
      `npm test` / `npm run test:watch`, `npm run typecheck` script).
- [x] Create a basic working test: `src/infrastructure/env.test.ts`
      (6 assertions: valid input, missing variable, invalid URL, empty key,
      fail-fast in `process.env`, read-back).

Documentation and configuration:

- [x] Add `.env.example` with documented variable names (placeholders only, no
      credentials) and un-ignore it in `.gitignore`.
- [x] Add `README.md` (installation, development, testing, deployment).
- [x] Add `docs/ROADMAP.md`.
- [x] Add `docs/ARCHITECTURE.md`.
- [x] Add `docs/DECISIONS.md`.
- [x] Add this `TASKS.md`.

Validation (Phase 0):

- [x] `npm test` — **1 test file, 6 tests passed**.
- [x] `npm run lint` — **clean (exit 0)**; verified the script really discovers
      files using a temporary file with a deliberate parsing error (flagged,
      exit 1), then re-ran clean after removal.
- [x] `npx tsc --noEmit` — **clean (exit 0)** (run after `npm run build` so the
      generated route types exist).
- [x] `npm run build` — **successful**; routes `/` and `/admin` prerendered as
      static, TypeScript passed inside the build.
- [x] Inspected final project structure and configuration.

Explicitly NOT done in Phase 0 (per instructions):

- [ ] Business features (catalog, cart, checkout, payments, inventory, order
      management, authentication flows).
- [ ] Database migrations or any invented schema.
- [ ] Connection to a remote Supabase project.
- [ ] Recreating Figma screens.
- [ ] Any commit or push.

---

## Phase 1 — Foundation: database, catalog and admin access ⬜

Documented intent (details in `docs/ROADMAP.md`), not yet started:

- [ ] Create the Supabase project and fill `.env.local` (credentials stay out of
      source code).
- [ ] Initial migration: products, images, store settings; RLS on every table.
- [ ] Generate TypeScript database types and add the `Database` generic to the
      three Supabase clients.
- [ ] Public catalog pages (list + detail) fed from the database; public bucket
      for product photographs.
- [ ] Supabase Auth for the two administrators; admin role validated in the
      database; protected `/admin` shell (server-side check).
- [ ] Admin product CRUD.
- [ ] Resolve pending discovery items that block Phase 1: final catalog,
      prices, photographs, visual identity (SPEC §19).

Later phases: see `docs/ROADMAP.md` (inventory → checkout/orders → payments →
admin panel/POS → realtime/communication/settings).
