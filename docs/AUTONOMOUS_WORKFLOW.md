# Autonomous OpenCode workflow (`/autopilot`)

This repository ships a reusable, project-local OpenCode orchestration system.
One command starts or resumes one complete development objective; a human merges
the resulting Pull Request and runs the command again for the next objective.

## Installed environment

- Active harness: **OpenCode V2 (2.3.2)** — the environment where `/autopilot`
  runs. The 22 installed skills and the tools used here correspond to V2.
- Standalone CLI on `PATH`: `opencode-ai@1.17.15`. This is a stale OpenCode 1
  installation and currently rejects the user's V2 global config
  (`~/.config/opencode/opencode.jsonc`, `mcp.servers`). Do not use it to validate
  this project setup. The configuration below deliberately uses **native V2
  fields** (`permissions`, `policies`, `agents`, `default_agent`), verified
  against `https://opencode.ai/config.json`. Opening a fresh V2 session in the
  project reloads the definitions automatically.
- Repository remote facts (verified, not assumed): single remote `origin` =
  `https://github.com/IngJabc/pasteleria-gabi.git`; GitHub reports `fork: false`,
  owner `IngJabc`, default branch `main`. There is no separate fork remote; this
  user-owned canonical repository is both the verified push target for feature
  branches and the PR base. PR #9 (OQ-12) and PR #10 (this workflow) are merged
  into `main`; the current merge commit is
  `ca4357163c954afeea1e0fe288232f3936d7f4db`.

## Files created

| File | Purpose |
| --- | --- |
| `opencode.jsonc` | V2 project config: default agent, ordered denials and hard safety policies |
| `.opencode/commands/autopilot.md` | The reusable `/autopilot` slash command |
| `.opencode/agents/project-orchestrator.md` | Primary orchestrator |
| `.opencode/agents/autopilot-planner.md` | Read-only task selection and brief drafting |
| `.opencode/agents/autopilot-implementer.md` | Scoped code implementation |
| `.opencode/agents/autopilot-reviewer.md` | Independent read-only diff review |
| `.opencode/agents/autopilot-qa.md` | Validation and regression evidence |
| `.opencode/agents/autopilot-security.md` | Security/data-exposure review |
| `.opencode/agents/autopilot-docs.md` | Task, roadmap and technical documentation |
| `docs/skills-catalog.md` | Catalog of all 22 discovered skills |
| `docs/AUTONOMOUS_WORKFLOW.md` | This manual |
| `.opencode/autopilot-state.example.json` | Tracked template for the runtime state cache |
| `scripts/validate-autopilot.mjs` | Non-destructive definition, recovery and Git-safety checks |

`.opencode/autopilot-state.json` is created at runtime and gitignored. No new
npm dependency, plugin, MCP server or remote integration is required. PR
creation and merge-status verification do require an already authenticated
GitHub CLI or equivalent GitHub API capability; the workflow reports the exact
blocker if neither is available.

## Invocation

```text
/autopilot
```

Optional text after the command is treated as extra constraints for the current
objective, not as a replacement for task selection. A fresh V2 session is
recommended whenever agent or command definitions change so the registry is
reloaded.

## One invocation, one objective

1. **Inspect actual state.** Git status, remotes, upstreams, recent commits,
   GitHub PR state and authentication capability are checked every time.
2. **Protect user work.** Unrelated uncommitted changes stop the workflow. The
   agent never resets, cleans, stashes, overwrites or discards them.
3. **Resolve the checkpoint.**
   - Previous PR open → report number/URL/state and stop.
   - Previous PR merged (verified via GitHub metadata) → fetch verified remotes,
     fast-forward local `main`, confirm clean base.
   - Interrupted before PR → recover the existing branch and work; do not
     duplicate it.
4. **Identify remotes.** Fork and canonical are derived from Git config plus
   GitHub metadata. Feature branches are pushed only to the verified fork/user
   remote, never to `main`. Ambiguity stops the workflow.
5. **Create the branch.** `features/<descriptive-name>` from clean verified
   `main`. The infrastructure objective uses
   `features/autonomous-opencode-workflow`.
6. **Select work.** Highest-priority task in `TASKS.md`/`docs/ROADMAP.md` whose
   dependencies are satisfied and that is not already complete.
7. **Discover skills.** `docs/skills-catalog.md` is consulted and relevant
   skills are loaded with the `skill` tool before planning/implementation.
