# `src/components` — Shared UI components

Presentational components reused across features (buttons, form fields, layout
primitives…). Components here are **pure UI**: they receive data through props
and emit events — no fetching, no Supabase calls, no business rules. That logic
belongs to `src/features` and `src/domain`.

Structure:

- `ui/` — generic, app-wide primitives.
- `layout/` — storefront chrome (top bar, header, footer).
- `admin/` — administrative shell: fail-closed-aware `AdminShell`, the
  `usePathname`-driven sidebar and the presentational primitives used by all
  admin screens (`AdminPageHeader`, `AdminSurface`, `AdminTable`, status chips,
  banners and empty states). Pure UI only; all data comes from `src/features/admin`.

Feature-specific components live next to their feature under
`src/features/<feature>/`, not here.
