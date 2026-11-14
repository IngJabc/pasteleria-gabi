# `src/components` — Shared UI components

Presentational components reused across features (buttons, form fields, layout
primitives…). Components here are **pure UI**: they receive data through props
and emit events — no fetching, no Supabase calls, no business rules. That logic
belongs to `src/features` and `src/domain`.

Structure:

- `ui/` — generic, app-wide primitives.

Feature-specific components live next to their feature under
`src/features/<feature>/`, not here.
