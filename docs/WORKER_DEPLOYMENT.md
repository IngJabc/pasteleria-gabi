# Worker deployment: unified Render Web Service

## Scope and status

The repository now provides a unified runtime at
`supabase/worker/runtime.mjs` (`npm run worker:unified`) that runs **both**
existing backend workers in one Node.js process:

- BCV automatic exchange-rate synchronization.
- OQ-16 receipt-review SLA notifications.

This is intended for the **existing** Render Web Service
`pasteleria-bcv-worker`. It does **not** create or require any additional
Render service or Background Worker. The runtime is implemented locally;
deployment/activation is a separate manual action and has not been performed.
Local validation report: 39 test files / 396 tests PASS, `npm run typecheck`
PASS, `npm run build` PASS, and `git diff --check` PASS.

## Architecture

- One process, one HTTP server, one `/healthz` endpoint.
- Workers start independently:
  - BCV: Monday–Friday 09:00 and 13:00 `America/Caracas`.
  - SLA: immediate startup cycle, then every 15 minutes (configurable).
- Failure isolation: a failed worker is logged and restarted by its supervisor
  without stopping the other worker.
- No overlapping cycles: each worker retains its existing internal cycle guard.
- No detached/child processes and no shell background execution.
- Shutdown (`SIGTERM`/`SIGINT`) is idempotent and coordinates both workers and
  the HTTP server.
- Health requests never trigger BCV sync or SLA cycles.

## Environment variables

Required for both workers (same Supabase project credentials):

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:

- `PORT` — provided by Render; the runtime binds `0.0.0.0:$PORT`.
- `BCV_SYNC_FETCH_TIMEOUT_MS` — default `15000`.
- `BCV_SYNC_SHUTDOWN_TIMEOUT_MS` — default `10000`.
- `SLA_POLL_MS` — default `900000` (15 minutes).
- `SLA_SHUTDOWN_TIMEOUT_MS` — default `10000`.

Startup fails with a safe, actionable error naming missing variables; values are
never logged.

Local npm worker commands (`npm run worker:unified` and `npm run worker:sla`) use
Node’s `--env-file-if-exists=.env.local`. The file is optional locally, and
existing process environment values take precedence.

The Render start command remains `node supabase/worker/runtime.mjs`. Production
uses Render-injected env vars and needs no `.env.local`. The runtime logs no
secret values.

## Render configuration (manual)

Use the existing service only:

| Setting | Value |
| --- | --- |
| Service | `pasteleria-bcv-worker` (existing Web Service, Free plan) |
| Build command | `npm ci` |
| Start command | `node supabase/worker/runtime.mjs` |
| Health check path | `/healthz` |
| Environment | Add/confirm variables above in Render dashboard |

Do not add a second service or a Background Worker.

## Prerequisites (complete)

- All repository migrations are applied in both Supabase Staging and Supabase
  Production, including `015_bcv_sync_attempts.sql` and
  `005_receipt_sla_notifications.sql`.
- BCV and OQ-16 migration prerequisites are complete. Worker deployment,
  production activation and runtime validation remain pending.

## Deployment and verification

1. Commit/merge this runtime to the branch/tag Render deploys.
2. In Render, update start command to `node supabase/worker/runtime.mjs`.
3. Confirm variables/secrets exist; never paste credentials into logs or repo.
4. Deploy/restart the existing service manually.
5. Verify `GET /healthz` returns HTTP 200 with the backward-compatible payload
   `{ "status": "ok", "service": "bcv-sync", "uptime_seconds": ... }` plus
   additive `runtime` and `workers` fields.
6. Verify worker logs show both `bcv-sync` and `receipt-sla` started, and that
   SLA cycles call `process_sla_notifications` with metrics.
7. Validate SLA behavior for both active administrators with a receipt older
   than 24 hours; confirm unread counter and read behavior in admin UI.
8. Validate BCV behavior at the next scheduled slot or through a controlled
   test that respects existing idempotency/manual-override semantics.

## Rollback

- Application rollback: change the existing Render service start command back to
  `node supabase/worker/bcv-rate-worker.mjs` and redeploy. This stops OQ-16
  cycles and restores BCV-only behavior.
- Data rollback: none is required for these runtime changes; neither worker
  deletes notification/rate history. Do not apply destructive SQL.
- If OQ-16 behavior is undesired after rollback, keep migration 005 in place and
  stop invoking `process_sla_notifications`; existing rows remain informational.

## Important operational limitation

Render Free services may suspend after inactivity. UptimeRobot-style polling of
`/healthz` keeps the HTTP service warm but does **not** guarantee exact
scheduled execution of BCV slots or SLA cycles. The workers intentionally do
not catch up/replay missed cycles after restart: after downtime, BCV uses the
next future Caracas slot and SLA runs immediately on startup then resumes its
15-minute cadence.