8. **Generate internal instructions.** The orchestrator writes its own scoped
   brief: objective, exclusions, acceptance criteria, tests, documentation and
   stop conditions. Users do not write implementation prompts.
9. **Delegate and implement.** Planner → implementer → independent reviewer →
   QA/security/docs, with findings repaired and validations rerun.
10. **Validate and document.** `npm run validate:autopilot`, `npm test`,
    `npm run lint`, `npm run typecheck`, `npm run build`, migration-safety checks
    where relevant, `git diff --check`, then `TASKS.md`, `docs/ROADMAP.md` and
    technical docs. The validation script never pushes, merges or changes files.
11. **Deliver.** Coherent commits, verified feature-branch push, PR to canonical
    `main` with scope/decisions/tests/risks, then verify the real PR URL.
12. **Stop at the human merge checkpoint.** The agent never merges or approves
    its own PR and never starts another objective in the same invocation.

## Skill routing

`docs/skills-catalog.md` lists every discovered skill with invocation details.
The orchestrator loads only skills relevant to the task:

- UI/frontend: `ui-ux-pro-max` (primary UI specialist), then
  `modern-web-guidance` (mandatory for HTML/CSS/client JS), `accessibility`,
  `web-design-guidelines`, `browser` for visual inspection.
- Backend/Supabase/Postgres: `supabase`, `supabase-postgres-best-practices`.
- Security: `security-audit`.
- Documentation: `writing-guidelines`.
- Performance/quality: `performance`, `core-web-vitals`, `web-quality-audit`,
  `best-practices`, `seo`, `vercel-optimize`.
- OpenCode/tooling: `opencode`; issue reporting: `report` (requires user
  confirmation and GitHub CLI).
- Vercel deployment skills are consultative only here: deployment or secrets
  changes require explicit authorization.

Skills do not override approved decisions, security rules or acceptance
criteria.

## Permissions and safety boundaries

Project `opencode.jsonc` adds ordered V2 denials for pushing to `main`,
force-pushing, deleting branches, merging PRs, hard reset/clean/stash/restore,
approving PRs, and remote Supabase pushes/resets. The same commands are repeated
as hard V2 policies (`tool.use`), which are evaluated after permissions, saved
approvals and agent rules and cannot be re-enabled by a later agent `allow`.
Subagents additionally cannot commit, push or open PRs; read-only agents also
cannot edit files. `npm run validate:autopilot` asserts that no agent definition
contains a matching push allow.

The workflow still requires agent judgment: shell patterns cannot block every
possible arbitrary HTTP call, and no workflow bypasses RLS, tests or migrations
safety. Prohibited without explicit authorization: remote SQL, `supabase db
push`, environment/secrets changes, deployments and PR merges.

## Recoverable state

The runtime cache `.opencode/autopilot-state.json` follows the tracked template
`.opencode/autopilot-state.example.json`. It records objective, branch, base
commit, verified push remote, commits, PR number/URL/state, validation results,
recovery context and next action. The `context` object tracks whether there was
a previous objective, unrelated changes, an interrupted branch, a dirty base,
an eligible task and prior recovery. The cache is written at objective start,
after each phase and at the PR checkpoint. Git, GitHub and the task
documentation are the source of truth; on disagreement, reconstruct from them
and treat the cache as a hint only.

The recovery rules are deliberately simple: unrelated changes stop the run; an
open PR stops the run; an unverified prior merge stops the run; interrupted work
on a known branch is resumed; a clean verified base with no active PR proceeds
to task selection; no eligible task stops the run. `npm run validate:autopilot`
exercises these transitions with template-shaped states and never touches the
network or the worktree. It is reusable across objectives: it checks that work
is on a `features/...` branch and that no secret or generated file was changed,
rather than hardcoding one objective's file list.

## Troubleshooting

- **`/autopilot` not listed:** reload the project in a V2 session so
  `.opencode/commands/autopilot.md` is registered.
- **Subagent unavailable:** the orchestrator performs that role directly and
  reports the limitation.
- **PR cannot be created:** report the exact authentication/CLI/API blocker.
  Local work and commits remain safe; never claim a PR exists.
- **Previous PR merge cannot be verified:** stop rather than starting another
  objective.
- **Definition drift:** run `npm run validate:autopilot` before starting a new
  objective; it reports missing files, invalid frontmatter, missing skills and
  safety-rule regressions.
- **Stale CLI errors:** use the V2 harness, not `opencode-ai@1.17.15` on `PATH`.
