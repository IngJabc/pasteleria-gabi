/**
 * OQ-16 — receipt-review SLA worker (backend only).
 *
 * Runs one atomic database cycle (`public.process_sla_notifications`) on startup
 * and then every 15 minutes. The RPC itself owns idempotency (UNIQUE +
 * ON CONFLICT DO NOTHING), so multiple worker instances are safe; this process
 * only avoids overlapping cycles within itself.
 *
 * It uses the SAME Supabase client library, environment variables and service-
 * role options as `src/infrastructure/supabase/admin.ts`. It cannot import that
 * module directly: it is TypeScript (with `@/` aliases) and imports `server-only`,
 * which throws outside Next.js's React Server Component runtime.
 *
 * Local execution (Node 22+):
 *   node --env-file=.env.local supabase/worker/sla-worker.mjs
 * Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Optional env: SLA_POLL_MS, SLA_SHUTDOWN_TIMEOUT_MS.
 *
 * No external notification provider is configured in this repository: the
 * durable in-app inbox (`admin_notifications`) IS the delivery. This worker
 * never marks anything as "externally delivered".
 */

import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const WORKER_NAME = "receipt-sla";
export const DEFAULT_POLL_MS = 15 * 60 * 1000;
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

/** Structured, single-line JSON logs. No customer data is ever logged. */
export function createLogger({
  now = () => new Date(),
  write = (line) => console.log(line),
} = {}) {
  function emit(level, event, fields) {
    write(
      JSON.stringify({
        timestamp: now().toISOString(),
        level,
        worker: WORKER_NAME,
        event,
        ...(fields ?? {}),
      }),
    );
  }
  return {
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };
}

/** Fails closed if the RPC returns an unexpected payload. */
function parseMetrics(data) {
  const required = [
    "bucket",
    "pending_submissions",
    "due_submissions",
    "active_administrators",
    "notifications_created",
    "processed_at",
  ];
  if (!data || typeof data !== "object") {
    throw new Error("process_sla_notifications returned no payload");
  }
  for (const key of required) {
    const expected = key === "processed_at" ? "string" : "number";
    if (typeof data[key] !== expected) {
      throw new Error(`process_sla_notifications returned an invalid ${key}`);
    }
  }
  return {
    bucket: data.bucket,
    pending_submissions: data.pending_submissions,
    due_submissions: data.due_submissions,
    active_administrators: data.active_administrators,
    notifications_created: data.notifications_created,
    processed_at: data.processed_at,
  };
}

/**
 * One SLA cycle. Calls ONLY the service-role RPC; no table writes here.
 * Errors are logged and re-thrown so the caller can isolate them per cycle.
 */
export async function processSlaCycle({
  rpc,
  logger = createLogger(),
  clock = () => new Date(),
}) {
  const startedAt = clock();
  try {
    const { data, error } = await rpc("process_sla_notifications", { p_now: null });
    if (error) {
      throw new Error(error.message ?? "process_sla_notifications failed");
    }
    const metrics = parseMetrics(data);
    logger.info("sla_cycle_complete", {
      duration_ms: clock() - startedAt,
      ...metrics,
    });
    return metrics;
  } catch (error) {
    logger.error("sla_cycle_failed", {
      duration_ms: clock() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/** Abortable delay; injectable so tests never wait 15 real minutes. */
export function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Worker lifecycle: immediate cycle, then one cycle per poll interval, never
 * overlapping within this process. Shutdown interrupts the sleep, waits for an
 * in-progress cycle with a bounded timeout, and always resolves `done`.
 */
export function createSlaWorker({
  rpc,
  logger = createLogger(),
  pollMs = DEFAULT_POLL_MS,
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  sleep = defaultSleep,
  clock = () => new Date(),
  runCycle = processSlaCycle,
} = {}) {
  const controller = new AbortController();
  let stopping = false;
  let running = false;
  let inFlight = null;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  function cycle() {
    if (running) return inFlight;
    running = true;
    const startedAt = clock();
    inFlight = Promise.resolve()
      .then(() => runCycle({ rpc, logger, clock }))
      .catch(() => {
        // Already logged by processSlaCycle; one bad cycle must not kill the loop.
      })
      .finally(() => {
        running = false;
        logger.info("sla_cycle_finished", {
          duration_ms: clock() - startedAt,
        });
      });
    return inFlight;
  }

  async function loop() {
    logger.info("worker_started", {
      poll_ms: pollMs,
      shutdown_timeout_ms: shutdownTimeoutMs,
    });
    try {
      do {
        await cycle();
        if (stopping) break;
        await sleep(pollMs, controller.signal);
      } while (!stopping);
    } catch (error) {
      if (!stopping) {
        logger.error("worker_loop_error", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      logger.info("worker_stopped", { status: "stopped" });
      resolveDone();
    }
  }

  let loopPromise = null;
  function start() {
    if (loopPromise) return loopPromise;
    loopPromise = loop();
    return loopPromise;
  }

  async function stop(signal = "manual") {
    if (stopping) {
      await done;
      return;
    }
    stopping = true;
    controller.abort();
    logger.info("worker_shutdown", {
      signal,
      waiting_for_cycle: running,
    });
    // Use a real timer instead of the injected poll `sleep`: it can be cleared
    // on a clean stop, so a later false "timeout" cannot be logged after the
    // worker has already exited gracefully.
    let timeoutTimer;
    const timedOut = new Promise((resolve) => {
      timeoutTimer = setTimeout(() => {
        logger.error("worker_shutdown_timeout", {
          timeout_ms: shutdownTimeoutMs,
        });
        // Bounded wait: release `done` even if a cycle is still in flight so a
        // scheduler can terminate the process instead of hanging forever.
        resolveDone();
        resolve("timeout");
      }, shutdownTimeoutMs);
    });
    await Promise.race([done, timedOut]);
    clearTimeout(timeoutTimer);
    await done;
  }

  return { start, stop, done, isRunning: () => running };
}

function positiveInt(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** CLI entry point. Kept separate so tests can import the pure functions. */
export async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required",
    );
  }

  // Mirrors createSupabaseAdminClient(): same library, env vars and options.
  const supabase = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  const rpc = (name, args) => supabase.rpc(name, args);

  const logger = createLogger();
  const worker = createSlaWorker({
    rpc,
    logger,
    pollMs: positiveInt(process.env.SLA_POLL_MS, DEFAULT_POLL_MS),
    shutdownTimeoutMs: positiveInt(
      process.env.SLA_SHUTDOWN_TIMEOUT_MS,
      DEFAULT_SHUTDOWN_TIMEOUT_MS,
    ),
  });

  const shutdown = (signal) => {
    void worker.stop(signal).then(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  worker.start();
  await worker.done;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  void main().catch((error) => {
    console.error(JSON.stringify({ event: "worker_fatal", error: String(error) }));
    process.exit(1);
  });
}
