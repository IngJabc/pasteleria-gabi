# DECISIONS

Key architectural decisions for Phase 0, in lightweight ADR form:
*Context → Decision → Consequences*. Superseding a decision should be done by
adding a new entry here (status: accepted, replaces #N).

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
