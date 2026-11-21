---
description: Start or resume one complete autonomous development objective, ending at the human PR-merge checkpoint
agent: project-orchestrator
---

Run the autonomous development workflow defined in `docs/AUTONOMOUS_WORKFLOW.md`.

$ARGUMENTS

Execute exactly one coherent objective in this invocation:

1. Inspect the real Git and GitHub state; protect any unrelated local changes.
2. If a previous PR is still open, report it and stop. If it is merged,
   synchronize `main`; if work is interrupted before a PR, recover that branch.
3. Read `TASKS.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`, `SPEC.md` and the
   source tree; select the highest-priority executable task with satisfied
   dependencies.
4. Discover and load relevant installed skills (`docs/skills-catalog.md`) and
   write your own detailed internal execution brief (scope, exclusions,
   acceptance criteria, tests, documentation).
5. Use the specialized subagents for planning, implementation, independent
   review, QA, security and documentation. Fix every genuine finding.
6. Run the full validation set, update the task/roadmap/technical documentation,
   audit the diff, then create coherent commits.
7. Push only the verified feature branch to the verified fork remote, open a PR
   against canonical `main`, verify the real PR URL and remote state.
8. Stop at the human merge checkpoint. Never merge or approve your own PR, never
   push to `main`, and never start another objective in this invocation.

Ask the user only for a genuine business decision, security authorization, or
unavailable external dependency. Do not ask them to write implementation prompts.
Report exact validation results, commit hash, branch and PR URL; if any step is
blocked, state the precise blocker and do not claim success.
