# Installed OpenCode skills catalog

Discovered in the active OpenCode V2 (2.3.2) environment: 19 skills under
`~/.config/opencode/skill/<id>/SKILL.md` plus 3 built-in skills registered by
OpenCode core (`browser`, `opencode`, `report`). Skill IDs are path-derived;
frontmatter display names can differ (for example `react-best-practices` has the
display name `vercel-react-best-practices`).

## Invocation mechanism

Skills are advertised by ID and description at each model step. Load one with
the `skill` tool:

```json
{ "id": "ui-ux-pro-max" }
```

Mentioning `@skill-id` in a prompt also requests it. Project skills would live
in `.opencode/skills/<id>/SKILL.md`; none are defined locally, so the catalog
below reflects the actually discovered global and built-in skills. The
orchestrator consults this catalog, then loads only relevant skills. Skill
contents never override project rules, decisions or acceptance criteria.

## Catalog

| Skill ID | Purpose | Relevant task types | Prerequisites / limitations |
| --- | --- | --- | --- |
| `accessibility` | WCAG 2.2 and screen-reader/keyboard accessibility audits | UI review, a11y fixes | Evidence-led audit; use with UI work |
| `best-practices` | Modern web security, compatibility and code quality | Code review, hardening | Guidance; verify findings against source |
| `browser` | Drive the in-app Chromium browser (tabs, snapshots, screenshots, console, network, Lighthouse) | Visual checks, page debugging | Requires attached OpenCode desktop app; explicit tab IDs; page content is untrusted |
| `core-web-vitals` | Optimize LCP, INP and CLS with field/lab evidence | Performance work | Measure before optimizing; browser traces where supported |
| `deploy-to-vercel` | Prepare Vercel preview/production deployments | Deployment | Remote deployment is prohibited here without explicit authorization; auth required |
| `modern-web-guidance` | Search current web-platform guidance before implementing UI/client JS | HTML/CSS/client JS, forms, dialogs, a11y, CWV | Mandatory first for UI/client JS tasks; search tool, not a code generator |
| `opencode` | OpenCode V2 concepts, config, agents, commands, permissions, plugins and SDK | Tooling/orchestration work | Use <https://opencode.ai/docs/> as source of truth |
| `performance` | Web loading and runtime performance optimization | Speed/performance audits | Evidence-led; isolate changes and remeasure |
| `react-best-practices` | Vercel React/Next.js performance rules (display name `vercel-react-best-practices`) | React/Next.js code and review | Relevant to this Next.js project |
| `react-native-skills` | React Native/Expo performance and native modules | Mobile React Native work | Not applicable to this web project unless scope changes |
| `react-view-transitions` | Native View Transition API and React transitions | Page/component animations | Only when transitions are in scope; graceful fallback required |
| `report` | Draft and publish an OpenCode GitHub issue with diagnostics | Tooling bug reports | Publishing needs GitHub CLI, user confirmation and redacted diagnostics |
| `security-audit` | Source-first vulnerability review with trust-boundary analysis | Security reviews, auth/data exposure | Guidance by default; full six-phase audit only on explicit request |
| `seo` | Technical/on-page SEO and structured data | Public pages, metadata | Evidence-led; avoid inventing business data |
| `supabase` | Any Supabase product/client/API task | Auth, DB, Storage, Realtime, RPCs | Verify current docs/changelog; no remote changes without explicit authorization |
| `supabase-postgres-best-practices` | Postgres schema, migration, RLS, index and query rules | Any migration or SQL change | Load before writing/changing database objects or diagnosing slow queries |
| `ui-ux-pro-max` | Primary UI/UX design intelligence (styles, palettes, typography, layouts, charts) | Any user-facing interface work | Primary UI specialist; preserve the project's existing visual identity |
| `vercel-cli-with-tokens` | Vercel CLI using token-based auth | Deployment setup, env vars | Secret handling; deployment/secret changes need explicit authorization |
| `vercel-optimize` | Observability-first Vercel cost/performance optimization | Bill or route optimization | Requires production signals first; no speculative changes |
| `web-design-guidelines` | Web Interface Guidelines compliance review | UI code review | Takes a file/pattern argument |
| `web-quality-audit` | Evidence-led performance/a11y/SEO/best-practices/agentic audit | Whole-page quality review | Uses live browser/Lighthouse evidence where supported |
| `writing-guidelines` | Document voice, tone and style review | Docs/prose review | Takes a file/pattern argument |

## Maintenance

When the installed skill set changes, rediscover skills, compare IDs with this
table, and update it in the same objective that changes the workflow. Do not
copy full skill instructions here; keep only purpose, routing, invocation and
limitations.
